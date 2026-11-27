package config

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// Config centraliza toda la configuración del backend en Go de Misiva.
type Config struct {
	Host           string
	Port           string
	DBDriver       string // "sqlite" o "postgres"
	DatabaseURL    string
	SQLitePath     string
	AppOrigin      string
	AllowedOrigins []string
	SessionDays    int
	CookieSecure   bool
}

// Load construye la configuración leyendo variables de entorno con valores seguros por defecto.
func Load() Config {
	host := firstNonEmpty(os.Getenv("GO_HOST"), os.Getenv("HOSTNAME"), "127.0.0.1")
	port := firstNonEmpty(os.Getenv("GO_PORT"), os.Getenv("PORT"), "8080")
	dbURL := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	driver := strings.ToLower(strings.TrimSpace(os.Getenv("DB_DRIVER")))
	if driver == "" {
		if dbURL != "" {
			driver = "postgres"
		} else {
			driver = "sqlite"
		}
	}

	sqlitePath := strings.TrimSpace(os.Getenv("SQLITE_PATH"))
	if sqlitePath == "" {
		storageDir := strings.TrimSpace(os.Getenv("MAILING_STORAGE_DIR"))
		if storageDir == "" {
			// Si se ejecuta desde /backend en desarrollo, usa ../storage si existe la raíz del monorepo.
			if _, err := os.Stat(filepath.Join("..", "package.json")); err == nil {
				storageDir = filepath.Join("..", "storage")
			} else {
				storageDir = "storage"
			}
		}
		sqlitePath = filepath.Join(storageDir, "misiva.db")
	}

	appOrigin := strings.TrimSpace(os.Getenv("APP_ORIGIN"))
	rawOrigins := os.Getenv("CORS_ALLOWED_ORIGINS")
	origins := parseCSV(rawOrigins)
	if appOrigin != "" && !contains(origins, appOrigin) {
		origins = append(origins, appOrigin)
	}
	for _, local := range []string{"http://localhost:3000", "http://127.0.0.1:3000"} {
		if !contains(origins, local) {
			origins = append(origins, local)
		}
	}

	sessionDays := 30
	if v, err := strconv.Atoi(os.Getenv("SESSION_DAYS")); err == nil && v > 0 && v <= 365 {
		sessionDays = v
	}

	cookieSecure := strings.HasPrefix(strings.ToLower(appOrigin), "https://") || os.Getenv("COOKIE_SECURE") == "1"

	return Config{
		Host:           host,
		Port:           port,
		DBDriver:       driver,
		DatabaseURL:    dbURL,
		SQLitePath:     sqlitePath,
		AppOrigin:      appOrigin,
		AllowedOrigins: origins,
		SessionDays:    sessionDays,
		CookieSecure:   cookieSecure,
	}
}

func (c Config) Addr() string {
	return c.Host + ":" + c.Port
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if t := strings.TrimSpace(v); t != "" {
			return t
		}
	}
	return ""
}

func parseCSV(raw string) []string {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		t := strings.TrimSpace(p)
		if t != "" && !contains(out, t) {
			out = append(out, t)
		}
	}
	return out
}

func contains(items []string, target string) bool {
	for _, item := range items {
		if item == target {
			return true
		}
	}
	return false
}
