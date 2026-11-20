"use client";

import { useId, type ReactNode } from "react";
import type { Align, Padding } from "@/lib/email/types";

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-zinc-600">
      <span className="font-medium text-zinc-700">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-zinc-400">{hint}</span>}
    </label>
  );
}

export const inputCls =
  "w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20";

export function TextInput({ label, value, onChange, placeholder, hint, type = "text" }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; hint?: string; type?: string }) {
  return (
    <Field label={label} hint={hint}>
      <input type={type} className={inputCls} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

export function TextArea({ label, value, onChange, rows = 4, mono, hint, placeholder }: { label: string; value: string; onChange: (v: string) => void; rows?: number; mono?: boolean; hint?: string; placeholder?: string }) {
  return (
    <Field label={label} hint={hint}>
      <textarea
        className={`${inputCls} ${mono ? "font-mono text-xs" : ""}`}
        rows={rows}
        value={value}
        placeholder={placeholder}
        spellCheck={!mono}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

export function NumberInput({ label, value, onChange, min, max, step = 1, suffix }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; suffix?: string }) {
  return (
    <Field label={label}>
      <div className="flex items-center gap-1">
        <input
          type="number"
          className={inputCls}
          value={Number.isFinite(value) ? value : 0}
          min={min}
          max={max}
          step={step}
          onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))}
        />
        {suffix && <span className="text-xs text-zinc-400">{suffix}</span>}
      </div>
    </Field>
  );
}

export function Slider({ label, value, onChange, min, max, step = 1, suffix = "" }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; step?: number; suffix?: string }) {
  return (
    <Field label={`${label}: ${value}${suffix}`}>
      <input type="range" className="accent-brand-600" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </Field>
  );
}

export function ColorInput({ label, value, onChange, allowEmpty }: { label: string; value: string; onChange: (v: string) => void; allowEmpty?: boolean }) {
  const valid = /^#[0-9a-f]{6}$/i.test(value);
  return (
    <Field label={label}>
      <div className="flex items-center gap-1.5">
        <input
          type="color"
          className="h-8 w-9 shrink-0 cursor-pointer rounded border border-zinc-300 bg-white p-0.5"
          value={valid ? value : "#ffffff"}
          onChange={(e) => onChange(e.target.value)}
        />
        <input className={`${inputCls} font-mono`} value={value} placeholder={allowEmpty ? "transparente" : "#000000"} onChange={(e) => onChange(e.target.value.trim())} />
        {allowEmpty && value && (
          <button type="button" className="text-xs text-zinc-400 hover:text-red-500" title="Quitar color" onClick={() => onChange("")}>
            ✕
          </button>
        )}
      </div>
    </Field>
  );
}

export function Select<T extends string | number>({ label, value, onChange, options }: { label: string; value: T; onChange: (v: T) => void; options: { label: string; value: T }[] }) {
  return (
    <Field label={label}>
      <select
        className={inputCls}
        value={String(value)}
        onChange={(e) => {
          const opt = options.find((o) => String(o.value) === e.target.value);
          if (opt) onChange(opt.value);
        }}
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-0.5">
      <label htmlFor={id} className="flex cursor-pointer items-center justify-between gap-2 text-xs font-medium text-zinc-700">
        {label}
        <span className="relative inline-flex">
          <input id={id} type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
          <span className="h-5 w-9 rounded-full bg-zinc-300 transition peer-checked:bg-brand-600" />
          <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition peer-checked:translate-x-4" />
        </span>
      </label>
      {hint && <span className="text-[11px] text-zinc-400">{hint}</span>}
    </div>
  );
}

export function AlignInput({ label = "Alineación", value, onChange }: { label?: string; value: Align; onChange: (v: Align) => void }) {
  const opts: { v: Align; icon: string; t: string }[] = [
    { v: "left", icon: "⇤", t: "Izquierda" },
    { v: "center", icon: "↔", t: "Centro" },
    { v: "right", icon: "⇥", t: "Derecha" },
  ];
  return (
    <Field label={label}>
      <div className="flex overflow-hidden rounded-md border border-zinc-300">
        {opts.map((o) => (
          <button
            key={o.v}
            type="button"
            title={o.t}
            className={`flex-1 py-1 text-sm ${value === o.v ? "bg-brand-600 text-white" : "bg-white text-zinc-700 hover:bg-zinc-100"}`}
            onClick={() => onChange(o.v)}
          >
            {o.icon}
          </button>
        ))}
      </div>
    </Field>
  );
}

export function PaddingInput({ value, onChange }: { value: Padding; onChange: (v: Padding) => void }) {
  const set = (k: keyof Padding, v: number) => onChange({ ...value, [k]: v });
  return (
    <Field label="Márgenes internos (px)">
      <div className="grid grid-cols-4 gap-1">
        {(["top", "right", "bottom", "left"] as const).map((k) => (
          <div key={k} className="flex flex-col items-center">
            <input type="number" min={0} className={`${inputCls} px-1 text-center`} value={value[k]} onChange={(e) => set(k, Number(e.target.value) || 0)} />
            <span className="text-[10px] text-zinc-400">{{ top: "arriba", right: "der.", bottom: "abajo", left: "izq." }[k]}</span>
          </div>
        ))}
      </div>
    </Field>
  );
}

export function Section({ title, children, defaultOpen = true }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} className="group border-b border-zinc-200">
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-zinc-500 hover:bg-zinc-50">
        {title}
        <span className="transition group-open:rotate-90">›</span>
      </summary>
      <div className="flex flex-col gap-3 px-4 pb-4">{children}</div>
    </details>
  );
}

export function Btn({ children, onClick, variant = "default", title, disabled, className = "" }: { children: ReactNode; onClick?: () => void; variant?: "default" | "primary" | "ghost" | "danger"; title?: string; disabled?: boolean; className?: string }) {
  const v = {
    default: "border border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50",
    primary: "bg-brand-600 text-white hover:bg-brand-700",
    ghost: "text-zinc-600 hover:bg-zinc-100",
    danger: "border border-red-200 bg-white text-red-600 hover:bg-red-50",
  }[variant];
  return (
    <button type="button" title={title} disabled={disabled} onClick={onClick} className={`inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${v} ${className}`}>
      {children}
    </button>
  );
}

export function Modal({ title, onClose, children, wide, footer }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`flex max-h-[92vh] w-full flex-col overflow-hidden rounded-xl bg-white shadow-2xl ${wide ? "max-w-6xl" : "max-w-2xl"}`}>
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3">
          <h2 className="text-base font-semibold text-zinc-900">{title}</h2>
          <button type="button" className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700" onClick={onClose} aria-label="Cerrar">
            ✕
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-zinc-200 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}
