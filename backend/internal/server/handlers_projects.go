package server

import (
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/zegirulabs/misiva/backend/internal/store"
)

const maxProjectBytes = 2 * 1024 * 1024 // 2 MiB

var projectIDPattern = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,80}$`)

func validProjectID(id string) bool {
	return projectIDPattern.MatchString(id)
}

func (s *Server) handleListProjects(w http.ResponseWriter, r *http.Request) {
	p, _ := principalFromCtx(r.Context())
	projects, err := s.store.ListProjects(r.Context(), p.User.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "No se pudieron listar los proyectos.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"projects": projects})
}

func (s *Server) handleGetProject(w http.ResponseWriter, r *http.Request) {
	p, _ := principalFromCtx(r.Context())
	id := strings.TrimSpace(r.PathValue("id"))
	if !validProjectID(id) {
		writeError(w, http.StatusBadRequest, "Identificador de proyecto inválido.")
		return
	}
	proj, err := s.store.GetProject(r.Context(), p.User.ID, id)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "Proyecto no encontrado.")
			return
		}
		writeError(w, http.StatusInternalServerError, "No se pudo leer el proyecto.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"project": proj})
}

func (s *Server) handleSaveProject(w http.ResponseWriter, r *http.Request) {
	p, _ := principalFromCtx(r.Context())
	var req struct {
		ID                string          `json:"id"`
		Name              string          `json:"name"`
		UpdatedAt         int64           `json:"updatedAt"`
		Doc               json.RawMessage `json:"doc"`
		ExpectedUpdatedAt *int64          `json:"expectedUpdatedAt"`
	}
	if err := readJSON(r, maxProjectBytes+64*1024, &req); err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			writeError(w, http.StatusRequestEntityTooLarge, "El proyecto supera el límite de 2 MB.")
			return
		}
		writeError(w, http.StatusBadRequest, "JSON de proyecto inválido.")
		return
	}

	if !validProjectID(req.ID) {
		writeError(w, http.StatusBadRequest, "Identificador de proyecto inválido.")
		return
	}
	name := strings.TrimSpace(req.Name)
	if n := utf8.RuneCountInString(name); n == 0 || n > 160 {
		writeError(w, http.StatusBadRequest, "El nombre del proyecto debe tener entre 1 y 160 caracteres.")
		return
	}
	if len(req.Doc) == 0 || len(req.Doc) > maxProjectBytes || !json.Valid(req.Doc) {
		writeError(w, http.StatusBadRequest, "Documento del proyecto inválido o demasiado grande.")
		return
	}

	// Verificación estructural ligera de EmailDoc v1
	var docProbe struct {
		Version int    `json:"version"`
		Mode    string `json:"mode"`
	}
	if err := json.Unmarshal(req.Doc, &docProbe); err != nil || docProbe.Version != 1 || (docProbe.Mode != "visual" && docProbe.Mode != "code") {
		writeError(w, http.StatusBadRequest, "El documento debe ser un EmailDoc válido (version=1, mode='visual'|'code').")
		return
	}

	saved, err := s.store.SaveProject(r.Context(), p.User.ID, store.Project{
		ID:        req.ID,
		Name:      name,
		UpdatedAt: req.UpdatedAt,
		Doc:       req.Doc,
	}, req.ExpectedUpdatedAt)
	if err != nil {
		if errors.Is(err, store.ErrConflict) {
			writeError(w, http.StatusConflict, "El proyecto fue modificado por otra sesión o agente. Recargue antes de guardar.")
			return
		}
		writeError(w, http.StatusInternalServerError, "No se pudo guardar el proyecto.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"project": saved})
}

func (s *Server) handleDeleteProjectQuery(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(r.URL.Query().Get("id"))
	s.deleteProjectByID(w, r, id)
}

func (s *Server) handleDeleteProjectPath(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(r.PathValue("id"))
	s.deleteProjectByID(w, r, id)
}

func (s *Server) deleteProjectByID(w http.ResponseWriter, r *http.Request, id string) {
	p, _ := principalFromCtx(r.Context())
	if !validProjectID(id) {
		writeJSON(w, http.StatusOK, map[string]any{"deleted": false})
		return
	}
	deleted, err := s.store.DeleteProject(r.Context(), p.User.ID, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "No se pudo eliminar el proyecto.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"deleted": deleted})
}
