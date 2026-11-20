// Renderizado del documento a HTML compatible con clientes de correo
// (Gmail, Outlook escritorio/web, Apple Mail, Yahoo, Samsung, Thunderbird…).
//
// Técnicas usadas:
//  - Maquetación con tablas role="presentation" y CSS en línea.
//  - Tabla "fantasma" para Outlook (comentarios condicionales MSO).
//  - Columnas híbridas (inline-block + MSO) que se apilan sin media queries.
//  - Botones a prueba de balas con VML opcional para Outlook.
//  - Fondos con imagen vía VML para Outlook.
//  - Modo oscuro con prefers-color-scheme + selectores de Outlook.com.

import type {
  Align,
  Block,
  ButtonBlock,
  ColumnsBlock,
  EmailDoc,
  EmailSettings,
  FooterBlock,
  HeroBlock,
  ImageBlock,
  SocialBlock,
} from "./types";
import { escapeHtml, transformTokens, type TokenMode } from "./tokens";
import type { Platform } from "./platforms";

export interface RenderCtx {
  settings: EmailSettings;
  /** Ancho disponible en px para el contenido del bloque (sin padding). */
  availWidth: number;
  mode: TokenMode;
}

const attr = (s: string) => escapeHtml(s);
const font = (s: string) => s.replace(/"/g, "'");

function fontStack(ctx: RenderCtx, override: string) {
  return font(override || ctx.settings.fontFamily);
}

/** Convierte rutas relativas (/media/…) en absolutas para exportar. */
export function absUrl(url: string, settings: EmailSettings): string {
  if (!url) return url;
  if (/^(https?:|data:|mailto:|tel:|#|\{\{|\*\||%%|\[\[|\{%|<%)/i.test(url)) return url;
  if (url.startsWith("/")) {
    const base = settings.publicBaseUrl.replace(/\/$/, "");
    return base ? base + url : url;
  }
  return url;
}

/** Aplica estilos en línea a etiquetas generadas por el editor de texto enriquecido. */
export function inlineRich(html: string, linkColor: string, fontSize: number): string {
  return html
    .replace(/<a\s(?![^>]*style=)/gi, `<a style="color:${linkColor};text-decoration:underline;" `)
    .replace(/<p(?=[\s>])(?![^>]*style=)/gi, `<p style="margin:0 0 ${Math.round(fontSize * 0.75)}px 0;"`)
    .replace(/<ul(?=[\s>])(?![^>]*style=)/gi, `<ul style="margin:0 0 ${Math.round(fontSize * 0.75)}px 0;padding-left:24px;"`)
    .replace(/<ol(?=[\s>])(?![^>]*style=)/gi, `<ol style="margin:0 0 ${Math.round(fontSize * 0.75)}px 0;padding-left:24px;"`)
    .replace(/<li(?=[\s>])(?![^>]*style=)/gi, `<li style="margin:0 0 4px 0;"`)
    .replace(/<(b|strong)>/gi, `<$1 style="font-weight:bold;">`);
}

function padStr(b: Block) {
  const p = b.padding;
  return `${p.top}px ${p.right}px ${p.bottom}px ${p.left}px`;
}

function imgTag(
  src: string,
  alt: string,
  width: number,
  ctx: RenderCtx,
  extraStyle = "",
  cls = "",
) {
  const s = ctx.mode === "export" ? absUrl(src, ctx.settings) : src;
  return `<img src="${attr(s)}" alt="${attr(alt)}" width="${width}"${cls ? ` class="${cls}"` : ""} style="display:block;width:100%;max-width:${width}px;height:auto;border:0;outline:none;text-decoration:none;${extraStyle}">`;
}

function alignTable(inner: string, align: Align) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td align="${align}" style="font-size:0;line-height:0;">${inner}</td></tr></table>`;
}

// ---------------------------------------------------------------------------
// Bloques
// ---------------------------------------------------------------------------

function renderButton(b: ButtonBlock, ctx: RenderCtx) {
  const ff = fontStack(ctx, b.fontFamily);
  const href = attr(b.href || "#");
  const text = b.text;
  const lineH = Math.round(b.fontSize * 1.2);
  const h = lineH + b.paddingV * 2 + b.borderWidth * 2;
  const estW = Math.min(
    ctx.availWidth,
    Math.round(text.replace(/\{\{[^}]*\}\}/g, "xxxxxx").length * b.fontSize * 0.6 + b.paddingH * 2),
  );
  const w = b.fullWidth ? ctx.availWidth : estW;
  const border = b.borderWidth ? `border:${b.borderWidth}px solid ${b.borderColor};` : "";
  const aStyle = `display:${b.fullWidth ? "block" : "inline-block"};padding:${b.paddingV}px ${b.paddingH}px;font-family:${ff};font-size:${b.fontSize}px;font-weight:${b.fontWeight};line-height:${lineH}px;color:${b.color};text-decoration:none;border-radius:${b.borderRadius}px;text-align:center;mso-padding-alt:0;`;

  const html = `<table role="presentation" cellpadding="0" cellspacing="0" border="0"${b.fullWidth ? ' width="100%"' : ""} class="${b.fullWidth ? "" : "btn-m"}" style="border-collapse:separate;"><tr><td align="center" bgcolor="${b.bg}" style="background-color:${b.bg};border-radius:${b.borderRadius}px;${border}mso-padding-alt:${b.paddingV}px ${b.paddingH}px;"><a href="${href}" target="_blank" style="${aStyle}">${text}</a></td></tr></table>`;

  if (ctx.settings.outlookVml && ctx.mode === "export") {
    const arc = Math.min(50, Math.round((b.borderRadius / h) * 100));
    const vml = `<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${href}" style="height:${h}px;v-text-anchor:middle;width:${w}px;" arcsize="${arc}%" ${b.borderWidth ? `strokecolor="${b.borderColor}" strokeweight="${b.borderWidth}px"` : 'stroke="f"'} fillcolor="${b.bg}"><w:anchorlock/><center style="color:${b.color};font-family:${ff};font-size:${b.fontSize}px;font-weight:${b.fontWeight};">${text}</center></v:roundrect><![endif]-->`;
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td align="${b.align}">${vml}<!--[if !mso]><!-->${html}<!--<![endif]--></td></tr></table>`;
  }
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td align="${b.align}">${html}</td></tr></table>`;
}

function renderImage(b: ImageBlock, ctx: RenderCtx) {
  const w = b.width > 0 ? Math.min(b.width, ctx.availWidth) : ctx.availWidth;
  if (!b.src) {
    // El marcador solo se ve en el editor; nunca se exporta.
    if (ctx.mode !== "canvas") return "";
    return `<div style="max-width:${w}px;margin:${b.align === "center" ? "0 auto" : b.align === "right" ? "0 0 0 auto" : "0"};background:#eef0f4;border:2px dashed #c3c8d4;color:#6b7280;font-family:Arial,sans-serif;font-size:14px;text-align:center;padding:40px 10px;">Imagen: suba una o pegue una URL</div>`;
  }
  const radius = b.borderRadius ? `border-radius:${b.borderRadius}px;` : "";
  const fullCls = b.width > 0 ? "" : "full-m";
  let img = imgTag(b.src, b.alt, w, ctx, radius, b.darkSrc ? `light-img ${fullCls}`.trim() : fullCls);
  if (b.darkSrc) {
    img += `<!--[if !mso]><!--><div class="dark-img" style="display:none;overflow:hidden;max-height:0;mso-hide:all;">${imgTag(b.darkSrc, b.alt, w, ctx, radius)}</div><!--<![endif]-->`;
  }
  if (b.href) img = `<a href="${attr(b.href)}" target="_blank" style="text-decoration:none;">${img}</a>`;
  // Centrar imágenes display:block en todos los clientes
  const inner = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="${w}" style="width:100%;max-width:${w}px;"${b.align !== "left" ? ` align="${b.align}"` : ""}><tr><td style="font-size:0;line-height:0;">${img}</td></tr></table>`;
  return alignTable(inner, b.align);
}

function renderSocial(b: SocialBlock, ctx: RenderCtx) {
  const ff = fontStack(ctx, "");
  const cells = b.items
    .map((it, i) => {
      const pad = i < b.items.length - 1 ? `padding-right:${b.gap}px;` : "";
      const content = it.icon
        ? imgTag(it.icon, it.label || it.network, b.iconSize, ctx)
        : `<span style="display:inline-block;padding:6px 14px;border-radius:999px;background-color:${b.pillBg};color:${b.textColor};font-family:${ff};font-size:${b.fontSize}px;line-height:${Math.round(b.fontSize * 1.4)}px;font-weight:bold;">${escapeHtml(it.label || it.network)}</span>`;
      return `<td style="${pad}font-size:0;line-height:0;" valign="middle"><a href="${attr(it.url || "#")}" target="_blank" style="text-decoration:none;">${content}</a></td>`;
    })
    .join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td align="${b.align}"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${cells}</tr></table></td></tr></table>`;
}

function renderFooter(b: FooterBlock, ctx: RenderCtx) {
  const ff = fontStack(ctx, "");
  const links: string[] = [];
  const a = (href: string, text: string) =>
    `<a href="${href}" target="_blank" class="dm-link" style="color:${b.linkColor};text-decoration:underline;">${escapeHtml(text)}</a>`;
  if (b.showWebVersion) links.push(a("{{@webversion}}", b.webVersionText));
  if (b.showPreferences) links.push(a("{{@preferences}}", b.preferencesText));
  if (b.showUnsubscribe) links.push(a("{{@unsubscribe}}", b.unsubscribeText));
  const linksHtml = links.length
    ? `<p style="margin:${Math.round(b.fontSize * 0.75)}px 0 0 0;">${links.join(" &nbsp;·&nbsp; ")}</p>`
    : "";
  return `<div class="${b.background ? "" : "dm-text"}" style="font-family:${ff};font-size:${b.fontSize}px;line-height:1.5;color:${b.color};text-align:${b.align};">${inlineRich(b.html, b.linkColor, b.fontSize)}${linksHtml}</div>`;
}

function renderColumns(b: ColumnsBlock, ctx: RenderCtx, platform?: Platform) {
  const total = b.columns.reduce((s, c) => s + c.width, 0) || 100;
  const half = Math.round(b.gap / 2);
  const widths = b.columns.map((c) => Math.floor((ctx.availWidth * c.width) / total));

  const colInner = (ci: number) => {
    const col = b.columns[ci];
    const padL = ci === 0 ? 0 : half;
    const padR = ci === b.columns.length - 1 ? 0 : half;
    const inner = widths[ci] - padL - padR;
    const rows = col.blocks
      .map((blk) => renderBlockRow(blk, { ...ctx, availWidth: inner - blk.padding.left - blk.padding.right }, platform))
      .join("");
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"${col.background ? ` bgcolor="${col.background}"` : ""} style="${col.background ? `background-color:${col.background};` : ""}"><tr><td class="col-pad" style="padding:0 ${padR}px 0 ${padL}px;" valign="${col.verticalAlign}"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${rows}</table></td></tr></table>`;
  };

  if (!b.stackOnMobile) {
    const cells = b.columns
      .map((c, i) => `<td width="${widths[i]}" valign="${c.verticalAlign}" style="width:${widths[i]}px;">${colInner(i)}</td>`)
      .join("");
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>${cells}</tr></table>`;
  }

  // Columnas híbridas: inline-block en clientes modernos, tabla en Outlook.
  let html = `<!--[if mso]><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr><![endif]-->`;
  b.columns.forEach((c, i) => {
    html += `<!--[if mso]><td width="${widths[i]}" valign="${c.verticalAlign}"><![endif]-->`;
    html += `<div class="col" style="display:inline-block;width:100%;max-width:${widths[i]}px;vertical-align:${c.verticalAlign};">${colInner(i)}</div>`;
    html += `<!--[if mso]></td><![endif]-->`;
  });
  html += `<!--[if mso]></tr></table><![endif]-->`;
  return `<div style="font-size:0;line-height:0;text-align:left;">${html}</div>`;
}

function renderHero(b: HeroBlock, ctx: RenderCtx) {
  const ff = fontStack(ctx, "");
  const W = ctx.availWidth + b.padding.left + b.padding.right;
  const img = b.bgImage ? (ctx.mode === "export" ? absUrl(b.bgImage, ctx.settings) : b.bgImage) : "";
  const btn = b.buttonText
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:20px;border-collapse:separate;"${b.align === "center" ? ' align="center"' : b.align === "right" ? ' align="right"' : ""}><tr><td bgcolor="${b.buttonBg}" style="background-color:${b.buttonBg};border-radius:6px;"><a href="${attr(b.buttonHref || "#")}" target="_blank" style="display:inline-block;padding:14px 28px;font-family:${ff};font-size:16px;font-weight:bold;line-height:20px;color:${b.buttonColor};text-decoration:none;border-radius:6px;">${b.buttonText}</a></td></tr></table>`
    : "";
  const content = `<div style="font-family:${ff};font-size:${b.fontSize}px;line-height:1.4;color:${b.color};text-align:${b.align};">${inlineRich(b.html, b.color, b.fontSize)}</div>${btn}`;
  const bgStyle = img
    ? `background-image:url('${attr(img)}');background-position:center center;background-size:cover;background-repeat:no-repeat;background-color:${b.bgColor};`
    : `background-color:${b.bgColor};`;
  const vmlOpen =
    img && ctx.settings.outlookVml && ctx.mode === "export"
      ? `<!--[if gte mso 9]><v:rect xmlns:v="urn:schemas-microsoft-com:vml" fill="true" stroke="false" style="width:${W}px;height:${b.height}px;"><v:fill type="frame" src="${attr(img)}" color="${b.bgColor}" /><v:textbox inset="0,0,0,0"><![endif]-->`
      : "";
  const vmlClose = vmlOpen ? `<!--[if gte mso 9]></v:textbox></v:rect><![endif]-->` : "";
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td${img ? ` background="${attr(img)}"` : ""} bgcolor="${b.bgColor}" valign="middle" height="${b.height}" style="${bgStyle}height:${b.height}px;">${vmlOpen}<div><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td class="px-m" valign="middle" height="${b.height}" style="padding:${padStr(b)};height:${b.height}px;">${content}</td></tr></table></div>${vmlClose}</td></tr></table>`;
}

/** HTML del contenido de un bloque (sin la fila contenedora). */
export function renderBlockContent(b: Block, ctx: RenderCtx, platform?: Platform): string {
  const s = ctx.settings;
  switch (b.type) {
    case "heading": {
      const ff = fontStack(ctx, b.fontFamily);
      return `<h${b.level} class="${b.background ? "" : "dm-text"}" style="margin:0;font-family:${ff};font-size:${b.fontSize}px;line-height:${b.lineHeight};font-weight:${b.fontWeight};letter-spacing:${b.letterSpacing}px;color:${b.color};text-align:${b.align};mso-line-height-rule:exactly;">${inlineRich(b.html, s.linkColor, b.fontSize)}</h${b.level}>`;
    }
    case "text": {
      const ff = fontStack(ctx, b.fontFamily);
      return `<div class="${b.background ? "" : "dm-text"}" style="font-family:${ff};font-size:${b.fontSize}px;line-height:${b.lineHeight};color:${b.color};text-align:${b.align};mso-line-height-rule:exactly;">${inlineRich(b.html, s.linkColor, b.fontSize)}</div>`;
    }
    case "image":
      return renderImage(b, ctx);
    case "button":
      return renderButton(b, ctx);
    case "divider":
      return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="${b.widthPercent}%" align="center" style="width:${b.widthPercent}%;"><tr><td style="border-top:${b.thickness}px ${b.style} ${b.color};font-size:1px;line-height:1px;height:1px;">&nbsp;</td></tr></table>`;
    case "spacer":
      return `<div style="height:${b.height}px;line-height:${b.height}px;font-size:1px;mso-line-height-rule:exactly;">&nbsp;</div>`;
    case "social":
      return renderSocial(b, ctx);
    case "html":
      return b.code;
    case "footer":
      return renderFooter(b, ctx);
    case "columns":
      return renderColumns(b, ctx, platform);
    case "hero":
      return renderHero(b, ctx);
  }
}

/** Fila <tr> completa de un bloque, con padding, fondo, visibilidad y condición. */
export function renderBlockRow(b: Block, ctx: RenderCtx, platform?: Platform): string {
  const isHero = b.type === "hero";
  const content = renderBlockContent(b, ctx, platform);
  const classes = [b.hideOnMobile ? "hide-mobile" : "", !isHero && b.type !== "columns" ? "px-m" : ""]
    .filter(Boolean)
    .join(" ");
  const bg = b.background ? ` bgcolor="${b.background}"` : "";
  const style = `padding:${isHero ? "0" : padStr(b)};${b.background ? `background-color:${b.background};` : ""}`;
  let inner = content;
  if (b.hideOnDesktop) {
    inner = `<!--[if !mso]><!--><div class="show-mobile" style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${content}</div><!--<![endif]-->`;
  }
  let row = `<tr><td${classes ? ` class="${classes}"` : ""}${bg} style="${style}">${inner}</td></tr>`;
  if (b.condition) row = `{{#if ${b.condition}}}${row}{{/if}}`;
  return row;
}

// ---------------------------------------------------------------------------
// Documento
// ---------------------------------------------------------------------------

function headCss(s: EmailSettings) {
  const bp = s.mobileBreakpoint;
  const dark = s.darkMode
    ? `
    @media (prefers-color-scheme: dark) {
      .dm-body, body { background-color:${s.darkBodyBg} !important; }
      .dm-content { background-color:${s.darkContentBg} !important; }
      .dm-text, .dm-text p, .dm-text li, .dm-text span, .dm-text h1, .dm-text h2, .dm-text h3 { color:${s.darkTextColor} !important; }
      .dm-text a, .dm-link { color:${s.darkLinkColor} !important; }
      .light-img { display:none !important; max-height:0 !important; }
      .dark-img { display:block !important; max-height:none !important; }
    }
    [data-ogsb] .dm-body { background-color:${s.darkBodyBg} !important; }
    [data-ogsb] .dm-content { background-color:${s.darkContentBg} !important; }
    [data-ogsc] .dm-text, [data-ogsc] .dm-text p { color:${s.darkTextColor} !important; }
    [data-ogsc] .dm-text a, [data-ogsc] .dm-link { color:${s.darkLinkColor} !important; }`
    : "";
  return `
    :root { color-scheme: ${s.darkMode ? "light dark" : "light"}; supported-color-schemes: ${s.darkMode ? "light dark" : "light"}; }
    html, body { margin:0 !important; padding:0 !important; height:100% !important; width:100% !important; }
    * { -ms-text-size-adjust:100%; -webkit-text-size-adjust:100%; }
    table, td { mso-table-lspace:0pt !important; mso-table-rspace:0pt !important; }
    table { border-spacing:0 !important; border-collapse:collapse !important; margin:0 auto !important; }
    img { -ms-interpolation-mode:bicubic; }
    a { text-decoration:none; }
    a[x-apple-data-detectors], .unstyle-auto-detected-links a { border-bottom:0 !important; cursor:default !important; color:inherit !important; text-decoration:none !important; font-size:inherit !important; font-family:inherit !important; font-weight:inherit !important; line-height:inherit !important; }
    u + #body a, #MessageViewBody a { color:inherit; text-decoration:none; font-size:inherit; font-family:inherit; font-weight:inherit; line-height:inherit; }
    .im { color:inherit !important; }
    @media screen and (max-width:${bp}px) {
      .container { width:100% !important; max-width:100% !important; }
      .col { max-width:100% !important; width:100% !important; display:block !important; }
      .col-pad { padding-left:0 !important; padding-right:0 !important; padding-bottom:16px !important; }
      .px-m { padding-left:20px !important; padding-right:20px !important; }
      .full-m { width:100% !important; max-width:100% !important; height:auto !important; }
      .hide-mobile { display:none !important; max-height:0 !important; overflow:hidden !important; mso-hide:all !important; }
      .show-mobile { display:block !important; max-height:none !important; overflow:visible !important; }
      .btn-m { width:100% !important; }
      .btn-m a { display:block !important; }
    }${dark}
    ${s.customCss}`;
}

export interface RenderOptions {
  mode: TokenMode;
  platform?: Platform;
  data?: Record<string, string>;
  minify?: boolean;
}

export interface RenderOutput {
  html: string;
  warnings: string[];
}

function addUtm(html: string, utm: string) {
  const params = utm.trim().replace(/^[?&]/, "");
  if (!params) return html;
  return html.replace(/href="(https?:\/\/[^"]+)"/gi, (m, url: string) => {
    if (/utm_source=/.test(url)) return m;
    const [base, hash] = url.split("#");
    const sep = base.includes("?") ? "&amp;" : "?";
    return `href="${base}${sep}${params.replace(/&(?!amp;)/g, "&amp;")}${hash ? "#" + hash : ""}"`;
  });
}

export function minifyHtml(html: string) {
  return html
    .replace(/\n\s*/g, "\n")
    .replace(/>\s+</g, "><")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function renderEmail(doc: EmailDoc, opts: RenderOptions): RenderOutput {
  const s = doc.settings;
  let html: string;

  if (doc.mode === "code") {
    html = doc.code;
  } else {
    const ctx: RenderCtx = { settings: s, availWidth: s.width, mode: opts.mode };
    const rows = doc.blocks
      .map((b) => renderBlockRow(b, { ...ctx, availWidth: s.width - b.padding.left - b.padding.right }, opts.platform))
      .join("\n");

    const ff = font(s.fontFamily);
    const preheader = s.preheader
      ? `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${s.preheader}${"&nbsp;&#847;&zwnj;".repeat(60)}</div>`
      : "";
    const webFont = s.webFontUrl
      ? `<!--[if !mso]><!--><link href="${attr(s.webFontUrl)}" rel="stylesheet" type="text/css"><!--<![endif]-->`
      : "";
    const radius = s.contentRadius ? `border-radius:${s.contentRadius}px;overflow:hidden;` : "";
    const border = s.borderColor ? `border:1px solid ${s.borderColor};` : "";

    html = `<!DOCTYPE html>
<html lang="${attr(s.lang)}" dir="${s.dir}" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no,address=no,email=no,date=no,url=no">
<meta name="color-scheme" content="${s.darkMode ? "light dark" : "light"}">
<meta name="supported-color-schemes" content="${s.darkMode ? "light dark" : "light"}">
<title>${escapeHtml(s.title || s.subject)}</title>
<!--[if mso]>
<noscript><xml><o:OfficeDocumentSettings><o:AllowPNG/><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
<style>td,th,div,p,a,h1,h2,h3,h4,h5,h6 { font-family: Arial, Helvetica, sans-serif; mso-line-height-rule: exactly; }</style>
<![endif]-->
${webFont}
<style>${headCss(s)}
</style>
</head>
<body id="body" class="dm-body" style="margin:0;padding:0;word-spacing:normal;background-color:${s.bodyBg};">
${preheader}
<div role="article" aria-roledescription="email" aria-label="${attr(s.subject || s.title)}" lang="${attr(s.lang)}" dir="${s.dir}" style="font-size:16px;">
<table role="presentation" class="dm-body" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${s.bodyBg}" style="background-color:${s.bodyBg};">
<tr><td align="center" style="padding:${s.contentPaddingY}px 0;">
<!--[if mso]><table role="presentation" align="center" width="${s.width}" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" class="container dm-content" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${s.contentBg}" style="max-width:${s.width}px;width:100%;margin:0 auto;background-color:${s.contentBg};font-family:${ff};color:${s.textColor};${radius}${border}">
${rows}
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</div>
</body>
</html>`;
  }

  if (opts.mode === "export") {
    html = addUtm(html, s.utm);
    const base = s.publicBaseUrl.replace(/\/$/, "");
    if (base) {
      html = html
        .replace(/(src|background|href)="\/(?!\/)/gi, `$1="${base}/`)
        .replace(/url\((['"]?)\/(?!\/)/gi, `url($1${base}/`);
    }
  }

  const tok = transformTokens(html, {
    mode: opts.mode === "canvas" ? "preview" : opts.mode,
    variables: doc.variables,
    platform: opts.platform,
    data: opts.data,
  });
  let out = tok.html;
  if (opts.minify) out = minifyHtml(out);
  return { html: out, warnings: tok.warnings };
}
