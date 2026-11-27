package server

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/zegirulabs/misiva/backend/internal/config"
	"github.com/zegirulabs/misiva/backend/internal/store"
)

func newTestServer(t *testing.T) (*Server, *httptest.Server) {
	t.Helper()
	st, err := store.Open(context.Background(), "sqlite", "", ":memory:")
	if err != nil {
		t.Fatalf("abrir sqlite en memoria: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })

	cfg := config.Config{
		Host:           "127.0.0.1",
		Port:           "0",
		DBDriver:       "sqlite",
		SQLitePath:     ":memory:",
		AllowedOrigins: []string{"http://localhost:3000"},
		SessionDays:    30,
	}
	srv := New(cfg, st)
	ts := httptest.NewServer(srv.Handler())
	t.Cleanup(ts.Close)
	return srv, ts
}

func doJSON(t *testing.T, method, url string, body any, headers map[string]string) (*http.Response, map[string]any) {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&buf).Encode(body); err != nil {
			t.Fatalf("serializar body: %v", err)
		}
	}
	req, err := http.NewRequest(method, url, &buf)
	if err != nil {
		t.Fatalf("crear request: %v", err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("ejecutar request: %v", err)
	}
	defer res.Body.Close()
	var parsed map[string]any
	_ = json.NewDecoder(res.Body).Decode(&parsed)
	return res, parsed
}

func TestEndToEndAuthUsersTokensAndProjects(t *testing.T) {
	_, ts := newTestServer(t)

	// 1. Healthcheck
	res, data := doJSON(t, http.MethodGet, ts.URL+"/healthz", nil, nil)
	if res.StatusCode != http.StatusOK || data["status"] != "ok" {
		t.Fatalf("healthz falló: %d %v", res.StatusCode, data)
	}

	// 2. Primer usuario registrado -> rol admin automático
	res, regAdmin := doJSON(t, http.MethodPost, ts.URL+"/api/v1/auth/register", map[string]any{
		"name":     "Leonardo Admin",
		"email":    "Admin@Misiva.App",
		"company":  "Zegiru Labs",
		"password": "SuperPasswordSegura123!",
	}, nil)
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("registro admin falló: %d %v", res.StatusCode, regAdmin)
	}
	adminUser := regAdmin["user"].(map[string]any)
	if adminUser["role"] != "admin" || adminUser["email"] != "admin@misiva.app" {
		t.Fatalf("rol/email inesperado del primer usuario: %v", adminUser)
	}
	adminSessionToken := regAdmin["sessionToken"].(string)
	adminHeaders := map[string]string{"Authorization": "Bearer " + adminSessionToken}

	// 3. Segundo usuario registrado -> rol member
	res, regMember := doJSON(t, http.MethodPost, ts.URL+"/api/v1/auth/register", map[string]any{
		"name":     "María Diseñadora",
		"email":    "maria@misiva.app",
		"password": "ClaveSeguraMiembro123!",
	}, nil)
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("registro member falló: %d %v", res.StatusCode, regMember)
	}
	memberUser := regMember["user"].(map[string]any)
	if memberUser["role"] != "member" {
		t.Fatalf("el segundo usuario debía ser member: %v", memberUser)
	}
	memberID := memberUser["id"].(string)

	// 4. Login y sesiones activas
	res, loginRes := doJSON(t, http.MethodPost, ts.URL+"/api/v1/auth/login", map[string]any{
		"email":    "maria@misiva.app",
		"password": "ClaveSeguraMiembro123!",
	}, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("login falló: %d %v", res.StatusCode, loginRes)
	}
	memberToken := loginRes["sessionToken"].(string)
	memberHeaders := map[string]string{"Authorization": "Bearer " + memberToken}

	res, sessData := doJSON(t, http.MethodGet, ts.URL+"/api/v1/auth/sessions", nil, memberHeaders)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("listar sesiones falló: %d %v", res.StatusCode, sessData)
	}
	if len(sessData["sessions"].([]any)) != 2 {
		t.Fatalf("se esperaban 2 sesiones activas para María: %v", sessData)
	}

	// 5. Crear Token MCP con scopes limitados (projects:read y projects:write, sin projects:delete)
	res, tokData := doJSON(t, http.MethodPost, ts.URL+"/api/v1/auth/tokens", map[string]any{
		"name":   "Claude Desktop",
		"scopes": []string{"projects:read", "projects:write"},
	}, memberHeaders)
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("crear token MCP falló: %d %v", res.StatusCode, tokData)
	}
	mcpRawToken := tokData["token"].(string)
	mcpHeaders := map[string]string{"Authorization": "Bearer " + mcpRawToken}

	// 6. Verificar introspección MCP (/api/v1/mcp/verify)
	res, verifyData := doJSON(t, http.MethodPost, ts.URL+"/api/v1/mcp/verify", nil, mcpHeaders)
	if res.StatusCode != http.StatusOK || verifyData["valid"] != true {
		t.Fatalf("introspección MCP falló: %d %v", res.StatusCode, verifyData)
	}

	// 7. Guardar proyecto usando el Token MCP (tiene projects:write)
	sampleDoc := map[string]any{
		"version":   1,
		"mode":      "visual",
		"settings":  map[string]any{"subject": "Campaña Bienvenida"},
		"blocks":    []any{},
		"code":      "",
		"variables": []any{},
	}
	res, saveRes := doJSON(t, http.MethodPut, ts.URL+"/api/v1/projects", map[string]any{
		"id":        "campana_01",
		"name":      "Campaña Q4",
		"updatedAt": 1000,
		"doc":       sampleDoc,
	}, mcpHeaders)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("guardar proyecto con token MCP falló: %d %v", res.StatusCode, saveRes)
	}
	savedProj := saveRes["project"].(map[string]any)
	updatedAt := int64(savedProj["updatedAt"].(float64))

	// 8. Control de concurrencia optimista (expectedUpdatedAt obsoleto -> 409)
	res, _ = doJSON(t, http.MethodPut, ts.URL+"/api/v1/projects", map[string]any{
		"id":                "campana_01",
		"name":              "Cambio concurrente obsoleto",
		"updatedAt":         updatedAt,
		"expectedUpdatedAt": updatedAt - 500,
		"doc":               sampleDoc,
	}, mcpHeaders)
	if res.StatusCode != http.StatusConflict {
		t.Fatalf("se esperaba 409 Conflict con expectedUpdatedAt obsoleto, obtuvo %d", res.StatusCode)
	}

	// 9. Intentar borrar proyecto con token MCP sin scope projects:delete -> 403 Forbidden
	res, _ = doJSON(t, http.MethodDelete, ts.URL+"/api/v1/projects/campana_01", nil, mcpHeaders)
	if res.StatusCode != http.StatusForbidden {
		t.Fatalf("se esperaba 403 al borrar sin scope projects:delete, obtuvo %d", res.StatusCode)
	}

	// 10. Aislamiento por cuenta: el admin no ve los proyectos privados de María
	res, adminProjs := doJSON(t, http.MethodGet, ts.URL+"/api/v1/projects", nil, adminHeaders)
	if res.StatusCode != http.StatusOK || len(adminProjs["projects"].([]any)) != 0 {
		t.Fatalf("aislamiento roto: admin vio proyectos de otro usuario: %v", adminProjs)
	}

	// 11. Protección del último administrador y suspensión de cuenta miembro
	adminID := adminUser["id"].(string)
	res, _ = doJSON(t, http.MethodPatch, ts.URL+"/api/v1/users/"+adminID, map[string]any{"role": "member"}, adminHeaders)
	if res.StatusCode != http.StatusConflict {
		t.Fatalf("no debe permitir degradar al único admin, obtuvo %d", res.StatusCode)
	}

	res, _ = doJSON(t, http.MethodPatch, ts.URL+"/api/v1/users/"+memberID, map[string]any{"active": false}, adminHeaders)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("admin no pudo suspender miembro: %d", res.StatusCode)
	}

	// El token MCP de un usuario suspendido deja de funcionar inmediatamente
	res, _ = doJSON(t, http.MethodGet, ts.URL+"/api/v1/projects", nil, mcpHeaders)
	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("token de cuenta suspendida debería devolver 401, obtuvo %d", res.StatusCode)
	}

	// 12. Bitácora de auditoría disponible para el admin
	res, auditData := doJSON(t, http.MethodGet, ts.URL+"/api/v1/audit-logs", nil, adminHeaders)
	if res.StatusCode != http.StatusOK || len(auditData["logs"].([]any)) < 5 {
		t.Fatalf("bitácora de auditoría incompleta: %d %v", res.StatusCode, auditData)
	}
}
