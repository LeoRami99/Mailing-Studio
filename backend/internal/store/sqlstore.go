package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	_ "github.com/jackc/pgx/v5/stdlib"
	_ "modernc.org/sqlite"
)

type SQLStore struct {
	db     *sql.DB
	driver string // "sqlite" | "postgres"
}

// Open abre y migra automáticamente una base de datos SQLite o PostgreSQL.
func Open(ctx context.Context, driver, databaseURL, sqlitePath string) (*SQLStore, error) {
	driver = strings.ToLower(strings.TrimSpace(driver))
	var db *sql.DB
	var err error

	switch driver {
	case "postgres", "postgresql":
		driver = "postgres"
		if databaseURL == "" {
			return nil, errors.New("DATABASE_URL es obligatoria cuando DB_DRIVER=postgres")
		}
		db, err = sql.Open("pgx", databaseURL)
		if err != nil {
			return nil, fmt.Errorf("abrir postgres: %w", err)
		}
		db.SetMaxOpenConns(15)
		db.SetMaxIdleConns(5)
		db.SetConnMaxLifetime(30 * time.Minute)

	case "sqlite", "sqlite3", "":
		driver = "sqlite"
		if sqlitePath != ":memory:" && !strings.HasPrefix(sqlitePath, "file:") {
			if err := os.MkdirAll(filepath.Dir(sqlitePath), 0o755); err != nil {
				return nil, fmt.Errorf("crear directorio sqlite: %w", err)
			}
		}
		dsn := sqlitePath
		if dsn != ":memory:" && !strings.Contains(dsn, "?") {
			dsn = dsn + "?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=foreign_keys(ON)"
		}
		db, err = sql.Open("sqlite", dsn)
		if err != nil {
			return nil, fmt.Errorf("abrir sqlite: %w", err)
		}
		if sqlitePath == ":memory:" {
			db.SetMaxOpenConns(1)
		} else {
			db.SetMaxOpenConns(4)
		}

	default:
		return nil, fmt.Errorf("driver de base de datos no soportado: %s", driver)
	}

	s := &SQLStore{db: db, driver: driver}
	if err := s.migrate(ctx); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("migrar esquema (%s): %w", driver, err)
	}
	return s, nil
}

func (s *SQLStore) Driver() string { return s.driver }

func (s *SQLStore) Ping(ctx context.Context) error {
	return s.db.PingContext(ctx)
}

func (s *SQLStore) Close() error {
	return s.db.Close()
}

func (s *SQLStore) migrate(ctx context.Context) error {
	if s.driver == "sqlite" {
		if _, err := s.db.ExecContext(ctx, `PRAGMA foreign_keys = ON;`); err != nil {
			return err
		}
		stmts := []string{
			`CREATE TABLE IF NOT EXISTS users (
				id TEXT PRIMARY KEY,
				name TEXT NOT NULL,
				email TEXT NOT NULL UNIQUE,
				company TEXT NOT NULL DEFAULT '',
				password_hash TEXT NOT NULL,
				role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin')),
				active INTEGER NOT NULL DEFAULT 1,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL
			);`,
			`CREATE TABLE IF NOT EXISTS sessions (
				id TEXT PRIMARY KEY,
				user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				token_hash TEXT NOT NULL UNIQUE,
				user_agent TEXT NOT NULL DEFAULT '',
				ip_address TEXT NOT NULL DEFAULT '',
				created_at TEXT NOT NULL,
				last_seen_at TEXT NOT NULL,
				expires_at TEXT NOT NULL
			);`,
			`CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);`,
			`CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);`,
			`CREATE TABLE IF NOT EXISTS api_tokens (
				id TEXT PRIMARY KEY,
				user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				name TEXT NOT NULL,
				token_prefix TEXT NOT NULL,
				token_hash TEXT NOT NULL UNIQUE,
				scopes TEXT NOT NULL,
				created_at TEXT NOT NULL,
				last_used_at TEXT,
				expires_at TEXT,
				revoked_at TEXT
			);`,
			`CREATE INDEX IF NOT EXISTS api_tokens_user_id_idx ON api_tokens(user_id);`,
			`CREATE TABLE IF NOT EXISTS projects (
				user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				id TEXT NOT NULL,
				name TEXT NOT NULL,
				doc TEXT NOT NULL,
				updated_at INTEGER NOT NULL,
				PRIMARY KEY (user_id, id)
			);`,
			`CREATE INDEX IF NOT EXISTS projects_user_updated_idx ON projects(user_id, updated_at DESC);`,
			`CREATE TABLE IF NOT EXISTS upload_assets (
				user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				name TEXT NOT NULL,
				size_bytes INTEGER NOT NULL,
				media_type TEXT NOT NULL,
				created_at TEXT NOT NULL,
				PRIMARY KEY (user_id, name)
			);`,
			`CREATE TABLE IF NOT EXISTS auth_attempts (
				key_hash TEXT PRIMARY KEY,
				attempts INTEGER NOT NULL,
				window_started_at TEXT NOT NULL,
				blocked_until TEXT
			);`,
			`CREATE TABLE IF NOT EXISTS audit_logs (
				id TEXT PRIMARY KEY,
				user_id TEXT,
				action TEXT NOT NULL,
				ip_address TEXT NOT NULL DEFAULT '',
				metadata TEXT NOT NULL DEFAULT '',
				created_at TEXT NOT NULL
			);`,
			`CREATE INDEX IF NOT EXISTS audit_logs_created_idx ON audit_logs(created_at DESC);`,
		}
		for _, stmt := range stmts {
			if _, err := s.db.ExecContext(ctx, stmt); err != nil {
				return err
			}
		}
		return nil
	}

	// PostgreSQL: 100% compatible con el esquema previo de Misiva + columnas extendidas.
	stmts := []string{
		`CREATE TABLE IF NOT EXISTS users (
			id UUID PRIMARY KEY,
			name VARCHAR(80) NOT NULL,
			email VARCHAR(320) NOT NULL UNIQUE,
			company VARCHAR(120) NOT NULL DEFAULT '',
			password_hash TEXT NOT NULL,
			role VARCHAR(24) NOT NULL DEFAULT 'member',
			active BOOLEAN NOT NULL DEFAULT TRUE,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			CHECK (role IN ('member', 'admin'))
		);`,
		`ALTER TABLE users ADD COLUMN IF NOT EXISTS company VARCHAR(120) NOT NULL DEFAULT '';`,
		`ALTER TABLE users ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;`,
		`CREATE TABLE IF NOT EXISTS sessions (
			id UUID PRIMARY KEY,
			user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			token_hash CHAR(64) NOT NULL UNIQUE,
			user_agent VARCHAR(500),
			ip_address VARCHAR(64) NOT NULL DEFAULT '',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			expires_at TIMESTAMPTZ NOT NULL
		);`,
		`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS ip_address VARCHAR(64) NOT NULL DEFAULT '';`,
		`CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);`,
		`CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);`,
		`CREATE TABLE IF NOT EXISTS api_tokens (
			id UUID PRIMARY KEY,
			user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			name VARCHAR(80) NOT NULL,
			token_prefix VARCHAR(24) NOT NULL,
			token_hash CHAR(64) NOT NULL UNIQUE,
			scopes TEXT[] NOT NULL DEFAULT ARRAY['projects:read', 'projects:write']::TEXT[],
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			last_used_at TIMESTAMPTZ,
			expires_at TIMESTAMPTZ,
			revoked_at TIMESTAMPTZ
		);`,
		`ALTER TABLE api_tokens ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;`,
		`CREATE INDEX IF NOT EXISTS api_tokens_user_id_idx ON api_tokens(user_id);`,
		`CREATE TABLE IF NOT EXISTS projects (
			user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			id VARCHAR(80) NOT NULL,
			name VARCHAR(160) NOT NULL,
			doc JSONB NOT NULL,
			updated_at BIGINT NOT NULL,
			PRIMARY KEY (user_id, id)
		);`,
		`CREATE INDEX IF NOT EXISTS projects_user_updated_idx ON projects(user_id, updated_at DESC);`,
		`CREATE TABLE IF NOT EXISTS upload_assets (
			user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			name VARCHAR(180) NOT NULL,
			size_bytes INTEGER NOT NULL,
			media_type VARCHAR(80) NOT NULL,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			PRIMARY KEY (user_id, name)
		);`,
		`CREATE TABLE IF NOT EXISTS auth_attempts (
			key_hash CHAR(64) PRIMARY KEY,
			attempts INTEGER NOT NULL,
			window_started_at TIMESTAMPTZ NOT NULL,
			blocked_until TIMESTAMPTZ
		);`,
		`CREATE TABLE IF NOT EXISTS audit_logs (
			id UUID PRIMARY KEY,
			user_id UUID,
			action VARCHAR(80) NOT NULL,
			ip_address VARCHAR(64) NOT NULL DEFAULT '',
			metadata TEXT NOT NULL DEFAULT '',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);`,
		`CREATE INDEX IF NOT EXISTS audit_logs_created_idx ON audit_logs(created_at DESC);`,
	}
	for _, stmt := range stmts {
		if _, err := s.db.ExecContext(ctx, stmt); err != nil {
			return err
		}
	}
	return nil
}

// rebind convierte marcadores "?" a "$1, $2..." cuando el driver es PostgreSQL.
func (s *SQLStore) rebind(q string) string {
	if s.driver != "postgres" {
		return q
	}
	var b strings.Builder
	b.Grow(len(q) + 16)
	idx := 1
	for i := 0; i < len(q); i++ {
		if q[i] == '?' {
			b.WriteByte('$')
			b.WriteString(strconv.Itoa(idx))
			idx++
		} else {
			b.WriteByte(q[i])
		}
	}
	return b.String()
}

func (s *SQLStore) timeArg(t time.Time) any {
	utc := t.UTC()
	if s.driver == "sqlite" {
		return utc.Format(time.RFC3339Nano)
	}
	return utc
}

func (s *SQLStore) optTimeArg(t *time.Time) any {
	if t == nil {
		return nil
	}
	return s.timeArg(*t)
}

func (s *SQLStore) boolArg(v bool) any {
	if s.driver == "sqlite" {
		if v {
			return 1
		}
		return 0
	}
	return v
}

func parseTime(raw any) time.Time {
	switch v := raw.(type) {
	case time.Time:
		return v.UTC()
	case string:
		return parseTimeString(v)
	case []byte:
		return parseTimeString(string(v))
	default:
		return time.Time{}
	}
}

func parseOptTime(raw any) *time.Time {
	if raw == nil {
		return nil
	}
	t := parseTime(raw)
	if t.IsZero() {
		return nil
	}
	return &t
}

func parseTimeString(v string) time.Time {
	v = strings.TrimSpace(v)
	if v == "" {
		return time.Time{}
	}
	for _, layout := range []string{time.RFC3339Nano, time.RFC3339, "2006-01-02 15:04:05.999999999-07:00", "2006-01-02 15:04:05"} {
		if t, err := time.Parse(layout, v); err == nil {
			return t.UTC()
		}
	}
	return time.Time{}
}

func parseBool(raw any) bool {
	switch v := raw.(type) {
	case bool:
		return v
	case int64:
		return v != 0
	case int:
		return v != 0
	case string:
		return v == "1" || strings.EqualFold(v, "true") || strings.EqualFold(v, "t")
	case []byte:
		return parseBool(string(v))
	default:
		return false
	}
}

func (s *SQLStore) encodeScopes(scopes []string) any {
	if len(scopes) == 0 {
		scopes = DefaultTokenScopes
	}
	if s.driver == "postgres" {
		escaped := make([]string, len(scopes))
		for i, sc := range scopes {
			escaped[i] = `"` + strings.ReplaceAll(sc, `"`, `\"`) + `"`
		}
		return "{" + strings.Join(escaped, ",") + "}"
	}
	b, _ := json.Marshal(scopes)
	return string(b)
}

func decodeScopes(raw any) []string {
	var str string
	switch v := raw.(type) {
	case string:
		str = v
	case []byte:
		str = string(v)
	case []string:
		return v
	default:
		return append([]string(nil), DefaultTokenScopes...)
	}
	str = strings.TrimSpace(str)
	if str == "" {
		return append([]string(nil), DefaultTokenScopes...)
	}
	if strings.HasPrefix(str, "[") {
		var out []string
		if err := json.Unmarshal([]byte(str), &out); err == nil && len(out) > 0 {
			return out
		}
	}
	if strings.HasPrefix(str, "{") && strings.HasSuffix(str, "}") {
		inner := strings.TrimSuffix(strings.TrimPrefix(str, "{"), "}")
		if inner == "" {
			return nil
		}
		parts := strings.Split(inner, ",")
		out := make([]string, 0, len(parts))
		for _, p := range parts {
			clean := strings.Trim(strings.TrimSpace(p), `"`)
			if clean != "" {
				out = append(out, clean)
			}
		}
		return out
	}
	return []string{str}
}

func isUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "unique") || strings.Contains(msg, "23505") || strings.Contains(msg, "duplicate key")
}

// ---------------------------------------------------------------------------
// Usuarios
// ---------------------------------------------------------------------------

func (s *SQLStore) CreateUser(ctx context.Context, name, email, company, passwordHash string) (User, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return User{}, err
	}
	defer func() { _ = tx.Rollback() }()

	var count int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(1) FROM users`).Scan(&count); err != nil {
		return User{}, err
	}
	role := "member"
	if count == 0 {
		role = "admin"
	}

	now := time.Now().UTC()
	id := uuid.NewString()
	_, err = tx.ExecContext(
		ctx,
		s.rebind(`INSERT INTO users (id, name, email, company, password_hash, role, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
		id, strings.TrimSpace(name), email, strings.TrimSpace(company), passwordHash, role, s.boolArg(true), s.timeArg(now), s.timeArg(now),
	)
	if err != nil {
		if isUniqueViolation(err) {
			return User{}, ErrEmailExists
		}
		return User{}, err
	}
	if err := tx.Commit(); err != nil {
		return User{}, err
	}
	return User{
		ID:           id,
		Name:         strings.TrimSpace(name),
		Email:        email,
		Company:      strings.TrimSpace(company),
		Role:         role,
		Active:       true,
		CreatedAt:    now,
		UpdatedAt:    now,
		PasswordHash: passwordHash,
	}, nil
}

func (s *SQLStore) scanUserRow(scanner interface{ Scan(dest ...any) error }) (User, error) {
	var u User
	var activeRaw, createdRaw, updatedRaw any
	var company sql.NullString
	err := scanner.Scan(&u.ID, &u.Name, &u.Email, &company, &u.PasswordHash, &u.Role, &activeRaw, &createdRaw, &updatedRaw)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return User{}, ErrNotFound
		}
		return User{}, err
	}
	u.Company = company.String
	u.Active = parseBool(activeRaw)
	u.CreatedAt = parseTime(createdRaw)
	u.UpdatedAt = parseTime(updatedRaw)
	return u, nil
}

func (s *SQLStore) GetUserByEmail(ctx context.Context, email string) (User, error) {
	row := s.db.QueryRowContext(
		ctx,
		s.rebind(`SELECT id, name, email, company, password_hash, role, active, created_at, updated_at FROM users WHERE email = ?`),
		email,
	)
	return s.scanUserRow(row)
}

func (s *SQLStore) GetUserByID(ctx context.Context, id string) (User, error) {
	row := s.db.QueryRowContext(
		ctx,
		s.rebind(`SELECT id, name, email, company, password_hash, role, active, created_at, updated_at FROM users WHERE id = ?`),
		id,
	)
	return s.scanUserRow(row)
}

func (s *SQLStore) UpdateUserProfile(ctx context.Context, id, name, email, company string) (User, error) {
	now := time.Now().UTC()
	res, err := s.db.ExecContext(
		ctx,
		s.rebind(`UPDATE users SET name = ?, email = ?, company = ?, updated_at = ? WHERE id = ?`),
		strings.TrimSpace(name), email, strings.TrimSpace(company), s.timeArg(now), id,
	)
	if err != nil {
		if isUniqueViolation(err) {
			return User{}, ErrEmailExists
		}
		return User{}, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return User{}, ErrNotFound
	}
	return s.GetUserByID(ctx, id)
}

func (s *SQLStore) UpdateUserPassword(ctx context.Context, id, newPasswordHash string) error {
	now := time.Now().UTC()
	res, err := s.db.ExecContext(
		ctx,
		s.rebind(`UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`),
		newPasswordHash, s.timeArg(now), id,
	)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *SQLStore) ListUsers(ctx context.Context) ([]UserSummary, error) {
	nowArg := s.timeArg(time.Now().UTC())
	rows, err := s.db.QueryContext(ctx, s.rebind(`
		SELECT
			u.id, u.name, u.email, u.company, u.role, u.active, u.created_at, u.updated_at,
			(SELECT COUNT(1) FROM projects p WHERE p.user_id = u.id) AS project_count,
			(SELECT COUNT(1) FROM sessions se WHERE se.user_id = u.id AND se.expires_at > ?) AS active_sessions,
			(SELECT COUNT(1) FROM api_tokens t WHERE t.user_id = u.id AND t.revoked_at IS NULL) AS active_tokens
		FROM users u
		ORDER BY u.created_at ASC
	`), nowArg)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]UserSummary, 0)
	for rows.Next() {
		var item UserSummary
		var company sql.NullString
		var activeRaw, createdRaw, updatedRaw any
		if err := rows.Scan(
			&item.ID, &item.Name, &item.Email, &company, &item.Role, &activeRaw, &createdRaw, &updatedRaw,
			&item.ProjectCount, &item.ActiveSessions, &item.ActiveTokens,
		); err != nil {
			return nil, err
		}
		item.Company = company.String
		item.Active = parseBool(activeRaw)
		item.CreatedAt = parseTime(createdRaw)
		item.UpdatedAt = parseTime(updatedRaw)
		out = append(out, item)
	}
	return out, rows.Err()
}

func (s *SQLStore) AdminUpdateUser(ctx context.Context, id string, role *string, active *bool) (User, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return User{}, err
	}
	defer func() { _ = tx.Rollback() }()

	current, err := s.scanUserRow(tx.QueryRowContext(
		ctx,
		s.rebind(`SELECT id, name, email, company, password_hash, role, active, created_at, updated_at FROM users WHERE id = ?`),
		id,
	))
	if err != nil {
		return User{}, err
	}

	nextRole := current.Role
	if role != nil {
		nextRole = *role
	}
	nextActive := current.Active
	if active != nil {
		nextActive = *active
	}

	// Evita dejar la plataforma sin ningún administrador activo.
	if current.Role == "admin" && current.Active && (nextRole != "admin" || !nextActive) {
		var otherAdmins int
		if err := tx.QueryRowContext(
			ctx,
			s.rebind(`SELECT COUNT(1) FROM users WHERE role = 'admin' AND active = ? AND id <> ?`),
			s.boolArg(true), id,
		).Scan(&otherAdmins); err != nil {
			return User{}, err
		}
		if otherAdmins == 0 {
			return User{}, ErrLastAdmin
		}
	}

	now := time.Now().UTC()
	if _, err := tx.ExecContext(
		ctx,
		s.rebind(`UPDATE users SET role = ?, active = ?, updated_at = ? WHERE id = ?`),
		nextRole, s.boolArg(nextActive), s.timeArg(now), id,
	); err != nil {
		return User{}, err
	}

	// Si se suspende la cuenta, revoca sus sesiones activas inmediatamente.
	if !nextActive {
		_, _ = tx.ExecContext(ctx, s.rebind(`DELETE FROM sessions WHERE user_id = ?`), id)
	}

	if err := tx.Commit(); err != nil {
		return User{}, err
	}
	return s.GetUserByID(ctx, id)
}

func (s *SQLStore) DeleteUser(ctx context.Context, id string) error {
	current, err := s.GetUserByID(ctx, id)
	if err != nil {
		return err
	}
	if current.Role == "admin" && current.Active {
		var otherAdmins int
		if err := s.db.QueryRowContext(
			ctx,
			s.rebind(`SELECT COUNT(1) FROM users WHERE role = 'admin' AND active = ? AND id <> ?`),
			s.boolArg(true), id,
		).Scan(&otherAdmins); err != nil {
			return err
		}
		if otherAdmins == 0 {
			return ErrLastAdmin
		}
	}
	res, err := s.db.ExecContext(ctx, s.rebind(`DELETE FROM users WHERE id = ?`), id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// ---------------------------------------------------------------------------
// Sesiones
// ---------------------------------------------------------------------------

func (s *SQLStore) CreateSession(ctx context.Context, userID, tokenHash, userAgent, ip string, expiresAt time.Time) (SessionInfo, error) {
	id := uuid.NewString()
	now := time.Now().UTC()
	if len(userAgent) > 500 {
		userAgent = userAgent[:500]
	}
	if len(ip) > 64 {
		ip = ip[:64]
	}
	_, err := s.db.ExecContext(
		ctx,
		s.rebind(`INSERT INTO sessions (id, user_id, token_hash, user_agent, ip_address, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
		id, userID, tokenHash, userAgent, ip, s.timeArg(now), s.timeArg(now), s.timeArg(expiresAt),
	)
	if err != nil {
		return SessionInfo{}, err
	}
	return SessionInfo{
		ID:         id,
		UserID:     userID,
		UserAgent:  userAgent,
		IPAddress:  ip,
		CreatedAt:  now,
		LastSeenAt: now,
		ExpiresAt:  expiresAt.UTC(),
	}, nil
}

func (s *SQLStore) GetSessionByTokenHash(ctx context.Context, tokenHash string) (User, SessionInfo, error) {
	now := time.Now().UTC()
	row := s.db.QueryRowContext(ctx, s.rebind(`
		SELECT
			u.id, u.name, u.email, u.company, u.role, u.active, u.created_at, u.updated_at,
			se.id, se.user_agent, se.ip_address, se.created_at, se.last_seen_at, se.expires_at
		FROM sessions se
		JOIN users u ON u.id = se.user_id
		WHERE se.token_hash = ? AND se.expires_at > ?
	`), tokenHash, s.timeArg(now))

	var u User
	var se SessionInfo
	var company, ua, ip sql.NullString
	var activeRaw, uCreated, uUpdated, sCreated, sLastSeen, sExpires any
	if err := row.Scan(
		&u.ID, &u.Name, &u.Email, &company, &u.Role, &activeRaw, &uCreated, &uUpdated,
		&se.ID, &ua, &ip, &sCreated, &sLastSeen, &sExpires,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return User{}, SessionInfo{}, ErrNotFound
		}
		return User{}, SessionInfo{}, err
	}
	u.Company = company.String
	u.Active = parseBool(activeRaw)
	u.CreatedAt = parseTime(uCreated)
	u.UpdatedAt = parseTime(uUpdated)
	if !u.Active {
		return User{}, SessionInfo{}, ErrUserSuspended
	}

	se.UserID = u.ID
	se.UserAgent = ua.String
	se.IPAddress = ip.String
	se.CreatedAt = parseTime(sCreated)
	se.LastSeenAt = parseTime(sLastSeen)
	se.ExpiresAt = parseTime(sExpires)

	if now.Sub(se.LastSeenAt) > 15*time.Minute {
		_, _ = s.db.ExecContext(ctx, s.rebind(`UPDATE sessions SET last_seen_at = ? WHERE id = ?`), s.timeArg(now), se.ID)
		se.LastSeenAt = now
	}
	return u, se, nil
}

func (s *SQLStore) DeleteSessionByTokenHash(ctx context.Context, tokenHash string) error {
	_, err := s.db.ExecContext(ctx, s.rebind(`DELETE FROM sessions WHERE token_hash = ?`), tokenHash)
	return err
}

func (s *SQLStore) DeleteSessionByID(ctx context.Context, userID, sessionID string) (bool, error) {
	res, err := s.db.ExecContext(ctx, s.rebind(`DELETE FROM sessions WHERE id = ? AND user_id = ?`), sessionID, userID)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n == 1, nil
}

func (s *SQLStore) DeleteOtherSessions(ctx context.Context, userID, keepSessionID string) (int64, error) {
	if keepSessionID == "" {
		res, err := s.db.ExecContext(ctx, s.rebind(`DELETE FROM sessions WHERE user_id = ?`), userID)
		if err != nil {
			return 0, err
		}
		n, _ := res.RowsAffected()
		return n, nil
	}
	res, err := s.db.ExecContext(ctx, s.rebind(`DELETE FROM sessions WHERE user_id = ? AND id <> ?`), userID, keepSessionID)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	return n, nil
}

func (s *SQLStore) ListUserSessions(ctx context.Context, userID string) ([]SessionInfo, error) {
	now := time.Now().UTC()
	rows, err := s.db.QueryContext(ctx, s.rebind(`
		SELECT id, user_agent, ip_address, created_at, last_seen_at, expires_at
		FROM sessions
		WHERE user_id = ? AND expires_at > ?
		ORDER BY last_seen_at DESC
	`), userID, s.timeArg(now))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]SessionInfo, 0)
	for rows.Next() {
		var se SessionInfo
		var ua, ip sql.NullString
		var createdRaw, lastSeenRaw, expiresRaw any
		if err := rows.Scan(&se.ID, &ua, &ip, &createdRaw, &lastSeenRaw, &expiresRaw); err != nil {
			return nil, err
		}
		se.UserID = userID
		se.UserAgent = ua.String
		se.IPAddress = ip.String
		se.CreatedAt = parseTime(createdRaw)
		se.LastSeenAt = parseTime(lastSeenRaw)
		se.ExpiresAt = parseTime(expiresRaw)
		out = append(out, se)
	}
	return out, rows.Err()
}

// ---------------------------------------------------------------------------
// Tokens MCP / API
// ---------------------------------------------------------------------------

func (s *SQLStore) CreateAPIToken(ctx context.Context, userID, name, prefix, tokenHash string, scopes []string, expiresAt *time.Time) (APITokenInfo, error) {
	id := uuid.NewString()
	now := time.Now().UTC()
	if len(scopes) == 0 {
		scopes = append([]string(nil), DefaultTokenScopes...)
	}
	_, err := s.db.ExecContext(
		ctx,
		s.rebind(`INSERT INTO api_tokens (id, user_id, name, token_prefix, token_hash, scopes, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
		id, userID, strings.TrimSpace(name), prefix, tokenHash, s.encodeScopes(scopes), s.timeArg(now), s.optTimeArg(expiresAt),
	)
	if err != nil {
		return APITokenInfo{}, err
	}
	return APITokenInfo{
		ID:        id,
		Name:      strings.TrimSpace(name),
		Prefix:    prefix,
		Scopes:    scopes,
		CreatedAt: now,
		ExpiresAt: expiresAt,
	}, nil
}

func (s *SQLStore) ListAPITokens(ctx context.Context, userID string) ([]APITokenInfo, error) {
	rows, err := s.db.QueryContext(ctx, s.rebind(`
		SELECT id, name, token_prefix, scopes, created_at, last_used_at, expires_at
		FROM api_tokens
		WHERE user_id = ? AND revoked_at IS NULL
		ORDER BY created_at DESC
	`), userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]APITokenInfo, 0)
	for rows.Next() {
		var item APITokenInfo
		var scopesRaw, createdRaw, lastUsedRaw, expiresRaw any
		if err := rows.Scan(&item.ID, &item.Name, &item.Prefix, &scopesRaw, &createdRaw, &lastUsedRaw, &expiresRaw); err != nil {
			return nil, err
		}
		item.Scopes = decodeScopes(scopesRaw)
		item.CreatedAt = parseTime(createdRaw)
		item.LastUsedAt = parseOptTime(lastUsedRaw)
		item.ExpiresAt = parseOptTime(expiresRaw)
		out = append(out, item)
	}
	return out, rows.Err()
}

func (s *SQLStore) RevokeAPIToken(ctx context.Context, userID, tokenID string) (bool, error) {
	now := time.Now().UTC()
	res, err := s.db.ExecContext(
		ctx,
		s.rebind(`UPDATE api_tokens SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL`),
		s.timeArg(now), tokenID, userID,
	)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n == 1, nil
}

func (s *SQLStore) VerifyAPITokenHash(ctx context.Context, tokenHash string) (VerifiedAPIToken, error) {
	row := s.db.QueryRowContext(ctx, s.rebind(`
		SELECT
			t.id, t.scopes, t.last_used_at, t.expires_at,
			u.id, u.name, u.email, u.company, u.role, u.active, u.created_at, u.updated_at
		FROM api_tokens t
		JOIN users u ON u.id = t.user_id
		WHERE t.token_hash = ? AND t.revoked_at IS NULL
	`), tokenHash)

	var v VerifiedAPIToken
	var company sql.NullString
	var scopesRaw, lastUsedRaw, expiresRaw, activeRaw, uCreated, uUpdated any
	if err := row.Scan(
		&v.TokenID, &scopesRaw, &lastUsedRaw, &expiresRaw,
		&v.User.ID, &v.User.Name, &v.User.Email, &company, &v.User.Role, &activeRaw, &uCreated, &uUpdated,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return VerifiedAPIToken{}, ErrNotFound
		}
		return VerifiedAPIToken{}, err
	}
	v.User.Company = company.String
	v.User.Active = parseBool(activeRaw)
	v.User.CreatedAt = parseTime(uCreated)
	v.User.UpdatedAt = parseTime(uUpdated)
	if !v.User.Active {
		return VerifiedAPIToken{}, ErrUserSuspended
	}
	v.Scopes = decodeScopes(scopesRaw)
	v.ExpiresAt = parseOptTime(expiresRaw)

	now := time.Now().UTC()
	if v.ExpiresAt != nil && now.After(*v.ExpiresAt) {
		return VerifiedAPIToken{}, ErrNotFound
	}

	lastUsed := parseOptTime(lastUsedRaw)
	if lastUsed == nil || now.Sub(*lastUsed) > 5*time.Minute {
		_, _ = s.db.ExecContext(ctx, s.rebind(`UPDATE api_tokens SET last_used_at = ? WHERE id = ?`), s.timeArg(now), v.TokenID)
	}
	return v, nil
}

// ---------------------------------------------------------------------------
// Rate Limiting / Protección contra Fuerza Bruta
// ---------------------------------------------------------------------------

func (s *SQLStore) AllowAuthAttempt(ctx context.Context, keyHash string, maxAttempts int, window, blockDuration time.Duration) (bool, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer func() { _ = tx.Rollback() }()

	query := `SELECT attempts, window_started_at, blocked_until FROM auth_attempts WHERE key_hash = ?`
	if s.driver == "postgres" {
		query += ` FOR UPDATE`
	}

	var attempts int
	var windowRaw, blockedRaw any
	err = tx.QueryRowContext(ctx, s.rebind(query), keyHash).Scan(&attempts, &windowRaw, &blockedRaw)
	now := time.Now().UTC()

	if errors.Is(err, sql.ErrNoRows) {
		if _, err := tx.ExecContext(ctx, s.rebind(`INSERT INTO auth_attempts (key_hash, attempts, window_started_at) VALUES (?, 1, ?)`), keyHash, s.timeArg(now)); err != nil {
			return false, err
		}
		return true, tx.Commit()
	}
	if err != nil {
		return false, err
	}

	blockedUntil := parseOptTime(blockedRaw)
	if blockedUntil != nil && blockedUntil.After(now) {
		return false, nil
	}

	windowStarted := parseTime(windowRaw)
	if now.Sub(windowStarted) > window {
		if _, err := tx.ExecContext(ctx, s.rebind(`UPDATE auth_attempts SET attempts = 1, window_started_at = ?, blocked_until = NULL WHERE key_hash = ?`), s.timeArg(now), keyHash); err != nil {
			return false, err
		}
		return true, tx.Commit()
	}

	if attempts >= maxAttempts {
		until := now.Add(blockDuration)
		if _, err := tx.ExecContext(ctx, s.rebind(`UPDATE auth_attempts SET blocked_until = ? WHERE key_hash = ?`), s.timeArg(until), keyHash); err != nil {
			return false, err
		}
		return false, tx.Commit()
	}

	if _, err := tx.ExecContext(ctx, s.rebind(`UPDATE auth_attempts SET attempts = attempts + 1 WHERE key_hash = ?`), keyHash); err != nil {
		return false, err
	}
	return true, tx.Commit()
}

func (s *SQLStore) ClearAuthAttempts(ctx context.Context, keyHash string) error {
	_, err := s.db.ExecContext(ctx, s.rebind(`DELETE FROM auth_attempts WHERE key_hash = ?`), keyHash)
	return err
}

// ---------------------------------------------------------------------------
// Proyectos por Usuario
// ---------------------------------------------------------------------------

func unwrapStoredDoc(raw []byte, fallbackID, fallbackName string, fallbackUpdated int64) json.RawMessage {
	// En el código histórico de Node.js, la columna doc guardaba a veces el Project completo serializado
	// o directamente el EmailDoc. Soportamos ambos de forma transparente.
	var probe struct {
		Version int             `json:"version"`
		Doc     json.RawMessage `json:"doc"`
	}
	if err := json.Unmarshal(raw, &probe); err == nil {
		if len(probe.Doc) > 0 && probe.Version == 0 {
			return probe.Doc
		}
	}
	_ = fallbackID
	_ = fallbackName
	_ = fallbackUpdated
	return json.RawMessage(raw)
}

func (s *SQLStore) ListProjects(ctx context.Context, userID string) ([]Project, error) {
	rows, err := s.db.QueryContext(ctx, s.rebind(`
		SELECT id, name, updated_at, doc
		FROM projects
		WHERE user_id = ?
		ORDER BY updated_at DESC
	`), userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]Project, 0)
	for rows.Next() {
		var p Project
		var docBytes []byte
		if err := rows.Scan(&p.ID, &p.Name, &p.UpdatedAt, &docBytes); err != nil {
			return nil, err
		}
		p.Doc = unwrapStoredDoc(docBytes, p.ID, p.Name, p.UpdatedAt)
		out = append(out, p)
	}
	return out, rows.Err()
}

func (s *SQLStore) GetProject(ctx context.Context, userID, projectID string) (Project, error) {
	var p Project
	var docBytes []byte
	err := s.db.QueryRowContext(ctx, s.rebind(`
		SELECT id, name, updated_at, doc
		FROM projects
		WHERE user_id = ? AND id = ?
	`), userID, projectID).Scan(&p.ID, &p.Name, &p.UpdatedAt, &docBytes)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Project{}, ErrNotFound
		}
		return Project{}, err
	}
	p.Doc = unwrapStoredDoc(docBytes, p.ID, p.Name, p.UpdatedAt)
	return p, nil
}

func (s *SQLStore) SaveProject(ctx context.Context, userID string, p Project, expectedUpdatedAt *int64) (Project, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Project{}, err
	}
	defer func() { _ = tx.Rollback() }()

	if expectedUpdatedAt != nil {
		var currentUpdated int64
		err := tx.QueryRowContext(ctx, s.rebind(`SELECT updated_at FROM projects WHERE user_id = ? AND id = ?`), userID, p.ID).Scan(&currentUpdated)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return Project{}, err
		}
		if err == nil && currentUpdated != *expectedUpdatedAt {
			return Project{}, ErrConflict
		}
	}

	p.Name = strings.TrimSpace(p.Name)
	p.UpdatedAt = time.Now().UnixMilli()
	docStr := string(p.Doc)

	if s.driver == "postgres" {
		_, err = tx.ExecContext(ctx, `
			INSERT INTO projects (user_id, id, name, doc, updated_at)
			VALUES ($1, $2, $3, $4::jsonb, $5)
			ON CONFLICT (user_id, id) DO UPDATE
			SET name = EXCLUDED.name, doc = EXCLUDED.doc, updated_at = EXCLUDED.updated_at
		`, userID, p.ID, p.Name, docStr, p.UpdatedAt)
	} else {
		_, err = tx.ExecContext(ctx, `
			INSERT INTO projects (user_id, id, name, doc, updated_at)
			VALUES (?, ?, ?, ?, ?)
			ON CONFLICT (user_id, id) DO UPDATE
			SET name = excluded.name, doc = excluded.doc, updated_at = excluded.updated_at
		`, userID, p.ID, p.Name, docStr, p.UpdatedAt)
	}
	if err != nil {
		return Project{}, err
	}
	if err := tx.Commit(); err != nil {
		return Project{}, err
	}
	return p, nil
}

func (s *SQLStore) DeleteProject(ctx context.Context, userID, projectID string) (bool, error) {
	res, err := s.db.ExecContext(ctx, s.rebind(`DELETE FROM projects WHERE user_id = ? AND id = ?`), userID, projectID)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n == 1, nil
}

// ---------------------------------------------------------------------------
// Assets multimedia
// ---------------------------------------------------------------------------

func (s *SQLStore) RegisterAsset(ctx context.Context, userID string, asset UploadAsset) error {
	now := time.Now().UTC()
	if s.driver == "postgres" {
		_, err := s.db.ExecContext(ctx, `
			INSERT INTO upload_assets (user_id, name, size_bytes, media_type, created_at)
			VALUES ($1, $2, $3, $4, $5)
			ON CONFLICT (user_id, name) DO UPDATE
			SET size_bytes = EXCLUDED.size_bytes, media_type = EXCLUDED.media_type
		`, userID, asset.Name, asset.SizeBytes, asset.MediaType, s.timeArg(now))
		return err
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO upload_assets (user_id, name, size_bytes, media_type, created_at)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT (user_id, name) DO UPDATE
		SET size_bytes = excluded.size_bytes, media_type = excluded.media_type
	`, userID, asset.Name, asset.SizeBytes, asset.MediaType, s.timeArg(now))
	return err
}

func (s *SQLStore) ListAssets(ctx context.Context, userID string) ([]UploadAsset, error) {
	rows, err := s.db.QueryContext(ctx, s.rebind(`
		SELECT name, size_bytes, media_type, created_at
		FROM upload_assets
		WHERE user_id = ?
		ORDER BY created_at DESC
	`), userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]UploadAsset, 0)
	for rows.Next() {
		var a UploadAsset
		var createdRaw any
		if err := rows.Scan(&a.Name, &a.SizeBytes, &a.MediaType, &createdRaw); err != nil {
			return nil, err
		}
		a.CreatedAt = parseTime(createdRaw)
		out = append(out, a)
	}
	return out, rows.Err()
}

func (s *SQLStore) DeleteAsset(ctx context.Context, userID, name string) (bool, error) {
	res, err := s.db.ExecContext(ctx, s.rebind(`DELETE FROM upload_assets WHERE user_id = ? AND name = ?`), userID, name)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n == 1, nil
}

// ---------------------------------------------------------------------------
// Auditoría de Seguridad
// ---------------------------------------------------------------------------

func (s *SQLStore) RecordAudit(ctx context.Context, userID, action, ip, metadata string) error {
	var uid any
	if strings.TrimSpace(userID) != "" {
		uid = userID
	}
	if len(ip) > 64 {
		ip = ip[:64]
	}
	_, err := s.db.ExecContext(
		ctx,
		s.rebind(`INSERT INTO audit_logs (id, user_id, action, ip_address, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?)`),
		uuid.NewString(), uid, action, ip, metadata, s.timeArg(time.Now().UTC()),
	)
	return err
}

func (s *SQLStore) ListAuditLogs(ctx context.Context, limit int) ([]AuditLog, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := s.db.QueryContext(ctx, s.rebind(`
		SELECT id, user_id, action, ip_address, metadata, created_at
		FROM audit_logs
		ORDER BY created_at DESC
		LIMIT ?
	`), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]AuditLog, 0)
	for rows.Next() {
		var l AuditLog
		var uid, ip, meta sql.NullString
		var createdRaw any
		if err := rows.Scan(&l.ID, &uid, &l.Action, &ip, &meta, &createdRaw); err != nil {
			return nil, err
		}
		l.UserID = uid.String
		l.IPAddress = ip.String
		l.Metadata = meta.String
		l.CreatedAt = parseTime(createdRaw)
		out = append(out, l)
	}
	return out, rows.Err()
}
