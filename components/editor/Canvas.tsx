"use client";

import { useState, type DragEvent } from "react";
import type { Block, BlockType, EmailDoc } from "@/lib/email/types";
import { BLOCK_LABELS, cloneBlock, createBlock } from "@/lib/email/defaults";
import { findList, locate, type EmailStore, type Target } from "@/lib/email/store";
import { renderBlockContent } from "@/lib/email/render";
import { transformTokens } from "@/lib/email/tokens";

const NEW = "application/x-new-block";
const MOVE = "application/x-move-block";

export function startNewBlockDrag(e: DragEvent, type: BlockType) {
  e.dataTransfer.setData(NEW, type);
  e.dataTransfer.effectAllowed = "copy";
}

/** Inserta o mueve un bloque en la posición indicada. */
export function dropBlock(store: EmailStore, target: Target, index: number, payload: { newType?: BlockType; moveId?: string }, onSelect: (id: string) => void) {
  const { doc } = store;
  if (payload.moveId) {
    const src = locate(doc, payload.moveId);
    if (!src) return;
    const moving = src.list[src.index];
    if (target.columnsId && moving.type === "columns") return; // un solo nivel de columnas
    if (target.columnsId === moving.id) return;
    store.change((d) => {
      const s = locate(d, payload.moveId!);
      const list = findList(d, target);
      if (!s || !list) return;
      const [blk] = s.list.splice(s.index, 1);
      let i = index;
      if (s.list === list && s.index < index) i--;
      list.splice(i, 0, blk);
    });
    return;
  }
  if (payload.newType) {
    if (target.columnsId && payload.newType === "columns") return;
    const blk = createBlock(payload.newType, doc.settings);
    if (target.columnsId) blk.padding = { ...blk.padding, left: 0, right: 0 };
    store.change((d) => {
      findList(d, target)?.splice(index, 0, blk);
    });
    onSelect(blk.id);
  }
}

function DropZone({ store, target, index, onSelect, empty }: { store: EmailStore; target: Target; index: number; onSelect: (id: string) => void; empty?: string }) {
  const [over, setOver] = useState(false);
  const accepts = (e: DragEvent) => e.dataTransfer.types.includes(NEW) || e.dataTransfer.types.includes(MOVE);
  return (
    <div
      className={`relative transition-all ${empty ? `flex min-h-20 items-center justify-center rounded border-2 border-dashed text-xs ${over ? "border-brand-500 bg-brand-50 text-brand-600" : "border-zinc-300 text-zinc-400"}` : over ? "h-10" : "h-2"}`}
      onDragOver={(e) => {
        if (!accepts(e)) return;
        e.preventDefault();
        e.stopPropagation();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        dropBlock(store, target, index, { newType: (e.dataTransfer.getData(NEW) as BlockType) || undefined, moveId: e.dataTransfer.getData(MOVE) || undefined }, onSelect);
      }}
    >
      {empty}
      {!empty && over && <div className="absolute inset-x-2 top-1/2 h-1 -translate-y-1/2 rounded bg-brand-500" />}
    </div>
  );
}

function BlockToolbar({ store, block, onSelect }: { store: EmailStore; block: Block; onSelect: (id: string | null) => void }) {
  const act = (fn: (list: Block[], i: number, d: EmailDoc) => void) =>
    store.change((d) => {
      const l = locate(d, block.id);
      if (l) fn(l.list, l.index, d);
    });
  const btn = "flex h-6 w-6 items-center justify-center rounded text-xs text-white hover:bg-white/20";
  return (
    <div className="absolute -top-3 right-2 z-20 flex items-center gap-0.5 rounded-md bg-brand-600 px-1 shadow-lg" onClick={(e) => e.stopPropagation()}>
      <span className="px-1 text-[10px] font-semibold uppercase tracking-wide text-white/80">{BLOCK_LABELS[block.type].label}</span>
      <button type="button" className={btn} title="Subir" onClick={() => act((l, i) => { if (i > 0) [l[i - 1], l[i]] = [l[i], l[i - 1]]; })}>↑</button>
      <button type="button" className={btn} title="Bajar" onClick={() => act((l, i) => { if (i < l.length - 1) [l[i + 1], l[i]] = [l[i], l[i + 1]]; })}>↓</button>
      <button
        type="button"
        className={btn}
        title="Duplicar (Ctrl+D)"
        onClick={() => {
          const copy = cloneBlock(block);
          act((l, i) => { l.splice(i + 1, 0, copy); });
          onSelect(copy.id);
        }}
      >
        ⧉
      </button>
      <button type="button" className={btn} title="Eliminar (Supr)" onClick={() => { act((l, i) => { l.splice(i, 1); }); onSelect(null); }}>🗑</button>
    </div>
  );
}

function BlockView({ store, block, selectedId, onSelect, availWidth, mobile }: { store: EmailStore; block: Block; selectedId: string | null; onSelect: (id: string | null) => void; availWidth: number; mobile: boolean }) {
  const { doc } = store;
  const selected = selectedId === block.id;
  const p = block.padding;
  const isHero = block.type === "hero";
  const padding = isHero ? 0 : mobile && block.type !== "columns" ? `${p.top}px 20px ${p.bottom}px 20px` : `${p.top}px ${p.right}px ${p.bottom}px ${p.left}px`;
  const inner = availWidth - (isHero ? 0 : p.left + p.right);

  let content: React.ReactNode;
  if (block.type === "columns") {
    const total = block.columns.reduce((s, c) => s + c.width, 0) || 100;
    const stack = mobile && block.stackOnMobile;
    content = (
      <div className={`flex ${stack ? "flex-col gap-4" : ""}`} style={{ gap: stack ? 16 : block.gap }}>
        {block.columns.map((col) => {
          const w = stack ? inner : ((inner - block.gap * (block.columns.length - 1)) * col.width) / total;
          return (
            <div key={col.id} className="min-w-0 rounded outline outline-1 outline-dashed outline-zinc-300/70" style={{ width: stack ? "100%" : `${(col.width / total) * 100}%`, background: col.background || undefined, alignSelf: col.verticalAlign === "middle" ? "center" : col.verticalAlign === "bottom" ? "flex-end" : "flex-start" }}>
              <BlockList store={store} blocks={col.blocks} target={{ columnsId: block.id, columnId: col.id }} selectedId={selectedId} onSelect={onSelect} availWidth={w} mobile={mobile} />
            </div>
          );
        })}
      </div>
    );
  } else {
    const raw = renderBlockContent(block, { settings: doc.settings, availWidth: inner, mode: "canvas" });
    const html = transformTokens(raw.replace(/\{\{\s*@[\w-]+\s*\}\}/g, "#"), { mode: "canvas", variables: doc.variables }).html;
    content = <div dangerouslySetInnerHTML={{ __html: html }} />;
  }

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.stopPropagation();
        e.dataTransfer.setData(MOVE, block.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onSelect(block.id);
      }}
      className={`group relative cursor-pointer ${selected ? "z-10 outline outline-2 outline-brand-600" : "hover:outline hover:outline-1 hover:outline-brand-400"} ${block.hideOnMobile && mobile ? "opacity-30" : ""} ${block.hideOnDesktop && !mobile ? "opacity-30" : ""}`}
      style={{ padding, background: block.background || undefined }}
    >
      {selected && <BlockToolbar store={store} block={block} onSelect={onSelect} />}
      {(block.condition || block.label || block.hideOnMobile || block.hideOnDesktop) && (
        <div className="pointer-events-none absolute left-1 top-1 z-10 flex gap-1">
          {block.condition && <span className="rounded bg-amber-500 px-1.5 text-[10px] font-semibold text-white">si {`{{${block.condition}}}`}</span>}
          {block.hideOnMobile && <span className="rounded bg-zinc-600 px-1.5 text-[10px] text-white">oculto en móvil</span>}
          {block.hideOnDesktop && <span className="rounded bg-zinc-600 px-1.5 text-[10px] text-white">solo móvil</span>}
          {block.label && <span className="rounded bg-violet-600 px-1.5 text-[10px] text-white">{block.label}</span>}
        </div>
      )}
      {content}
    </div>
  );
}

function BlockList({ store, blocks, target, selectedId, onSelect, availWidth, mobile }: { store: EmailStore; blocks: Block[]; target: Target; selectedId: string | null; onSelect: (id: string | null) => void; availWidth: number; mobile: boolean }) {
  if (!blocks.length) {
    return (
      <div className="p-2">
        <DropZone store={store} target={target} index={0} onSelect={onSelect} empty={target.columnsId ? "Suelte un bloque aquí" : "Arrastre bloques aquí para empezar"} />
      </div>
    );
  }
  return (
    <div>
      <DropZone store={store} target={target} index={0} onSelect={onSelect} />
      {blocks.map((b, i) => (
        <div key={b.id}>
          <BlockView store={store} block={b} selectedId={selectedId} onSelect={onSelect} availWidth={availWidth} mobile={mobile} />
          <DropZone store={store} target={target} index={i + 1} onSelect={onSelect} />
        </div>
      ))}
    </div>
  );
}

export function Canvas({ store, selectedId, onSelect, device, dark }: { store: EmailStore; selectedId: string | null; onSelect: (id: string | null) => void; device: "desktop" | "mobile"; dark: boolean }) {
  const s = store.doc.settings;
  const mobile = device === "mobile";
  const width = mobile ? 375 : s.width;
  return (
    <div className="min-h-full px-6 py-8" style={{ background: dark && s.darkMode ? s.darkBodyBg : s.bodyBg }} onClick={() => onSelect(null)}>
      {s.webFontUrl && <link rel="stylesheet" href={s.webFontUrl} />}
      <div
        className={`email-canvas mx-auto shadow-sm ${dark && s.darkMode ? "email-canvas-dark" : ""}`}
        style={{
          width,
          maxWidth: "100%",
          background: dark && s.darkMode ? s.darkContentBg : s.contentBg,
          color: s.textColor,
          fontFamily: s.fontFamily,
          borderRadius: s.contentRadius,
          border: s.borderColor ? `1px solid ${s.borderColor}` : undefined,
          overflow: "visible",
          ["--dm-text" as string]: s.darkTextColor,
          ["--dm-link" as string]: s.darkLinkColor,
        }}
      >
        <BlockList store={store} blocks={store.doc.blocks} target={{}} selectedId={selectedId} onSelect={onSelect} availWidth={width} mobile={mobile} />
      </div>
      {s.preheader && (
        <p className="mx-auto mt-3 text-center text-xs text-zinc-400" style={{ maxWidth: width }}>
          Preheader: {s.preheader}
        </p>
      )}
    </div>
  );
}
