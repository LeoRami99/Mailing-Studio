"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { EmailDoc, Project } from "@/lib/email/types";
import { cloneBlock, emptyDoc, TEMPLATES, uid } from "@/lib/email/defaults";
import { locate, useEmailStore } from "@/lib/email/store";
import { Canvas } from "./Canvas";
import { CodeEditor } from "./CodeEditor";
import { Inspector } from "./Inspector";
import { LeftPanel } from "./LeftPanel";
import { download, ExportModal, ImportModal, PreviewModal, ProjectsModal, slug, useValidation } from "./Modals";
import { Btn } from "./fields";

const KEY_PROJECTS = "mailing:projects";
const KEY_CURRENT = "mailing:current";

function loadProjects(): Project[] {
  try {
    return JSON.parse(localStorage.getItem(KEY_PROJECTS) ?? "[]");
  } catch {
    return [];
  }
}

export default function Editor() {
  const [ready, setReady] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentId, setCurrentId] = useState("");
  const [name, setName] = useState("Correo sin título");
  const store = useEmailStore(emptyDoc());
  const { doc, load } = store;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [darkCanvas, setDarkCanvas] = useState(false);
  const [modal, setModal] = useState<"preview" | "export" | "import" | "projects" | null>(null);
  const [saved, setSaved] = useState<"saved" | "saving" | "error">("saved");
  const issues = useValidation(doc);

  // Carga inicial desde localStorage
  useEffect(() => {
    const list = loadProjects();
    const cur = localStorage.getItem(KEY_CURRENT);
    let p = list.find((x) => x.id === cur) ?? list[0];
    if (!p) {
      p = { id: uid(), name: "Boletín de ejemplo", updatedAt: Date.now(), doc: TEMPLATES.find((t) => t.id === "newsletter")!.build() };
      list.push(p);
      localStorage.setItem(KEY_PROJECTS, JSON.stringify(list));
      localStorage.setItem(KEY_CURRENT, p.id);
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProjects(list);
    setCurrentId(p.id);
    setName(p.name);
    load(p.doc);
    setReady(true);
  }, [load]);

  // Guardado automático
  const firstSave = useRef(true);
  useEffect(() => {
    if (!ready) return;
    if (firstSave.current) {
      firstSave.current = false;
      return;
    }
     
    setSaved("saving");
    const t = setTimeout(() => {
      setProjects((prev) => {
        const next = prev.some((p) => p.id === currentId)
          ? prev.map((p) => (p.id === currentId ? { ...p, name, doc, updatedAt: Date.now() } : p))
          : [...prev, { id: currentId, name, doc, updatedAt: Date.now() }];
        try {
          localStorage.setItem(KEY_PROJECTS, JSON.stringify(next));
          localStorage.setItem(KEY_CURRENT, currentId);
          setSaved("saved");
        } catch {
          setSaved("error");
        }
        return next;
      });
    }, 500);
    return () => clearTimeout(t);
  }, [doc, name, currentId, ready]);

  const persist = (list: Project[], cur: string) => {
    setProjects(list);
    localStorage.setItem(KEY_PROJECTS, JSON.stringify(list));
    localStorage.setItem(KEY_CURRENT, cur);
  };

  const openProject = (id: string) => {
    const p = projects.find((x) => x.id === id);
    if (!p) return;
    setCurrentId(p.id);
    setName(p.name);
    load(p.doc);
    setSelectedId(null);
    localStorage.setItem(KEY_CURRENT, p.id);
    setModal(null);
  };

  const newProject = (d: EmailDoc, n = "Correo sin título") => {
    const p: Project = { id: uid(), name: n, updatedAt: Date.now(), doc: d };
    persist([...projects, p], p.id);
    setCurrentId(p.id);
    setName(n);
    load(d);
    setSelectedId(null);
    setModal(null);
  };

  // Atajos de teclado
  const onKey = useCallback(
    (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName);
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z" && !typing) {
        e.preventDefault();
        if (e.shiftKey) store.redo();
        else store.undo();
      } else if (mod && e.key.toLowerCase() === "y" && !typing) {
        e.preventDefault();
        store.redo();
      } else if (mod && e.key.toLowerCase() === "d" && selectedId && !typing) {
        e.preventDefault();
        const l = locate(store.doc, selectedId);
        if (!l) return;
        const copy = cloneBlock(l.list[l.index]);
        store.change((d) => {
          const x = locate(d, selectedId);
          x?.list.splice(x.index + 1, 0, copy);
        });
        setSelectedId(copy.id);
      } else if ((e.key === "Delete" || e.key === "Backspace") && selectedId && !typing) {
        e.preventDefault();
        store.change((d) => {
          const x = locate(d, selectedId);
          x?.list.splice(x.index, 1);
        });
        setSelectedId(null);
      } else if (e.key === "Escape" && !typing) {
        setSelectedId(null);
      }
    },
    [store, selectedId],
  );
  useEffect(() => {
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onKey]);

  const errors = issues.filter((i) => i.level === "error").length;
  const warnings = issues.filter((i) => i.level === "warning").length;

  if (!ready) {
    return <div className="flex h-screen flex-col items-center justify-center gap-3 text-sm text-zinc-400">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/icon.svg" alt="Misiva" width={56} height={56} className="animate-pulse" />
        Cargando editor…
      </div>;
  }

  return (
    <div className="flex h-screen flex-col bg-zinc-100 text-zinc-900">
      {/* Barra superior */}
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-zinc-200 bg-white px-3">
        <div className="flex items-center gap-2 pr-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/icon.svg" alt="" width={32} height={32} className="h-8 w-8" />
          <span className="hidden text-base font-extrabold tracking-tight text-brand-900 lg:inline">
            misiva<span className="text-lacre">.</span>
          </span>
        </div>
        <Btn variant="ghost" onClick={() => setModal("projects")} title="Mis correos y plantillas">☰ Correos</Btn>
        <input
          className="w-56 rounded-md border border-transparent px-2 py-1 text-sm font-medium hover:border-zinc-300 focus:border-brand-500 focus:outline-none"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="Nombre del correo"
        />
        <span className="text-xs text-zinc-400">{saved === "saving" ? "Guardando…" : saved === "error" ? "⚠ No se pudo guardar (almacenamiento lleno)" : "✓ Guardado"}</span>

        <div className="mx-auto flex items-center gap-1">
          <Btn variant="ghost" onClick={store.undo} disabled={!store.canUndo} title="Deshacer (Ctrl+Z)">↶</Btn>
          <Btn variant="ghost" onClick={store.redo} disabled={!store.canRedo} title="Rehacer (Ctrl+Shift+Z)">↷</Btn>
          <div className="mx-2 flex overflow-hidden rounded-md border border-zinc-300">
            <button type="button" className={`px-3 py-1 text-sm ${device === "desktop" ? "bg-zinc-800 text-white" : "bg-white"}`} onClick={() => setDevice("desktop")} title="Escritorio">🖥</button>
            <button type="button" className={`px-3 py-1 text-sm ${device === "mobile" ? "bg-zinc-800 text-white" : "bg-white"}`} onClick={() => setDevice("mobile")} title="Móvil">📱</button>
          </div>
          {doc.settings.darkMode && doc.mode === "visual" && (
            <Btn variant={darkCanvas ? "primary" : "ghost"} onClick={() => setDarkCanvas((x) => !x)} title="Ver fondos en modo oscuro">◐</Btn>
          )}
        </div>

        <Btn variant="ghost" onClick={() => setModal("import")}>⬆ Cargar</Btn>
        <Btn variant="ghost" onClick={() => download(`${slug(name)}.mailing.json`, JSON.stringify({ name, doc }, null, 2), "application/json")} title="Descargar el proyecto editable">💾 Proyecto</Btn>
        <Btn onClick={() => setModal("preview")}>👁 Vista previa</Btn>
        <Btn variant="primary" onClick={() => setModal("export")}>
          Exportar HTML
          {(errors > 0 || warnings > 0) && (
            <span className={`ml-1 rounded-full px-1.5 text-[11px] ${errors ? "bg-red-500" : "bg-amber-400 text-zinc-900"}`}>{errors || warnings}</span>
          )}
        </Btn>
      </header>

      <div className="flex min-h-0 flex-1">
        {doc.mode === "visual" ? (
          <>
            <aside className="w-72 shrink-0 border-r border-zinc-200 bg-white">
              <LeftPanel store={store} selectedId={selectedId} onSelect={setSelectedId} />
            </aside>
            <main className="min-w-0 flex-1 overflow-auto">
              <Canvas store={store} selectedId={selectedId} onSelect={setSelectedId} device={device} dark={darkCanvas} />
            </main>
            <aside className="w-80 shrink-0 overflow-y-auto border-l border-zinc-200 bg-white">
              <Inspector store={store} selectedId={selectedId} onSelect={setSelectedId} />
            </aside>
          </>
        ) : (
          <>
            <aside className="w-72 shrink-0 border-r border-zinc-200 bg-white">
              <LeftPanel store={store} selectedId={null} onSelect={() => {}} />
            </aside>
            <main className="min-w-0 flex-1">
              <CodeEditor store={store} device={device} />
            </main>
          </>
        )}
      </div>

      {modal === "preview" && <PreviewModal doc={doc} onClose={() => setModal(null)} />}
      {modal === "export" && <ExportModal doc={doc} name={name} onClose={() => setModal(null)} />}
      {modal === "import" && <ImportModal onClose={() => setModal(null)} onImport={(d, n) => newProject(d, n ?? "Correo importado")} />}
      {modal === "projects" && (
        <ProjectsModal
          projects={projects}
          currentId={currentId}
          onOpen={openProject}
          onNew={newProject}
          onDuplicate={(id) => {
            const p = projects.find((x) => x.id === id);
            if (p) newProject(structuredClone(p.doc), `${p.name} (copia)`);
          }}
          onDelete={(id) => {
            const rest = projects.filter((p) => p.id !== id);
            if (id === currentId) {
              const next = rest[0];
              if (next) {
                persist(rest, next.id);
                setCurrentId(next.id);
                setName(next.name);
                load(next.doc);
              } else {
                const p: Project = { id: uid(), name: "Correo sin título", updatedAt: Date.now(), doc: TEMPLATES[0].build() };
                persist([p], p.id);
                setCurrentId(p.id);
                setName(p.name);
                load(p.doc);
              }
              setSelectedId(null);
            } else {
              persist(rest, currentId);
            }
          }}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
