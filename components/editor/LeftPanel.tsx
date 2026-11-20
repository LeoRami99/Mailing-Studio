"use client";

import { useState } from "react";
import type { BlockType, EmailSettings, Variable } from "@/lib/email/types";
import { BLOCK_LABELS, createBlock, FONT_STACKS } from "@/lib/email/defaults";
import { PLATFORMS } from "@/lib/email/platforms";
import { locate, type EmailStore } from "@/lib/email/store";
import { startNewBlockDrag } from "./Canvas";
import { ColorInput, NumberInput, Section, Select, Slider, TextArea, TextInput, Toggle, Btn, inputCls } from "./fields";
import { ImageLibrary } from "./ImagePicker";

type Tab = "blocks" | "design" | "vars" | "images";

export function LeftPanel({ store, selectedId, onSelect }: { store: EmailStore; selectedId: string | null; onSelect: (id: string) => void }) {
  const [tab, setTab] = useState<Tab>("blocks");
  const tabs: { id: Tab; label: string }[] = [
    { id: "blocks", label: "Bloques" },
    { id: "design", label: "Diseño" },
    { id: "vars", label: "Variables" },
    { id: "images", label: "Imágenes" },
  ];

  /** Agrega un bloque después del seleccionado (o al final). */
  const addBlock = (type: BlockType, patch?: Record<string, unknown>) => {
    const blk = { ...createBlock(type, store.doc.settings), ...patch } as ReturnType<typeof createBlock>;
    store.change((d) => {
      const loc = selectedId ? locate(d, selectedId) : null;
      if (loc && !(loc.target.columnsId && type === "columns")) {
        if (loc.target.columnsId) blk.padding = { ...blk.padding, left: 0, right: 0 };
        loc.list.splice(loc.index + 1, 0, blk);
      } else {
        // antes del pie legal si existe
        const fi = d.blocks.findIndex((b) => b.type === "footer");
        d.blocks.splice(fi >= 0 && type !== "footer" ? fi : d.blocks.length, 0, blk);
      }
    });
    onSelect(blk.id);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex border-b border-zinc-200">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`flex-1 border-b-2 px-2 py-2.5 text-xs font-semibold ${tab === t.id ? "border-brand-600 text-brand-700" : "border-transparent text-zinc-500 hover:text-zinc-800"}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "blocks" && <BlocksTab onAdd={addBlock} codeMode={store.doc.mode === "code"} />}
        {tab === "design" && <DesignTab store={store} />}
        {tab === "vars" && <VariablesTab store={store} />}
        {tab === "images" && (
          <div className="p-4">
            <p className="mb-3 text-xs text-zinc-500">Haga clic en una imagen para insertarla como bloque.</p>
            <ImageLibrary onPick={(url) => addBlock("image", { src: url, alt: "" })} />
          </div>
        )}
      </div>
    </div>
  );
}

function BlocksTab({ onAdd, codeMode }: { onAdd: (t: BlockType) => void; codeMode: boolean }) {
  if (codeMode) {
    return <p className="p-4 text-sm text-zinc-500">Está editando un HTML importado en modo código. Los bloques visuales no están disponibles; use el panel de código.</p>;
  }
  return (
    <div className="p-3">
      <p className="mb-3 px-1 text-xs text-zinc-500">Arrastre un bloque al lienzo o haga clic para agregarlo.</p>
      <div className="grid grid-cols-2 gap-2">
        {(Object.keys(BLOCK_LABELS) as BlockType[]).map((t) => (
          <button
            key={t}
            type="button"
            draggable
            onDragStart={(e) => startNewBlockDrag(e, t)}
            onClick={() => onAdd(t)}
            title={BLOCK_LABELS[t].hint}
            className="flex cursor-grab flex-col items-center gap-1 rounded-lg border border-zinc-200 bg-white px-2 py-3 text-xs text-zinc-700 shadow-sm transition hover:border-brand-400 hover:text-brand-700 hover:shadow active:cursor-grabbing"
          >
            <span className="font-mono text-lg leading-none text-zinc-500">{BLOCK_LABELS[t].icon}</span>
            {BLOCK_LABELS[t].label}
          </button>
        ))}
      </div>
    </div>
  );
}

function DesignTab({ store }: { store: EmailStore }) {
  const s = store.doc.settings;
  const set = <K extends keyof EmailSettings>(k: K) => (v: EmailSettings[K]) =>
    store.change((d) => {
      d.settings[k] = v;
    }, `settings:${k}`);
  const isDesktop = typeof window !== "undefined" && window.location.protocol === "app:";
  const isLocal = isDesktop || (typeof window !== "undefined" && /localhost|127\.0\.0\.1/.test(window.location.host));

  return (
    <div>
      <Section title="Mensaje">
        <TextInput label="Asunto" value={s.subject} onChange={set("subject")} hint={`${s.subject.length} caracteres · recomendado 30–50. Admite {{variables}}.`} />
        <TextArea label="Preencabezado (preheader)" rows={2} value={s.preheader} onChange={set("preheader")} hint={`${s.preheader.length} caracteres · recomendado 40–90. Texto de vista previa en la bandeja.`} />
        <TextInput label="Título del documento" value={s.title} onChange={set("title")} />
        <div className="grid grid-cols-2 gap-2">
          <TextInput label="Idioma" value={s.lang} onChange={set("lang")} />
          <Select label="Dirección" value={s.dir} onChange={set("dir")} options={[{ label: "Izq. → der.", value: "ltr" }, { label: "Der. → izq.", value: "rtl" }]} />
        </div>
      </Section>
      <Section title="Diseño general">
        <Slider label="Ancho del correo" value={s.width} onChange={set("width")} min={480} max={800} step={10} suffix=" px" />
        <ColorInput label="Fondo exterior" value={s.bodyBg} onChange={set("bodyBg")} />
        <ColorInput label="Fondo del contenido" value={s.contentBg} onChange={set("contentBg")} />
        <ColorInput label="Borde del contenido" allowEmpty value={s.borderColor} onChange={set("borderColor")} />
        <Slider label="Esquinas redondeadas" value={s.contentRadius} onChange={set("contentRadius")} min={0} max={32} suffix=" px" />
        <Slider label="Margen superior/inferior" value={s.contentPaddingY} onChange={set("contentPaddingY")} min={0} max={80} suffix=" px" />
      </Section>
      <Section title="Tipografía y colores">
        <Select label="Fuente principal" value={s.fontFamily} onChange={set("fontFamily")} options={FONT_STACKS} />
        <TextInput label="Pila de fuentes personalizada" value={s.fontFamily} onChange={set("fontFamily")} hint="Siempre termine con una fuente segura (Arial, sans-serif)." />
        <TextInput label="URL de fuente web (opcional)" value={s.webFontUrl} onChange={set("webFontUrl")} placeholder="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;700&display=swap" hint="Funciona en Apple Mail, iOS y Samsung. Gmail y Outlook usan la fuente de respaldo." />
        <ColorInput label="Color de texto por defecto" value={s.textColor} onChange={set("textColor")} />
        <ColorInput label="Color de enlaces" value={s.linkColor} onChange={set("linkColor")} />
      </Section>
      <Section title="Modo oscuro" defaultOpen={false}>
        <Toggle label="Optimizar para modo oscuro" checked={s.darkMode} onChange={set("darkMode")} hint="Apple Mail, iOS, Outlook.com y Outlook app respetan estos colores. Gmail invierte colores por su cuenta." />
        {s.darkMode && (
          <>
            <ColorInput label="Fondo exterior (oscuro)" value={s.darkBodyBg} onChange={set("darkBodyBg")} />
            <ColorInput label="Fondo contenido (oscuro)" value={s.darkContentBg} onChange={set("darkContentBg")} />
            <ColorInput label="Texto (oscuro)" value={s.darkTextColor} onChange={set("darkTextColor")} />
            <ColorInput label="Enlaces (oscuro)" value={s.darkLinkColor} onChange={set("darkLinkColor")} />
          </>
        )}
      </Section>
      <Section title="Compatibilidad y exportación" defaultOpen={false}>
        <Toggle label="VML para Outlook escritorio" checked={s.outlookVml} onChange={set("outlookVml")} hint="Botones redondeados e imágenes de fondo en Outlook 2007–2021 / 365 Windows." />
        <NumberInput label="Punto de quiebre móvil" value={s.mobileBreakpoint} onChange={set("mobileBreakpoint")} min={320} max={800} suffix="px" />
        <TextInput
          label="URL pública de las imágenes"
          value={s.publicBaseUrl}
          onChange={set("publicBaseUrl")}
          placeholder="https://mailing.suempresa.com"
          hint={isDesktop ? "En la app de escritorio las imágenes subidas quedan en este equipo. Para el envío, súbalas a un servidor o CDN público y use su URL completa, o ponga aquí la URL pública donde las publique (las rutas /media/… se reescriben)." : isLocal ? "Está en localhost: los destinatarios no verán imágenes subidas aquí. Despliegue la plataforma en un dominio público y ponga su URL." : "Las rutas /media/… se convierten en absolutas con esta URL al exportar."}
        />
        {!s.publicBaseUrl && !isDesktop && typeof window !== "undefined" && (
          <Btn onClick={() => set("publicBaseUrl")(window.location.origin)}>Usar {window.location.origin}</Btn>
        )}
        <TextInput label="Parámetros UTM" value={s.utm} onChange={set("utm")} placeholder="utm_source=email&utm_medium=email&utm_campaign=..." hint="Se añaden a todos los enlaces https al exportar." />
        <TextArea label="CSS adicional (<head>)" value={s.customCss} onChange={set("customCss")} rows={5} mono hint="Solo para media queries y ajustes. Gmail limita el <style> a 16 KB." />
      </Section>
    </div>
  );
}

function VariablesTab({ store }: { store: EmailStore }) {
  const vars = store.doc.variables;
  const [open, setOpen] = useState<string | null>(null);
  const setVar = (i: number, patch: Partial<Variable>, key: string) =>
    store.change((d) => {
      Object.assign(d.variables[i], patch);
    }, `var:${i}:${key}`);

  const copy = (t: string) => navigator.clipboard?.writeText(t);

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="rounded-md bg-brand-50 p-3 text-xs leading-relaxed text-brand-900">
        <p className="mb-1 font-semibold">Cómo usar variables</p>
        <p>
          Escriba <code className="rounded bg-white px-1">{"{{clave}}"}</code> en cualquier texto, botón, enlace o asunto. Con valor por defecto en línea:{" "}
          <code className="rounded bg-white px-1">{'{{nombre|"amigo"}}'}</code>. Condicional: <code className="rounded bg-white px-1">{"{{#if clave}}…{{else}}…{{/if}}"}</code>.
        </p>
        <p className="mt-1">Al exportar se traducen a la sintaxis de su plataforma (SendGrid, Mailchimp, Brevo, HubSpot…).</p>
      </div>

      {vars.map((v, i) => (
        <div key={i} className="rounded-md border border-zinc-200">
          <div className="flex items-center gap-2 px-3 py-2">
            <button type="button" className="font-mono text-xs text-brand-700 hover:underline" title="Copiar" onClick={() => copy(`{{${v.key}}}`)}>
              {`{{${v.key}}}`}
            </button>
            <span className="flex-1 truncate text-xs text-zinc-500">{v.label}</span>
            <button type="button" className="text-xs text-zinc-500 hover:text-zinc-900" onClick={() => setOpen(open === v.key + i ? null : v.key + i)}>
              {open === v.key + i ? "▾" : "▸"}
            </button>
          </div>
          {open === v.key + i && (
            <div className="flex flex-col gap-2 border-t border-zinc-200 p-3">
              <TextInput label="Clave" value={v.key} onChange={(k) => setVar(i, { key: k.replace(/[^\w.-]/g, "_") }, "key")} hint="Solo letras, números y _" />
              <TextInput label="Etiqueta" value={v.label} onChange={(x) => setVar(i, { label: x }, "label")} />
              <TextInput label="Valor de ejemplo (vista previa)" value={v.sample} onChange={(x) => setVar(i, { sample: x }, "sample")} />
              <TextInput label="Valor por defecto si llega vacío" value={v.fallback} onChange={(x) => setVar(i, { fallback: x }, "fallback")} />
              <details>
                <summary className="cursor-pointer text-xs font-medium text-zinc-600">Nombre del campo por plataforma</summary>
                <div className="mt-2 flex flex-col gap-1.5">
                  {PLATFORMS.filter((p) => p.id !== "custom").map((p) => (
                    <label key={p.id} className="flex items-center gap-2 text-[11px] text-zinc-500">
                      <span className="w-28 shrink-0 truncate" title={p.name}>{p.name.split(" (")[0]}</span>
                      <input
                        className={`${inputCls} py-1 text-xs`}
                        placeholder={p.defaultName(v.key)}
                        value={v.tags[p.id] ?? ""}
                        onChange={(e) => setVar(i, { tags: { ...v.tags, [p.id]: e.target.value } }, `tag:${p.id}`)}
                      />
                    </label>
                  ))}
                </div>
              </details>
              <Btn variant="danger" onClick={() => store.change((d) => { d.variables.splice(i, 1); })}>Eliminar variable</Btn>
            </div>
          )}
        </div>
      ))}
      <Btn
        onClick={() => {
          let n = 1;
          while (vars.some((v) => v.key === `campo${n}`)) n++;
          store.change((d) => {
            d.variables.push({ key: `campo${n}`, label: `Campo ${n}`, sample: "", fallback: "", tags: {} });
          });
          setOpen(`campo${n}${vars.length}`);
        }}
      >
        + Nueva variable
      </Btn>
      <ImportVarsCsv store={store} />
    </div>
  );
}

/** Crea variables a partir de la primera fila (encabezados) y segunda fila (ejemplo) de un CSV. */
function ImportVarsCsv({ store }: { store: EmailStore }) {
  return (
    <label className="cursor-pointer rounded-md border border-dashed border-zinc-300 p-3 text-center text-xs text-zinc-500 hover:border-brand-400">
      Importar variables desde CSV (encabezados = claves, 2.ª fila = ejemplo)
      <input
        type="file"
        accept=".csv,text/csv"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          const text = await f.text();
          const [head, first] = text.split(/\r?\n/);
          const sep = head.includes(";") ? ";" : ",";
          const keys = head.split(sep).map((h) => h.trim().replace(/^"|"$/g, ""));
          const vals = (first ?? "").split(sep).map((h) => h.trim().replace(/^"|"$/g, ""));
          store.change((d) => {
            keys.forEach((label, i) => {
              const key = label.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^\w]+/g, "_").replace(/^_|_$/g, "");
              if (!key || d.variables.some((v) => v.key === key)) return;
              d.variables.push({ key, label, sample: vals[i] ?? "", fallback: "", tags: {} });
            });
          });
          e.target.value = "";
        }}
      />
    </label>
  );
}
