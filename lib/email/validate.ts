import type { EmailDoc } from "./types";
import { findVariables } from "./tokens";

export type IssueLevel = "error" | "warning" | "info";

export interface Issue {
  level: IssueLevel;
  message: string;
  clients?: string;
}

const SHORTENERS = /(bit\.ly|tinyurl\.com|goo\.gl|ow\.ly|t\.co|is\.gd|buff\.ly|cutt\.ly|rebrand\.ly)\//i;

/**
 * Revisa el HTML exportado y el documento contra las reglas de compatibilidad
 * de los principales clientes de correo y buenas prácticas de entregabilidad.
 * @param canonicalHtml HTML con tokens canónicos (antes de traducir a la plataforma)
 * @param exportHtml HTML final exportado
 */
export function validateEmail(doc: EmailDoc, canonicalHtml: string, exportHtml: string): Issue[] {
  const issues: Issue[] = [];
  const add = (level: IssueLevel, message: string, clients?: string) =>
    issues.push({ level, message, clients });

  const bytes = new TextEncoder().encode(exportHtml).length;
  const kb = bytes / 1024;
  if (kb > 102) add("error", `El HTML pesa ${kb.toFixed(1)} KB. Gmail recorta los mensajes de más de ~102 KB y oculta el resto (incluido el enlace de baja).`, "Gmail");
  else if (kb > 80) add("warning", `El HTML pesa ${kb.toFixed(1)} KB; está cerca del límite de 102 KB de Gmail. Considere minificar.`, "Gmail");
  else add("info", `Peso del HTML: ${kb.toFixed(1)} KB (límite de Gmail: ~102 KB).`);

  const styleBlocks = [...exportHtml.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)];
  const styleSize = styleBlocks.reduce((s, m) => s + m[1].length, 0);
  if (styleSize > 16000) add("warning", `El CSS del <head> ocupa ${(styleSize / 1024).toFixed(1)} KB. Gmail descarta bloques <style> de más de 16 KB.`, "Gmail");

  // Etiquetas prohibidas
  const forbidden: [RegExp, string][] = [
    [/<script/i, "<script>"],
    [/<form/i, "<form>"],
    [/<iframe/i, "<iframe>"],
    [/<video/i, "<video>"],
    [/<object/i, "<object>"],
    [/<embed/i, "<embed>"],
    [/<svg/i, "<svg> (no se muestra en Gmail ni Outlook)"],
    [/@import/i, "@import en CSS"],
  ];
  for (const [re, name] of forbidden) {
    if (re.test(exportHtml)) add("error", `Contiene ${name}, que los clientes de correo bloquean o eliminan.`);
  }
  if (/\son[a-z]+\s*=/i.test(exportHtml.replace(/<!--[\s\S]*?-->/g, ""))) {
    add("error", "Contiene atributos de evento (onclick, onload…); se eliminan y pueden marcar el correo como spam.");
  }

  // CSS problemático
  const inlineStyles = [...exportHtml.matchAll(/style="([^"]*)"/gi)].map((m) => m[1]).join(";");
  if (/display\s*:\s*(flex|grid)/i.test(inlineStyles)) add("warning", "Usa display:flex/grid; Outlook y varios clientes no lo soportan. Use tablas.", "Outlook, Gmail");
  if (/position\s*:\s*(absolute|fixed|relative)/i.test(inlineStyles)) add("warning", "Usa position; Gmail y Outlook lo eliminan.", "Gmail, Outlook");
  if (/float\s*:/i.test(inlineStyles)) add("warning", "Usa float; Outlook lo ignora. Prefiera align en tablas.", "Outlook");
  if (/background-image/i.test(inlineStyles) && !/v:fill/i.test(exportHtml)) add("warning", "Hay imágenes de fondo sin VML: Outlook escritorio no las mostrará. Active «Compatibilidad VML para Outlook».", "Outlook escritorio");

  // Imágenes
  const imgs = [...exportHtml.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
  let noAlt = 0, noWidth = 0, httpImg = 0, dataImg = 0, relImg = 0, localImg = 0;
  for (const tag of imgs) {
    const src = tag.match(/src="([^"]*)"/i)?.[1] ?? "";
    if (!/\balt="/i.test(tag)) noAlt++;
    else if (/\balt=""/i.test(tag)) noAlt++;
    if (!/\bwidth="/i.test(tag)) noWidth++;
    if (src.startsWith("http://")) httpImg++;
    if (src.startsWith("data:")) dataImg++;
    if (src.startsWith("/") || (!/^[a-z]+:/i.test(src) && !/^[{*%[<$]/.test(src))) relImg++;
    if (/\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|192\.168\.|10\.)/i.test(src) || /^(app|file):/i.test(src)) localImg++;
  }
  if (noAlt) add("warning", `${noAlt} imagen(es) sin texto alternativo (alt). Muchos clientes bloquean imágenes por defecto.`, "Outlook, Gmail");
  if (noWidth) add("warning", `${noWidth} imagen(es) sin atributo width; Outlook las mostrará a tamaño real.`, "Outlook");
  if (httpImg) add("warning", `${httpImg} imagen(es) con http://. Use HTTPS.`);
  if (dataImg) add("error", `${dataImg} imagen(es) incrustadas en base64 (data:). Gmail y Outlook.com no las muestran y aumentan el peso.`, "Gmail, Outlook.com");
  if (relImg) add("error", `${relImg} imagen(es) con ruta relativa. Configure la «URL pública» en Diseño para que sean absolutas.`);
  if (localImg) add("error", `${localImg} imagen(es) apuntan a localhost o a una red privada: los destinatarios no podrán verlas. Publique la plataforma o use un servidor/CDN público.`);
  if (imgs.length > 0) {
    const text = exportHtml.replace(/<head[\s\S]*?<\/head>/i, "").replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim();
    if (text.length < 200 && imgs.length >= 1) add("warning", "Muy poco texto en relación con las imágenes. Los filtros de spam penalizan los correos «solo imagen».");
  }

  // Enlaces
  const hrefs = [...exportHtml.matchAll(/href="([^"]*)"/gi)].map((m) => m[1]).filter((h) => !/\.css|fonts\.googleapis/i.test(h));
  const empty = hrefs.filter((h) => !h || h === "#").length;
  if (empty) add("warning", `${empty} enlace(s) vacíos o con "#".`);
  const http = hrefs.filter((h) => h.startsWith("http://")).length;
  if (http) add("warning", `${http} enlace(s) con http://. Use HTTPS.`);
  if (hrefs.some((h) => SHORTENERS.test(h))) add("warning", "Usa acortadores públicos de URL; afectan la reputación del remitente.");

  // Baja
  const hasUnsub = /\{\{\s*@unsubscribe\s*\}\}/.test(canonicalHtml);
  if (!hasUnsub) add("error", "No hay enlace de baja. Gmail y Yahoo lo exigen a remitentes masivos (y la Ley 1581 de 2012 en Colombia). Agregue un bloque «Pie legal».");

  // Bloques de imagen sin archivo
  let emptyImgs = 0;
  const walk = (list: EmailDoc["blocks"]) =>
    list.forEach((blk) => {
      if (blk.type === "image" && !blk.src) emptyImgs++;
      if (blk.type === "columns") blk.columns.forEach((c) => walk(c.blocks));
    });
  if (doc.mode === "visual") walk(doc.blocks);
  if (emptyImgs) add("warning", `${emptyImgs} bloque(s) de imagen sin imagen; no aparecerán en el correo exportado.`);

  // Metadatos
  const s = doc.settings;
  if (!s.subject) add("warning", "Falta el asunto.");
  else if (s.subject.length > 60) add("info", `El asunto tiene ${s.subject.length} caracteres; en móvil se cortan desde ~40–50.`);
  if (!s.preheader) add("warning", "Falta el preencabezado (preheader); el cliente mostrará el primer texto del cuerpo.");
  else if (s.preheader.length < 40 || s.preheader.length > 110) add("info", `El preheader tiene ${s.preheader.length} caracteres (recomendado 40–90).`);

  // Variables
  const used = findVariables(canonicalHtml + " " + s.subject + " " + s.preheader);
  const defined = new Set(doc.variables.map((v) => v.key));
  const undefinedVars = used.filter((u) => !defined.has(u));
  if (undefinedVars.length) add("warning", `Variables usadas pero no definidas: ${undefinedVars.join(", ")}.`);
  const opens = (canonicalHtml.match(/\{\{\s*#if/g) ?? []).length;
  const closes = (canonicalHtml.match(/\{\{\s*\/if\s*\}\}/g) ?? []).length;
  if (opens !== closes) add("error", `Condicionales desbalanceados: ${opens} {{#if}} y ${closes} {{/if}}.`);

  if (!/<meta[^>]+viewport/i.test(exportHtml)) add("warning", "Falta la etiqueta meta viewport (responsive en móvil).");
  if (!/<table/i.test(exportHtml)) add("warning", "El HTML no usa tablas para la maquetación; Outlook escritorio puede romper el diseño.", "Outlook");

  if (!issues.some((i) => i.level !== "info")) add("info", "Sin problemas detectados. Haga un envío de prueba a Gmail y Outlook antes del envío masivo.");
  return issues;
}
