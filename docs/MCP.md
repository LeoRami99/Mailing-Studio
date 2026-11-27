# Servidor MCP de Misiva (v0.2)

Misiva integra un servidor **Model Context Protocol (MCP)** completo para que asistentes de IA (Claude Desktop, Claude Code, Cursor, Windsurf, VS Code Copilot, Codex, MCP Inspector, etc.) puedan diseñar, editar bloque por bloque, importar, auditar compatibilidad y exportar correos HTML profesionales sobre la cuenta del usuario.

---

## 1. Mejoras Principales en MCP v0.2

1. **Integración directa con el Backend en Go**: Autenticación mediante tokens personales `misiva_mcp_...` validados contra `/api/v1/mcp/verify`, aislando los proyectos por usuario.
2. **Permisos Granulares (`scopes`) por Token**:
   - `projects:read`: Listar, leer y renderizar/auditar mailings.
   - `projects:write`: Crear mailings, editar ajustes, bloques, variables e importar HTML.
   - `projects:delete`: Eliminar proyectos (desactivado por defecto al crear un token para evitar borrados accidentales).
   - `assets:read`: Consultar la biblioteca de imágenes subidas por el usuario.
3. **Edición Granular Inteligente**: Ya no es necesario que el modelo reenvíe todo el árbol `EmailDoc` en cada cambio. Con `add_block`, `update_block`, `move_block`, `remove_block`, `update_settings` y `set_variables`, Misiva rellena valores por defecto automáticamente y devuelve errores diagnósticos exactos por ruta si falta una propiedad.
4. **Doble Transporte**:
   - **Streamable HTTP (`/mcp`)** con soporte CORS y `OPTIONS` para clientes remotos o basados en web.
   - **STDIO (`npm run mcp:stdio`)** nativo sobre Node.js para clientes locales de escritorio.
5. **Recursos (`misiva://`) y Prompts Guiados**: Catálogos en vivo de bloques, plataformas ESP, reglas de entregabilidad y plantillas de trabajo para campañas y pruebas A/B.

---

## 2. Cómo Conectar un Cliente MCP

### Opción A: Transporte Streamable HTTP (Recomendado)

1. Inicie Misiva con el backend en Go (`npm run dev:full` o `docker compose up -d`).
2. Inicie sesión en `http://localhost:3000`, haga clic en el ícono de **Cuenta** (arriba a la derecha) → pestaña **Acceso MCP**.
3. Elija los permisos deseados, pulse **Crear** y copie el token `misiva_mcp_...` (o pulse **Copiar JSON** directamente desde el modal).

```json
{
  "mcpServers": {
    "misiva": {
      "url": "http://localhost:3000/mcp",
      "headers": {
        "Authorization": "Bearer misiva_mcp_SU_TOKEN_PERSONAL"
      }
    }
  }
}
```

### Opción B: Transporte Local STDIO (Claude Desktop / Cursor / CLI)

Conectado a su cuenta en el backend Go:

```json
{
  "mcpServers": {
    "misiva": {
      "command": "node",
      "args": ["/ruta/absoluta/a/Mailing-Studio/scripts/mcp-stdio.mjs"],
      "env": {
        "GO_BACKEND_URL": "http://127.0.0.1:8080",
        "MISIVA_MCP_TOKEN": "misiva_mcp_SU_TOKEN_PERSONAL"
      }
    }
  }
}
```

> **Modo local sin cuentas**: Si omite `GO_BACKEND_URL` y `DATABASE_URL`, `scripts/mcp-stdio.mjs` trabajará directamente sobre `./storage/projects/*.json`.

---

## 3. Catálogo de las 18 Herramientas MCP

### Descubrimiento y Catálogos (`readOnly`)
| Herramienta | Scope | Descripción |
| --- | --- | --- |
| `list_templates` | — | Lista las 5 plantillas base (`blank`, `newsletter`, `event`, `promo`, `transactional`) y su estructura. |
| `list_platforms` | — | Lista las 14 plataformas ESP soportadas (SendGrid, Mailchimp, Brevo, HubSpot, Klaviyo, SES, SFMC, etc.) y su sintaxis. |
| `list_block_types` | — | Devuelve los 11 tipos de bloques visuales y todas sus propiedades por defecto (`defaultProperties`). |
| `list_assets` | `assets:read` | Lista las imágenes disponibles en la biblioteca del usuario (`/media/...`). |

### Gestión de Proyectos
| Herramienta | Scope | Descripción |
| --- | --- | --- |
| `list_projects` | `projects:read` | Lista proyectos del usuario con búsqueda opcional (`search`) por nombre o asunto. |
| `get_project` | `projects:read` | Obtiene el proyecto completo o un árbol ligero de bloques (`summaryOnly: true`). |
| `create_mailing` | `projects:write` | Crea un proyecto desde plantilla aplicando `subject`, `preheader`, `brandColor` y `publicBaseUrl`. |
| `duplicate_project` | `projects:write` | Clona un mailing regenerando IDs de bloques para variantes A/B o envíos periódicos. |
| `delete_project` | `projects:delete` | Elimina un proyecto (solo si el token fue creado con `projects:delete`). |
| `save_project` | `projects:write` | Guarda el `EmailDoc` completo con control optimista (`expectedUpdatedAt`) y diagnóstico detallado de errores. |

### Edición Granular por Bloques, Ajustes, Variables e Importación
| Herramienta | Scope | Descripción |
| --- | --- | --- |
| `update_settings` | `projects:write` | Modifica parcialmente `doc.settings` (asunto, preheader, colores claro/oscuro, ancho, UTM, CSS, `outlookVml`). |
| `add_block` | `projects:write` | Crea e inserta un bloque con valores por defecto seguros en raíz (`index`) o dentro de columnas (`parentColumnsId` + `columnIndex`). |
| `update_block` | `projects:write` | Actualiza parcialmente las propiedades de un bloque existente mediante su `blockId`. |
| `move_block` | `projects:write` | Reordena un bloque existente a otro índice `toIndex`. |
| `remove_block` | `projects:write` | Elimina un bloque específico por su `blockId`. |
| `set_variables` | `projects:write` | Crea, fusiona (`merge: true`) o reemplaza variables `{{clave}}` y sus etiquetas por plataforma. |
| `import_html_mailing` | `projects:write` | Importa HTML/CSS externo en modo `code` o `visual`, normalizando merge tags (`*\|FNAME\|*` → `{{nombre}}`) y autodetectando variables. |

### Renderizado y Auditoría de Entregabilidad
| Herramienta | Scope | Descripción |
| --- | --- | --- |
| `render_project` | `projects:read` | Renderiza HTML (tablas + VML Outlook + modo oscuro) y texto plano en modo `export` (14 plataformas o `customPlatform`) o `preview` (`sampleData`), devolviendo peso en KB frente al límite de 102 KB de Gmail y lista de `issues` (`error`, `warning`, `info`). |

---

## 4. Recursos MCP (`misiva://`)

| URI | Tipo | Contenido |
| --- | --- | --- |
| `misiva://catalog/platforms` | Estático (`application/json`) | Especificación de sintaxis de las 14 plataformas de envío. |
| `misiva://catalog/blocks` | Estático (`application/json`) | Esquema por defecto de los 11 bloques del editor. |
| `misiva://guidelines/email-deliverability` | Estático (`text/markdown`) | Reglas técnicas de entregabilidad, Gmail (<102 KB), Outlook VML y accesibilidad. |
| `misiva://projects/{id}` | Dinámico (`application/json`) | Documento JSON completo del proyecto con autocompletado y listado dinámico. |
| `misiva://projects/{id}/html` | Dinámico (`text/html`) | Código HTML compilado listo para previsualizar. |

---

## 5. Prompts MCP Integrados

- `design_campaign`: Flujo guiado de principio a fin para diseñar una campaña según objetivo, audiencia, plataforma de envío y color de marca.
- `audit_deliverability`: Revisa y corrige automáticamente problemas de peso, imágenes sin `alt`, contraste, variables no declaradas o ausencia de enlace de baja en un proyecto existente.
- `ab_test_variants`: Clona un proyecto y construye una Variante B optimizada para pruebas de conversión.
