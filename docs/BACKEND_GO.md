# Backend de Autenticación, Usuarios y Persistencia en Go

El directorio [`backend/`](../backend) contiene un servidor HTTP independiente escrito en **Go** (biblioteca estándar `net/http` + `database/sql`), diseñado para ejecutarse en paralelo a Next.js con latencias por debajo del milisegundo y cero dependencias de CGO (`CGO_ENABLED=0`).

---

## 1. Inicio Rápido

### Desarrollo en paralelo (Go + Next.js en un solo comando)

Desde la raíz del proyecto:

```bash
npm run dev:full
```

Esto inicia simultáneamente:
- **Backend en Go** en `http://127.0.0.1:8080` usando **SQLite** en `storage/misiva.db` (se crea y migra solo).
- **Frontend Next.js** en `http://localhost:3000` conectado vía `GO_BACKEND_URL=http://127.0.0.1:8080`.

### Comandos individuales del backend en Go

```bash
npm run go:dev      # Ejecuta el servidor Go en modo desarrollo (:8080)
npm run go:test     # Ejecuta todas las pruebas unitarias e integrales en Go
npm run go:build    # Compila el binario en backend/bin/misiva-backend
```

---

## 2. Variables de Entorno (`backend/.env.example`)

| Variable | Descripción | Valor por defecto |
| --- | --- | --- |
| `GO_HOST` | Interfaz de red donde escucha el servicio Go. | `127.0.0.1` |
| `GO_PORT` | Puerto HTTP del servicio Go. | `8080` |
| `DB_DRIVER` | Motor SQL: `sqlite` o `postgres` (autodetecta `postgres` si hay `DATABASE_URL`). | `sqlite` |
| `SQLITE_PATH` | Ruta del archivo SQLite cuando `DB_DRIVER=sqlite`. Activa WAL y `foreign_keys=ON`. | `../storage/misiva.db` |
| `DATABASE_URL` | Cadena de conexión PostgreSQL cuando `DB_DRIVER=postgres`. | *(vacío)* |
| `APP_ORIGIN` | Origen público autorizado para validación CSRF y cookies `Secure`. | `http://localhost:3000` |
| `CORS_ALLOWED_ORIGINS` | Lista separada por comas de orígenes permitidos en CORS. | `http://localhost:3000,http://127.0.0.1:3000` |
| `SESSION_DAYS` | Duración en días de las sesiones interactivas. | `30` |
| `COOKIE_SECURE` | `1` fuerza el atributo `Secure` en la cookie `misiva_session`. | Automático según HTTPS |

---

## 3. Modelo de Seguridad y Base de Datos

### Criptografía y Sesiones
- **Contraseñas**: Hashing **Argon2id** (`m=19456 KiB, t=2, p=1, keyLen=32`) almacenado en formato estándar PHC (`$argon2id$v=19$m=19456,t=2,p=1$...`). Es **100 % compatible** con los hashes generados previamente por `@node-rs/argon2`.
- **Sesiones**: Tokens aleatorios de 256 bits (`crypto/rand` en Base64URL). En la base de datos **nunca se guarda el token en claro**, únicamente su resumen `SHA-256` (`token_hash`). Se entregan simultáneamente en cookie `HttpOnly; SameSite=Lax` (`misiva_session`) y como `sessionToken` para clientes API.
- **Tokens MCP (`misiva_mcp_...`)**: Prefijo identificable de 22 caracteres + secreto aleatorio de 288 bits, hash `SHA-256` en base de datos, **scopes granulares** y fecha de expiración opcional.
- **Protección contra Fuerza Bruta**: Tabla `auth_attempts` transaccional por `SHA-256(scope + IP + email)`. Bloquea temporalmente durante 15 minutos tras superar el umbral (5 intentos en registro, 10 en login) y se limpia al iniciar sesión con éxito.
- **Primer Usuario Administrador**: Al crear la primera cuenta sobre una base vacía, recibe automáticamente el rol `admin`. El sistema impide degradar, suspender o borrar al último administrador activo.

### Tablas Migradas Automáticamente
1. `users`: `id`, `name`, `email` (único), `company`, `password_hash`, `role` (`admin`|`member`), `active`, `created_at`, `updated_at`.
2. `sessions`: `id`, `user_id`, `token_hash`, `user_agent`, `ip_address`, `created_at`, `last_seen_at`, `expires_at`.
3. `api_tokens`: `id`, `user_id`, `name`, `token_prefix`, `token_hash`, `scopes`, `created_at`, `last_used_at`, `expires_at`, `revoked_at`.
4. `projects`: `(user_id, id)` PK compuesta, `name`, `doc` (`JSONB` en Postgres / `TEXT` en SQLite), `updated_at` (`BIGINT` ms).
5. `upload_assets`: `(user_id, name)` PK compuesta, `size_bytes`, `media_type`, `created_at`.
6. `auth_attempts`: `key_hash`, `attempts`, `window_started_at`, `blocked_until`.
7. `audit_logs`: `id`, `user_id`, `action`, `ip_address`, `metadata`, `created_at`.

---

## 4. Referencia de Endpoints REST (`/api/v1`)

### Salud
| Método | Ruta | Auth | Descripción |
| --- | --- | --- | --- |
| `GET` | `/healthz` o `/api/v1/health` | Pública | Estado del servidor, driver activo (`sqlite`/`postgres`) y latencia de base de datos. |

### Autenticación, Perfil y Sesiones
| Método | Ruta | Auth | Descripción |
| --- | --- | --- | --- |
| `POST` | `/api/v1/auth/register` | Pública | Crea cuenta (`name`, `email`, `company?`, `password` >= 12 chars) e inicia sesión. |
| `POST` | `/api/v1/auth/login` | Pública | Autentica credenciales y emite cookie `misiva_session` + `sessionToken`. |
| `POST` | `/api/v1/auth/logout` | Pública | Revoca la sesión actual y limpia la cookie. |
| `POST` | `/api/v1/auth/logout-all` | Sesión | Cierra todas las demás sesiones activas del usuario. |
| `GET` | `/api/v1/auth/session` | Opcional | Devuelve `{ authRequired, authenticated, backend: "go", dbDriver, user }`. |
| `GET` | `/api/v1/auth/me` | Sesión / Token | Devuelve los datos del usuario autenticado. |
| `PATCH` | `/api/v1/auth/me` | Sesión | Actualiza `name`, `email` o `company`. |
| `POST` | `/api/v1/auth/password` | Sesión | Cambia la contraseña (`currentPassword`, `newPassword`) y cierra otras sesiones. |
| `GET` | `/api/v1/auth/sessions` | Sesión | Lista sesiones activas marcando `current: true` en la sesión actual. |
| `DELETE` | `/api/v1/auth/sessions/{id}` | Sesión | Revoca una sesión específica por su ID. |

### Tokens MCP e Introspección
| Método | Ruta | Auth | Descripción |
| --- | --- | --- | --- |
| `GET` | `/api/v1/auth/tokens` | Sesión | Lista tokens MCP activos del usuario con sus `scopes` y último uso. |
| `POST` | `/api/v1/auth/tokens` | Sesión | Crea un token (`name`, `scopes[]`, `expiresInDays?`). Devuelve el valor completo una única vez. |
| `DELETE` | `/api/v1/auth/tokens/{id}` | Sesión | Revoca inmediatamente un token MCP (también acepta `DELETE /api/v1/auth/tokens` con `{ id }`). |
| `POST` | `/api/v1/mcp/verify` | Bearer MCP | Valida un token `misiva_mcp_...` y devuelve `{ valid, tokenId, user, scopes, expiresAt }`. |

### Proyectos y Multimedia (Soportan Sesión y Tokens MCP con Scopes)
| Método | Ruta | Scope requerido | Descripción |
| --- | --- | --- | --- |
| `GET` | `/api/v1/projects` | `projects:read` | Lista todos los mailings del usuario ordenados por `updatedAt DESC`. |
| `GET` | `/api/v1/projects/{id}` | `projects:read` | Obtiene el proyecto completo por su ID. |
| `PUT` | `/api/v1/projects` | `projects:write` | Crea o actualiza un proyecto. Acepta `expectedUpdatedAt` (devuelve `409` si cambió). |
| `DELETE` | `/api/v1/projects/{id}` | `projects:delete` | Elimina un proyecto del usuario. |
| `GET` | `/api/v1/assets` | `assets:read` | Lista los metadatos de imágenes subidas por el usuario. |
| `POST` | `/api/v1/assets` | `assets:write` | Registra una imagen subida asociada a la cuenta. |
| `DELETE` | `/api/v1/assets/{name}` | `assets:write` | Elimina el registro de propiedad de una imagen. |

### Administración (Solo rol `admin`)
| Método | Ruta | Auth | Descripción |
| --- | --- | --- | --- |
| `GET` | `/api/v1/users` | Admin | Lista usuarios con conteo de proyectos, sesiones activas y tokens MCP. |
| `PATCH` | `/api/v1/users/{id}` | Admin | Cambia `role` (`admin`\|`member`) o `active` (`true`\|`false`). Suspender cierra sesiones al instante. |
| `DELETE` | `/api/v1/users/{id}` | Admin | Elimina un usuario y todos sus recursos en cascada. |
| `GET` | `/api/v1/audit-logs` | Admin | Consulta eventos recientes de seguridad (`?limit=50`). |
