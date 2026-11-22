"use client";

import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { LuAlignCenter, LuAlignLeft, LuAlignRight, LuChevronRight, LuX } from "react-icons/lu";
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
  "w-full rounded-[10px] border border-zinc-200/90 bg-white/85 px-2.5 py-2 text-sm text-zinc-900 shadow-[0_1px_1px_rgba(24,24,27,0.03),inset_0_1px_0_rgba(255,255,255,0.9)] outline-none transition focus:border-brand-400 focus:bg-white focus:ring-4 focus:ring-brand-500/10";

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
            <LuX aria-hidden />
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
  const opts = [
    { v: "left" as const, Icon: LuAlignLeft, t: "Izquierda" },
    { v: "center" as const, Icon: LuAlignCenter, t: "Centro" },
    { v: "right" as const, Icon: LuAlignRight, t: "Derecha" },
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
            <o.Icon className="mx-auto h-4 w-4" aria-hidden />
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
    <details open={defaultOpen} className="group border-b border-zinc-200/70">
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-xs font-semibold text-zinc-600 transition hover:bg-zinc-100/70 hover:text-zinc-900">
        {title}
        <LuChevronRight className="transition group-open:rotate-90" aria-hidden />
      </summary>
      <div className="flex flex-col gap-3 px-4 pb-4">{children}</div>
    </details>
  );
}

export function Btn({ children, onClick, variant = "default", title, disabled, className = "" }: { children: ReactNode; onClick?: () => void; variant?: "default" | "primary" | "ghost" | "danger"; title?: string; disabled?: boolean; className?: string }) {
  const v = {
    default: "border border-zinc-200/90 bg-white/90 text-zinc-800 shadow-[0_1px_2px_rgba(24,24,27,0.06),inset_0_1px_0_white] hover:-translate-y-px hover:border-zinc-300 hover:bg-white hover:shadow-[0_4px_12px_rgba(24,24,27,0.08)]",
    primary: "border border-brand-500/70 bg-gradient-to-b from-brand-500 to-brand-600 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_5px_14px_rgba(0,143,85,0.24)] hover:-translate-y-px hover:from-brand-500 hover:to-brand-700 hover:shadow-[0_8px_20px_rgba(0,143,85,0.28)]",
    ghost: "border border-transparent text-zinc-600 hover:border-white/70 hover:bg-white/65 hover:text-zinc-900 hover:shadow-[0_2px_10px_rgba(24,24,27,0.05)]",
    danger: "border border-red-200/90 bg-white/90 text-red-600 shadow-sm hover:-translate-y-px hover:bg-red-50",
  }[variant];
  return (
    <button type="button" title={title} disabled={disabled} onClick={onClick} className={`inline-flex items-center justify-center gap-1.5 rounded-[10px] px-3 py-1.5 text-sm font-medium transition duration-200 active:translate-y-0 active:scale-[0.98] disabled:cursor-not-allowed disabled:translate-y-0 disabled:opacity-40 ${v} ${className}`}>
      {children}
    </button>
  );
}

export function Modal({ title, onClose, children, wide, footer }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();

    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = previousOverflow;
      previous?.focus();
    };
  }, []);

  const trapFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return;
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (!focusable?.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-2.5 backdrop-blur-[7px] sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={trapFocus}
        className={`glass-dialog flex max-h-[calc(100dvh-1.25rem)] w-full flex-col overflow-hidden rounded-[18px] outline-none sm:max-h-[calc(100dvh-3rem)] sm:rounded-[22px] ${wide ? "max-w-6xl" : "max-w-2xl"}`}
      >
        <div className="relative z-20 flex shrink-0 items-center justify-between border-b border-zinc-200/70 bg-white/70 px-4 py-3 backdrop-blur-xl sm:px-5 sm:py-3.5">
          <h2 id={titleId} className="min-w-0 truncate pr-4 text-base font-semibold tracking-[-0.01em] text-zinc-900">{title}</h2>
          <button type="button" className="rounded-lg border border-transparent p-1.5 text-zinc-400 transition hover:border-white hover:bg-white/75 hover:text-zinc-800 hover:shadow-sm" onClick={onClose} aria-label="Cerrar">
            <LuX aria-hidden />
          </button>
        </div>
        <div className="soft-scrollbar relative z-10 min-h-0 flex-1 overflow-auto bg-white/45">{children}</div>
        {footer && <div className="relative z-20 flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-zinc-200/70 bg-white/78 px-4 py-3 backdrop-blur-xl sm:px-5">{footer}</div>}
      </div>
    </div>
  );
}
