package server

import (
	"errors"
	"net/http"
	"net/mail"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/zegirulabs/misiva/backend/internal/security"
	"github.com/zegirulabs/misiva/backend/internal/store"
)

func validEmail(email string) bool {
	if len(email) < 3 || len(email) > 320 {
		return false
	}
	parsed, err := mail.ParseAddress(email)
	return err == nil && strings.EqualFold(parsed.Address, email) && strings.Contains(email, "@")
}

func (s *Server) rateLimitKey(scope string, r *http.Request, identity string) string {
	return security.SHA256Hex(scope + ":" + clientIP(r) + ":" + identity)
}

func (s *Server) handleRegister(w http.ResponseWriter, r *http.Request) {
	if !s.trustedMutation(r) {
		writeError(w, http.StatusForbidden, "Origen no permitido.")
		return
	}
	var req struct {
		Name     string `json:"name"`
		Email    string `json:"email"`
		Company  string `json:"company"`
		Password string `json:"password"`
	}
	if err := readJSON(r, 32*1024, &req); err != nil {
		writeError(w, http.StatusBadRequest, "Datos de registro inválidos.")
		return
	}

	name := strings.TrimSpace(req.Name)
	if n := utf8.RuneCountInString(name); n < 2 || n > 80 {
		writeError(w, http.StatusBadRequest, "Escriba un nombre de entre 2 y 80 caracteres.")
		return
	}
	email := security.NormalizeEmail(req.Email)
	if !validEmail(email) {
		writeError(w, http.StatusBadRequest, "Escriba un correo electrónico válido.")
		return
	}
	company := strings.TrimSpace(req.Company)
	if utf8.RuneCountInString(company) > 120 {
		writeError(w, http.StatusBadRequest, "El nombre de la empresa no debe superar 120 caracteres.")
		return
	}
	pwLen := utf8.RuneCountInString(req.Password)
	if pwLen < 12 {
		writeError(w, http.StatusBadRequest, "Use al menos 12 caracteres en la contraseña.")
		return
	}
	if pwLen > 128 {
		writeError(w, http.StatusBadRequest, "La contraseña no debe superar 128 caracteres.")
		return
	}

	rlKey := s.rateLimitKey("register", r, email)
	allowed, err := s.store.AllowAuthAttempt(r.Context(), rlKey, 5, 15*time.Minute, 15*time.Minute)
	if err == nil && !allowed {
		writeError(w, http.StatusTooManyRequests, "Demasiados intentos. Espere 15 minutos.")
		return
	}

	hash, err := security.HashPassword(req.Password)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "No se pudo procesar la contraseña.")
		return
	}

	user, err := s.store.CreateUser(r.Context(), name, email, company, hash)
	if err != nil {
		if errors.Is(err, store.ErrEmailExists) {
			writeError(w, http.StatusConflict, "Ya existe una cuenta con ese correo.")
			return
		}
		writeError(w, http.StatusInternalServerError, "No se pudo crear la cuenta.")
		return
	}

	rawToken, err := security.RandomToken(32)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "No se pudo iniciar la sesión.")
		return
	}
	expiresAt := time.Now().UTC().Add(time.Duration(s.cfg.SessionDays) * 24 * time.Hour)
	ip := clientIP(r)
	if _, err := s.store.CreateSession(r.Context(), user.ID, security.SHA256Hex(rawToken), r.UserAgent(), ip, expiresAt); err != nil {
		writeError(w, http.StatusInternalServerError, "No se pudo guardar la sesión.")
		return
	}
	_ = s.store.RecordAudit(r.Context(), user.ID, "auth.register", ip, "role="+user.Role)

	s.setSessionCookie(w, r, rawToken, expiresAt)
	writeJSON(w, http.StatusCreated, map[string]any{
		"user":         user,
		"sessionToken": rawToken,
		"expiresAt":    expiresAt.Format(time.RFC3339),
	})
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	if !s.trustedMutation(r) {
		writeError(w, http.StatusForbidden, "Origen no permitido.")
		return
	}
	var req struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := readJSON(r, 32*1024, &req); err != nil {
		writeError(w, http.StatusUnauthorized, "Correo o contraseña incorrectos.")
		return
	}

	email := security.NormalizeEmail(req.Email)
	if !validEmail(email) || req.Password == "" || len(req.Password) > 256 {
		writeError(w, http.StatusUnauthorized, "Correo o contraseña incorrectos.")
		return
	}

	rlKey := s.rateLimitKey("login", r, email)
	allowed, err := s.store.AllowAuthAttempt(r.Context(), rlKey, 10, 15*time.Minute, 15*time.Minute)
	if err == nil && !allowed {
		writeError(w, http.StatusTooManyRequests, "Demasiados intentos. Espere 15 minutos.")
		return
	}

	ip := clientIP(r)
	user, err := s.store.GetUserByEmail(r.Context(), email)
	if err != nil || !security.VerifyPassword(user.PasswordHash, req.Password) {
		_ = s.store.RecordAudit(r.Context(), "", "auth.login_failed", ip, "email="+email)
		writeError(w, http.StatusUnauthorized, "Correo o contraseña incorrectos.")
		return
	}
	if !user.Active {
		_ = s.store.RecordAudit(r.Context(), user.ID, "auth.login_suspended", ip, "")
		writeError(w, http.StatusForbidden, "Esta cuenta ha sido desactivada por un administrador.")
		return
	}

	_ = s.store.ClearAuthAttempts(r.Context(), rlKey)

	rawToken, err := security.RandomToken(32)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "No se pudo iniciar la sesión.")
		return
	}
	expiresAt := time.Now().UTC().Add(time.Duration(s.cfg.SessionDays) * 24 * time.Hour)
	if _, err := s.store.CreateSession(r.Context(), user.ID, security.SHA256Hex(rawToken), r.UserAgent(), ip, expiresAt); err != nil {
		writeError(w, http.StatusInternalServerError, "No se pudo guardar la sesión.")
		return
	}
	_ = s.store.RecordAudit(r.Context(), user.ID, "auth.login", ip, "")

	s.setSessionCookie(w, r, rawToken, expiresAt)
	writeJSON(w, http.StatusOK, map[string]any{
		"user":         user,
		"sessionToken": rawToken,
		"expiresAt":    expiresAt.Format(time.RFC3339),
	})
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	if !s.trustedMutation(r) {
		writeError(w, http.StatusForbidden, "Origen no permitido.")
		return
	}
	if tok := extractSessionToken(r); tok != "" {
		_ = s.store.DeleteSessionByTokenHash(r.Context(), security.SHA256Hex(tok))
	}
	s.clearSessionCookie(w, r)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleLogoutAll(w http.ResponseWriter, r *http.Request) {
	p, _ := principalFromCtx(r.Context())
	revoked, err := s.store.DeleteOtherSessions(r.Context(), p.User.ID, p.SessionID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "No se pudieron cerrar las demás sesiones.")
		return
	}
	_ = s.store.RecordAudit(r.Context(), p.User.ID, "auth.logout_others", clientIP(r), "")
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "revoked": revoked})
}

func (s *Server) handleSession(w http.ResponseWriter, r *http.Request) {
	p, err := s.authenticateRequest(r)
	if err != nil || p == nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"authRequired":  true,
			"authenticated": false,
			"backend":       "go",
			"dbDriver":      s.store.Driver(),
			"user":          nil,
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"authRequired":  true,
		"authenticated": true,
		"backend":       "go",
		"dbDriver":      s.store.Driver(),
		"user":          p.User,
	})
}

func (s *Server) handleGetMe(w http.ResponseWriter, r *http.Request) {
	p, _ := principalFromCtx(r.Context())
	writeJSON(w, http.StatusOK, map[string]any{
		"user":     p.User,
		"authKind": p.AuthKind,
	})
}

func (s *Server) handleUpdateMe(w http.ResponseWriter, r *http.Request) {
	p, _ := principalFromCtx(r.Context())
	var req struct {
		Name    *string `json:"name"`
		Email   *string `json:"email"`
		Company *string `json:"company"`
	}
	if err := readJSON(r, 32*1024, &req); err != nil {
		writeError(w, http.StatusBadRequest, "Datos inválidos.")
		return
	}

	name := p.User.Name
	if req.Name != nil {
		name = strings.TrimSpace(*req.Name)
		if n := utf8.RuneCountInString(name); n < 2 || n > 80 {
			writeError(w, http.StatusBadRequest, "El nombre debe tener entre 2 y 80 caracteres.")
			return
		}
	}
	email := p.User.Email
	if req.Email != nil {
		email = security.NormalizeEmail(*req.Email)
		if !validEmail(email) {
			writeError(w, http.StatusBadRequest, "Escriba un correo válido.")
			return
		}
	}
	company := p.User.Company
	if req.Company != nil {
		company = strings.TrimSpace(*req.Company)
		if utf8.RuneCountInString(company) > 120 {
			writeError(w, http.StatusBadRequest, "El nombre de la empresa no debe superar 120 caracteres.")
			return
		}
	}

	updated, err := s.store.UpdateUserProfile(r.Context(), p.User.ID, name, email, company)
	if err != nil {
		if errors.Is(err, store.ErrEmailExists) {
			writeError(w, http.StatusConflict, "Ya existe otra cuenta con ese correo.")
			return
		}
		writeError(w, http.StatusInternalServerError, "No se pudo actualizar el perfil.")
		return
	}
	_ = s.store.RecordAudit(r.Context(), p.User.ID, "user.profile_updated", clientIP(r), "")
	writeJSON(w, http.StatusOK, map[string]any{"user": updated})
}

func (s *Server) handleChangePassword(w http.ResponseWriter, r *http.Request) {
	p, _ := principalFromCtx(r.Context())
	var req struct {
		CurrentPassword string `json:"currentPassword"`
		NewPassword     string `json:"newPassword"`
	}
	if err := readJSON(r, 32*1024, &req); err != nil {
		writeError(w, http.StatusBadRequest, "Datos inválidos.")
		return
	}
	if n := utf8.RuneCountInString(req.NewPassword); n < 12 || n > 128 {
		writeError(w, http.StatusBadRequest, "La nueva contraseña debe tener entre 12 y 128 caracteres.")
		return
	}

	fullUser, err := s.store.GetUserByID(r.Context(), p.User.ID)
	if err != nil || !security.VerifyPassword(fullUser.PasswordHash, req.CurrentPassword) {
		writeError(w, http.StatusUnauthorized, "La contraseña actual es incorrecta.")
		return
	}

	hash, err := security.HashPassword(req.NewPassword)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "No se pudo procesar la contraseña.")
		return
	}
	if err := s.store.UpdateUserPassword(r.Context(), p.User.ID, hash); err != nil {
		writeError(w, http.StatusInternalServerError, "No se pudo cambiar la contraseña.")
		return
	}
	// Por seguridad, revoca todas las sesiones excepto la sesión actual.
	_, _ = s.store.DeleteOtherSessions(r.Context(), p.User.ID, p.SessionID)
	_ = s.store.RecordAudit(r.Context(), p.User.ID, "auth.password_changed", clientIP(r), "")
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleListSessions(w http.ResponseWriter, r *http.Request) {
	p, _ := principalFromCtx(r.Context())
	sessions, err := s.store.ListUserSessions(r.Context(), p.User.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "No se pudieron listar las sesiones.")
		return
	}
	for i := range sessions {
		if sessions[i].ID == p.SessionID {
			sessions[i].Current = true
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"sessions": sessions})
}

func (s *Server) handleRevokeSession(w http.ResponseWriter, r *http.Request) {
	p, _ := principalFromCtx(r.Context())
	id := strings.TrimSpace(r.PathValue("id"))
	if id == "" {
		writeError(w, http.StatusBadRequest, "Identificador de sesión requerido.")
		return
	}
	revoked, err := s.store.DeleteSessionByID(r.Context(), p.User.ID, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "No se pudo revocar la sesión.")
		return
	}
	if id == p.SessionID {
		s.clearSessionCookie(w, r)
	}
	writeJSON(w, http.StatusOK, map[string]any{"revoked": revoked})
}
