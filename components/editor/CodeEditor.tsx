"use client";

import { useMemo, useRef, useState } from "react";
import { LuBraces, LuCodeXml, LuEye, LuPaintbrush, LuVariable } from "react-icons/lu";
import type { EmailStore } from "@/lib/email/store";
import { renderEmail } from "@/lib/email/render";
import { uid } from "@/lib/email/defaults";
import { extractTemplateCss, replaceTemplateCss } from "@/lib/email/html-template";
import { Btn } from "./fields";
import { PreviewFrame } from "./Modals";

type EditTab = "visual" | "html" | "css";

/** Plantilla importada: edición visual de contenido, HTML/CSS y vista previa en vivo. */
export function CodeEditor({ store, device }: { store: EmailStore; device: "desktop" | "mobile" }) {
  const { doc } = store;
  const [tab, setTab] = useState<EditTab>("visual");
  const [visualSource, setVisualSource] = useState(doc.code);
  const ta = useRef<HTMLTextAreaElement>(null);
  const visualFrame = useRef<HTMLIFrameElement>(null);
  const preview = useMemo(() => renderEmail(doc, { mode: "preview" }).html, [doc]);
  const css = useMemo(() => extractTemplateCss(doc.code), [doc.code]);

  const insert = (t: string) => {
    const el = ta.current;
    if (!el) return;
    const { selectionStart: a, selectionEnd: b, value } = el;
    const next = value.slice(0, a) + t + value.slice(b);
    store.change((d) => {
      d.code = next;
    });
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = a + t.length;
    });
  };

  const toVisual = () => {
    if (!confirm("Se convertirá la plantilla en un bloque HTML visual. Los estilos del <head> pasarán a CSS adicional. ¿Continuar?")) return;
    const head = doc.code.match(/<style[^>]*>([\s\S]*?)<\/style>/gi)?.map((s) => s.replace(/<\/?style[^>]*>/gi, "")).join("\n") ?? "";
    const body = doc.code.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? doc.code;
    store.change((d) => {
      d.mode = "visual";
      d.settings.customCss = head;
      d.blocks = [{ id: uid(), type: "html", code: body.trim(), padding: { top: 0, right: 0, bottom: 0, left: 0 }, background: "" }];
    });
  };

  const activateVisualEditing = () => {
    const frame = visualFrame.current;
    const content = frame?.contentDocument;
    if (!content?.body) return;
    content.body.contentEditable = "true";
    content.body.spellcheck = true;
    content.body.style.outline = "none";
    const sync = () => {
      const html = `<!DOCTYPE html>\n${content.documentElement.outerHTML}`;
      store.change((d) => { d.code = html; }, "template:visual");
    };
    content.addEventListener("input", sync);
    content.addEventListener("blur", sync, true);
  };

  const tabs: { id: EditTab; label: string; Icon: typeof LuEye }[] = [
    { id: "visual", label: "Contenido", Icon: LuEye },
    { id: "html", label: "HTML", Icon: LuCodeXml },
    { id: "css", label: "CSS", Icon: LuPaintbrush },
  ];

  const selectTab = (next: EditTab) => {
    // Solo se refresca al entrar; durante la edición visual se mantiene el
    // iframe estable para no perder la selección ni el cursor.
    if (next === "visual") setVisualSource(doc.code);
    setTab(next);
  };

  return (
    <div className="grid h-full grid-cols-2">
      <div className="flex min-h-0 flex-col border-r border-zinc-200/80">
        <div className="flex items-center border-b border-zinc-200/80 bg-white/80 px-2 backdrop-blur-xl">
          {tabs.map(({ id, label, Icon }) => (
            <button key={id} type="button" onClick={() => selectTab(id)} className={`inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium ${tab === id ? "border-brand-600 text-brand-700" : "border-transparent text-zinc-500 hover:text-zinc-800"}`}>
              <Icon aria-hidden /> {label}
            </button>
          ))}
          <span className="ml-auto text-xs text-zinc-400">{(new TextEncoder().encode(doc.code).length / 1024).toFixed(1)} KB</span>
        </div>
        {tab === "html" && (
          <>
            <div className="flex flex-wrap items-center gap-1 border-b border-zinc-800 bg-zinc-900 px-2 py-1.5">
              <LuVariable className="text-zinc-400" aria-hidden />
              <select className="rounded border border-zinc-700 bg-zinc-800 px-1 py-1 text-xs text-zinc-200" value="" onChange={(e) => { if (e.target.value) insert(e.target.value); e.target.value = ""; }}>
                <option value="">Insertar variable…</option>
                {doc.variables.map((v) => <option key={v.key} value={`{{${v.key}}}`}>{`{{${v.key}}}`} — {v.label}</option>)}
                <option value="{{@unsubscribe}}">URL de baja</option>
                <option value="{{@preferences}}">URL de preferencias</option>
                <option value="{{@webversion}}">URL versión web</option>
                <option value={"{{#if nombre}}\n\n{{/if}}"}>Bloque condicional</option>
              </select>
              <Btn variant="ghost" className="ml-auto text-xs text-zinc-300 hover:bg-zinc-800" onClick={toVisual}>Convertir a bloques</Btn>
            </div>
            <textarea ref={ta} spellCheck={false} className="min-h-0 flex-1 resize-none bg-zinc-950 p-3 font-mono text-xs leading-relaxed text-zinc-100 outline-none" value={doc.code} onChange={(e) => store.change((d) => { d.code = e.target.value; }, "code")} onKeyDown={(e) => { if (e.key === "Tab") { e.preventDefault(); insert("  "); } }} />
          </>
        )}
        {tab === "css" && (
          <>
            <div className="flex items-center gap-2 border-b border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-400">
              <LuBraces aria-hidden /> Edita los bloques &lt;style&gt; del documento, incluidos media queries.
            </div>
            <textarea spellCheck={false} className="min-h-0 flex-1 resize-none bg-zinc-950 p-3 font-mono text-xs leading-relaxed text-zinc-100 outline-none" value={css} placeholder="/* CSS de la plantilla */" onChange={(e) => store.change((d) => { d.code = replaceTemplateCss(d.code, e.target.value); }, "template:css")} />
          </>
        )}
        {tab === "visual" && (
          <div className="flex min-h-0 flex-1 flex-col bg-zinc-100/80">
            <div className="border-b border-zinc-200 bg-brand-50 px-3 py-2 text-xs text-brand-900">Haga clic en textos e imágenes editables dentro de la plantilla. Para estructura o atributos use HTML; para estilos use CSS.</div>
            <div className="min-h-0 flex-1 overflow-auto p-4">
              <iframe ref={visualFrame} title="Edición visual de la plantilla" sandbox="allow-same-origin" srcDoc={visualSource} onLoad={activateVisualEditing} className="mx-auto block min-h-full w-full rounded-xl border border-white bg-white shadow-[0_14px_40px_rgba(6,32,21,0.13)] ring-1 ring-black/[0.04]" />
            </div>
          </div>
        )}
      </div>
      <div className="soft-scrollbar min-h-0 overflow-auto bg-zinc-100/75 p-4">
        <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-zinc-500"><LuEye aria-hidden /> Vista previa final</div>
        <PreviewFrame html={preview} width={device === "mobile" ? 375 : "100%"} />
      </div>
    </div>
  );
}
