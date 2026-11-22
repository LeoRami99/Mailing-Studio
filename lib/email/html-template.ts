const STYLE_RE = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;

/** Devuelve el CSS de todos los bloques <style> de una plantilla importada. */
export function extractTemplateCss(html: string): string {
  return [...html.matchAll(STYLE_RE)].map((match) => match[1].trim()).filter(Boolean).join("\n\n");
}

/** Sustituye los bloques <style> por uno editable, conservando el resto del documento. */
export function replaceTemplateCss(html: string, css: string): string {
  let inserted = false;
  const style = css.trim() ? `<style data-misiva-template>\n${css.trim()}\n</style>` : "";
  const withoutStyles = html.replace(STYLE_RE, () => {
    if (inserted) return "";
    inserted = true;
    return style;
  });
  if (inserted || !style) return withoutStyles;
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${style}\n</head>`);
  if (/<html\b[^>]*>/i.test(html)) return html.replace(/<html\b[^>]*>/i, (tag) => `${tag}\n<head>\n${style}\n</head>`);
  return `${style}\n${html}`;
}

/** Añade CSS a una plantilla sin descartar los estilos que ya contiene. */
export function appendTemplateCss(html: string, css: string): string {
  const extra = css.trim();
  if (!extra) return html;
  const existing = extractTemplateCss(html);
  return replaceTemplateCss(html, [existing, extra].filter(Boolean).join("\n\n"));
}
