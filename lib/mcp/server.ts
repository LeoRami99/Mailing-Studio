import { mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { BLOCK_LABELS, cloneBlock, createBlock, defaultSettings, emptyDoc, pad, TEMPLATES, uid } from "@/lib/email/defaults";
import { appendTemplateCss, extractTemplateCss } from "@/lib/email/html-template";
import { DEFAULT_CUSTOM_PLATFORM, getPlatform, PLATFORMS } from "@/lib/email/platforms";
import { htmlToText } from "@/lib/email/plaintext";
import { renderEmail } from "@/lib/email/render";
import { findVariables } from "@/lib/email/tokens";
import type { Block, BlockType, EmailDoc, Project, Variable } from "@/lib/email/types";
import { validateEmail } from "@/lib/email/validate";
import { databaseEnabled, query } from "@/lib/server/db";
import { goBackendEnabled, goListAssets, type GoAuthContext } from "@/lib/server/go-backend";
import {
  BLOCK_TYPES,
  deleteProject,
  explainBlockError,
  explainEmailDocError,
  getProject,
  isBlock,
  isEmailDoc,
  listProjects,
  saveProject,
  type StoreActor,
} from "@/lib/server/project-store";

export interface MisivaMcpContext {
  userId?: string;
  scopes?: string[];
  goAuth?: GoAuthContext;
}

const ALL_SCOPES = ["projects:read", "projects:write", "projects:delete", "assets:read", "assets:write"];

const text = (value: unknown) => ({
  content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
});

const failure = (message: string) => ({ ...text(message), isError: true as const });

function canonicalHtml(doc: EmailDoc) {
  const identity = {
    ...getPlatform("generic"),
    defaultName: (key: string) => key,
    variable: (name: string) => `{{${name}}}`,
    unsubscribe: "{{@unsubscribe}}",
    preferences: "{{@preferences}}",
    webversion: "{{@webversion}}",
    ifStart: (name: string) => `{{#if ${name}}}`,
    ifElse: "{{else}}",
    ifEnd: "{{/if}}",
  };
  return renderEmail(doc, { mode: "export", platform: identity }).html;
}

function summarizeBlocks(blocks: Block[]): Record<string, unknown>[] {
  return blocks.map((b, index) => {
    const base: Record<string, unknown> = { index, id: b.id, type: b.type };
    if (b.label) base.label = b.label;
    if (b.condition) base.condition = b.condition;
    if (b.type === "heading" || b.type === "text" || b.type === "footer" || b.type === "hero") {
      base.preview = b.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 90);
    } else if (b.type === "button") {
      base.text = b.text;
      base.href = b.href;
    } else if (b.type === "image") {
      base.src = b.src;
      base.alt = b.alt;
    } else if (b.type === "columns") {
      base.columns = b.columns.map((c, ci) => ({
        columnIndex: ci,
        id: c.id,
        width: c.width,
        blocks: summarizeBlocks(c.blocks),
      }));
    }
    return base;
  });
}

function findBlockLocation(
  blocks: Block[],
  targetId: string,
): { list: Block[]; index: number; block: Block; parentColumnsId?: string; columnIndex?: number } | null {
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.id === targetId) return { list: blocks, index: i, block: b };
    if (b.type === "columns") {
      for (let ci = 0; ci < b.columns.length; ci++) {
        const col = b.columns[ci];
        for (let bi = 0; bi < col.blocks.length; bi++) {
          if (col.blocks[bi].id === targetId) {
            return {
              list: col.blocks,
              index: bi,
              block: col.blocks[bi],
              parentColumnsId: b.id,
              columnIndex: ci,
            };
          }
        }
      }
    }
  }
  return null;
}

function normalizeCommonMergeTags(html: string): string {
  return html
    .replace(/\*\|UNSUB\|\*/gi, "{{@unsubscribe}}")
    .replace(/\*\|ARCHIVE\|\*/gi, "{{@webversion}}")
    .replace(/\*\|UPDATE_PROFILE\|\*/gi, "{{@preferences}}")
    .replace(/\*\|FNAME\|\*/gi, "{{nombre}}")
    .replace(/\*\|LNAME\|\*/gi, "{{apellido}}")
    .replace(/\*\|EMAIL\|\*/gi, "{{email}}")
    .replace(/\*\|COMPANY\|\*/gi, "{{empresa}}")
    .replace(/\{\{\s*contact\.firstname\s*\}\}/gi, "{{nombre}}")
    .replace(/\{\{\s*contact\.lastname\s*\}\}/gi, "{{apellido}}")
    .replace(/\{\{\s*unsubscribe(?:_link|_url)?\s*\}\}/gi, "{{@unsubscribe}}");
}

function serverSideHtmlToVisualDoc(rawHtml: string, normalizeTags: boolean): EmailDoc {
  const html = normalizeTags ? normalizeCommonMergeTags(rawHtml) : rawHtml;
  const cleanHtml = html
    .replace(/<(script|iframe|object|embed|form|video)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");

  const doc = emptyDoc();
  doc.mode = "visual";
  doc.code = cleanHtml;
  doc.settings.customCss = extractTemplateCss(cleanHtml);
  const titleMatch = cleanHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch?.[1]?.trim()) {
    doc.settings.title = titleMatch[1].trim().slice(0, 120);
  }
  const bodyMatch = cleanHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const bodyInner = (bodyMatch ? bodyMatch[1] : cleanHtml).replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "").trim();

  const htmlBlk = createBlock("html");
  if (htmlBlk.type === "html") {
    htmlBlk.code = bodyInner || "<p>Contenido importado</p>";
    htmlBlk.padding = pad(0, 0, 0, 0);
  }
  const blocks: Block[] = [htmlBlk];
  if (!/\{\{\s*@unsubscribe\s*\}\}/i.test(cleanHtml)) {
    blocks.push(createBlock("footer"));
  }
  doc.blocks = blocks;
  return doc;
}

const DELIVERABILITY_GUIDE = `# Guía de Compatibilidad y Entregabilidad de Misiva

1. **Asunto y Preheader**:
   - Asunto claro de 30 a 55 caracteres (móvil corta alrededor de 45–50).
   - Preheader complementario de 40 a 90 caracteres (no repita el asunto).
2. **Peso del HTML (Límite de Gmail)**:
   - Mantenga el HTML exportado siempre por debajo de **102 KB** (ideal < 80 KB) para evitar que Gmail recorte el mensaje y oculte el enlace de baja.
3. **Imágenes y Accesibilidad**:
   - Toda imagen debe incluir atributo \`alt\` descriptivo, ancho explícito (\`width\`) y URL \`https://\` pública (nunca \`data:\` base64 ni \`localhost\`).
   - Mantenga proporción saludable de texto real frente a imágenes (> 200 caracteres de texto).
4. **Compatibilidad con Outlook y Modo Oscuro**:
   - Mantenga \`outlookVml: true\` para botones redondeados y portadas (\`hero\`) con imagen de fondo.
   - Use siempre el bloque \`footer\` con \`showUnsubscribe: true\` (\`{{@unsubscribe}}\`), obligatorio para Gmail, Yahoo y normativas de datos personales.
5. **Variables Canónicas en Misiva**:
   - Variable simple: \`{{nombre}}\`
   - Variable con respaldo: \`{{nombre|"amigo"}}\`
   - Condicionales: \`{{#if empresa}}...{{else}}...{{/if}}\`
   - Enlaces de sistema: \`{{@unsubscribe}}\`, \`{{@preferences}}\`, \`{{@webversion}}\`
`;

export function createMisivaMcpServer(input?: string | MisivaMcpContext) {
  const ctx: MisivaMcpContext = typeof input === "string" ? { userId: input } : input ?? {};
  const scopes = new Set(ctx.scopes && ctx.scopes.length > 0 ? ctx.scopes : ALL_SCOPES);
  const actor: StoreActor = { userId: ctx.userId, goAuth: ctx.goAuth };

  const requireScope = (scope: string) => {
    if (!scopes.has(scope)) {
      return failure(
        `Permiso denegado: este token MCP no incluye el permiso '${scope}'. Genere un token con ese alcance en Cuenta → Acceso MCP.`,
      );
    }
    return null;
  };

  const server = new McpServer(
    { name: "misiva", version: "0.2.0" },
    {
      instructions:
        "Servidor MCP oficial de Misiva (estudio visual de correos HTML compatibles con Gmail, Outlook, Apple Mail y 14 plataformas de envío). " +
        "Flujo recomendado: 1) Consulte list_templates, list_block_types o list_projects; 2) Cree con create_mailing o edite de forma granular con update_settings, add_block, update_block, move_block, remove_block y set_variables (más rápido y seguro que reenviar todo el documento con save_project); " +
        "3) Ejecute siempre render_project al finalizar y corrija todos los errores (issues con level='error') antes de entregar el resultado. " +
        "Nunca afirme que un correo fue enviado a destinatarios reales: Misiva diseña, valida y exporta plantillas.",
    },
  );

  // -------------------------------------------------------------------------
  // RECURSOS MCP (Catálogos, Guías y Proyectos Dinámicos)
  // -------------------------------------------------------------------------

  server.registerResource(
    "platforms_catalog",
    "misiva://catalog/platforms",
    {
      title: "Catálogo de plataformas de envío",
      description: "Sintaxis de variables, enlaces de baja y condicionales para las 14 plataformas soportadas por Misiva.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [{
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify(PLATFORMS.map((p) => ({
          id: p.id,
          name: p.name,
          sampleVariable: p.variable(p.defaultName("nombre"), "amigo"),
          unsubscribeTag: p.unsubscribe,
          supportsConditionals: Boolean(p.ifStart),
          notes: p.notes,
          docs: p.docs,
        })), null, 2),
      }],
    }),
  );

  server.registerResource(
    "blocks_catalog",
    "misiva://catalog/blocks",
    {
      title: "Catálogo de bloques visuales de Misiva",
      description: "Los 11 tipos de bloques disponibles en el editor con su estructura JSON por defecto.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [{
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify(
          ([...BLOCK_TYPES] as BlockType[]).map((type) => ({
            type,
            ...BLOCK_LABELS[type],
            defaultBlock: createBlock(type),
          })),
          null,
          2,
        ),
      }],
    }),
  );

  server.registerResource(
    "deliverability_guidelines",
    "misiva://guidelines/email-deliverability",
    {
      title: "Guía de entregabilidad y compatibilidad HTML",
      description: "Reglas clave para Gmail (<102 KB), Outlook (VML/tablas), modo oscuro, accesibilidad y merge tags.",
      mimeType: "text/markdown",
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "text/markdown", text: DELIVERABILITY_GUIDE }],
    }),
  );

  server.registerResource(
    "project_document",
    new ResourceTemplate("misiva://projects/{id}", {
      list: async () => {
        if (!scopes.has("projects:read")) return { resources: [] };
        const projects = await listProjects(actor).catch(() => []);
        return {
          resources: projects.map((p) => ({
            uri: `misiva://projects/${p.id}`,
            name: p.name,
            description: p.doc.settings.subject || "Sin asunto",
            mimeType: "application/json",
          })),
        };
      },
      complete: {
        id: async (value) => {
          if (!scopes.has("projects:read")) return [];
          const projects = await listProjects(actor).catch(() => []);
          return projects.map((p) => p.id).filter((id) => id.startsWith(value));
        },
      },
    }),
    {
      title: "Documento JSON de proyecto Misiva",
      description: "Accede directamente al documento estructurado de un proyecto por su ID.",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      if (!scopes.has("projects:read")) throw new Error("Sin permiso projects:read");
      const id = String(variables.id ?? "");
      const project = await getProject(id, actor);
      if (!project) throw new Error(`No existe el proyecto ${id}`);
      return {
        contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(project, null, 2) }],
      };
    },
  );

  server.registerResource(
    "project_rendered_html",
    new ResourceTemplate("misiva://projects/{id}/html", { list: undefined }),
    {
      title: "HTML exportado de un proyecto",
      description: "Devuelve el HTML final renderizado con tablas e inline CSS listo para previsualizar o exportar.",
      mimeType: "text/html",
    },
    async (uri, variables) => {
      if (!scopes.has("projects:read")) throw new Error("Sin permiso projects:read");
      const id = String(variables.id ?? "");
      const project = await getProject(id, actor);
      if (!project) throw new Error(`No existe el proyecto ${id}`);
      const rendered = renderEmail(project.doc, { mode: "export", platform: getPlatform("generic"), minify: false });
      return {
        contents: [{ uri: uri.href, mimeType: "text/html", text: rendered.html }],
      };
    },
  );

  // -------------------------------------------------------------------------
  // PROMPTS GUIADOS MCP
  // -------------------------------------------------------------------------

  server.registerPrompt(
    "design_campaign",
    {
      title: "Diseñar campaña de correo completa",
      description: "Guía al asistente para crear, estructurar, personalizar y validar un correo profesional en Misiva.",
      argsSchema: z.object({
        goal: z.string().describe("Objetivo principal del correo (ej. lanzamiento de producto, invitación a webinar, boletín mensual)"),
        audience: z.string().optional().describe("Público objetivo"),
        platform: z.string().optional().describe("Plataforma de envío destino (ej. sendgrid, mailchimp, brevo, hubspot)"),
        brandColor: z.string().optional().describe("Color principal en hexadecimal, ej. #008F55"),
      }),
    },
    ({ goal, audience, platform, brandColor }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text:
              `Diseña una campaña de correo en Misiva con el siguiente contexto:\n` +
              `- Objetivo: ${goal}\n` +
              `- Audiencia: ${audience || "General"}\n` +
              `- Plataforma destino: ${platform || "generic"}\n` +
              `- Color de marca: ${brandColor || "#008F55"}\n\n` +
              `Sigue estrictamente estos pasos:\n` +
              `1. Crea el proyecto con \`create_mailing\` eligiendo la plantilla más adecuada.\n` +
              `2. Ajusta colores globales y modo oscuro con \`update_settings\`.\n` +
              `3. Personaliza los bloques con \`update_block\`, \`add_block\` y \`remove_block\`, usando variables canónicas como \`{{nombre|"amigo"}}\` y manteniendo el bloque \`footer\` con enlace de baja.\n` +
              `4. Ejecuta \`render_project\` para la plataforma "${platform || "generic"}" y corrige cualquier error de entregabilidad o accesibilidad antes de presentar el resumen.`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "audit_deliverability",
    {
      title: "Auditar entregabilidad y compatibilidad",
      description: "Revisa a fondo un proyecto existente frente a Gmail, Outlook, modo oscuro y accesibilidad.",
      argsSchema: z.object({
        projectId: z.string().describe("ID del proyecto en Misiva"),
        platform: z.string().optional().describe("Plataforma de exportación (ej. mailchimp, sendgrid, brevo)"),
      }),
    },
    ({ projectId, platform }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text:
              `Audita el mailing con ID "${projectId}" para la plataforma "${platform || "generic"}":\n` +
              `1. Lee el proyecto con \`get_project\` y ejecuta \`render_project\`.\n` +
              `2. Revisa el peso frente a los 102 KB de Gmail, textos alternativos (\`alt\`) en imágenes, enlaces rotos o HTTP, contraste en modo claro/oscuro, longitud de asunto/preheader, variables sin definir y presencia de \`{{@unsubscribe}}\`.\n` +
              `3. Aplica las correcciones necesarias usando \`update_settings\`, \`update_block\` o \`set_variables\` y vuelve a validar con \`render_project\`.`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "ab_test_variants",
    {
      title: "Generar variante A/B de mailing",
      description: "Duplica un correo existente y crea una variante B optimizando asunto, preheader y llamado a la acción.",
      argsSchema: z.object({
        projectId: z.string().describe("ID del proyecto original (Variante A)"),
        hypothesis: z.string().optional().describe("Hipótesis de conversión a probar (ej. urgencia vs beneficio directo)"),
      }),
    },
    ({ projectId, hypothesis }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text:
              `Crea una Variante B para prueba A/B a partir del proyecto "${projectId}".\n` +
              `Hipótesis: ${hypothesis || "Mejorar tasa de apertura y clic mediante propuesta de valor más directa"}.\n` +
              `1. Inspecciona el original con \`get_project\`.\n` +
              `2. Clónalo con \`duplicate_project\` nombrándolo con el sufijo "(Variante B)".\n` +
              `3. Propón y aplica un nuevo asunto, preheader complementario, titular principal y texto de botón CTA usando \`update_settings\` y \`update_block\`.\n` +
              `4. Valida con \`render_project\` y presenta una tabla comparativa Variante A vs Variante B.`,
          },
        },
      ],
    }),
  );

  // -------------------------------------------------------------------------
  // HERRAMIENTAS DE CATÁLOGO Y DESCUBRIMIENTO
  // -------------------------------------------------------------------------

  server.registerTool("list_templates", {
    title: "Listar plantillas iniciales",
    description: "Devuelve las plantillas profesionales integradas en Misiva para iniciar un nuevo mailing.",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true },
  }, async () => text(TEMPLATES.map((tpl) => {
    const sample = tpl.build();
    return {
      id: tpl.id,
      name: tpl.name,
      description: tpl.description,
      defaultSubject: sample.settings.subject,
      blockTypes: sample.blocks.map((b) => b.type),
    };
  })));

  server.registerTool("list_platforms", {
    title: "Listar plataformas de envío soportadas",
    description: "Lista las 14 plataformas ESP compatibles (SendGrid, Mailchimp, Brevo, HubSpot, Klaviyo, SES, SFMC, etc.) y cómo traducen las variables.",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true },
  }, async () => text(PLATFORMS.map((p) => ({
    id: p.id,
    name: p.name,
    exampleVariable: p.variable(p.defaultName("nombre"), "amigo"),
    unsubscribe: p.unsubscribe,
    supportsConditionals: Boolean(p.ifStart),
    notes: p.notes,
    docs: p.docs,
  }))));

  server.registerTool("list_block_types", {
    title: "Catálogo y esquema de bloques",
    description: "Muestra los 11 tipos de bloques visuales de Misiva y sus propiedades por defecto.",
    inputSchema: z.object({
      type: z.enum(["heading", "text", "image", "button", "columns", "hero", "divider", "spacer", "social", "footer", "html"]).optional(),
    }),
    annotations: { readOnlyHint: true },
  }, async ({ type }) => {
    const types = type ? [type] : ([...BLOCK_TYPES] as BlockType[]);
    return text(types.map((t) => ({
      type: t,
      ...BLOCK_LABELS[t],
      defaultProperties: createBlock(t),
    })));
  });

  server.registerTool("list_assets", {
    title: "Listar biblioteca de imágenes",
    description: "Lista las imágenes subidas en la cuenta del usuario para usarlas en bloques image o hero.",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true },
  }, async () => {
    const denied = requireScope("assets:read");
    if (denied) return denied;

    const uploadDir = path.join(process.env.MAILING_STORAGE_DIR || path.join(process.cwd(), "storage"), "uploads");
    await mkdir(uploadDir, { recursive: true }).catch(() => {});

    if (goBackendEnabled() && actor.goAuth) {
      const assets = await goListAssets(actor.goAuth);
      return text({
        count: assets.length,
        assets: assets.map((a) => ({ ...a, url: `/media/${a.name}` })),
        note: "Recuerde configurar settings.publicBaseUrl con su dominio HTTPS público antes de exportar.",
      });
    }

    if (databaseEnabled() && actor.userId) {
      const rows = await query<{ name: string; size_bytes: number; media_type: string }>(
        "SELECT name, size_bytes, media_type FROM upload_assets WHERE user_id = $1 ORDER BY created_at DESC",
        [actor.userId],
      );
      return text({
        count: rows.rows.length,
        assets: rows.rows.map((r) => ({ name: r.name, size: r.size_bytes, mediaType: r.media_type, url: `/media/${r.name}` })),
      });
    }

    const names = (await readdir(uploadDir).catch(() => [])).filter((n) => /\.(png|jpe?g|gif|webp)$/i.test(n));
    const files = await Promise.all(names.map(async (name) => {
      const st = await stat(path.join(uploadDir, name)).catch(() => null);
      return st ? { name, url: `/media/${name}`, size: st.size } : null;
    }));
    const valid = files.filter((item): item is { name: string; url: string; size: number } => item !== null);
    return text({ count: valid.length, assets: valid });
  });

  // -------------------------------------------------------------------------
  // GESTIÓN DE PROYECTOS
  // -------------------------------------------------------------------------

  server.registerTool("list_projects", {
    title: "Listar mailings",
    description: "Lista los proyectos guardados en Misiva con metadatos resumidos y filtro de búsqueda opcional.",
    inputSchema: z.object({
      search: z.string().max(100).optional().describe("Filtra proyectos por nombre o asunto"),
    }),
    annotations: { readOnlyHint: true },
  }, async ({ search }) => {
    const denied = requireScope("projects:read");
    if (denied) return denied;

    const all = await listProjects(actor);
    const term = search?.trim().toLowerCase();
    const filtered = term
      ? all.filter((p) => p.name.toLowerCase().includes(term) || p.doc.settings.subject.toLowerCase().includes(term))
      : all;

    return text(filtered.map(({ id, name, updatedAt, doc }) => ({
      id,
      name,
      updatedAt,
      subject: doc.settings.subject,
      preheader: doc.settings.preheader,
      mode: doc.mode,
      blockCount: doc.blocks.length,
      variablesCount: doc.variables.length,
    })));
  });

  server.registerTool("get_project", {
    title: "Leer mailing",
    description: "Obtiene el documento editable completo de un proyecto, o un resumen compacto de su árbol de bloques si summaryOnly=true.",
    inputSchema: z.object({
      id: z.string().min(1).max(80),
      summaryOnly: z.boolean().default(false).describe("Si es true, devuelve ajustes, variables y resumen de bloques con IDs sin todo el HTML interno"),
    }),
    annotations: { readOnlyHint: true },
  }, async ({ id, summaryOnly }) => {
    const denied = requireScope("projects:read");
    if (denied) return denied;

    const project = await getProject(id, actor);
    if (!project) return failure(`No existe el proyecto ${id}.`);
    if (summaryOnly) {
      return text({
        id: project.id,
        name: project.name,
        updatedAt: project.updatedAt,
        mode: project.doc.mode,
        settings: project.doc.settings,
        variables: project.doc.variables,
        blocks: summarizeBlocks(project.doc.blocks),
      });
    }
    return text(project);
  });

  server.registerTool("create_mailing", {
    title: "Crear mailing",
    description: "Crea un proyecto nuevo desde una plantilla profesional con colores, asunto y URL base opcionales.",
    inputSchema: z.object({
      name: z.string().min(1).max(160),
      template: z.enum(["blank", "newsletter", "event", "promo", "transactional"]).default("newsletter"),
      subject: z.string().max(160),
      preheader: z.string().max(240),
      title: z.string().max(120).optional(),
      brandColor: z.string().max(32).optional().describe("Color principal hex (ej. #008F55) aplicado a enlaces y botones"),
      publicBaseUrl: z.string().max(500).optional(),
      lang: z.string().max(10).optional(),
    }),
  }, async ({ name, template, subject, preheader, title, brandColor, publicBaseUrl, lang }) => {
    const denied = requireScope("projects:write");
    if (denied) return denied;

    const base = TEMPLATES.find((item) => item.id === template) ?? TEMPLATES[0];
    const doc = base.build();
    doc.settings.subject = subject;
    doc.settings.preheader = preheader;
    if (title) doc.settings.title = title;
    if (publicBaseUrl) doc.settings.publicBaseUrl = publicBaseUrl;
    if (lang) doc.settings.lang = lang;
    if (brandColor) {
      doc.settings.linkColor = brandColor;
      for (const blk of doc.blocks) {
        if (blk.type === "button") blk.bg = brandColor;
        if (blk.type === "hero") blk.bgColor = brandColor;
      }
    }

    const project = await saveProject({ id: uid(), name, updatedAt: Date.now(), doc }, actor);
    return text({
      id: project.id,
      name: project.name,
      updatedAt: project.updatedAt,
      blocks: summarizeBlocks(project.doc.blocks),
      next: "Edite secciones específicas con update_block / add_block / update_settings y finalice siempre con render_project.",
    });
  });

  server.registerTool("duplicate_project", {
    title: "Duplicar mailing",
    description: "Clona un proyecto existente con nuevos identificadores, ideal para pruebas A/B o plantillas recurrentes.",
    inputSchema: z.object({
      id: z.string().min(1).max(80),
      newName: z.string().min(1).max(160),
      newSubject: z.string().max(160).optional(),
    }),
  }, async ({ id, newName, newSubject }) => {
    const denied = requireScope("projects:write");
    if (denied) return denied;

    const source = await getProject(id, actor);
    if (!source) return failure(`No existe el proyecto origen ${id}.`);
    const clonedDoc = structuredClone(source.doc);
    clonedDoc.blocks = clonedDoc.blocks.map(cloneBlock);
    if (newSubject !== undefined) clonedDoc.settings.subject = newSubject;

    const created = await saveProject({ id: uid(), name: newName, updatedAt: Date.now(), doc: clonedDoc }, actor);
    return text({ id: created.id, name: created.name, updatedAt: created.updatedAt, blocks: summarizeBlocks(created.doc.blocks) });
  });

  server.registerTool("delete_project", {
    title: "Eliminar mailing",
    description: "Elimina permanentemente un proyecto de la cuenta (requiere el permiso explícito projects:delete).",
    inputSchema: z.object({
      id: z.string().min(1).max(80),
    }),
    annotations: { destructiveHint: true },
  }, async ({ id }) => {
    const denied = requireScope("projects:delete");
    if (denied) return denied;

    const deleted = await deleteProject(id, actor);
    if (!deleted) return failure(`No se encontró el proyecto ${id}.`);
    return text({ id, deleted: true });
  });

  server.registerTool("save_project", {
    title: "Guardar documento completo",
    description: "Guarda el objeto EmailDoc completo de un proyecto. Para ediciones puntuales prefiera update_settings, add_block o update_block.",
    inputSchema: z.object({
      id: z.string().min(1).max(80),
      name: z.string().min(1).max(160),
      document: z.record(z.string(), z.unknown()),
      expectedUpdatedAt: z.number().optional().describe("updatedAt leído con get_project; evita sobrescribir cambios concurrentes."),
    }),
  }, async ({ id, name, document, expectedUpdatedAt }) => {
    const denied = requireScope("projects:write");
    if (denied) return denied;

    if (!isEmailDoc(document)) {
      const detail = explainEmailDocError(document);
      return failure(`El documento no tiene una estructura EmailDoc válida: ${detail ?? "verifique sus propiedades"}.`);
    }
    const current = await getProject(id, actor);
    if (current && expectedUpdatedAt !== undefined && current.updatedAt !== expectedUpdatedAt) {
      return failure("El proyecto cambió desde la última lectura. Ejecute get_project de nuevo y reaplique los cambios.");
    }
    try {
      const project = await saveProject({ id, name, updatedAt: Date.now(), doc: document }, actor, expectedUpdatedAt);
      return text({ id: project.id, name: project.name, updatedAt: project.updatedAt });
    } catch (err) {
      return failure(err instanceof Error ? err.message : "Error al guardar el proyecto.");
    }
  });

  // -------------------------------------------------------------------------
  // EDICIÓN GRANULAR INTELIGENTE (Ajustes, Bloques, Variables e Importación)
  // -------------------------------------------------------------------------

  server.registerTool("update_settings", {
    title: "Actualizar ajustes globales y diseño",
    description: "Modifica parcialmente el nombre del proyecto o doc.settings (asunto, preheader, colores, modo oscuro, ancho, UTM, URL pública, CSS).",
    inputSchema: z.object({
      id: z.string().min(1).max(80),
      name: z.string().min(1).max(160).optional(),
      settings: z.record(z.string(), z.unknown()).describe("Campos parciales de EmailSettings a modificar"),
    }),
  }, async ({ id, name, settings }) => {
    const denied = requireScope("projects:write");
    if (denied) return denied;

    const project = await getProject(id, actor);
    if (!project) return failure(`No existe el proyecto ${id}.`);

    const template = defaultSettings() as unknown as Record<string, unknown>;
    const mergedSettings = { ...project.doc.settings } as unknown as Record<string, unknown>;
    for (const [key, val] of Object.entries(settings)) {
      if (!(key in template)) {
        return failure(`Propiedad desconocida en settings: '${key}'. Campos válidos: ${Object.keys(template).join(", ")}`);
      }
      if (typeof val !== typeof template[key]) {
        return failure(`Tipo inválido en settings.${key}: se esperaba ${typeof template[key]}.`);
      }
      mergedSettings[key] = val;
    }

    const nextDoc: EmailDoc = { ...project.doc, settings: mergedSettings as unknown as EmailDoc["settings"] };
    const saved = await saveProject({
      id: project.id,
      name: name ?? project.name,
      updatedAt: Date.now(),
      doc: nextDoc,
    }, actor);
    return text({ id: saved.id, name: saved.name, updatedAt: saved.updatedAt, settings: saved.doc.settings });
  });

  server.registerTool("add_block", {
    title: "Añadir bloque al correo",
    description: "Crea un bloque con valores por defecto seguros y aplica las propiedades indicadas, insertándolo en la posición deseada o dentro de una columna.",
    inputSchema: z.object({
      projectId: z.string().min(1).max(80),
      type: z.enum(["heading", "text", "image", "button", "columns", "hero", "divider", "spacer", "social", "footer", "html"]),
      props: z.record(z.string(), z.unknown()).optional().describe("Propiedades del bloque a personalizar (ej. html, text, href, src, alt, align, bg, color, padding)"),
      index: z.number().int().min(0).optional().describe("Posición de inserción (por defecto antes del footer o al final)"),
      parentColumnsId: z.string().optional().describe("ID de un bloque 'columns' si desea insertar dentro de una columna"),
      columnIndex: z.number().int().min(0).max(3).optional().describe("Índice de columna (0..3) cuando se usa parentColumnsId"),
    }),
  }, async ({ projectId, type, props, index, parentColumnsId, columnIndex }) => {
    const denied = requireScope("projects:write");
    if (denied) return denied;

    const project = await getProject(projectId, actor);
    if (!project) return failure(`No existe el proyecto ${projectId}.`);

    const base = createBlock(type, project.doc.settings) as unknown as Record<string, unknown>;
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (k === "id" || k === "type") continue;
        if (k === "padding" && v && typeof v === "object" && !Array.isArray(v)) {
          base.padding = { ...(base.padding as Record<string, unknown>), ...(v as Record<string, unknown>) };
        } else {
          base[k] = v;
        }
      }
    }

    if (!isBlock(base)) {
      return failure(`Propiedades de bloque inválidas: ${explainBlockError(base) ?? "verifique los tipos"}.`);
    }

    const nextDoc = structuredClone(project.doc);
    nextDoc.mode = "visual";

    if (parentColumnsId) {
      const parent = nextDoc.blocks.find((b) => b.id === parentColumnsId);
      if (!parent || parent.type !== "columns") {
        return failure(`No se encontró un bloque 'columns' con ID ${parentColumnsId}.`);
      }
      const ci = columnIndex ?? 0;
      const targetCol = parent.columns[ci];
      if (!targetCol) return failure(`El bloque columns solo tiene ${parent.columns.length} columnas.`);
      const pos = index !== undefined ? Math.min(index, targetCol.blocks.length) : targetCol.blocks.length;
      targetCol.blocks.splice(pos, 0, base);
    } else {
      let pos = nextDoc.blocks.length;
      if (index !== undefined) {
        pos = Math.min(index, nextDoc.blocks.length);
      } else if (nextDoc.blocks.length > 0 && nextDoc.blocks[nextDoc.blocks.length - 1].type === "footer" && type !== "footer") {
        // Por defecto inserta justo antes del pie legal para mantener una estructura limpia.
        pos = nextDoc.blocks.length - 1;
      }
      nextDoc.blocks.splice(pos, 0, base);
    }

    const saved = await saveProject({ ...project, doc: nextDoc }, actor);
    return text({
      projectId: saved.id,
      updatedAt: saved.updatedAt,
      addedBlock: base,
      blocks: summarizeBlocks(saved.doc.blocks),
    });
  });

  server.registerTool("update_block", {
    title: "Modificar bloque existente",
    description: "Actualiza parcialmente las propiedades de un bloque por su blockId (funciona tanto en bloques raíz como dentro de columnas).",
    inputSchema: z.object({
      projectId: z.string().min(1).max(80),
      blockId: z.string().min(1),
      props: z.record(z.string(), z.unknown()).describe("Propiedades a modificar en el bloque"),
    }),
  }, async ({ projectId, blockId, props }) => {
    const denied = requireScope("projects:write");
    if (denied) return denied;

    const project = await getProject(projectId, actor);
    if (!project) return failure(`No existe el proyecto ${projectId}.`);

    const nextDoc = structuredClone(project.doc);
    const loc = findBlockLocation(nextDoc.blocks, blockId);
    if (!loc) return failure(`No se encontró ningún bloque con ID '${blockId}'.`);

    const candidate = { ...(loc.block as unknown as Record<string, unknown>) };
    for (const [k, v] of Object.entries(props)) {
      if (k === "id" || k === "type") continue;
      if (k === "padding" && v && typeof v === "object" && !Array.isArray(v)) {
        candidate.padding = { ...(candidate.padding as Record<string, unknown>), ...(v as Record<string, unknown>) };
      } else {
        candidate[k] = v;
      }
    }

    if (!isBlock(candidate)) {
      return failure(`Actualización inválida para el bloque ${blockId}: ${explainBlockError(candidate) ?? "tipos incompatibles"}.`);
    }

    loc.list[loc.index] = candidate;
    const saved = await saveProject({ ...project, doc: nextDoc }, actor);
    return text({ projectId: saved.id, updatedAt: saved.updatedAt, block: candidate });
  });

  server.registerTool("move_block", {
    title: "Reordenar bloque",
    description: "Mueve un bloque existente a otro índice dentro de su lista actual.",
    inputSchema: z.object({
      projectId: z.string().min(1).max(80),
      blockId: z.string().min(1),
      toIndex: z.number().int().min(0),
    }),
  }, async ({ projectId, blockId, toIndex }) => {
    const denied = requireScope("projects:write");
    if (denied) return denied;

    const project = await getProject(projectId, actor);
    if (!project) return failure(`No existe el proyecto ${projectId}.`);

    const nextDoc = structuredClone(project.doc);
    const loc = findBlockLocation(nextDoc.blocks, blockId);
    if (!loc) return failure(`No se encontró el bloque '${blockId}'.`);

    const [removed] = loc.list.splice(loc.index, 1);
    const targetIdx = Math.min(Math.max(0, toIndex), loc.list.length);
    loc.list.splice(targetIdx, 0, removed);

    const saved = await saveProject({ ...project, doc: nextDoc }, actor);
    return text({ projectId: saved.id, updatedAt: saved.updatedAt, blocks: summarizeBlocks(saved.doc.blocks) });
  });

  server.registerTool("remove_block", {
    title: "Eliminar bloque",
    description: "Quita un bloque del correo por su blockId.",
    inputSchema: z.object({
      projectId: z.string().min(1).max(80),
      blockId: z.string().min(1),
    }),
  }, async ({ projectId, blockId }) => {
    const denied = requireScope("projects:write");
    if (denied) return denied;

    const project = await getProject(projectId, actor);
    if (!project) return failure(`No existe el proyecto ${projectId}.`);

    const nextDoc = structuredClone(project.doc);
    const loc = findBlockLocation(nextDoc.blocks, blockId);
    if (!loc) return failure(`No se encontró el bloque '${blockId}'.`);

    loc.list.splice(loc.index, 1);
    const saved = await saveProject({ ...project, doc: nextDoc }, actor);
    return text({ projectId: saved.id, updatedAt: saved.updatedAt, removedBlockId: blockId, blocks: summarizeBlocks(saved.doc.blocks) });
  });

  server.registerTool("set_variables", {
    title: "Gestionar variables de personalización",
    description: "Añade o actualiza variables dinámicas ({{clave}}) y sus equivalencias de merge tags por plataforma.",
    inputSchema: z.object({
      projectId: z.string().min(1).max(80),
      merge: z.boolean().default(true).describe("Si es true conserva las variables existentes actualizando las coincidentes; si es false reemplaza toda la lista."),
      variables: z.array(z.object({
        key: z.string().regex(/^[a-zA-Z0-9_.-]{1,60}$/),
        label: z.string().min(1).max(80),
        sample: z.string().max(200).default(""),
        fallback: z.string().max(200).default(""),
        tags: z.record(z.string(), z.string()).default({}),
      })),
    }),
  }, async ({ projectId, merge, variables }) => {
    const denied = requireScope("projects:write");
    if (denied) return denied;

    const project = await getProject(projectId, actor);
    if (!project) return failure(`No existe el proyecto ${projectId}.`);

    const nextDoc = structuredClone(project.doc);
    if (!merge) {
      nextDoc.variables = variables as Variable[];
    } else {
      const byKey = new Map(nextDoc.variables.map((v) => [v.key, v]));
      for (const incoming of variables) {
        const prev = byKey.get(incoming.key);
        byKey.set(incoming.key, {
          key: incoming.key,
          label: incoming.label,
          sample: incoming.sample,
          fallback: incoming.fallback,
          tags: { ...(prev?.tags ?? {}), ...incoming.tags },
        });
      }
      nextDoc.variables = [...byKey.values()];
    }

    const saved = await saveProject({ ...project, doc: nextDoc }, actor);
    return text({ projectId: saved.id, updatedAt: saved.updatedAt, variables: saved.doc.variables });
  });

  server.registerTool("import_html_mailing", {
    title: "Importar plantilla HTML externa",
    description: "Crea o actualiza un proyecto en Misiva a partir de HTML y CSS externos, convirtiendo merge tags conocidos al formato canónico.",
    inputSchema: z.object({
      projectId: z.string().max(80).optional().describe("Si se indica, actualiza ese proyecto; si se omite, crea uno nuevo"),
      name: z.string().min(1).max(160),
      subject: z.string().max(160).default(""),
      preheader: z.string().max(240).default(""),
      html: z.string().min(1).max(800_000),
      css: z.string().max(100_000).optional(),
      mode: z.enum(["code", "visual"]).default("code").describe("'code' preserva el documento HTML completo editable; 'visual' lo encapsula en bloques de Misiva"),
      normalizeMergeTags: z.boolean().default(true),
    }),
  }, async ({ projectId, name, subject, preheader, html, css, mode, normalizeMergeTags }) => {
    const denied = requireScope("projects:write");
    if (denied) return denied;

    const mergedHtml = css ? appendTemplateCss(html, css) : html;
    const processedHtml = normalizeMergeTags ? normalizeCommonMergeTags(mergedHtml) : mergedHtml;

    let doc: EmailDoc;
    if (mode === "visual") {
      doc = serverSideHtmlToVisualDoc(processedHtml, false);
    } else {
      doc = emptyDoc();
      doc.mode = "code";
      doc.code = processedHtml;
      doc.settings.customCss = extractTemplateCss(processedHtml);
    }
    if (subject) doc.settings.subject = subject;
    if (preheader) doc.settings.preheader = preheader;

    const detectedVars = findVariables(`${processedHtml} ${subject} ${preheader}`);
    const definedKeys = new Set(doc.variables.map((v) => v.key));
    for (const key of detectedVars) {
      if (!definedKeys.has(key)) {
        doc.variables.push({ key, label: key, sample: `[${key}]`, fallback: "", tags: {} });
      }
    }

    const targetId = projectId && projectId.trim() ? projectId.trim() : uid();
    const saved: Project = await saveProject({ id: targetId, name, updatedAt: Date.now(), doc }, actor);
    return text({
      id: saved.id,
      name: saved.name,
      mode: saved.doc.mode,
      detectedVariables: detectedVars,
      updatedAt: saved.updatedAt,
    });
  });

  // -------------------------------------------------------------------------
  // RENDERIZADO, PREVISUALIZACIÓN Y AUDITORÍA DE COMPATIBILIDAD
  // -------------------------------------------------------------------------

  server.registerTool("render_project", {
    title: "Renderizar y auditar mailing",
    description: "Genera el HTML compatible (tablas + VML Outlook + modo oscuro) y texto plano para cualquier plataforma o vista previa con datos de prueba, y ejecuta la auditoría completa de entregabilidad.",
    inputSchema: z.object({
      id: z.string().min(1).max(80),
      renderMode: z.enum(["export", "preview"]).default("export").describe("'export' escribe merge tags de la plataforma; 'preview' evalúa variables y condicionales con sampleData"),
      platform: z.string().default("generic").describe(`Valores: ${PLATFORMS.map((item) => item.id).join(", ")}`),
      sampleData: z.record(z.string(), z.string()).optional().describe("Valores de prueba para variables cuando renderMode='preview'"),
      customPlatform: z.object({
        variablePattern: z.string().default(DEFAULT_CUSTOM_PLATFORM.variablePattern),
        variableWithFallbackPattern: z.string().default(DEFAULT_CUSTOM_PLATFORM.variableWithFallbackPattern),
        uppercase: z.boolean().default(false),
        unsubscribe: z.string().default(DEFAULT_CUSTOM_PLATFORM.unsubscribe),
        preferences: z.string().default(""),
        webversion: z.string().default(""),
        ifStart: z.string().default(""),
        ifElse: z.string().default(""),
        ifEnd: z.string().default(""),
      }).optional(),
      minify: z.boolean().default(true),
      includeHtml: z.boolean().default(true),
    }),
    annotations: { readOnlyHint: true },
  }, async ({ id, renderMode, platform: platformId, sampleData, customPlatform, minify, includeHtml }) => {
    const denied = requireScope("projects:read");
    if (denied) return denied;

    const project = await getProject(id, actor);
    if (!project) return failure(`No existe el proyecto ${id}.`);

    const platform = getPlatform(platformId, customPlatform ?? DEFAULT_CUSTOM_PLATFORM);
    const canonical = canonicalHtml(project.doc);
    const exportRender = renderEmail(project.doc, { mode: "export", platform, minify });
    const activeRender = renderMode === "preview"
      ? renderEmail(project.doc, { mode: "preview", data: sampleData, minify })
      : exportRender;

    const issues = validateEmail(project.doc, canonical, exportRender.html);
    const sizeBytes = new TextEncoder().encode(exportRender.html).length;
    const errorCount = issues.filter((i) => i.level === "error").length;
    const warningCount = issues.filter((i) => i.level === "warning").length;

    return text({
      id,
      name: project.name,
      renderMode,
      platform: platform.id,
      subject: project.doc.settings.subject,
      preheader: project.doc.settings.preheader,
      metrics: {
        sizeBytes,
        sizeKB: Number((sizeBytes / 1024).toFixed(2)),
        gmailClipLimitKB: 102,
        errorCount,
        warningCount,
        readyToExport: errorCount === 0,
      },
      issues,
      warnings: activeRender.warnings,
      text: htmlToText(activeRender.html),
      ...(includeHtml ? { html: activeRender.html } : {}),
    });
  });

  return server;
}
