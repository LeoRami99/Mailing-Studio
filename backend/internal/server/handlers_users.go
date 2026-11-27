package server

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/zegirulabs/misiva/backend/internal/store"
)

func (s *Server) handleListUsers(w http.ResponseWriter, r *http.Request) {
	users, err := s.store.ListUsers(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "No se pudieron listar los usuarios.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"users": users})
}

func (s *Server) handleAdminUpdateUser(w http.ResponseWriter, r *http.Request) {
	p, _ := principalFromCtx(r.Context())
	id := strings.TrimSpace(r.PathValue("id"))
	if id == "" {
		writeError(w, http.StatusBadRequest, "Identificador de usuario requerido.")
		return
	}

	var req struct {
		Role   *string `json:"role"`
		Active *bool   `json:"active"`
	}
	if err := readJSON(r, 16*1024, &req); err != nil {
		writeError(w, http.StatusBadRequest, "Datos inválidos.")
		return
	}
	if req.Role != nil {
		role := strings.ToLower(strings.TrimSpace(*req.Role))
		if role != "admin" && role != "member" {
			writeError(w, http.StatusBadRequest, "Rol inválido. Use 'admin' o 'member'.")
			return
		}
		req.Role = &role
	}

	updated, err := s.store.AdminUpdateUser(r.Context(), id, req.Role, req.Active)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "Usuario no encontrado.")
			return
		}
		if errors.Is(err, store.ErrLastAdmin) {
			writeError(w, http.StatusConflict, "No se puede degradar o desactivar al único administrador activo.")
			return
		}
		writeError(w, http.StatusInternalServerError, "No se pudo actualizar el usuario.")
		return
	}

	_ = s.store.RecordAudit(r.Context(), p.User.ID, "admin.user_updated", clientIP(r), "target="+id)
	writeJSON(w, http.StatusOK, map[string]any{"user": updated})
}

func (s *Server) handleAdminDeleteUser(w http.ResponseWriter, r *http.Request) {
	p, _ := principalFromCtx(r.Context())
	id := strings.TrimSpace(r.PathValue("id"))
	if id == "" {
		writeError(w, http.StatusBadRequest, "Identificador de usuario requerido.")
		return
	}
	if id == p.User.ID {
		writeError(w, http.StatusConflict, "No puede eliminar su propia cuenta de administrador activa.")
		return
	}

	if err := s.store.DeleteUser(r.Context(), id); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "Usuario no encontrado.")
			return
		}
		if errors.Is(err, store.ErrLastAdmin) {
			writeError(w, http.StatusConflict, "No se puede eliminar al único administrador.")
			return
		}
		writeError(w, http.StatusInternalServerError, "No se pudo eliminar el usuario.")
		return
	}
	_ = s.store.RecordAudit(r.Context(), p.User.ID, "admin.user_deleted", clientIP(r), "target="+id)
	writeJSON(w, http.StatusOK, map[string]any{"deleted": true})
}

func (s *Server) handleListAuditLogs(w http.ResponseWriter, r *http.Request) {
	limit := 50
	if raw := r.URL.Query().Get("limit"); raw != "" {
		if v, err := strconv.Atoi(raw); err == nil && v > 0 && v <= 200 {
			limit = v
		}
	}
	logs, err := s.store.ListAuditLogs(r.Context(), limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "No se pudo consultar la bitácora de auditoría.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"logs": logs})
}
