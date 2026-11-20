"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Btn, inputCls, Modal } from "./fields";

export interface UploadedFile {
  name: string;
  url: string;
  size: number;
}

export async function uploadFiles(files: FileList | File[]): Promise<UploadedFile[]> {
  const fd = new FormData();
  for (const f of Array.from(files)) fd.append("file", f);
  const res = await fetch("/api/upload", { method: "POST", body: fd });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Error al subir");
  return json.files;
}

export function useLibrary() {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [loading, setLoading] = useState(false);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/upload");
      const json = await res.json();
      setFiles(json.files ?? []);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);
  return { files, loading, refresh };
}

/** Zona para soltar/subir imágenes + biblioteca + URL externa. */
export function ImageLibrary({ onPick, selected }: { onPick: (url: string) => void; selected?: string }) {
  const { files, loading, refresh } = useLibrary();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const doUpload = async (list: FileList | File[]) => {
    setBusy(true);
    setError("");
    try {
      const up = await uploadFiles(list);
      await refresh();
      if (up[0]) onPick(up[0].url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (name: string) => {
    if (!confirm("¿Eliminar esta imagen del servidor? Los correos ya enviados que la usen dejarán de mostrarla.")) return;
    await fetch("/api/upload", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    refresh();
  };

  return (
    <div className="flex flex-col gap-3">
      <div
        className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed p-5 text-center text-sm transition ${drag ? "border-brand-500 bg-brand-50" : "border-zinc-300 bg-zinc-50 hover:border-brand-400"}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("Files")) {
            e.preventDefault();
            setDrag(true);
          }
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          if (e.dataTransfer.files.length) doUpload(e.dataTransfer.files);
        }}
      >
        <span className="text-2xl">⬆</span>
        <span className="font-medium text-zinc-700">{busy ? "Subiendo…" : "Arrastre imágenes aquí o haga clic"}</span>
        <span className="text-xs text-zinc-400">PNG, JPG, GIF o WebP · máx. 5 MB · se recomienda &lt; 200 KB</span>
        <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden onChange={(e) => e.target.files && doUpload(e.target.files)} />
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="grid grid-cols-3 gap-2">
        {loading && !files.length && <p className="col-span-3 text-xs text-zinc-400">Cargando…</p>}
        {!loading && !files.length && <p className="col-span-3 text-xs text-zinc-400">Aún no hay imágenes subidas.</p>}
        {files.map((f) => (
          <div key={f.name} className={`group relative overflow-hidden rounded-md border bg-[repeating-conic-gradient(#f4f4f5_0_25%,#fff_0_50%)] bg-[length:16px_16px] ${selected === f.url ? "border-brand-500 ring-2 ring-brand-500/30" : "border-zinc-200"}`}>
            <button type="button" className="block aspect-square w-full" onClick={() => onPick(f.url)} title={`${f.name} · ${(f.size / 1024).toFixed(0)} KB`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={f.url} alt={f.name} className="h-full w-full object-contain" />
            </button>
            <span className={`absolute bottom-0 left-0 right-0 bg-black/60 px-1 text-[10px] ${f.size > 200 * 1024 ? "text-amber-300" : "text-white"}`}>{(f.size / 1024).toFixed(0)} KB</span>
            <button type="button" className="absolute right-1 top-1 hidden rounded bg-white/90 px-1 text-xs text-red-600 group-hover:block" onClick={() => remove(f.name)} title="Eliminar">
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Campo de imagen: miniatura + URL + botón para abrir la biblioteca. */
export function ImageField({ label, value, onChange }: { label: string; value: string; onChange: (url: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-1 text-xs">
      <span className="font-medium text-zinc-700">{label}</span>
      {value && (
        <div className="flex h-24 items-center justify-center overflow-hidden rounded-md border border-zinc-200 bg-[repeating-conic-gradient(#f4f4f5_0_25%,#fff_0_50%)] bg-[length:16px_16px]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value} alt="" className="max-h-full max-w-full object-contain" />
        </div>
      )}
      <div className="flex gap-1">
        <input className={inputCls} value={value} placeholder="https://… o suba una imagen" onChange={(e) => onChange(e.target.value.trim())} />
        <Btn onClick={() => setOpen(true)} title="Subir o elegir de la biblioteca">🖼</Btn>
      </div>
      {open && (
        <Modal title="Imágenes" onClose={() => setOpen(false)}>
          <div className="p-5">
            <ImageLibrary
              selected={value}
              onPick={(url) => {
                onChange(url);
                setOpen(false);
              }}
            />
          </div>
        </Modal>
      )}
    </div>
  );
}
