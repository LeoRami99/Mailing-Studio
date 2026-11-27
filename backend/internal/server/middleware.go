package server

import (
	"context"
	"net/http"
	"strings"

	"github.com/zegirulabs/misiva/backend/internal/security"
	"github.com/zegirulabs/misiva/backend/internal/store"
)

type ctxKey int

const authPrincipalKey ctxKey = 1

// Principal representa al usuario autenticado en una petición (vía sesión o token MCP).
type Principal struct {
	User      store.User
	AuthKind  string // "session" | "api_token"
	SessionID string
	TokenID   string
	Scopes    map[string]bool
}

func (p Principal) HasScope(scope string) bool {
	if p.AuthKind == "session" {
		return true
	}
	return p.Scopes[scope]
}

func principalFromCtx(ctx context.Context) (Principal, bool) {
	p, ok := ctx.Value(authPrincipalKey).(Principal)
	return p, ok
}

func extractSessionToken(r *http.Request) string {
	if c, err := r.Cookie(SessionCookieName); err == nil && strings.TrimSpace(c.Value) != "" {
		return strings.TrimSpace(c.Value)
	}
	auth := strings.TrimSpace(r.Header.Get("Authorization"))
	if strings.HasPrefix(auth, "Bearer ") {
		tok := strings.TrimSpace(strings.TrimPrefix(auth, "Bearer "))
		if !strings.HasPrefix(tok, "misiva_mcp_") {
			return tok
		}
	}
	return ""
}

func extractAPIToken(r *http.Request) string {
	auth := strings.TrimSpace(r.Header.Get("Authorization"))
	if strings.HasPrefix(auth, "Bearer ") {
		tok := strings.TrimSpace(strings.TrimPrefix(auth, "Bearer "))
		if strings.HasPrefix(tok, "misiva_mcp_") {
			return tok
		}
	}
	return ""
}

func (s *Server) authenticateRequest(r *http.Request) (*Principal, error) {
	if apiTok := extractAPIToken(r); apiTok != "" {
		verified, err := s.store.VerifyAPITokenHash(r.Context(), security.SHA256Hex(apiTok))
		if err != nil {
			return nil, err
		}
		scopeMap := make(map[string]bool, len(verified.Scopes))
		for _, sc := range verified.Scopes {
			scopeMap[sc] = true
		}
		return &Principal{
			User:     verified.User,
			AuthKind: "api_token",
			TokenID:  verified.TokenID,
			Scopes:   scopeMap,
		}, nil
	}

	if sessTok := extractSessionToken(r); sessTok != "" {
		user, sess, err := s.store.GetSessionByTokenHash(r.Context(), security.SHA256Hex(sessTok))
		if err != nil {
			return nil, err
		}
		return &Principal{
			User:      user,
			AuthKind:  "session",
			SessionID: sess.ID,
		}, nil
	}

	return nil, store.ErrNotFound
}

func (s *Server) checkMutationCSRF(w http.ResponseWriter, r *http.Request) bool {
	if r.Method == http.MethodGet || r.Method == http.MethodHead || r.Method == http.MethodOptions {
		return true
	}
	if !s.trustedMutation(r) {
		writeError(w, http.StatusForbidden, "Origen no permitido.")
		return false
	}
	return true
}

func (s *Server) requireAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.checkMutationCSRF(w, r) {
			return
		}
		p, err := s.authenticateRequest(r)
		if err != nil || p == nil {
			writeError(w, http.StatusUnauthorized, "Inicie sesión para continuar.")
			return
		}
		ctx := context.WithValue(r.Context(), authPrincipalKey, *p)
		next(w, r.WithContext(ctx))
	}
}

func (s *Server) requireSessionAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.checkMutationCSRF(w, r) {
			return
		}
		p, err := s.authenticateRequest(r)
		if err != nil || p == nil || p.AuthKind != "session" {
			writeError(w, http.StatusUnauthorized, "Esta operación requiere una sesión interactiva activa.")
			return
		}
		ctx := context.WithValue(r.Context(), authPrincipalKey, *p)
		next(w, r.WithContext(ctx))
	}
}

func (s *Server) requireScope(scope string, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.checkMutationCSRF(w, r) {
			return
		}
		p, err := s.authenticateRequest(r)
		if err != nil || p == nil {
			writeError(w, http.StatusUnauthorized, "No autorizado.")
			return
		}
		if !p.HasScope(scope) {
			writeError(w, http.StatusForbidden, "El token no tiene el permiso requerido ("+scope+").")
			return
		}
		ctx := context.WithValue(r.Context(), authPrincipalKey, *p)
		next(w, r.WithContext(ctx))
	}
}

func (s *Server) requireAdmin(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.checkMutationCSRF(w, r) {
			return
		}
		p, err := s.authenticateRequest(r)
		if err != nil || p == nil || p.AuthKind != "session" {
			writeError(w, http.StatusUnauthorized, "Inicie sesión para continuar.")
			return
		}
		if p.User.Role != "admin" {
			writeError(w, http.StatusForbidden, "Se requieren permisos de administrador.")
			return
		}
		ctx := context.WithValue(r.Context(), authPrincipalKey, *p)
		next(w, r.WithContext(ctx))
	}
}
