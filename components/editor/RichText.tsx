"use client";

import { useEffect, useRef, useState } from "react";
import type { Variable } from "@/lib/email/types";

/**
 * Editor de texto enriquecido mínimo basado en contentEditable.
 * Produce HTML sencillo (p, b, i, u, a, ul, ol, li, br, span con color).
 */
export function RichText({
  value,
  onChange,
  variables,
  minHeight = 120,
  singleLine,
}: {
  value: string;
  onChange: (html: string) => void;
  variables: Variable[];
  minHeight?: number;
  singleLine?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [showSource, setShowSource] = useState(false);
  // Enlace: window.prompt() no existe en Electron, así que se usa un campo en línea.
  const [linkUrl, setLinkUrl] = useState<string | null>(null);
  const savedRange = useRef<Range | null>(null);
  const lastEmitted = useRef<string>("");

  // Sincroniza el contenido externo sin romper el cursor mientras se escribe.
  useEffect(() => {
    const el = ref.current;
    if (!el || showSource) return;
    if (value !== lastEmitted.current && el.innerHTML !== value) el.innerHTML = value;
  }, [value, showSource]);

  const emit = () => {
    const el = ref.current;
    if (!el) return;
    const html = el.innerHTML.replace(/<div><br><\/div>/g, "<br>");
    lastEmitted.current = html;
    onChange(html);
  };

  const cmd = (name: string, arg?: string) => {
    ref.current?.focus();
    document.execCommand(name, false, arg);
    emit();
  };

  const insertText = (t: string) => {
    ref.current?.focus();
    document.execCommand("insertText", false, t);
    emit();
  };

  const link = () => {
    const sel = window.getSelection();
    savedRange.current = sel && sel.rangeCount && ref.current?.contains(sel.anchorNode) ? sel.getRangeAt(0).cloneRange() : null;
    const current = sel?.anchorNode?.parentElement?.closest("a")?.getAttribute("href");
    setLinkUrl(current ?? "https://");
  };

  const applyLink = () => {
    const url = linkUrl?.trim();
    setLinkUrl(null);
    if (!url || !ref.current) return;
    ref.current.focus();
    const sel = window.getSelection();
    if (savedRange.current && sel) {
      sel.removeAllRanges();
      sel.addRange(savedRange.current);
    }
    if (sel && sel.isCollapsed) {
      // Sin texto seleccionado: inserta la URL como texto enlazado.
      document.execCommand("insertHTML", false, `<a href="${url.replace(/"/g, "&quot;")}">${url.replace(/</g, "&lt;")}</a>`);
    } else {
      document.execCommand("createLink", false, url);
    }
    emit();
  };

  const tb = "rounded px-1.5 py-0.5 text-xs text-zinc-700 hover:bg-zinc-200";

  return (
    <div className="overflow-hidden rounded-md border border-zinc-300 bg-white focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/20">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-zinc-200 bg-zinc-50 px-1 py-1">
        <button type="button" className={`${tb} font-bold`} title="Negrita" onMouseDown={(e) => { e.preventDefault(); cmd("bold"); }}>B</button>
        <button type="button" className={`${tb} italic`} title="Cursiva" onMouseDown={(e) => { e.preventDefault(); cmd("italic"); }}>I</button>
        <button type="button" className={`${tb} underline`} title="Subrayado" onMouseDown={(e) => { e.preventDefault(); cmd("underline"); }}>U</button>
        <button type="button" className={`${tb} line-through`} title="Tachado" onMouseDown={(e) => { e.preventDefault(); cmd("strikeThrough"); }}>S</button>
        <button type="button" className={tb} title="Enlace" onMouseDown={(e) => { e.preventDefault(); link(); }}>🔗</button>
        <button type="button" className={tb} title="Quitar enlace" onMouseDown={(e) => { e.preventDefault(); cmd("unlink"); }}>⛓︎̸</button>
        {!singleLine && (
          <>
            <button type="button" className={tb} title="Lista con viñetas" onMouseDown={(e) => { e.preventDefault(); cmd("insertUnorderedList"); }}>• —</button>
            <button type="button" className={tb} title="Lista numerada" onMouseDown={(e) => { e.preventDefault(); cmd("insertOrderedList"); }}>1.</button>
          </>
        )}
        <label className={`${tb} relative cursor-pointer`} title="Color del texto seleccionado">
          A<span className="ml-0.5 inline-block h-2 w-2 rounded-sm bg-gradient-to-r from-red-500 via-green-500 to-brand-500" />
          <input type="color" className="absolute inset-0 cursor-pointer opacity-0" onChange={(e) => cmd("foreColor", e.target.value)} />
        </label>
        <button type="button" className={tb} title="Quitar formato" onMouseDown={(e) => { e.preventDefault(); cmd("removeFormat"); }}>⌫</button>
        <select
          className="ml-1 rounded border border-zinc-300 bg-white px-1 py-0.5 text-xs text-zinc-700"
          value=""
          title="Insertar variable"
          onChange={(e) => {
            const v = e.target.value;
            if (v) insertText(v);
            e.target.value = "";
          }}
        >
          <option value="">{"{{ }}"} Variable…</option>
          {variables.map((v) => (
            <option key={v.key} value={`{{${v.key}}}`}>
              {v.label} — {`{{${v.key}}}`}
            </option>
          ))}
          <option value={'{{@unsubscribe}}'}>URL de baja</option>
          <option value={'{{@webversion}}'}>URL versión web</option>
        </select>
        <button type="button" className={`${tb} ml-auto font-mono`} title="Ver/editar HTML" onClick={() => setShowSource((s) => !s)}>
          {showSource ? "Visual" : "</>"}
        </button>
      </div>
      {linkUrl !== null && (
        <div className="flex items-center gap-1 border-b border-zinc-200 bg-brand-50 px-2 py-1.5">
          <input
            autoFocus
            className="min-w-0 flex-1 rounded border border-zinc-300 bg-white px-2 py-1 text-xs"
            value={linkUrl}
            placeholder="https://… o mailto:… (admite {{variables}})"
            onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applyLink();
              } else if (e.key === "Escape") setLinkUrl(null);
            }}
          />
          <button type="button" className="rounded bg-brand-600 px-2 py-1 text-xs text-white" onClick={applyLink}>Aplicar</button>
          <button type="button" className="px-1 text-xs text-zinc-500" onClick={() => setLinkUrl(null)}>✕</button>
        </div>
      )}
      {showSource ? (
        <textarea
          className="block w-full p-2 font-mono text-xs text-zinc-800 outline-none"
          style={{ minHeight }}
          value={value}
          onChange={(e) => {
            lastEmitted.current = "";
            onChange(e.target.value);
          }}
        />
      ) : (
        <div
          ref={ref}
          contentEditable
          suppressContentEditableWarning
          className="rich-editor max-h-80 overflow-auto p-2 text-sm text-zinc-900 outline-none"
          style={{ minHeight }}
          onInput={emit}
          onBlur={emit}
          onKeyDown={(e) => {
            if (singleLine && e.key === "Enter" && !e.shiftKey) e.preventDefault();
          }}
          onPaste={(e) => {
            // Pega solo texto para no arrastrar estilos de Word/Docs que rompen el correo.
            e.preventDefault();
            const text = e.clipboardData.getData("text/plain");
            document.execCommand("insertText", false, text);
            emit();
          }}
        />
      )}
    </div>
  );
}
