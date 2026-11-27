package server

import (
	"encoding/json"
	"errors"
	"log"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/zegirulabs/misiva/backend/internal/config"
	"github.com/zegirulabs/misiva/backend/internal/store"
)

const SessionCookieName = "misiva_session"

type Server struct {
	cfg   config.Config
	store store.Store
	mux   *http.ServeMux
}

func New(cfg config.Config, st store.Store) *Server {
	s := &Server{
		cfg:   cfg,
		store: st,
		mux:   http.NewServeMux(),
	}
	s.registerRoutes()
	return s
}

func (s *Server) Handler() http.Handler {
	return s.withRecover(s.withLogging(s.withCORS(s.mux)))
}

func (s *Server) registerRoutes() {
	// Salud y diagnóstico del backend
	s.mux.HandleFunc("GET /healthz", s.handleHealth)
	s.mux.HandleFunc("GET /api/v1/health", s.handleHealth)

	// Autenticación y sesiones
	s.mux.HandleFunc("POST /api/v1/auth/register", s.handleRegister)
	s.mux.HandleFunc("POST /api/v1/auth/login", s.handleLogin)
	s.mux.HandleFunc("POST /api/v1/auth/logout", s.handleLogout)
	s.mux.HandleFunc("POST /api/v1/auth/logout-all", s.requireAuth(s.handleLogoutAll))
	s.mux.HandleFunc("GET /api/v1/auth/session", s.handleSession)

	// Perfil y seguridad de la cuenta
	s.mux.HandleFunc("GET /api/v1/auth/me", s.requireAuth(s.handleGetMe))
	s.mux.HandleFunc("PATCH /api/v1/auth/me", s.requireSessionAuth(s.handleUpdateMe))
	s.mux.HandleFunc("POST /api/v1/auth/password", s.requireSessionAuth(s.handleChangePassword))
	s.mux.HandleFunc("GET /api/v1/auth/sessions", s.requireSessionAuth(s.handleListSessions))
	s.mux.HandleFunc("DELETE /api/v1/auth/sessions/{id}", s.requireSessionAuth(s.handleRevokeSession))

	// Tokens MCP y endpoint de introspección para servidores MCP
	s.mux.HandleFunc("GET /api/v1/auth/tokens", s.requireSessionAuth(s.handleListTokens))
	s.mux.HandleFunc("POST /api/v1/auth/tokens", s.requireSessionAuth(s.handleCreateToken))
	s.mux.HandleFunc("DELETE /api/v1/auth/tokens", s.requireSessionAuth(s.handleRevokeTokenBody))
	s.mux.HandleFunc("DELETE /api/v1/auth/tokens/{id}", s.requireSessionAuth(s.handleRevokeTokenPath))
	s.mux.HandleFunc("POST /api/v1/mcp/verify", s.handleVerifyMCPToken)

	// Administración de usuarios y bitácora de auditoría (solo rol admin)
	s.mux.HandleFunc("GET /api/v1/users", s.requireAdmin(s.handleListUsers))
	s.mux.HandleFunc("PATCH /api/v1/users/{id}", s.requireAdmin(s.handleAdminUpdateUser))
	s.mux.HandleFunc("DELETE /api/v1/users/{id}", s.requireAdmin(s.handleAdminDeleteUser))
	s.mux.HandleFunc("GET /api/v1/audit-logs", s.requireAdmin(s.handleListAuditLogs))

	// Proyectos por usuario (compatible con sesión y con tokens MCP con scopes)
	s.mux.HandleFunc("GET /api/v1/projects", s.requireScope(store.ScopeProjectsRead, s.handleListProjects))
	s.mux.HandleFunc("GET /api/v1/projects/{id}", s.requireScope(store.ScopeProjectsRead, s.handleGetProject))
	s.mux.HandleFunc("PUT /api/v1/projects", s.requireScope(store.ScopeProjectsWrite, s.handleSaveProject))
	s.mux.HandleFunc("DELETE /api/v1/projects", s.requireScope(store.ScopeProjectsDelete, s.handleDeleteProjectQuery))
	s.mux.HandleFunc("DELETE /api/v1/projects/{id}", s.requireScope(store.ScopeProjectsDelete, s.handleDeleteProjectPath))

	// Registro de assets multimedia por usuario
	s.mux.HandleFunc("GET /api/v1/assets", s.requireScope(store.ScopeAssetsRead, s.handleListAssets))
	s.mux.HandleFunc("POST /api/v1/assets", s.requireScope(store.ScopeAssetsWrite, s.handleRegisterAsset))
	s.mux.HandleFunc("DELETE /api/v1/assets/{name}", s.requireScope(store.ScopeAssetsWrite, s.handleDeleteAsset))
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	start := time.Now()
	err := s.store.Ping(r.Context())
	latencyMs := time.Since(start).Milliseconds()
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{
			"status":   "degraded",
			"dbDriver": s.store.Driver(),
			"error":    "No se pudo conectar con la base de datos.",
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"status":      "ok",
		"service":     "misiva-go-backend",
		"version":     "0.2.0",
		"dbDriver":    s.store.Driver(),
		"dbLatencyMs": latencyMs,
		"timestamp":   time.Now().UTC().Format(time.RFC3339),
	})
}

// ---------------------------------------------------------------------------
// Utilidades HTTP
// ---------------------------------------------------------------------------

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func readJSON(r *http.Request, maxBytes int64, dst any) error {
	if maxBytes <= 0 {
		maxBytes = 64 * 1024
	}
	defer r.Body.Close()
	dec := json.NewDecoder(http.MaxBytesReader(nil, r.Body, maxBytes))
	if err := dec.Decode(dst); err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			return maxErr
		}
		return err
	}
	return nil
}

func clientIP(r *http.Request) string {
	if xff := strings.TrimSpace(r.Header.Get("X-Forwarded-For")); xff != "" {
		parts := strings.Split(xff, ",")
		return strings.TrimSpace(parts[0])
	}
	if xrip := strings.TrimSpace(r.Header.Get("X-Real-IP")); xrip != "" {
		return xrip
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err == nil {
		return host
	}
	return r.RemoteAddr
}

func (s *Server) isSecureRequest(r *http.Request) bool {
	if s.cfg.CookieSecure {
		return true
	}
	if strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https") {
		return true
	}
	return r.TLS != nil
}

func (s *Server) setSessionCookie(w http.ResponseWriter, r *http.Request, token string, expires time.Time) {
	http.SetCookie(w, &http.Cookie{
		Name:     SessionCookieName,
		Value:    token,
		Path:     "/",
		Expires:  expires.UTC(),
		HttpOnly: true,
		Secure:   s.isSecureRequest(r),
		SameSite: http.SameSiteLaxMode,
	})
}

func (s *Server) clearSessionCookie(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name:     SessionCookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   s.isSecureRequest(r),
		SameSite: http.SameSiteLaxMode,
	})
}

func (s *Server) trustedMutation(r *http.Request) bool {
	// Si viene con Authorization Bearer (ej. cliente MCP o API), no está sujeto a CSRF de cookies.
	if strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") {
		return true
	}
	if strings.EqualFold(r.Header.Get("Sec-Fetch-Site"), "cross-site") {
		return false
	}
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin == "" {
		return true
	}
	for _, allowed := range s.cfg.AllowedOrigins {
		if strings.EqualFold(origin, allowed) {
			return true
		}
	}
	if s.cfg.AppOrigin != "" && strings.EqualFold(origin, s.cfg.AppOrigin) {
		return true
	}
	u, err := url.Parse(origin)
	if err != nil {
		return false
	}
	fwdHost := strings.TrimSpace(r.Header.Get("X-Forwarded-Host"))
	if fwdHost == "" {
		fwdHost = r.Host
	}
	return fwdHost == "" || strings.EqualFold(u.Host, fwdHost)
}

func (s *Server) withCORS(next http.Handler) http.Handler {
	allowedSet := make(map[string]bool, len(s.cfg.AllowedOrigins))
	for _, o := range s.cfg.AllowedOrigins {
		allowedSet[strings.ToLower(o)] = true
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := strings.TrimSpace(r.Header.Get("Origin"))
		if origin != "" && allowedSet[strings.ToLower(origin)] {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")
			w.Header().Set("Vary", "Origin")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(code int) {
	r.status = code
	r.ResponseWriter.WriteHeader(code)
}

func (s *Server) withLogging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r)
		if r.URL.Path != "/healthz" {
			log.Printf("[misiva-go] %s %s -> %d (%s)", r.Method, r.URL.Path, rec.status, time.Since(start).Round(time.Microsecond))
		}
	})
}

func (s *Server) withRecover(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				log.Printf("[misiva-go] PANIC recuperado en %s %s: %v", r.Method, r.URL.Path, rec)
				writeError(w, http.StatusInternalServerError, "Error interno del servidor.")
			}
		}()
		next.ServeHTTP(w, r)
	})
}
