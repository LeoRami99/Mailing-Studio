"use client";

import type { Block, EmailDoc, SocialItem } from "@/lib/email/types";
import { BLOCK_LABELS, FONT_STACKS, makeColumn, uid } from "@/lib/email/defaults";
import { locate, type EmailStore } from "@/lib/email/store";
import {
  AlignInput,
  Btn,
  ColorInput,
  NumberInput,
  PaddingInput,
  Section,
  Select,
  Slider,
  TextArea,
  TextInput,
  Toggle,
} from "./fields";
import { RichText } from "./RichText";
import { ImageField } from "./ImagePicker";

const FONT_OPTS = [{ label: "Heredar del diseño", value: "" }, ...FONT_STACKS];

export function Inspector({ store, selectedId, onSelect }: { store: EmailStore; selectedId: string | null; onSelect: (id: string | null) => void }) {
  const { doc, change } = store;
  const loc = selectedId ? locate(doc, selectedId) : null;
  const block = loc ? loc.list[loc.index] : null;

  if (!block) {
    return (
      <div className="p-6 text-center text-sm text-zinc-400">
        <p className="mb-2 text-3xl">☝</p>
        Seleccione un bloque en el lienzo para editar sus propiedades, o arrastre uno nuevo desde el panel izquierdo.
      </div>
    );
  }

  /** Actualiza el bloque seleccionado. `key` agrupa cambios rápidos en el historial. */
  const set = <B extends Block>(fn: (b: B) => void, key?: string) =>
    change((d: EmailDoc) => {
      const l = locate(d, block.id);
      if (l) fn(l.list[l.index] as B);
    }, key ? `${block.id}:${key}` : undefined);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const upd = (key: string) => (v: unknown) => set<any>((b) => { b[key] = v; }, key);
  const vars = doc.variables;
  const meta = BLOCK_LABELS[block.type];

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-zinc-900">
            <span className="mr-1.5 inline-block w-6 text-center font-mono text-zinc-400">{meta.icon}</span>
            {meta.label}
          </p>
          {loc?.target.columnsId && (
            <button type="button" className="text-xs text-brand-600 hover:underline" onClick={() => onSelect(loc.target.columnsId!)}>
              ↑ Seleccionar columnas contenedoras
            </button>
          )}
        </div>
        <Btn variant="ghost" onClick={() => onSelect(null)} title="Deseleccionar">✕</Btn>
      </div>

      <Section title="Contenido">
        {block.type === "heading" && (
          <>
            <RichText key={block.id} value={block.html} onChange={upd("html")} variables={vars} minHeight={50} singleLine />
            <Select label="Nivel" value={block.level} onChange={upd("level")} options={[{ label: "H1", value: 1 }, { label: "H2", value: 2 }, { label: "H3", value: 3 }]} />
          </>
        )}
        {(block.type === "text" || block.type === "footer") && (
          <RichText key={block.id} value={block.html} onChange={upd("html")} variables={vars} />
        )}
        {block.type === "image" && (
          <>
            <ImageField label="Imagen" value={block.src} onChange={upd("src")} />
            <TextInput label="Texto alternativo (alt)" value={block.alt} onChange={upd("alt")} hint="Se muestra cuando el cliente bloquea imágenes. Obligatorio." />
            <TextInput label="Enlace al hacer clic" value={block.href} onChange={upd("href")} placeholder="https://" />
            <ImageField label="Imagen alternativa para modo oscuro (opcional)" value={block.darkSrc ?? ""} onChange={upd("darkSrc")} />
          </>
        )}
        {block.type === "button" && (
          <>
            <TextInput label="Texto" value={block.text} onChange={upd("text")} hint="Use un verbo + resultado. Admite variables: {{nombre}}" />
            <TextInput label="Enlace" value={block.href} onChange={upd("href")} placeholder="https://" hint="Admite variables, p. ej. https://sitio.com/?id={{email}}" />
          </>
        )}
        {block.type === "html" && (
          <TextArea label="Código HTML" value={block.code} onChange={upd("code")} rows={14} mono hint="Use tablas y estilos en línea. Sin <script>, <form> ni <iframe>." />
        )}
        {block.type === "hero" && (
          <>
            <ImageField label="Imagen de fondo" value={block.bgImage} onChange={upd("bgImage")} />
            <RichText key={block.id} value={block.html} onChange={upd("html")} variables={vars} />
            <TextInput label="Texto del botón (vacío = sin botón)" value={block.buttonText} onChange={upd("buttonText")} />
            <TextInput label="Enlace del botón" value={block.buttonHref} onChange={upd("buttonHref")} />
          </>
        )}
        {block.type === "spacer" && <Slider label="Altura" value={block.height} onChange={upd("height")} min={4} max={200} suffix=" px" />}
        {block.type === "divider" && (
          <>
            <ColorInput label="Color" value={block.color} onChange={upd("color")} />
            <Slider label="Grosor" value={block.thickness} onChange={upd("thickness")} min={1} max={10} suffix=" px" />
            <Slider label="Ancho" value={block.widthPercent} onChange={upd("widthPercent")} min={10} max={100} suffix=" %" />
            <Select label="Estilo" value={block.style} onChange={upd("style")} options={[{ label: "Sólida", value: "solid" }, { label: "Guiones", value: "dashed" }, { label: "Puntos", value: "dotted" }]} />
          </>
        )}
        {block.type === "social" && <SocialEditor items={block.items} onChange={upd("items")} />}
        {block.type === "columns" && (
          <>
            <p className="text-xs text-zinc-500">Columnas ({block.columns.length}). Los anchos se reparten en porcentaje.</p>
            {block.columns.map((c, i) => (
              <div key={c.id} className="flex flex-col gap-2 rounded-md border border-zinc-200 p-2">
                <div className="flex items-center justify-between text-xs font-medium text-zinc-700">
                  Columna {i + 1}
                  {block.columns.length > 1 && (
                    <button type="button" className="text-red-500 hover:underline" onClick={() => set<typeof block>((b) => { b.columns.splice(i, 1); })}>
                      Quitar
                    </button>
                  )}
                </div>
                <Slider label="Ancho" value={c.width} min={10} max={90} suffix=" %" onChange={(v) => set<typeof block>((b) => { b.columns[i].width = v; }, `w${i}`)} />
                <ColorInput label="Fondo" allowEmpty value={c.background} onChange={(v) => set<typeof block>((b) => { b.columns[i].background = v; }, `bg${i}`)} />
                <Select label="Alineación vertical" value={c.verticalAlign} onChange={(v) => set<typeof block>((b) => { b.columns[i].verticalAlign = v; })} options={[{ label: "Arriba", value: "top" }, { label: "Centro", value: "middle" }, { label: "Abajo", value: "bottom" }]} />
              </div>
            ))}
            <div className="flex flex-wrap gap-1">
              {block.columns.length < 4 && (
                <Btn onClick={() => set<typeof block>((b) => { b.columns.push(makeColumn(Math.round(100 / (b.columns.length + 1)))); })}>+ Columna</Btn>
              )}
              <Btn onClick={() => set<typeof block>((b) => { const w = Math.round(100 / b.columns.length); b.columns.forEach((c) => (c.width = w)); })}>Igualar anchos</Btn>
              {block.columns.length === 2 && (
                <>
                  <Btn onClick={() => set<typeof block>((b) => { b.columns[0].width = 33; b.columns[1].width = 67; })}>1/3 + 2/3</Btn>
                  <Btn onClick={() => set<typeof block>((b) => { b.columns[0].width = 67; b.columns[1].width = 33; })}>2/3 + 1/3</Btn>
                </>
              )}
            </div>
            <Slider label="Separación" value={block.gap} onChange={upd("gap")} min={0} max={60} suffix=" px" />
            <Toggle label="Apilar en móvil" checked={block.stackOnMobile} onChange={upd("stackOnMobile")} hint="Recomendado. Usa columnas híbridas que funcionan incluso sin media queries (Gmail app)." />
          </>
        )}
        {block.type === "footer" && (
          <>
            <Toggle label="Enlace «Ver en el navegador»" checked={block.showWebVersion} onChange={upd("showWebVersion")} />
            {block.showWebVersion && <TextInput label="Texto" value={block.webVersionText} onChange={upd("webVersionText")} />}
            <Toggle label="Enlace de preferencias" checked={block.showPreferences} onChange={upd("showPreferences")} />
            {block.showPreferences && <TextInput label="Texto" value={block.preferencesText} onChange={upd("preferencesText")} />}
            <Toggle label="Enlace de baja (obligatorio)" checked={block.showUnsubscribe} onChange={upd("showUnsubscribe")} />
            {block.showUnsubscribe && <TextInput label="Texto" value={block.unsubscribeText} onChange={upd("unsubscribeText")} />}
          </>
        )}
      </Section>

      <Section title="Estilo">
        {(block.type === "heading" || block.type === "text") && (
          <>
            <Select label="Fuente" value={block.fontFamily} onChange={upd("fontFamily")} options={FONT_OPTS} />
            <div className="grid grid-cols-2 gap-2">
              <NumberInput label="Tamaño" value={block.fontSize} onChange={upd("fontSize")} min={8} max={96} suffix="px" />
              <NumberInput label="Interlineado" value={block.lineHeight} onChange={upd("lineHeight")} min={0.8} max={3} step={0.05} />
            </div>
            {block.type === "heading" && (
              <div className="grid grid-cols-2 gap-2">
                <Select label="Peso" value={block.fontWeight} onChange={upd("fontWeight")} options={[300, 400, 500, 600, 700, 800, 900].map((w) => ({ label: String(w), value: w }))} />
                <NumberInput label="Espaciado letras" value={block.letterSpacing} onChange={upd("letterSpacing")} min={-5} max={20} step={0.5} suffix="px" />
              </div>
            )}
            <ColorInput label="Color" value={block.color} onChange={upd("color")} />
            <AlignInput value={block.align} onChange={upd("align")} />
          </>
        )}
        {block.type === "image" && (
          <>
            <Slider label="Ancho (0 = completo)" value={block.width} onChange={upd("width")} min={0} max={doc.settings.width} suffix=" px" />
            <AlignInput value={block.align} onChange={upd("align")} />
            <Slider label="Bordes redondeados" value={block.borderRadius} onChange={upd("borderRadius")} min={0} max={100} suffix=" px" />
          </>
        )}
        {block.type === "button" && (
          <>
            <Select label="Fuente" value={block.fontFamily} onChange={upd("fontFamily")} options={FONT_OPTS} />
            <div className="grid grid-cols-2 gap-2">
              <ColorInput label="Fondo" value={block.bg} onChange={upd("bg")} />
              <ColorInput label="Texto" value={block.color} onChange={upd("color")} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <NumberInput label="Tamaño texto" value={block.fontSize} onChange={upd("fontSize")} min={10} max={40} suffix="px" />
              <Select label="Peso" value={block.fontWeight} onChange={upd("fontWeight")} options={[400, 500, 600, 700, 800].map((w) => ({ label: String(w), value: w }))} />
              <NumberInput label="Relleno vertical" value={block.paddingV} onChange={upd("paddingV")} min={0} max={40} suffix="px" />
              <NumberInput label="Relleno horizontal" value={block.paddingH} onChange={upd("paddingH")} min={0} max={80} suffix="px" />
            </div>
            <Slider label="Bordes redondeados" value={block.borderRadius} onChange={upd("borderRadius")} min={0} max={40} suffix=" px" />
            <div className="grid grid-cols-2 gap-2">
              <NumberInput label="Borde" value={block.borderWidth} onChange={upd("borderWidth")} min={0} max={8} suffix="px" />
              <ColorInput label="Color borde" value={block.borderColor} onChange={upd("borderColor")} />
            </div>
            <AlignInput value={block.align} onChange={upd("align")} />
            <Toggle label="Ancho completo" checked={block.fullWidth} onChange={upd("fullWidth")} />
          </>
        )}
        {block.type === "social" && (
          <>
            <AlignInput value={block.align} onChange={upd("align")} />
            <Slider label="Tamaño de íconos" value={block.iconSize} onChange={upd("iconSize")} min={16} max={64} suffix=" px" />
            <Slider label="Separación" value={block.gap} onChange={upd("gap")} min={0} max={40} suffix=" px" />
            <div className="grid grid-cols-2 gap-2">
              <ColorInput label="Fondo (sin ícono)" value={block.pillBg} onChange={upd("pillBg")} />
              <ColorInput label="Texto (sin ícono)" value={block.textColor} onChange={upd("textColor")} />
            </div>
          </>
        )}
        {block.type === "footer" && (
          <>
            <NumberInput label="Tamaño" value={block.fontSize} onChange={upd("fontSize")} min={9} max={20} suffix="px" />
            <div className="grid grid-cols-2 gap-2">
              <ColorInput label="Texto" value={block.color} onChange={upd("color")} />
              <ColorInput label="Enlaces" value={block.linkColor} onChange={upd("linkColor")} />
            </div>
            <AlignInput value={block.align} onChange={upd("align")} />
          </>
        )}
        {block.type === "hero" && (
          <>
            <ColorInput label="Color de fondo (respaldo)" value={block.bgColor} onChange={upd("bgColor")} />
            <Slider label="Altura mínima" value={block.height} onChange={upd("height")} min={100} max={700} suffix=" px" />
            <ColorInput label="Color de texto" value={block.color} onChange={upd("color")} />
            <NumberInput label="Tamaño texto" value={block.fontSize} onChange={upd("fontSize")} min={10} max={48} suffix="px" />
            <AlignInput value={block.align} onChange={upd("align")} />
            <div className="grid grid-cols-2 gap-2">
              <ColorInput label="Botón: fondo" value={block.buttonBg} onChange={upd("buttonBg")} />
              <ColorInput label="Botón: texto" value={block.buttonColor} onChange={upd("buttonColor")} />
            </div>
          </>
        )}
        <ColorInput label="Fondo del bloque" allowEmpty value={block.background} onChange={upd("background")} />
        <PaddingInput value={block.padding} onChange={upd("padding")} />
      </Section>

      <Section title="Visibilidad y personalización" defaultOpen={false}>
        <Toggle label="Ocultar en móvil" checked={!!block.hideOnMobile} onChange={upd("hideOnMobile")} />
        <Toggle label="Mostrar solo en móvil" checked={!!block.hideOnDesktop} onChange={upd("hideOnDesktop")} hint="Se oculta en escritorio y en Outlook." />
        <Select
          label="Mostrar solo si la variable tiene valor"
          value={block.condition ?? ""}
          onChange={upd("condition")}
          options={[{ label: "Siempre visible", value: "" }, ...vars.map((v) => ({ label: `${v.label} ({{${v.key}}})`, value: v.key }))]}
        />
        <TextInput label="Nota interna" value={block.label ?? ""} onChange={upd("label")} hint="Solo visible en el editor." />
      </Section>
    </div>
  );
}

function SocialEditor({ items, onChange }: { items: SocialItem[]; onChange: (v: SocialItem[]) => void }) {
  const upd = (i: number, patch: Partial<SocialItem>) => onChange(items.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= items.length) return;
    const a = [...items];
    [a[i], a[j]] = [a[j], a[i]];
    onChange(a);
  };
  return (
    <div className="flex flex-col gap-2">
      {items.map((it, i) => (
        <div key={it.id} className="flex flex-col gap-2 rounded-md border border-zinc-200 p-2">
          <div className="flex items-center gap-1">
            <input className="flex-1 rounded border border-zinc-300 px-2 py-1 text-sm" value={it.label} placeholder="Etiqueta" onChange={(e) => upd(i, { label: e.target.value, network: e.target.value })} />
            <button type="button" className="px-1 text-zinc-400 hover:text-zinc-700" onClick={() => move(i, -1)}>↑</button>
            <button type="button" className="px-1 text-zinc-400 hover:text-zinc-700" onClick={() => move(i, 1)}>↓</button>
            <button type="button" className="px-1 text-red-400 hover:text-red-600" onClick={() => onChange(items.filter((_, j) => j !== i))}>✕</button>
          </div>
          <input className="rounded border border-zinc-300 px-2 py-1 text-sm" value={it.url} placeholder="https://" onChange={(e) => upd(i, { url: e.target.value })} />
          <ImageField label="Ícono PNG (opcional, si no se usa texto)" value={it.icon} onChange={(v) => upd(i, { icon: v })} />
        </div>
      ))}
      <Btn onClick={() => onChange([...items, { id: uid(), network: "Red", url: "https://", icon: "", label: "Red" }])}>+ Agregar red</Btn>
      <p className="text-[11px] text-zinc-400">Use íconos PNG (no SVG: Gmail y Outlook no los muestran), de al menos el doble del tamaño visible.</p>
    </div>
  );
}
