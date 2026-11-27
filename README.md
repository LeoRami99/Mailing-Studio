<p align="center">
  <img src="public/brand/icon.svg" alt="Misiva" width="180">
</p>

<p align="center">
  <strong>Editor visual de código abierto para crear correos HTML que se ven bien en todas partes.</strong><br>
  Gmail · Outlook · Apple Mail · Yahoo · Samsung Mail · Thunderbird — y exportación lista para SendGrid, Mailchimp, Brevo, HubSpot y más.
</p>

<p align="center">
  <strong>Desarrollado por Zegiru Labs.</strong>
</p>

<p align="center">
  <a href="LICENSE"><img alt="Licencia MIT" src="https://img.shields.io/badge/licencia-MIT-5b3df5"></a>
  <img alt="Node.js 20.9+" src="https://img.shields.io/badge/node-%E2%89%A520.9-339933">
  <img alt="Go 1.24+" src="https://img.shields.io/badge/Go-1.24+-00ADD8">
  <img alt="Next.js 16" src="https://img.shields.io/badge/Next.js-16-000000">
  <img alt="Electron 45" src="https://img.shields.io/badge/Electron-45-47848F">
  <img alt="Plataformas" src="https://img.shields.io/badge/escritorio-Linux%20%7C%20Windows%20%7C%20macOS-ff6b4a">
</p>

<p align="center">
  <img src="docs/screenshot.png" alt="Captura del editor de Misiva" width="900">
</p>

---

## Contenido

- [Qué es Misiva](#qué-es-misiva)
- [Características](#características)
- [Inicio rápido](#inicio-rápido)
- [Ejecutar en desarrollo](#ejecutar-en-desarrollo)
- [Compilar](#compilar)
  - [Servidor propio con Docker](#servidor-propio-con-docker)
  - [Versión web](#versión-web)
  - [App de escritorio](#app-de-escritorio)
  - [Publicar una versión con GitHub Actions](#publicar-una-versión-con-github-actions)
- [Cómo se usa](#cómo-se-usa)
- [Configuración](#configuración)
- [Integración MCP para asistentes de IA](#integración-mcp-para-asistentes-de-ia)
- [Documentación técnica detallada](#documentación-técnica-detallada)
- [Arquitectura](#arquitectura)
- [Solución de problemas](#solución-de-problemas)
- [Contribuir](#contribuir)
- [Marca](#marca)
- [Licencia](#licencia)

## Qué es Misiva

*Misiva* (del latín *missīva*, «carta que se envía») es un editor de correos HTML con arrastrar y soltar.
Arma el correo con bloques, personalízalo con variables, revisa que sea compatible y exporta el HTML con
la sintaxis exacta de tu plataforma de envío. Funciona en el navegador (con cuentas multiusuario sobre un
backend rápido en **Go** con SQLite o PostgreSQL) o como app de escritorio sin servicios externos.

## Características

**Editor**
- 11 bloques: título, texto enriquecido, imagen, botón, columnas (2–4), portada con imagen de fondo,
  separador, espacio, redes sociales, pie legal con enlace de baja y HTML libre.
- Arrastrar y soltar, duplicar, reordenar, deshacer/rehacer y atajos de teclado.
- Estilo por bloque: fuentes, tamaños, colores, márgenes, bordes, alineación y fondo.
- Visibilidad: ocultar en móvil, mostrar solo en móvil o mostrar solo si una variable tiene valor.
- Diseño global: ancho, fondos, tipografía y fuente web, colores para modo oscuro, UTM y CSS propio.
- Plantillas de inicio: boletín, evento/webinar, promoción y notificación.

**Autenticación y Backend en Go (`/backend`)**
- Servicio independiente en **Go** (`net/http` + `CGO_ENABLED=0`) con soporte dual **SQLite WAL** (cero configuración en local) y **PostgreSQL** (producción/Docker).
- Contraseñas protegidas con **Argon2id** en formato estándar PHC, sesiones `HttpOnly`, límite contra fuerza bruta y bitácora de auditoría.
- Gestión de perfil, cambio de contraseña, cierre de sesiones activas en otros dispositivos y panel de administración de usuarios (`admin` / `member`).
- Aislamiento estricto de proyectos e imágenes por cuenta, con control de concurrencia optimista.

**Variables y plataformas**
- Sintaxis única en el editor (`{{nombre}}`, `{{nombre|"amigo"}}`, `{{#if x}}…{{/if}}`) que se traduce al
  exportar a: Genérico, SendGrid, Mailchimp, Brevo, HubSpot, Mailgun, Amazon SES, Postmark, Mailjet,
  Klaviyo, ActiveCampaign, Salesforce Marketing Cloud, Zoho Campaigns o patrones personalizados.
- Nombre del campo configurable por plataforma (p. ej. `nombre` → `FNAME` en Mailchimp).
- Importación de variables desde la cabecera de un CSV.

**Compatibilidad**
- Maquetación con tablas y estilos en línea, tabla fantasma y VML para Outlook escritorio.
- Columnas híbridas que se apilan en móvil incluso sin media queries (app de Gmail).
- Preheader, modo oscuro (`prefers-color-scheme` y Outlook.com) e imágenes alternativas para modo oscuro.
- Revisión automática antes de exportar: peso frente al límite de 102 KB de Gmail, imágenes sin `alt` o
  sin ancho, rutas locales, enlaces vacíos o `http`, falta de enlace de baja, etiquetas prohibidas y
  variables sin definir.

**Entrada y salida**
- Exporta HTML (normal o minificado), versión en texto plano y JSON de datos de ejemplo.
- Carga plantillas HTML completas y hojas CSS separadas. Permite modificar contenido visualmente, editar
  el HTML y los bloques `<style>` en pestañas dedicadas, con vista previa en vivo; convierte merge tags de
  otras plataformas (`*|FNAME|*`, `{{ contact.X }}`, `%%X%%`…) a variables.
- Importación híbrida: adapta títulos, textos, imágenes, botones, separadores y tablas de 2–4 columnas a
  bloques nativos; conserva automáticamente las secciones complejas como HTML y muestra un informe antes
  de crear el proyecto.
- Guarda y abre proyectos `.json`; guardado automático en servidor o en el navegador.
- Biblioteca de imágenes con subida por arrastre.
- Vista previa en escritorio, tablet y móvil, con modo oscuro simulado e imágenes bloqueadas.

## Inicio rápido

**Requisitos:** [Node.js](https://nodejs.org/) 20.9 o superior (recomendado 22 LTS) y [Go](https://go.dev/) 1.24+ (para el backend de cuentas y MCP; opcional si solo usa el editor local en navegador).

```bash
git clone <url-del-repositorio> misiva
cd misiva
npm install

# Modo completo en paralelo (Backend Go con SQLite + Frontend Next.js + MCP):
npm run dev:full
```

Abra <http://localhost:3000>. Cree su primera cuenta (recibirá rol `admin` automáticamente) y empiece a diseñar o generar tokens MCP desde **Cuenta → Acceso MCP**.

> Si desea ejecutar únicamente el editor local sin cuentas ni servidor Go, ejecute `npm run dev`.

## Ejecutar en desarrollo

| Comando                | Qué hace                                                                          |
| ---------------------- | --------------------------------------------------------------------------------- |
| `npm run dev:full`     | Levanta en paralelo el backend en Go (`:8080`, SQLite) y `next dev` (`:3000`).    |
| `npm run dev`          | Solo frontend Next.js en <http://localhost:3000> (modo local si no hay backend).  |
| `npm run go:dev`       | Ejecuta únicamente el backend en Go en `http://127.0.0.1:8080`.                   |
| `npm run go:test`      | Ejecuta la suite de pruebas unitarias e integrales del backend en Go.             |
| `npm run go:build`     | Compila el binario `backend/bin/misiva-backend`.                                  |
| `npm run mcp:stdio`    | Inicia el servidor MCP de Misiva sobre transporte `stdio`.                        |
| `npm run electron:dev` | App de escritorio sobre `next dev`. Reutiliza el servidor de `:3000` si ya corre. |
| `npm run lint`         | ESLint.                                                                           |
| `npx tsc --noEmit`     | Revisión de tipos TypeScript.                                                     |

En desarrollo, las imágenes subidas se guardan en `storage/uploads/` y la base SQLite local en `storage/misiva.db` (ignorados por git).

## Compilar

### Servidor propio con Docker

El despliegue con Docker Compose levanta tres contenedores coordinados: **PostgreSQL 17**, **Backend en Go (`backend-go`)** y **Next.js (`misiva`)**.

```bash
cp .env.example .env
# Edite .env y defina POSTGRES_PASSWORD y APP_ORIGIN.
docker compose up -d --build
```

Misiva quedará disponible en <http://127.0.0.1:3000>. Al abrirlo por primera vez, cree la cuenta inicial (administrador) desde **Registrarse**. Coloque Caddy, Traefik o nginx delante con HTTPS.

### Versión web manual

```bash
npm run go:build     # compila backend/bin/misiva-backend
npm run build        # compila Next.js (.next/standalone)
```

Ejecute `backend/bin/misiva-backend` (con SQLite o `DB_DRIVER=postgres DATABASE_URL=...`) y arranque Next.js definiendo `GO_BACKEND_URL=http://127.0.0.1:8080` y `MISIVA_SERVER_PROJECTS=1`.

### App de escritorio

| Comando                  | Resultado                                                           | Dónde compilar           |
| ------------------------ | ------------------------------------------------------------------- | ------------------------ |
| `npm run electron:start` | Compila y abre la app en modo producción, sin empaquetar.           | Cualquiera               |
| `npm run dist:linux`     | `dist-electron/Misiva-<versión>-linux-x86_64.AppImage`              | Linux                    |
| `npm run dist:win`       | `dist-electron/Misiva-<versión>-win-x64.exe` (instalador NSIS)      | Windows (o Linux + Wine) |
| `npm run dist:mac`       | `dist-electron/Misiva-<versión>-mac-<arch>.dmg`                     | macOS                    |

### Publicar una versión con GitHub Actions

- **CI** (`ci.yml`): en cada *push* a `main` y en cada *pull request* ejecuta lint, revisión de tipos y build.
- **Release** (`release.yml`): al subir una etiqueta `v*` compila los instaladores de Linux, Windows y macOS.

## Cómo se usa

1. **Elija una plantilla** en *☰ Correos* o empiece en blanco.
2. **Arrastre bloques** desde el panel izquierdo y edítelos en el panel derecho.
3. **Defina el asunto y el preheader** en *Diseño → Mensaje*.
4. **Inserte variables** desde el editor de texto o escribiéndolas a mano.
5. **Revise** con *Vista previa* (móvil, modo oscuro, imágenes bloqueadas, datos de prueba).
6. **Exporte**: elija la plataforma, revise la pestaña *Revisión* y descargue el `.html` y el `.txt`.

### Sintaxis de variables

| Escriba                         | Significado                                    |
| ------------------------------- | ---------------------------------------------- |
| `{{nombre}}`                    | Variable                                       |
| `{{nombre\|"amigo"}}`           | Variable con valor por defecto si llega vacía  |
| `{{#if empresa}}…{{else}}…{{/if}}` | Contenido condicional                       |
| `{{@unsubscribe}}`              | URL de baja                                    |
| `{{@preferences}}`              | URL de preferencias                            |
| `{{@webversion}}`               | URL de la versión web                          |

## Configuración

Variables de entorno principales:

| Variable              | Uso                                                                  | Por defecto            |
| --------------------- | -------------------------------------------------------------------- | ---------------------- |
| `GO_BACKEND_URL`      | URL del backend en Go para autenticación, usuarios, tokens y proyectos.| Desactivado          |
| `GO_HOST`, `GO_PORT`  | Interfaz y puerto donde escucha el backend en Go.                    | `127.0.0.1`, `8080`    |
| `DB_DRIVER`           | Motor SQL del backend Go (`sqlite` o `postgres`).                    | `sqlite`               |
| `SQLITE_PATH`         | Ruta del archivo SQLite cuando `DB_DRIVER=sqlite`.                   | `./storage/misiva.db`  |
| `MAILING_STORAGE_DIR` | Carpeta donde se guardan las imágenes subidas (`<dir>/uploads`).     | `./storage`            |
| `PORT`, `HOSTNAME`    | Puerto e interfaz del servidor autónomo (`server.js`).               | `3000`, `0.0.0.0`      |
| `MISIVA_SERVER_PROJECTS` | `1` guarda proyectos en el servidor (activo automáticamente con Go). | Automático con Go   |
| `DATABASE_URL`        | Conexión PostgreSQL para producción/Docker.                          | Desactivado            |
| `APP_ORIGIN`          | Origen público autorizado para operaciones de escritura y CORS.      | Host de la solicitud   |
| `MISIVA_MCP_TOKEN`    | Token MCP para transporte `stdio` o modo local sin base de datos.    | Desactivado            |
| `MISIVA_MCP_ALLOWED_ORIGINS` | Orígenes web adicionales permitidos en `/mcp`.               | Ninguno                |

## Integración MCP para asistentes de IA

Misiva publica un servidor **MCP v0.2** tanto por **Streamable HTTP** (`/mcp`) como por **STDIO** (`npm run mcp:stdio`), con **18 herramientas**, **5 recursos `misiva://`** y **3 prompts guiados**.

En Misiva abra el botón de cuenta → **Acceso MCP**, elija los permisos (`projects:read`, `projects:write`, `projects:delete`, `assets:read`), cree un token y copie la configuración JSON lista para su cliente:

```json
{
  "mcpServers": {
    "misiva": {
      "url": "http://localhost:3000/mcp",
      "headers": {
        "Authorization": "Bearer <TOKEN_MCP_PERSONAL>"
      }
    }
  }
}
```

Capacidades destacadas del MCP:
- **Catálogos y descubrimiento**: `list_templates`, `list_platforms`, `list_block_types`, `list_assets`.
- **Proyectos**: `list_projects`, `get_project` (completo o resumido), `create_mailing`, `duplicate_project`, `delete_project`, `save_project`.
- **Edición granular sin reenviar todo el JSON**: `update_settings`, `add_block`, `update_block`, `move_block`, `remove_block`, `set_variables`, `import_html_mailing`.
- **Renderizado y auditoría**: `render_project` (modos `export` y `preview` con métricas de peso Gmail <102 KB y validación de compatibilidad).

Consulte la referencia completa en **[docs/MCP.md](docs/MCP.md)**.

## Documentación técnica detallada

- **[docs/ARQUITECTURA.md](docs/ARQUITECTURA.md)** — Diagnóstico del proyecto, diagrama de arquitectura híbrida y flujo entre Next.js, Go, Electron y MCP.
- **[docs/BACKEND_GO.md](docs/BACKEND_GO.md)** — Referencia completa del backend en Go: seguridad Argon2id, esquema SQLite/PostgreSQL, bitácora de auditoría y todos los endpoints `/api/v1/*`.
- **[docs/MCP.md](docs/MCP.md)** — Guía de integración MCP (Streamable HTTP y `stdio`), scopes, las 18 herramientas, recursos y prompts.

## Arquitectura

```text
backend/                   Backend independiente en Go (:8080)
  cmd/server/main.go       Arranque HTTP y apagado ordenado
  internal/config/         Configuración por entorno (SQLite / PostgreSQL)
  internal/security/       Argon2id PHC, SHA-256 y tokens criptográficos
  internal/store/          Persistencia SQL unificada, rate limit y auditoría
  internal/server/         Endpoints REST /api/v1/*, middlewares y pruebas E2E
app/
  page.tsx                 Puerta de sesión y editor
  mcp/route.ts             Servidor MCP Streamable HTTP con CORS y scopes
  api/                     Proxy/endpoints de sesión, perfil, usuarios, proyectos e imágenes
components/editor/         Interfaz: lienzo, paneles, inspector, modales, editor de código
components/auth/           Login, registro, gestión de perfil/sesiones, admin y acceso MCP
lib/email/                 Modelo EmailDoc, compilador HTML/VML, plataformas y validador
lib/mcp/server.ts          Definición de las 18 herramientas, 5 recursos y 3 prompts MCP
lib/server/go-backend.ts   Puente HTTP Next.js <-> Go Backend
scripts/                   Arranque en paralelo (dev-parallel.mjs), MCP stdio y Electron
```

## Solución de problemas

| Problema | Solución |
| --- | --- |
| «No se pudo conectar con el backend de autenticación en Go» | Ejecute `npm run dev:full` o levante Go con `npm run go:dev` cuando `GO_BACKEND_URL` esté configurada. |
| `npm run dev` falla con errores de sintaxis o «Node.js version» | Use Node 20.9+ (`node --version`; con nvm: `nvm use`). |
| «Another next dev server is already running» | Ya hay un `next dev` abierto; use ese o deténgalo. `electron:dev` lo reutiliza. |
| Las imágenes no se ven en el correo recibido | Las rutas `/media/…` deben ser públicas: configure la *URL pública* o use URLs de un CDN. |
| macOS dice que la app «está dañada» | Es por no estar firmada: `xattr -cr /Applications/Misiva.app`. |

## Contribuir

¡Las contribuciones son bienvenidas! Lea [CONTRIBUTING.md](CONTRIBUTING.md) y el
[Código de conducta](CODE_OF_CONDUCT.md). Para reportar vulnerabilidades, vea [SECURITY.md](SECURITY.md).
Los cambios por versión están en [CHANGELOG.md](CHANGELOG.md).

## Marca

| Elemento       | Valor |
| -------------- | ----- |
| Nombre         | **Misiva** (en el logo, en minúsculas: *misiva.*) |
| Desarrollo     | Claude y Codex por **Zegiru Labs** |
| Color principal | Esmeralda `#008F55` y verde eléctrico `#00E878` |
| Acento          | Lima `#C8FF00` |
| Texto oscuro    | `#073B2A` |
| Archivos        | `public/brand/icon.svg`, `public/brand/icon-1024.png`, `build/icon.png` |

## Licencia

[MIT](LICENSE) © 2026 Leonardo Ramírez y colaboradores de Misiva.
