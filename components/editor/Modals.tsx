"use client";

import { useEffect, useMemo, useState } from "react";
import type { EmailDoc, Project, Variable } from "@/lib/email/types";
import { renderEmail } from "@/lib/email/render";
import { htmlToText } from "@/lib/email/plaintext";
import { DEFAULT_CUSTOM_PLATFORM, getPlatform, PLATFORMS, type CustomPlatformConfig } from "@/lib/email/platforms";
import { findVariables, transformTokens } from "@/lib/email/tokens";
import { validateEmail, type Issue } from "@/lib/email/validate";
import { emptyDoc, TEMPLATES, uid } from "@/lib/email/defaults";
import { Btn, inputCls, Modal, TextInput, Toggle } from "./fields";

export function download(name: string, content: string, type = "text/html") {
  const blob = new Blob([content], { type: `${type};charset=utf-8` });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export const slug = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "correo";

// ---------------------------------------------------------------------------
// Vista previa
// ---------------------------------------------------------------------------

export function PreviewFrame({ html, width, height = "100%", dark, noImages }: { html: string; width: number | string; height?: number | string; dark?: boolean; noImages?: boolean }) {
  let src = html;
  // Simula el modo oscuro activando las reglas prefers-color-scheme: dark
  if (dark) src = src.replace(/@media\s*\(prefers-color-scheme:\s*dark\)/g, "@media all");
  if (noImages) src = src.replace(/(<img\b[^>]*?)\ssrc="[^"]*"/gi, '$1 src=""').replace(/background(-image)?:\s*url\([^)]*\)/gi, "background-image:none");
  return (
    <iframe
      title="Vista previa del correo"
      className="mx-auto block rounded-md border border-zinc-200 bg-white shadow-sm transition-all"
      style={{ width, height, maxWidth: "100%" }}
      sandbox="allow-same-origin allow-popups"
      srcDoc={src}
    />
  );
}

export function PreviewModal({ doc, onClose }: { doc: EmailDoc; onClose: () => void }) {
  const [device, setDevice] = useState<"desktop" | "mobile" | "tablet">("desktop");
  const [dark, setDark] = useState(false);
  const [noImages, setNoImages] = useState(false);
  const [data, setData] = useState<Record<string, string>>(() => Object.fromEntries(doc.variables.map((v) => [v.key, v.sample])));
  const html = useMemo(() => renderEmail(doc, { mode: "preview", data }).html, [doc, data]);
  const subject = transformTokens(doc.settings.subject, { mode: "preview", variables: doc.variables, data }).html;
  const pre = transformTokens(doc.settings.preheader, { mode: "preview", variables: doc.variables, data }).html;
  const w = device === "desktop" ? "100%" : device === "tablet" ? 768 : 375;

  return (
    <Modal title="Vista previa" onClose={onClose} wide>
      <div className="flex h-[80vh]">
        <aside className="w-64 shrink-0 overflow-y-auto border-r border-zinc-200 p-4">
          <div className="mb-4 flex flex-col gap-1">
            {(["desktop", "tablet", "mobile"] as const).map((d) => (
              <Btn key={d} variant={device === d ? "primary" : "default"} onClick={() => setDevice(d)}>
                {{ desktop: "🖥 Escritorio", tablet: "⬚ Tablet (768)", mobile: "📱 Móvil (375)" }[d]}
              </Btn>
            ))}
          </div>
          <div className="mb-4 flex flex-col gap-3">
            <Toggle label="Simular modo oscuro" checked={dark} onChange={setDark} />
            <Toggle label="Imágenes bloqueadas" checked={noImages} onChange={setNoImages} hint="Así lo ven quienes no cargan imágenes (Outlook por defecto)." />
          </div>
          <p className="mb-2 text-xs font-semibold uppercase text-zinc-500">Datos de prueba</p>
          <div className="flex flex-col gap-2">
            {doc.variables.map((v) => (
              <TextInput key={v.key} label={`${v.label} {{${v.key}}}`} value={data[v.key] ?? ""} onChange={(x) => setData((d) => ({ ...d, [v.key]: x }))} />
            ))}
            <Btn variant="ghost" onClick={() => setData(Object.fromEntries(doc.variables.map((v) => [v.key, ""])))}>Vaciar (probar valores por defecto)</Btn>
          </div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col bg-zinc-100">
          <div className="border-b border-zinc-200 bg-white px-5 py-3">
            <p className="text-sm font-semibold text-zinc-900" dangerouslySetInnerHTML={{ __html: subject || "<span class='text-zinc-400'>(sin asunto)</span>" }} />
            <p className="truncate text-xs text-zinc-500" dangerouslySetInnerHTML={{ __html: pre || "(sin preheader)" }} />
          </div>
          <div className="min-h-0 flex-1 p-4">
            <PreviewFrame html={html} width={w} dark={dark} noImages={noImages} />
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Exportar
// ---------------------------------------------------------------------------

function IssueList({ issues }: { issues: Issue[] }) {
  const icon = { error: "⛔", warning: "⚠️", info: "ℹ️" };
  const color = { error: "border-red-200 bg-red-50 text-red-800", warning: "border-amber-200 bg-amber-50 text-amber-900", info: "border-zinc-200 bg-zinc-50 text-zinc-700" };
  const order = { error: 0, warning: 1, info: 2 };
  return (
    <ul className="flex flex-col gap-2">
      {[...issues].sort((a, b) => order[a.level] - order[b.level]).map((i, k) => (
        <li key={k} className={`rounded-md border px-3 py-2 text-sm ${color[i.level]}`}>
          <span className="mr-1">{icon[i.level]}</span>
          {i.message}
          {i.clients && <span className="ml-1 text-xs opacity-70">({i.clients})</span>}
        </li>
      ))}
    </ul>
  );
}

export function useValidation(doc: EmailDoc) {
  return useMemo(() => {
    const exported = renderEmail(doc, { mode: "export", platform: getPlatform("generic") }).html;
    return validateEmail(doc, rawCanonical(doc), exported);
  }, [doc]);
}

/** HTML con tokens canónicos sin traducir (para detectar variables y baja). */
function rawCanonical(doc: EmailDoc) {
  // Plataforma "identidad": deja los tokens como {{…}}
  const identity = {
    ...getPlatform("generic"),
    defaultName: (k: string) => k,
    variable: (n: string) => `{{${n}}}`,
    unsubscribe: "{{@unsubscribe}}",
    preferences: "{{@preferences}}",
    webversion: "{{@webversion}}",
    ifStart: (n: string) => `{{#if ${n}}}`,
    ifElse: "{{else}}",
    ifEnd: "{{/if}}",
  };
  return renderEmail(doc, { mode: "export", platform: identity }).html;
}

export function ExportModal({ doc, name, onClose }: { doc: EmailDoc; name: string; onClose: () => void }) {
  const [platformId, setPlatformId] = useState("generic");
  const [custom, setCustom] = useState<CustomPlatformConfig>(DEFAULT_CUSTOM_PLATFORM);
  const [minify, setMinify] = useState(false);
  const [tab, setTab] = useState<"html" | "text" | "data" | "check">("check");
  const [copied, setCopied] = useState("");

  useEffect(() => {
    const p = localStorage.getItem("mailing:platform");
    const c = localStorage.getItem("mailing:customPlatform");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (p) setPlatformId(p);
    if (c) setCustom({ ...DEFAULT_CUSTOM_PLATFORM, ...JSON.parse(c) });
  }, []);
  useEffect(() => {
    localStorage.setItem("mailing:platform", platformId);
    localStorage.setItem("mailing:customPlatform", JSON.stringify(custom));
  }, [platformId, custom]);

  const platform = getPlatform(platformId, custom);
  const out = useMemo(() => renderEmail(doc, { mode: "export", platform, minify }), [doc, platform, minify]);
  const subject = useMemo(() => transformTokens(doc.settings.subject, { mode: "export", variables: doc.variables, platform }).html, [doc, platform]);
  const text = useMemo(() => htmlToText(out.html), [out.html]);
  const issues = useMemo(() => {
    const canonical = doc.mode === "code" ? doc.code : rawCanonical(doc);
    return [...validateEmail(doc, canonical, out.html), ...out.warnings.map((m) => ({ level: "warning" as const, message: m }))];
  }, [doc, out]);
  const sample = useMemo(() => {
    const used = new Set(findVariables((doc.mode === "code" ? doc.code : rawCanonical(doc)) + doc.settings.subject));
    const obj: Record<string, string> = {};
    for (const v of doc.variables) if (used.has(v.key)) obj[v.tags[platform.id]?.trim() || platform.defaultName(v.key)] = v.sample;
    return JSON.stringify(obj, null, 2);
  }, [doc, platform]);

  const errors = issues.filter((i) => i.level === "error").length;
  const warns = issues.filter((i) => i.level === "warning").length;
  const file = slug(name);

  const copy = async (t: string, what: string) => {
    await navigator.clipboard.writeText(t);
    setCopied(what);
    setTimeout(() => setCopied(""), 1500);
  };

  const tabs = [
    { id: "check", label: `Revisión ${errors ? `⛔${errors}` : ""} ${warns ? `⚠️${warns}` : ""}` },
    { id: "html", label: "HTML" },
    { id: "text", label: "Texto plano" },
    { id: "data", label: "Variables" },
  ] as const;

  return (
    <Modal
      title="Exportar"
      onClose={onClose}
      wide
      footer={
        <>
          {copied && <span className="mr-auto text-sm text-green-600">✓ {copied} copiado</span>}
          <Btn onClick={() => copy(out.html, "HTML")}>Copiar HTML</Btn>
          <Btn onClick={() => download(`${file}.txt`, text, "text/plain")}>Descargar .txt</Btn>
          <Btn variant="primary" onClick={() => download(`${file}-${platform.id}.html`, out.html)}>Descargar .html</Btn>
        </>
      }
    >
      <div className="grid h-[72vh] grid-cols-[300px_1fr]">
        <aside className="flex flex-col gap-3 overflow-y-auto border-r border-zinc-200 p-4">
          <label className="flex flex-col gap-1 text-xs font-medium text-zinc-700">
            Plataforma de envío
            <select className={inputCls} value={platformId} onChange={(e) => setPlatformId(e.target.value)}>
              {PLATFORMS.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
          <p className="rounded-md bg-zinc-50 p-2 text-xs text-zinc-600">{platform.notes}</p>
          {platform.docs && (
            <a className="text-xs text-brand-600 hover:underline" href={platform.docs} target="_blank" rel="noreferrer">
              Documentación de la plataforma ↗
            </a>
          )}
          {platformId === "custom" && (
            <div className="flex flex-col gap-2 rounded-md border border-zinc-200 p-2">
              <TextInput label="Variable" value={custom.variablePattern} onChange={(v) => setCustom({ ...custom, variablePattern: v })} hint="{name} = nombre del campo" />
              <TextInput label="Variable con valor por defecto" value={custom.variableWithFallbackPattern} onChange={(v) => setCustom({ ...custom, variableWithFallbackPattern: v })} hint="{name}, {fallback}" />
              <Toggle label="Nombres en MAYÚSCULAS" checked={custom.uppercase} onChange={(v) => setCustom({ ...custom, uppercase: v })} />
              <TextInput label="URL de baja" value={custom.unsubscribe} onChange={(v) => setCustom({ ...custom, unsubscribe: v })} />
              <TextInput label="URL de preferencias" value={custom.preferences} onChange={(v) => setCustom({ ...custom, preferences: v })} />
              <TextInput label="URL versión web" value={custom.webversion} onChange={(v) => setCustom({ ...custom, webversion: v })} />
              <TextInput label="Inicio condicional" value={custom.ifStart} onChange={(v) => setCustom({ ...custom, ifStart: v })} hint="p. ej. {% if {name} %}" />
              <TextInput label="Si no (else)" value={custom.ifElse} onChange={(v) => setCustom({ ...custom, ifElse: v })} />
              <TextInput label="Fin condicional" value={custom.ifEnd} onChange={(v) => setCustom({ ...custom, ifEnd: v })} />
            </div>
          )}
          <Toggle label="Minificar HTML" checked={minify} onChange={setMinify} hint="Reduce el peso (útil cerca del límite de 102 KB de Gmail)." />
          <div className="mt-2 rounded-md border border-zinc-200 p-2 text-xs">
            <p className="mb-1 font-semibold text-zinc-700">Asunto</p>
            <code className="block break-all text-zinc-600">{subject || "(sin asunto)"}</code>
            {subject && <button type="button" className="mt-1 text-brand-600 hover:underline" onClick={() => copy(subject, "Asunto")}>Copiar</button>}
            <p className="mb-1 mt-2 font-semibold text-zinc-700">Preheader</p>
            <span className="text-zinc-600">{doc.settings.preheader || "(sin preheader)"}</span>
          </div>
          <p className="text-xs text-zinc-500">Peso: {(new TextEncoder().encode(out.html).length / 1024).toFixed(1)} KB</p>
        </aside>
        <div className="flex min-w-0 flex-col">
          <div className="flex border-b border-zinc-200 px-3">
            {tabs.map((t) => (
              <button key={t.id} type="button" onClick={() => setTab(t.id)} className={`border-b-2 px-3 py-2 text-sm ${tab === t.id ? "border-brand-600 font-semibold text-brand-700" : "border-transparent text-zinc-500"}`}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-4">
            {tab === "check" && <IssueList issues={issues} />}
            {tab === "html" && <pre className="whitespace-pre-wrap break-all rounded-md bg-zinc-900 p-3 font-mono text-[11px] text-zinc-100">{out.html}</pre>}
            {tab === "text" && (
              <>
                <p className="mb-2 text-xs text-zinc-500">Versión de texto plano para la parte multipart/alternative del correo (mejora la entregabilidad).</p>
                <pre className="whitespace-pre-wrap rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-800">{text}</pre>
                <Btn className="mt-2" onClick={() => copy(text, "Texto")}>Copiar texto</Btn>
              </>
            )}
            {tab === "data" && (
              <>
                <p className="mb-2 text-xs text-zinc-500">Ejemplo de datos por destinatario para {platform.name} (p. ej. dynamic_template_data en SendGrid).</p>
                <pre className="rounded-md bg-zinc-900 p-3 font-mono text-xs text-zinc-100">{sample}</pre>
                <table className="mt-4 w-full text-left text-xs">
                  <thead>
                    <tr className="border-b text-zinc-500"><th className="py-1">Variable</th><th>Campo en {platform.name.split(" (")[0]}</th><th>Por defecto</th></tr>
                  </thead>
                  <tbody>
                    {doc.variables.map((v) => (
                      <tr key={v.key} className="border-b border-zinc-100">
                        <td className="py-1 font-mono">{`{{${v.key}}}`}</td>
                        <td className="font-mono">{platform.variable(v.tags[platform.id]?.trim() || platform.defaultName(v.key), "")}</td>
                        <td>{v.fallback || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Importar
// ---------------------------------------------------------------------------

/** Convierte merge tags de otras plataformas a la sintaxis canónica {{clave}}. */
export function normalizeMergeTags(html: string): { html: string; keys: string[] } {
  const keys = new Set<string>();
  const add = (k: string) => {
    const key = k.trim().toLowerCase();
    keys.add(key);
    return `{{${key}}}`;
  };
  let s = html;
  // Especiales
  s = s
    .replace(/\*\|UNSUB\|\*|<%asm_group_unsubscribe_raw_url%>|\{\{\s*unsubscribe\s*\}\}|\{\{\{\s*unsubscribe\s*\}\}\}|%%unsub_center_url%%|%UNSUBSCRIBELINK%|\{%\s*unsubscribe_url\s*%\}|\{\{\s*unsubscribe_link\s*\}\}|%unsubscribe_url%|\{ENLACE_BAJA\}/gi, "{{@unsubscribe}}")
    .replace(/\*\|UPDATE_PROFILE\|\*|<%asm_preferences_raw_url%>|%%profile_center_url%%|\{ENLACE_PREFERENCIAS\}/gi, "{{@preferences}}")
    .replace(/\*\|ARCHIVE\|\*|\{\{\s*mirror\s*\}\}|%%view_email_url%%|%WEBCOPY%|\{\{\s*view_as_page_url\s*\}\}|\{VER_EN_WEB\}/gi, "{{@webversion}}");
  // Mailchimp *|FNAME|*
  s = s.replace(/\*\|([A-Z0-9_]+)\|\*/g, (_m, k) => add(k));
  // Brevo / HubSpot / Klaviyo {{ contact.X }} {{ person.X }}
  s = s.replace(/\{\{\s*(?:contact|person|params)\.([\w]+)(?:\s*\|[^}]*)?\s*\}\}/g, (_m, k) => add(k));
  // SFMC %%X%%
  s = s.replace(/%%([A-Za-z_][\w]*)%%/g, (_m, k) => add(k));
  // ActiveCampaign %FIRSTNAME%
  s = s.replace(/%([A-Z][A-Z0-9_]{2,})%/g, (_m, k) => add(k));
  // Genérico {NOMBRE}
  s = s.replace(/(?<!\{)\{([A-Z][A-Z0-9_]{1,})\}(?!\})/g, (_m, k) => add(k));
  // Handlebars simples {{x}}
  for (const m of s.matchAll(/\{\{\s*([a-zA-Z_][\w]*)\s*\}\}/g)) keys.add(m[1]);
  return { html: s, keys: [...keys] };
}

export function ImportModal({ onClose, onImport }: { onClose: () => void; onImport: (doc: EmailDoc, name?: string) => void }) {
  const [tab, setTab] = useState<"html" | "json">("html");
  const [html, setHtml] = useState("");
  const [convert, setConvert] = useState(true);
  const [error, setError] = useState("");

  const readFile = async (f: File | undefined, cb: (t: string) => void) => {
    if (!f) return;
    cb(await f.text());
  };

  const importHtml = (asBlock: boolean) => {
    if (!html.trim()) return setError("Pegue o cargue un HTML.");
    const { html: h, keys } = convert ? normalizeMergeTags(html) : { html, keys: [] };
    const d = emptyDoc();
    const known = new Set(d.variables.map((v) => v.key));
    const extra: Variable[] = keys.filter((k) => !known.has(k)).map((k) => ({ key: k, label: k, sample: `[${k}]`, fallback: "", tags: {} }));
    d.variables.push(...extra);
    const title = h.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? "";
    d.settings.title = title || "Correo importado";
    if (asBlock) {
      const body = h.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? h;
      d.mode = "visual";
      d.blocks = [{ id: uid(), type: "html", code: body.trim(), padding: { top: 0, right: 0, bottom: 0, left: 0 }, background: "" }];
    } else {
      d.mode = "code";
      d.code = h;
    }
    onImport(d, d.settings.title);
  };

  const importJson = (text: string) => {
    try {
      const parsed = JSON.parse(text);
      const doc: EmailDoc = parsed.doc ?? parsed;
      if (!doc.settings || !Array.isArray(doc.blocks)) throw new Error("No es un proyecto válido.");
      const base = emptyDoc();
      onImport({ ...base, ...doc, settings: { ...base.settings, ...doc.settings } }, parsed.name);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Modal title="Cargar" onClose={onClose}>
      <div className="flex border-b border-zinc-200 px-3">
        {(["html", "json"] as const).map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)} className={`border-b-2 px-3 py-2 text-sm ${tab === t ? "border-brand-600 font-semibold text-brand-700" : "border-transparent text-zinc-500"}`}>
            {t === "html" ? "HTML existente" : "Proyecto (.json)"}
          </button>
        ))}
      </div>
      <div className="flex flex-col gap-3 p-5">
        {tab === "html" ? (
          <>
            <label className="cursor-pointer rounded-md border-2 border-dashed border-zinc-300 p-4 text-center text-sm text-zinc-500 hover:border-brand-400">
              Seleccionar archivo .html
              <input type="file" accept=".html,.htm,text/html" hidden onChange={(e) => readFile(e.target.files?.[0], setHtml)} />
            </label>
            <textarea className={`${inputCls} font-mono text-xs`} rows={12} placeholder="…o pegue aquí el código HTML" value={html} onChange={(e) => setHtml(e.target.value)} />
            <Toggle label="Convertir merge tags de otras plataformas a variables" checked={convert} onChange={setConvert} hint="Detecta *|FNAME|*, {{ contact.X }}, %%X%%, %X%, {X} y enlaces de baja." />
            <div className="flex flex-wrap gap-2">
              <Btn variant="primary" onClick={() => importHtml(false)}>Editar como código</Btn>
              <Btn onClick={() => importHtml(true)}>Insertar como bloque HTML en el editor visual</Btn>
            </div>
            <p className="text-xs text-zinc-500">
              «Editar como código» conserva el HTML tal cual, con vista previa en vivo, variables y exportación a cualquier plataforma. «Bloque HTML» le permite agregar bloques visuales antes o después.
            </p>
          </>
        ) : (
          <label className="cursor-pointer rounded-md border-2 border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 hover:border-brand-400">
            Seleccionar proyecto .json exportado desde esta plataforma
            <input type="file" accept=".json,application/json" hidden onChange={(e) => readFile(e.target.files?.[0], importJson)} />
          </label>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Proyectos y plantillas
// ---------------------------------------------------------------------------

export function ProjectsModal({ projects, currentId, onOpen, onNew, onDelete, onDuplicate, onClose }: {
  projects: Project[];
  currentId: string;
  onOpen: (id: string) => void;
  onNew: (doc: EmailDoc, name: string) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal title="Mis correos y plantillas" onClose={onClose} wide>
      <div className="p-5">
        <h3 className="mb-3 text-sm font-semibold text-zinc-700">Crear nuevo desde plantilla</h3>
        <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-5">
          {TEMPLATES.map((t) => (
            <TemplateCard key={t.id} name={t.name} description={t.description} doc={t.build()} onClick={() => onNew(t.build(), t.name === "En blanco" ? "Correo sin título" : t.name)} />
          ))}
        </div>
        <h3 className="mb-3 text-sm font-semibold text-zinc-700">Correos guardados en este navegador ({projects.length})</h3>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[...projects].sort((a, b) => b.updatedAt - a.updatedAt).map((p) => (
            <div key={p.id} className={`group overflow-hidden rounded-lg border ${p.id === currentId ? "border-brand-500 ring-2 ring-brand-500/20" : "border-zinc-200"}`}>
              <button type="button" className="block w-full" onClick={() => onOpen(p.id)}>
                <Thumb doc={p.doc} />
              </button>
              <div className="flex items-center gap-1 border-t border-zinc-200 px-2 py-1.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-zinc-800">{p.name}</p>
                  <p className="text-[11px] text-zinc-400">{new Date(p.updatedAt).toLocaleString("es")}</p>
                </div>
                <button type="button" className="rounded px-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700" title="Duplicar" onClick={() => onDuplicate(p.id)}>⧉</button>
                <button
                  type="button"
                  className="rounded px-1 text-zinc-400 hover:bg-red-50 hover:text-red-600"
                  title="Eliminar"
                  onClick={() => confirm(`¿Eliminar «${p.name}»? Esta acción no se puede deshacer.`) && onDelete(p.id)}
                >
                  🗑
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

function Thumb({ doc }: { doc: EmailDoc }) {
  const html = useMemo(() => renderEmail(doc, { mode: "preview" }).html, [doc]);
  return (
    <div className="pointer-events-none relative h-44 overflow-hidden bg-zinc-100">
      <iframe title="miniatura" srcDoc={html} sandbox="" scrolling="no" tabIndex={-1} className="absolute left-0 top-0 origin-top-left" style={{ width: 700, height: 900, transform: "scale(0.3)" }} />
    </div>
  );
}

function TemplateCard({ name, description, doc, onClick }: { name: string; description: string; doc: EmailDoc; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="overflow-hidden rounded-lg border border-zinc-200 text-left transition hover:border-brand-400 hover:shadow">
      <Thumb doc={doc} />
      <div className="border-t border-zinc-200 px-2 py-1.5">
        <p className="text-sm font-medium text-zinc-800">{name}</p>
        <p className="text-[11px] text-zinc-400">{description}</p>
      </div>
    </button>
  );
}
