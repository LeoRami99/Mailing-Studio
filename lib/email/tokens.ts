import type { Variable } from "./types";
import type { Platform } from "./platforms";

export const TOKEN_RE =
  /\{\{\s*(#if\s+[\w.-]+|else|\/if|@[\w-]+|[\w.-]+(?:\s*\|\s*"[^"]*")?)\s*\}\}/g;

export type TokenMode = "preview" | "canvas" | "export";

export interface TokenOptions {
  mode: TokenMode;
  variables: Variable[];
  platform?: Platform;
  /** Valores para la vista previa (por defecto los de ejemplo de cada variable). */
  data?: Record<string, string>;
}

export interface TokenResult {
  html: string;
  warnings: string[];
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function parseVar(raw: string): { key: string; fallback: string | null } {
  const m = raw.match(/^([\w.-]+)(?:\s*\|\s*"([^"]*)")?$/);
  if (!m) return { key: raw, fallback: null };
  return { key: m[1], fallback: m[2] ?? null };
}

/** Lista las claves de variables usadas en un texto. */
export function findVariables(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(TOKEN_RE)) {
    const t = m[1].trim();
    if (t.startsWith("#if")) out.add(t.slice(3).trim());
    else if (t === "else" || t === "/if" || t.startsWith("@")) continue;
    else out.add(parseVar(t).key);
  }
  return [...out];
}

/**
 * Traduce los tokens canónicos del HTML según el modo:
 *  - preview: reemplaza por datos de ejemplo y evalúa condicionales.
 *  - canvas: como preview pero resalta las variables en el texto.
 *  - export: escribe la sintaxis de la plataforma.
 */
export function transformTokens(html: string, opts: TokenOptions): TokenResult {
  const warnings = new Set<string>();
  const vars = new Map(opts.variables.map((v) => [v.key, v]));
  const data: Record<string, string> = {};
  for (const v of opts.variables) data[v.key] = v.sample;
  Object.assign(data, opts.data ?? {});

  const valueFor = (key: string, fb: string | null) => {
    const v = vars.get(key);
    const val = data[key];
    if (val) return val;
    return fb ?? v?.fallback ?? "";
  };

  const platformName = (key: string) => {
    const p = opts.platform!;
    const v = vars.get(key);
    if (!v) warnings.add(`La variable "${key}" no está definida en el panel de variables.`);
    return v?.tags[p.id]?.trim() || p.defaultName(key);
  };

  if (opts.mode === "export") {
    const p = opts.platform!;
    const stack: string[] = [];
    const out = html.replace(TOKEN_RE, (_m, rawTok: string) => {
      const t = rawTok.trim();
      if (t.startsWith("#if")) {
        const key = t.slice(3).trim();
        stack.push(platformName(key));
        if (!p.ifStart) {
          warnings.add(`${p.name} no admite condicionales en el HTML: el contenido condicional se exporta siempre visible.`);
          return "";
        }
        return p.ifStart(platformName(key));
      }
      if (t === "else") {
        if (!p.ifElse) {
          warnings.add(`${p.name} no admite {{else}}: revise los bloques condicionales.`);
          return "";
        }
        return p.ifElse;
      }
      if (t === "/if") {
        const name = stack.pop() ?? "";
        return p.ifEnd ? p.ifEnd.replace("__NAME__", name) : "";
      }
      if (t.startsWith("@")) {
        const k = t.slice(1);
        const val =
          k === "unsubscribe"
            ? p.unsubscribe
            : k === "preferences"
              ? p.preferences
              : k === "webversion"
                ? p.webversion
                : null;
        if (val === null || val === "") {
          warnings.add(`${p.name} no tiene un marcador para "${k}". Revise ese enlace.`);
          return "#";
        }
        return val;
      }
      const { key, fallback } = parseVar(t);
      const fb = fallback ?? vars.get(key)?.fallback ?? "";
      return p.variable(platformName(key), fb);
    });
    return { html: out, warnings: [...warnings] };
  }

  // preview / canvas: evaluar condicionales con los datos de ejemplo.
  const parts = html.split(/(<[^>]*>)/);
  const out: string[] = [];
  // pila de visibilidad: cada nivel guarda [condiciónCumplida, enRamaElse]
  const stack: { cond: boolean; inElse: boolean }[] = [];
  const visible = () =>
    stack.every((s) => (s.inElse ? !s.cond : s.cond));

  for (const part of parts) {
    const isTag = part.startsWith("<");
    let buf = "";
    let last = 0;
    for (const m of part.matchAll(TOKEN_RE)) {
      const idx = m.index!;
      if (visible()) buf += part.slice(last, idx);
      last = idx + m[0].length;
      const t = m[1].trim();
      if (t.startsWith("#if")) {
        const key = t.slice(3).trim();
        stack.push({ cond: !!valueFor(key, null), inElse: false });
        continue;
      }
      if (t === "else") {
        if (stack.length) stack[stack.length - 1].inElse = true;
        continue;
      }
      if (t === "/if") {
        stack.pop();
        continue;
      }
      if (!visible()) continue;
      if (t.startsWith("@")) {
        buf += "#";
        continue;
      }
      const { key, fallback } = parseVar(t);
      const val = escapeHtml(valueFor(key, fallback));
      if (opts.mode === "canvas" && !isTag) {
        buf += `<span class="var-chip" title="Variable: ${escapeHtml(key)}">${val || escapeHtml(`{{${key}}}`)}</span>`;
      } else {
        buf += val;
      }
    }
    if (visible()) buf += part.slice(last);
    out.push(buf);
  }
  return { html: out.join(""), warnings: [] };
}
