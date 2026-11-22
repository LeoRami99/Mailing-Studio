import type {
  Block,
  BlockType,
  Column,
  EmailDoc,
  EmailSettings,
  Padding,
  Variable,
} from "./types";

export const uid = () =>
  Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);

export const pad = (top = 12, right = 32, bottom = 12, left = 32): Padding => ({ top, right, bottom, left });

export const FONT_STACKS: { label: string; value: string }[] = [
  { label: "Arial / Helvetica", value: "Arial, Helvetica, sans-serif" },
  { label: "Helvetica Neue", value: "'Helvetica Neue', Helvetica, Arial, sans-serif" },
  { label: "Verdana", value: "Verdana, Geneva, sans-serif" },
  { label: "Tahoma", value: "Tahoma, Verdana, Segoe, sans-serif" },
  { label: "Trebuchet MS", value: "'Trebuchet MS', 'Lucida Grande', Tahoma, sans-serif" },
  { label: "Segoe UI (sistema)", value: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif" },
  { label: "Georgia", value: "Georgia, Times, 'Times New Roman', serif" },
  { label: "Times New Roman", value: "'Times New Roman', Times, serif" },
  { label: "Courier New", value: "'Courier New', Courier, monospace" },
  { label: "Montserrat (web) + Arial", value: "Montserrat, Arial, Helvetica, sans-serif" },
  { label: "Roboto (web) + Arial", value: "Roboto, Arial, Helvetica, sans-serif" },
  { label: "Open Sans (web) + Arial", value: "'Open Sans', Arial, Helvetica, sans-serif" },
  { label: "Lato (web) + Arial", value: "Lato, Arial, Helvetica, sans-serif" },
  { label: "Poppins (web) + Arial", value: "Poppins, Arial, Helvetica, sans-serif" },
  { label: "Inter (web) + Arial", value: "Inter, Arial, Helvetica, sans-serif" },
];

export function defaultSettings(): EmailSettings {
  return {
    title: "Mi correo",
    subject: "",
    preheader: "",
    lang: "es",
    dir: "ltr",
    width: 600,
    bodyBg: "#f2f4f7",
    contentBg: "#ffffff",
    textColor: "#1f2937",
    linkColor: "#2563eb",
    fontFamily: "Arial, Helvetica, sans-serif",
    webFontUrl: "",
    contentRadius: 8,
    contentPaddingY: 24,
    borderColor: "",
    darkMode: true,
    darkBodyBg: "#111111",
    darkContentBg: "#1c1c1e",
    darkTextColor: "#eeeeee",
    darkLinkColor: "#8ab4ff",
    outlookVml: true,
    mobileBreakpoint: 620,
    publicBaseUrl: "",
    utm: "",
    customCss: "",
  };
}

export function defaultVariables(): Variable[] {
  return [
    { key: "nombre", label: "Nombre", sample: "María", fallback: "Hola", tags: { mailchimp: "FNAME", brevo: "FIRSTNAME", hubspot: "firstname", klaviyo: "first_name", activecampaign: "FIRSTNAME", zoho: "FNAME" } },
    { key: "apellido", label: "Apellido", sample: "Gómez", fallback: "", tags: { mailchimp: "LNAME", brevo: "LASTNAME", hubspot: "lastname", klaviyo: "last_name", activecampaign: "LASTNAME", zoho: "LNAME" } },
    { key: "email", label: "Correo", sample: "maria@ejemplo.com", fallback: "", tags: { mailchimp: "EMAIL", brevo: "EMAIL", hubspot: "email", klaviyo: "email", activecampaign: "EMAIL", zoho: "EMAIL" } },
    { key: "empresa", label: "Empresa", sample: "Empresa S.A.S.", fallback: "", tags: { mailchimp: "COMPANY", brevo: "COMPANY", hubspot: "company", klaviyo: "organization", activecampaign: "ORGNAME", zoho: "COMPANY" } },
  ];
}

export const BLOCK_LABELS: Record<BlockType, { label: string; hint: string }> = {
  heading: { label: "Título", hint: "Encabezado H1–H3" },
  text: { label: "Texto", hint: "Párrafos con formato, listas y enlaces" },
  image: { label: "Imagen", hint: "Imagen con enlace opcional" },
  button: { label: "Botón", hint: "Botón compatible con Outlook" },
  columns: { label: "Columnas", hint: "2–4 columnas que se apilan en móvil" },
  hero: { label: "Portada", hint: "Imagen de fondo con texto y botón" },
  divider: { label: "Separador", hint: "Línea horizontal" },
  spacer: { label: "Espacio", hint: "Espacio vertical" },
  social: { label: "Redes", hint: "Enlaces a redes sociales" },
  footer: { label: "Pie legal", hint: "Datos legales y enlace de baja" },
  html: { label: "HTML", hint: "Código HTML libre" },
};

export function createBlock(type: BlockType, s?: Partial<EmailSettings>): Block {
  const text = s?.textColor ?? "#1f2937";
  const link = s?.linkColor ?? "#2563eb";
  const base = { id: uid(), padding: pad(), background: "" };
  switch (type) {
    case "heading":
      return { ...base, type, html: "Escriba aquí su título", level: 1, fontSize: 28, color: text, align: "left", fontWeight: 700, lineHeight: 1.25, fontFamily: "", letterSpacing: 0, padding: pad(16, 32, 8, 32) };
    case "text":
      return { ...base, type, html: "<p>Hola {{nombre}}, escriba aquí el contenido de su mensaje. Puede usar <b>negrita</b>, <i>cursiva</i>, enlaces y variables.</p>", fontSize: 16, color: text, align: "left", lineHeight: 1.6, fontFamily: "" };
    case "image":
      return { ...base, type, src: "", alt: "", width: 0, align: "center", href: "", borderRadius: 0 };
    case "button":
      return { ...base, type, text: "Llamado a la acción", href: "https://", bg: link, color: "#ffffff", borderRadius: 6, fontSize: 16, fontWeight: 700, paddingV: 14, paddingH: 28, align: "center", fullWidth: false, borderColor: "#000000", borderWidth: 0, fontFamily: "", padding: pad(16, 32, 16, 32) };
    case "divider":
      return { ...base, type, color: "#e5e7eb", thickness: 1, widthPercent: 100, style: "solid", padding: pad(16, 32, 16, 32) };
    case "spacer":
      return { ...base, type, height: 24, padding: pad(0, 0, 0, 0) };
    case "social":
      return {
        ...base, type, align: "center", iconSize: 32, gap: 8, textColor: "#ffffff", pillBg: "#374151", fontSize: 13,
        items: [
          { id: uid(), network: "LinkedIn", url: "https://www.linkedin.com/", icon: "", label: "LinkedIn" },
          { id: uid(), network: "Instagram", url: "https://www.instagram.com/", icon: "", label: "Instagram" },
          { id: uid(), network: "Facebook", url: "https://www.facebook.com/", icon: "", label: "Facebook" },
        ],
        padding: pad(16, 32, 16, 32),
      };
    case "html":
      return { ...base, type, code: '<p style="margin:0;font-family:Arial,sans-serif;font-size:16px;">HTML personalizado</p>' };
    case "footer":
      return {
        ...base, type,
        html: "<p><b>[Razón social]</b> · NIT [000.000.000-0]<br>[Dirección] · [Ciudad, País]<br>[correo@empresa.com]</p><p>Recibe este correo porque autorizó el tratamiento de sus datos personales. Consulte nuestra <a href=\"https://\">política de tratamiento de datos</a>.</p>",
        fontSize: 12, color: "#6b7280", linkColor: "#6b7280", align: "center",
        showUnsubscribe: true, unsubscribeText: "Cancelar suscripción",
        showPreferences: false, preferencesText: "Preferencias",
        showWebVersion: true, webVersionText: "Ver en el navegador",
        background: "#f9fafb",
        padding: pad(24, 32, 24, 32),
      };
    case "columns":
      return {
        ...base, type, gap: 24, stackOnMobile: true,
        columns: [makeColumn(50, [createBlock("image", s), createBlock("text", s)]), makeColumn(50, [createBlock("image", s), createBlock("text", s)])],
      };
    case "hero":
      return {
        ...base, type, bgImage: "", bgColor: "#1e3a8a", height: 320,
        html: "<p style=\"margin:0 0 8px 0;font-size:32px;font-weight:bold;\">Título principal</p><p style=\"margin:0;\">Subtítulo de su campaña</p>",
        color: "#ffffff", align: "center", fontSize: 18,
        buttonText: "Ver más", buttonHref: "https://", buttonBg: "#ffffff", buttonColor: "#1e3a8a",
        padding: pad(48, 40, 48, 40),
      };
  }
}

export function makeColumn(width: number, blocks: Block[] = []): Column {
  return {
    id: uid(),
    width,
    blocks: blocks.map((b) => ({ ...b, padding: { ...b.padding, left: 0, right: 0 } })),
    background: "",
    verticalAlign: "top",
  };
}

/** Clona un bloque con nuevos IDs (incluye columnas anidadas). */
export function cloneBlock(b: Block): Block {
  const c = structuredClone(b);
  const reid = (x: Block) => {
    x.id = uid();
    if (x.type === "columns") x.columns.forEach((col) => { col.id = uid(); col.blocks.forEach(reid); });
    if (x.type === "social") x.items.forEach((it) => (it.id = uid()));
  };
  reid(c);
  return c;
}

export function emptyDoc(): EmailDoc {
  return {
    version: 1,
    mode: "visual",
    settings: defaultSettings(),
    blocks: [],
    code: "",
    variables: defaultVariables(),
  };
}

// ---------------------------------------------------------------------------
// Plantillas de inicio (contenido de ejemplo, reemplácelo por datos reales)
// ---------------------------------------------------------------------------

export interface Template {
  id: string;
  name: string;
  description: string;
  build: () => EmailDoc;
}

function doc(blocks: Block[], patch: Partial<EmailSettings> = {}): EmailDoc {
  return { ...emptyDoc(), settings: { ...defaultSettings(), ...patch }, blocks };
}

function b<T extends BlockType>(type: T, patch: Record<string, unknown> = {}): Block {
  return { ...createBlock(type), ...patch } as Block;
}

export const TEMPLATES: Template[] = [
  {
    id: "blank",
    name: "En blanco",
    description: "Empiece desde cero",
    build: () => doc([b("footer")]),
  },
  {
    id: "newsletter",
    name: "Boletín",
    description: "Logo, destacado, dos columnas de noticias y pie",
    build: () =>
      doc(
        [
          b("image", { width: 160, alt: "Logo de la empresa", padding: pad(24, 32, 8, 32) }),
          b("heading", { html: "Boletín de [mes]", align: "center", fontSize: 30 }),
          b("text", { html: "<p>Hola {{nombre|\"\"}}, estas son las novedades de este mes.</p>", align: "center", padding: pad(0, 32, 16, 32) }),
          b("image", { alt: "Imagen destacada", padding: pad(8, 0, 8, 0) }),
          b("heading", { html: "Noticia principal", level: 2, fontSize: 22 }),
          b("text", { html: "<p>Resumen de la noticia principal en 2 a 4 líneas. Explique por qué es relevante para el lector.</p>" }),
          b("button", { text: "Leer más" }),
          b("divider"),
          createBlock("columns"),
          b("social"),
          b("footer"),
        ],
        { subject: "Novedades de [mes]", preheader: "Lo más importante del mes en un minuto de lectura." },
      ),
  },
  {
    id: "event",
    name: "Evento / Webinar",
    description: "Portada, detalles del evento y botón de inscripción",
    build: () =>
      doc(
        [
          b("hero", { html: '<p style="margin:0 0 8px 0;font-size:14px;letter-spacing:2px;">WEBINAR</p><p style="margin:0 0 12px 0;font-size:32px;font-weight:bold;line-height:1.2;">[Nombre del evento]</p><p style="margin:0;">[Fecha] · [Hora] (hora de Colombia)</p>', buttonText: "Inscribirme" }),
          b("text", { html: "<p>Hola {{nombre|\"\"}},</p><p>Le invitamos a [descripción breve del evento y su beneficio para el asistente].</p>", padding: pad(32, 32, 8, 32) }),
          b("heading", { html: "Qué aprenderá", level: 2, fontSize: 20 }),
          b("text", { html: "<ul><li>[Tema 1]</li><li>[Tema 2]</li><li>[Tema 3]</li></ul>" }),
          b("button", { text: "Reservar mi cupo", padding: pad(8, 32, 32, 32) }),
          b("footer"),
        ],
        { subject: "{{nombre}}, le invitamos a [evento]", preheader: "[Fecha] · Inscripción gratuita, cupos limitados." },
      ),
  },
  {
    id: "promo",
    name: "Promoción / Producto",
    description: "Imagen grande, oferta y CTA de ancho completo",
    build: () =>
      doc(
        [
          b("image", { width: 140, alt: "Logo", align: "left", padding: pad(24, 32, 16, 32) }),
          b("image", { alt: "Producto destacado", padding: pad(0, 0, 0, 0) }),
          b("heading", { html: "[Titular de la oferta]", align: "center", fontSize: 32, padding: pad(32, 32, 8, 32) }),
          b("text", { html: "<p>[Describa la oferta, condiciones y vigencia.]</p>", align: "center" }),
          b("button", { text: "Aprovechar la oferta", fullWidth: true, padding: pad(16, 32, 32, 32) }),
          b("footer"),
        ],
        { subject: "[Oferta] por tiempo limitado", preheader: "Válida hasta [fecha]. Conozca las condiciones." },
      ),
  },
  {
    id: "transactional",
    name: "Notificación / Seguimiento",
    description: "Correo sobrio de texto con un botón",
    build: () =>
      doc(
        [
          b("image", { width: 140, alt: "Logo", align: "left", padding: pad(32, 40, 16, 40) }),
          b("text", { html: "<p>Hola {{nombre|\"\"}},</p><p>[Mensaje principal del correo.]</p><p>Saludos,<br>[Firma]</p>", padding: pad(8, 40, 8, 40) }),
          b("button", { text: "Ir a la plataforma", align: "left", padding: pad(8, 40, 32, 40) }),
          b("footer", { align: "left", background: "" }),
        ],
        { subject: "[Asunto]", preheader: "[Resumen de una línea]" },
      ),
  },
];
