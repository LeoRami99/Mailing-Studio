package server

import (
	"net/http"
	"path/filepath"
	"strings"

	"github.com/zegirulabs/misiva/backend/internal/store"
)

func (s *Server) handleListAssets(w http.ResponseWriter, r *http.Request) {
	p, _ := principalFromCtx(r.Context())
	assets, err := s.store.ListAssets(r.Context(), p.User.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "No se pudieron listar las imágenes.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"assets": assets})
}

func (s *Server) handleRegisterAsset(w http.ResponseWriter, r *http.Request) {
	p, _ := principalFromCtx(r.Context())
	var req struct {
		Name      string `json:"name"`
		SizeBytes int64  `json:"size"`
		MediaType string `json:"mediaType"`
	}
	if err := readJSON(r, 16*1024, &req); err != nil {
		writeError(w, http.StatusBadRequest, "Datos de imagen inválidos.")
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" || name != filepath.Base(name) || len(name) > 180 {
		writeError(w, http.StatusBadRequest, "Nombre de archivo inválido.")
		return
	}
	if req.SizeBytes <= 0 {
		req.SizeBytes = 1
	}
	if req.MediaType == "" {
		req.MediaType = "application/octet-stream"
	}

	asset := store.UploadAsset{
		Name:      name,
		SizeBytes: req.SizeBytes,
		MediaType: req.MediaType,
	}
	if err := s.store.RegisterAsset(r.Context(), p.User.ID, asset); err != nil {
		writeError(w, http.StatusInternalServerError, "No se pudo registrar la imagen.")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"ok": true, "asset": asset})
}

func (s *Server) handleDeleteAsset(w http.ResponseWriter, r *http.Request) {
	p, _ := principalFromCtx(r.Context())
	name := strings.TrimSpace(r.PathValue("name"))
	if name == "" || name != filepath.Base(name) {
		writeError(w, http.StatusBadRequest, "Nombre de archivo inválido.")
		return
	}
	deleted, err := s.store.DeleteAsset(r.Context(), p.User.ID, name)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "No se pudo eliminar la imagen.")
		return
	}
	if !deleted {
		writeError(w, http.StatusNotFound, "Imagen no encontrada.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
