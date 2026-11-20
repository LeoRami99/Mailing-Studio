"use client";

import { useMemo, useRef } from "react";
import type { EmailStore } from "@/lib/email/store";
import { renderEmail } from "@/lib/email/render";
import { uid } from "@/lib/email/defaults";
import { Btn } from "./fields";
import { PreviewFrame } from "./Modals";

/** Edición de un HTML importado: código a la izquierda, vista previa en vivo a la derecha. */
export function CodeEditor({ store, device }: { store: EmailStore; device: "desktop" | "mobile" }) {
  const { doc } = store;
  const ta = useRef<HTMLTextAreaElement>(null);
  const preview = useMemo(() => renderEmail(doc, { mode: "preview" }).html, [doc]);

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
    if (!confirm("Se convertirá el cuerpo del HTML en un bloque HTML dentro del editor visual. Se perderán los estilos del <head> (puede pegarlos en Diseño > CSS adicional). ¿Continuar?")) return;
    const head = doc.code.match(/<style[^>]*>([\s\S]*?)<\/style>/gi)?.map((s) => s.replace(/<\/?style[^>]*>/gi, "")).join("\n") ?? "";
    const body = doc.code.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? doc.code;
    store.change((d) => {
      d.mode = "visual";
      d.settings.customCss = head;
      d.blocks = [{ id: uid(), type: "html", code: body.trim(), padding: { top: 0, right: 0, bottom: 0, left: 0 }, background: "" }];
    });
  };

  return (
    <div className="grid h-full grid-cols-2">
      <div className="flex min-h-0 flex-col border-r border-zinc-200">
        <div className="flex flex-wrap items-center gap-1 border-b border-zinc-200 bg-white px-2 py-1.5">
          <select
            className="rounded border border-zinc-300 px-1 py-1 text-xs"
            value=""
            onChange={(e) => {
              if (e.target.value) insert(e.target.value);
              e.target.value = "";
            }}
          >
            <option value="">Insertar variable…</option>
            {doc.variables.map((v) => (
              <option key={v.key} value={`{{${v.key}}}`}>{`{{${v.key}}}`} — {v.label}</option>
            ))}
            <option value="{{@unsubscribe}}">URL de baja</option>
            <option value="{{@preferences}}">URL de preferencias</option>
            <option value="{{@webversion}}">URL versión web</option>
            <option value={"{{#if nombre}}\n\n{{/if}}"}>Bloque condicional</option>
          </select>
          <span className="ml-1 text-xs text-zinc-400">{(new TextEncoder().encode(doc.code).length / 1024).toFixed(1)} KB</span>
          <Btn variant="ghost" className="ml-auto text-xs" onClick={toVisual}>Pasar a editor visual</Btn>
        </div>
        <textarea
          ref={ta}
          spellCheck={false}
          className="min-h-0 flex-1 resize-none bg-zinc-950 p-3 font-mono text-xs leading-relaxed text-zinc-100 outline-none"
          value={doc.code}
          onChange={(e) => {
            const v = e.target.value;
            store.change((d) => {
              d.code = v;
            }, "code");
          }}
          onKeyDown={(e) => {
            if (e.key === "Tab") {
              e.preventDefault();
              insert("  ");
            }
          }}
        />
      </div>
      <div className="min-h-0 overflow-auto bg-zinc-100 p-4">
        <PreviewFrame html={preview} width={device === "mobile" ? 375 : "100%"} />
      </div>
    </div>
  );
}
