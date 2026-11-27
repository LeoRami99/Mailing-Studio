package store

import (
	"context"
	"encoding/json"
	"errors"
	"time"
)

var (
	ErrNotFound      = errors.New("recurso no encontrado")
	ErrConflict      = errors.New("conflicto con el estado actual del recurso")
	ErrEmailExists   = errors.New("ya existe una cuenta con ese correo")
	ErrUserSuspended = errors.New("la cuenta está suspendida")
	ErrLastAdmin     = errors.New("no se puede degradar o desactivar al único administrador")
)

// Scopes válidos para tokens MCP y API.
const (
	ScopeProjectsRead   = "projects:read"
	ScopeProjectsWrite  = "projects:write"
	ScopeProjectsDelete = "projects:delete"
	ScopeAssetsRead     = "assets:read"
	ScopeAssetsWrite    = "assets:write"
)

var DefaultTokenScopes = []string{ScopeProjectsRead, ScopeProjectsWrite, ScopeAssetsRead}

var ValidScopes = map[string]bool{
	ScopeProjectsRead:   true,
	ScopeProjectsWrite:  true,
	ScopeProjectsDelete: true,
	ScopeAssetsRead:     true,
	ScopeAssetsWrite:    true,
}

type User struct {
	ID           string    `json:"id"`
	Name         string    `json:"name"`
	Email        string    `json:"email"`
	Company      string    `json:"company,omitempty"`
	Role         string    `json:"role"` // "admin" | "member"
	Active       bool      `json:"active"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
	PasswordHash string    `json:"-"`
}

type UserSummary struct {
	User
	ProjectCount   int `json:"projectCount"`
	ActiveSessions int `json:"activeSessions"`
	ActiveTokens   int `json:"activeTokens"`
}

type SessionInfo struct {
	ID         string    `json:"id"`
	UserID     string    `json:"userId"`
	UserAgent  string    `json:"userAgent"`
	IPAddress  string    `json:"ipAddress,omitempty"`
	CreatedAt  time.Time `json:"createdAt"`
	LastSeenAt time.Time `json:"lastSeenAt"`
	ExpiresAt  time.Time `json:"expiresAt"`
	Current    bool      `json:"current,omitempty"`
}

type APITokenInfo struct {
	ID         string     `json:"id"`
	Name       string     `json:"name"`
	Prefix     string     `json:"prefix"`
	Scopes     []string   `json:"scopes"`
	CreatedAt  time.Time  `json:"createdAt"`
	LastUsedAt *time.Time `json:"lastUsedAt"`
	ExpiresAt  *time.Time `json:"expiresAt,omitempty"`
}

type VerifiedAPIToken struct {
	TokenID   string
	User      User
	Scopes    []string
	ExpiresAt *time.Time
}

type Project struct {
	ID        string          `json:"id"`
	Name      string          `json:"name"`
	UpdatedAt int64           `json:"updatedAt"`
	Doc       json.RawMessage `json:"doc"`
}

type UploadAsset struct {
	Name      string    `json:"name"`
	SizeBytes int64     `json:"size"`
	MediaType string    `json:"mediaType"`
	CreatedAt time.Time `json:"createdAt"`
}

type AuditLog struct {
	ID        string    `json:"id"`
	UserID    string    `json:"userId,omitempty"`
	Action    string    `json:"action"`
	IPAddress string    `json:"ipAddress,omitempty"`
	Metadata  string    `json:"metadata,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
}

type Store interface {
	Driver() string
	Ping(ctx context.Context) error
	Close() error

	// Usuarios
	CreateUser(ctx context.Context, name, email, company, passwordHash string) (User, error)
	GetUserByEmail(ctx context.Context, email string) (User, error)
	GetUserByID(ctx context.Context, id string) (User, error)
	UpdateUserProfile(ctx context.Context, id, name, email, company string) (User, error)
	UpdateUserPassword(ctx context.Context, id, newPasswordHash string) error
	ListUsers(ctx context.Context) ([]UserSummary, error)
	AdminUpdateUser(ctx context.Context, id string, role *string, active *bool) (User, error)
	DeleteUser(ctx context.Context, id string) error

	// Sesiones
	CreateSession(ctx context.Context, userID, tokenHash, userAgent, ip string, expiresAt time.Time) (SessionInfo, error)
	GetSessionByTokenHash(ctx context.Context, tokenHash string) (User, SessionInfo, error)
	DeleteSessionByTokenHash(ctx context.Context, tokenHash string) error
	DeleteSessionByID(ctx context.Context, userID, sessionID string) (bool, error)
	DeleteOtherSessions(ctx context.Context, userID, keepSessionID string) (int64, error)
	ListUserSessions(ctx context.Context, userID string) ([]SessionInfo, error)

	// Tokens MCP / API
	CreateAPIToken(ctx context.Context, userID, name, prefix, tokenHash string, scopes []string, expiresAt *time.Time) (APITokenInfo, error)
	ListAPITokens(ctx context.Context, userID string) ([]APITokenInfo, error)
	RevokeAPIToken(ctx context.Context, userID, tokenID string) (bool, error)
	VerifyAPITokenHash(ctx context.Context, tokenHash string) (VerifiedAPIToken, error)

	// Protección contra fuerza bruta
	AllowAuthAttempt(ctx context.Context, keyHash string, maxAttempts int, window, blockDuration time.Duration) (bool, error)
	ClearAuthAttempts(ctx context.Context, keyHash string) error

	// Proyectos
	ListProjects(ctx context.Context, userID string) ([]Project, error)
	GetProject(ctx context.Context, userID, projectID string) (Project, error)
	SaveProject(ctx context.Context, userID string, p Project, expectedUpdatedAt *int64) (Project, error)
	DeleteProject(ctx context.Context, userID, projectID string) (bool, error)

	// Assets multimedia
	RegisterAsset(ctx context.Context, userID string, asset UploadAsset) error
	ListAssets(ctx context.Context, userID string) ([]UploadAsset, error)
	DeleteAsset(ctx context.Context, userID, name string) (bool, error)

	// Auditoría
	RecordAudit(ctx context.Context, userID, action, ip, metadata string) error
	ListAuditLogs(ctx context.Context, limit int) ([]AuditLog, error)
}
