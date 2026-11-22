import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { TEMPLATES, uid } from "@/lib/email/defaults";
import { getPlatform, PLATFORMS } from "@/lib/email/platforms";
import { htmlToText } from "@/lib/email/plaintext";
import { renderEmail } from "@/lib/email/render";
import { validateEmail } from "@/lib/email/validate";
import { getProject, isEmailDoc, listProjects, saveProject } from "@/lib/server/project-store";

const text = (value: unknown) => ({ content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] });
const failure = (message: string) => ({ ...text(message), isError: true as const });

function canonicalHtml(doc: Parameters<typeof renderEmail>[0]) {
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

export function createMisivaMcpServer(userId?: string) {
  const server = new McpServer(
    { name: "misiva", version: "0.1.0" },
    { instructions: "Cree correos profesionales, accesibles y compatibles con clientes de email. Antes de guardar, use asuntos claros, preheader complementario, un CTA principal, texto alternativo y pie legal. Después de guardar, renderice y revise los problemas. Nunca afirme que un correo fue enviado: Misiva diseña y exporta, no realiza envíos." },
  );

  server.registerTool("list_projects", {
    title: "Listar mailings",
    description: "Lista los proyectos guardados en Misiva sin devolver el documento completo.",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true },
  }, async () => text((await listProjects(userId)).map(({ id, name, updatedAt, doc }) => ({
    id, name, updatedAt, subject: doc.settings.subject, mode: doc.mode,
  }))));

  server.registerTool("get_project", {
    title: "Leer mailing",
    description: "Obtiene el documento editable completo de un proyecto.",
    inputSchema: z.object({ id: z.string().min(1).max(80) }),
    annotations: { readOnlyHint: true },
  }, async ({ id }) => {
    const project = await getProject(id, userId);
    return project ? text(project) : failure(`No existe el proyecto ${id}.`);
  });

  server.registerTool("create_mailing", {
    title: "Crear mailing",
    description: "Crea un proyecto desde una plantilla profesional. Después puede ajustarse con save_project.",
    inputSchema: z.object({
      name: z.string().min(1).max(160),
      template: z.enum(["blank", "newsletter", "event", "promo", "transactional"]).default("newsletter"),
      subject: z.string().max(160),
      preheader: z.string().max(240),
      publicBaseUrl: z.string().max(500).optional(),
    }),
  }, async ({ name, template, subject, preheader, publicBaseUrl }) => {
    const base = TEMPLATES.find((item) => item.id === template) ?? TEMPLATES[0];
    const doc = base.build();
    doc.settings.subject = subject;
    doc.settings.preheader = preheader;
    if (publicBaseUrl) doc.settings.publicBaseUrl = publicBaseUrl;
    const project = await saveProject({ id: uid(), name, updatedAt: Date.now(), doc }, userId);
    return text({ id: project.id, name: project.name, next: "Use get_project, adapte el contenido con save_project y termine con render_project." });
  });

  server.registerTool("save_project", {
    title: "Guardar mailing",
    description: "Guarda el documento completo de un proyecto. Preserve version=1 y la estructura obtenida con get_project.",
    inputSchema: z.object({
      id: z.string().min(1).max(80),
      name: z.string().min(1).max(160),
      document: z.record(z.string(), z.unknown()),
      expectedUpdatedAt: z.number().optional().describe("updatedAt leído con get_project; evita sobrescribir cambios más recientes."),
    }),
  }, async ({ id, name, document, expectedUpdatedAt }) => {
    if (!isEmailDoc(document)) return failure("El documento no tiene una estructura EmailDoc válida.");
    const current = await getProject(id, userId);
    if (current && expectedUpdatedAt !== undefined && current.updatedAt !== expectedUpdatedAt) {
      return failure("El proyecto cambió desde la última lectura. Ejecute get_project de nuevo y reaplique los cambios.");
    }
    const project = await saveProject({ id, name, updatedAt: Date.now(), doc: document }, userId);
    return text({ id: project.id, name: project.name, updatedAt: project.updatedAt });
  });

  server.registerTool("render_project", {
    title: "Renderizar y revisar mailing",
    description: "Genera HTML y texto plano para una plataforma y devuelve la revisión de compatibilidad.",
    inputSchema: z.object({
      id: z.string().min(1).max(80),
      platform: z.string().default("generic").describe(`Valores: ${PLATFORMS.map((item) => item.id).join(", ")}`),
      minify: z.boolean().default(true),
      includeHtml: z.boolean().default(true),
    }),
    annotations: { readOnlyHint: true },
  }, async ({ id, platform: platformId, minify, includeHtml }) => {
    const project = await getProject(id, userId);
    if (!project) return failure(`No existe el proyecto ${id}.`);
    const platform = getPlatform(platformId);
    const canonical = canonicalHtml(project.doc);
    const rendered = renderEmail(project.doc, { mode: "export", platform, minify });
    const issues = validateEmail(project.doc, canonical, rendered.html);
    return text({
      id, platform: platform.id, subject: project.doc.settings.subject,
      preheader: project.doc.settings.preheader, issues, warnings: rendered.warnings,
      text: htmlToText(rendered.html), ...(includeHtml ? { html: rendered.html } : {}),
    });
  });

  return server;
}
