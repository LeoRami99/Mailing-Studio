/** Genera la versión en texto plano (parte multipart/alternative) a partir del HTML. */
export function htmlToText(html: string): string {
  let s = html;
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/<head[\s\S]*?<\/head>/i, "");
  s = s.replace(/<(style|script|title)[\s\S]*?<\/\1>/gi, "");
  // preheader oculto
  s = s.replace(/<div[^>]*display:none[^>]*>[\s\S]*?<\/div>/gi, "");
  s = s.replace(/<img[^>]*alt="([^"]*)"[^>]*>/gi, (_m, alt: string) => (alt ? `[${alt}]` : ""));
  s = s.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, text: string) => {
    const t = text.replace(/<[^>]+>/g, "").trim();
    if (!href || href === "#") return t;
    if (!t || t === href) return href;
    return `${t} (${href})`;
  });
  s = s.replace(/<li[^>]*>/gi, "\n• ");
  s = s.replace(/<h[1-6][^>]*>/gi, "\n\n");
  s = s.replace(/<\/h[1-6]>/gi, "\n\n");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|div|tr|table|ul|ol)>/gi, "\n");
  s = s.replace(/<[^>]+>/g, "");
  s = s
    .replace(/&nbsp;/g, " ")
    .replace(/&#847;|&zwnj;/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&middot;|·/g, "·");
  s = s
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return s;
}
