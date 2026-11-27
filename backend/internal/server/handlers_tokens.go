package server

import (
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/zegirulabs/misiva/backend/internal/security"
	"github.com/zegirulabs/misiva/backend/internal/store"
)

func (s *Server) handleListTokens(w http.ResponseWriter, r *http.Request) {
	p, _ := principalFromCtx(r.Context())
	tokens, err := s.store.ListAPITokens(r.Context(), p.User.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "No se pudieron consultar los tokens MCP.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"tokens": tokens})
}

func (s *Server) handleCreateToken(w http.ResponseWriter, r *http.Request) {
	p, _ := principalFromCtx(r.Context())
	var req struct {
		Name          string   `json:"name"`
		Scopes        []string `json:"scopes"`
		ExpiresInDays *int     `json:"expiresInDays"`
	}
	if err := readJSON(r, 32*1024, &req); err != nil {
		writeError(w, http.StatusBadRequest, "Datos inválidos.")
		return
	}

	name := strings.TrimSpace(req.Name)
	if n := utf8.RuneCountInString(name); n < 2 || n > 80 {
		writeError(w, http.StatusBadRequest, "Escriba un nombre de entre 2 y 80 caracteres para identificar el token.")
		return
	}

	scopes := req.Scopes
	if len(scopes) == 0 {
		scopes = append([]string(nil), store.DefaultTokenScopes...)
	} else {
		seen := make(map[string]bool, len(scopes))
		clean := make([]string, 0, len(scopes))
		for _, sc := range scopes {
			sc = strings.TrimSpace(sc)
			if !store.ValidScopes[sc] {
				writeError(w, http.StatusBadRequest, "Permiso desconocido: "+sc)
				return
			}
			if !seen[sc] {
				seen[sc] = true
				clean = append(clean, sc)
			}
		}
		scopes = clean
	}

	var expiresAt *time.Time
	if req.ExpiresInDays != nil && *req.ExpiresInDays > 0 {
		if *req.ExpiresInDays > 3650 {
			writeError(w, http.StatusBadRequest, "La expiración máxima es de 3650 días.")
			return
		}
		exp := time.Now().UTC().Add(time.Duration(*req.ExpiresInDays) * 24 * time.Hour)
		expiresAt = &exp
	}

	active, err := s.store.ListAPITokens(r.Context(), p.User.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "No se pudo verificar el límite de tokens.")
		return
	}
	if len(active) >= 20 {
		writeError(w, http.StatusConflict, "Ha alcanzado el límite de 20 tokens activos. Revoque uno antes de crear otro.")
		return
	}

	rnd, err := security.RandomToken(36)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "No se pudo generar el token.")
		return
	}
	raw := "misiva_mcp_" + rnd
	prefix := raw
	if len(prefix) > 22 {
		prefix = prefix[:22]
	}

	created, err := s.store.CreateAPIToken(r.Context(), p.User.ID, name, prefix, security.SHA256Hex(raw), scopes, expiresAt)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "No se pudo guardar el token.")
		return
	}
	_ = s.store.RecordAudit(r.Context(), p.User.ID, "mcp.token_created", clientIP(r), "name="+name)

	writeJSON(w, http.StatusCreated, map[string]any{
		"id":        created.ID,
		"name":      created.Name,
		"token":     raw,
		"prefix":    created.Prefix,
		"scopes":    created.Scopes,
		"createdAt": created.CreatedAt,
		"expiresAt": created.ExpiresAt,
	})
}

func (s *Server) handleRevokeTokenBody(w http.ResponseWriter, r *http.Request) {
	p, _ := principalFromCtx(r.Context())
	var req struct {
		ID string `json:"id"`
	}
	if err := readJSON(r, 16*1024, &req); err != nil || strings.TrimSpace(req.ID) == "" {
		writeError(w, http.StatusBadRequest, "Identificador de token inválido.")
		return
	}
	revoked, err := s.store.RevokeAPIToken(r.Context(), p.User.ID, strings.TrimSpace(req.ID))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "No se pudo revocar el token.")
		return
	}
	if revoked {
		_ = s.store.RecordAudit(r.Context(), p.User.ID, "mcp.token_revoked", clientIP(r), "id="+req.ID)
	}
	writeJSON(w, http.StatusOK, map[string]any{"revoked": revoked})
}

func (s *Server) handleRevokeTokenPath(w http.ResponseWriter, r *http.Request) {
	p, _ := principalFromCtx(r.Context())
	id := strings.TrimSpace(r.PathValue("id"))
	if id == "" {
		writeError(w, http.StatusBadRequest, "Identificador de token inválido.")
		return
	}
	revoked, err := s.store.RevokeAPIToken(r.Context(), p.User.ID, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "No se pudo revocar el token.")
		return
	}
	if revoked {
		_ = s.store.RecordAudit(r.Context(), p.User.ID, "mcp.token_revoked", clientIP(r), "id="+id)
	}
	writeJSON(w, http.StatusOK, map[string]any{"revoked": revoked})
}

// handleVerifyMCPToken permite al servidor MCP validar un Bearer token en milisegundos y obtener el usuario y sus scopes.
func (s *Server) handleVerifyMCPToken(w http.ResponseWriter, r *http.Request) {
	tok := extractAPIToken(r)
	if tok == "" {
		var body struct {
			Token string `json:"token"`
		}
		_ = readJSON(r, 8*1024, &body)
		tok = strings.TrimSpace(body.Token)
	}
	if tok == "" || !strings.HasPrefix(tok, "misiva_mcp_") {
		writeError(w, http.StatusUnauthorized, "Token MCP ausente o con formato inválido.")
		return
	}

	verified, err := s.store.VerifyAPITokenHash(r.Context(), security.SHA256Hex(tok))
	if err != nil {
		writeError(w, http.StatusUnauthorized, "Token MCP inválido, revocado o expirado.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"valid":     true,
		"tokenId":   verified.TokenID,
		"user":      verified.User,
		"scopes":    verified.Scopes,
		"expiresAt": verified.ExpiresAt,
	})
}
