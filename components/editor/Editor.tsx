"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  LuCircleAlert,
  LuCircleCheck,
  LuDownload,
  LuEye,
  LuFileDown,
  LuMenu,
  LuMonitor,
  LuMoonStar,
  LuRedo2,
  LuSmartphone,
  LuUndo2,
  LuUpload,
  LuUserRound,
} from "react-icons/lu";
import type { AuthUser } from "@/components/auth/AuthGate";
import { AccountModal } from "@/components/auth/AccountModal";
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

export default function Editor({
  user,
  authBackend,
  onUserUpdated,
  onSignedOut,
}: {
  user: AuthUser | null;
  authBackend?: string;
  onUserUpdated?: (user: AuthUser) => void;
  onSignedOut: () => void;
}) {
  const [ready, setReady] = useState(false);
  const [serverStorage, setServerStorage] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentId, setCurrentId] = useState("");
  const [name, setName] = useState("Correo sin título");
  const store = useEmailStore(emptyDoc());
  const { doc, load } = store;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [darkCanvas, setDarkCanvas] = useState(false);
  const [modal, setModal] = useState<"preview" | "export" | "import" | "projects" | "account" | null>(null);
  const [saved, setSaved] = useState<"saved" | "saving" | "error">("saved");
  const issues = useValidation(doc);

  // En self-hosted los proyectos viven en el servidor; en web local/Electron,
  // el comportamiento histórico de localStorage se conserva.
  useEffect(() => {
    let cancelled = false;
    const initialize = async () => {
      let remote = false;
      let list: Project[] = [];
      try {
        const config = await fetch("/api/config", { cache: "no-store" }).then((res) => res.json()) as { projectStorage?: string };
        remote = config.projectStorage === "server";
        if (remote) {
          const result = await fetch("/api/projects", { cache: "no-store" }).then((res) => res.json()) as { projects?: Project[] };
          list = result.projects ?? [];
        } else {
          list = loadProjects();
        }
      } catch {
        list = loadProjects();
      }
      if (cancelled) return;

      const cur = localStorage.getItem(KEY_CURRENT);
      let p = list.find((item) => item.id === cur) ?? list[0];
      if (!p) {
        p = { id: uid(), name: "Boletín de ejemplo", updatedAt: Date.now(), doc: TEMPLATES.find((t) => t.id === "newsletter")!.build() };
        list.push(p);
        if (remote) {
          await fetch("/api/projects", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(p) });
        } else {
          localStorage.setItem(KEY_PROJECTS, JSON.stringify(list));
        }
      }
      localStorage.setItem(KEY_CURRENT, p.id);
      setServerStorage(remote);
      setProjects(list);
      setCurrentId(p.id);
      setName(p.name);
      load(p.doc);
      setReady(true);
    };
    void initialize();
    return () => { cancelled = true; };
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
          localStorage.setItem(KEY_CURRENT, currentId);
          if (serverStorage) {
            const project = next.find((item) => item.id === currentId)!;
            void fetch("/api/projects", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(project) })
              .then((res) => { if (!res.ok) throw new Error(); setSaved("saved"); })
              .catch(() => setSaved("error"));
          } else {
            localStorage.setItem(KEY_PROJECTS, JSON.stringify(next));
            setSaved("saved");
          }
        } catch {
          setSaved("error");
        }
        return next;
      });
    }, 500);
    return () => clearTimeout(t);
  }, [doc, name, currentId, ready, serverStorage]);

  const persist = (list: Project[], cur: string) => {
    setProjects(list);
    localStorage.setItem(KEY_CURRENT, cur);
    if (serverStorage) {
      const project = list.find((item) => item.id === cur);
      if (project) void fetch("/api/projects", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(project) });
    } else {
      localStorage.setItem(KEY_PROJECTS, JSON.stringify(list));
    }
  };

  const openProjects = async () => {
    if (serverStorage) {
      try {
        const result = await fetch("/api/projects", { cache: "no-store" }).then((res) => res.json()) as { projects?: Project[] };
        if (result.projects) setProjects(result.projects);
      } catch {
        // Se conserva la copia que ya está abierta si el servidor no responde.
      }
    }
    setModal("projects");
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
    return <div className="misiva-shell flex h-screen flex-col items-center justify-center gap-3 text-sm text-zinc-500">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/icon.svg" alt="Misiva" width={56} height={56} className="animate-pulse" />
        Cargando editor…
      </div>;
  }

  return (
    <div className="misiva-shell flex h-screen flex-col overflow-hidden text-zinc-900">
      {/* Barra superior */}
      <header className="glass-toolbar flex h-16 shrink-0 items-center gap-2 border-b px-3.5">
        <div className="flex items-center gap-2 pr-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/icon.svg" alt="" width={32} height={32} className="h-8 w-8" />
          <span className="hidden text-base font-extrabold tracking-tight text-brand-900 lg:inline">
            misiva<span className="text-lacre">.</span>
          </span>
        </div>
        <Btn variant="ghost" onClick={() => void openProjects()} title="Mis correos y plantillas"><LuMenu aria-hidden /> Correos</Btn>
        <input
          className="w-56 rounded-[10px] border border-transparent bg-white/25 px-2.5 py-1.5 text-sm font-semibold tracking-[-0.01em] transition hover:border-white/80 hover:bg-white/55 focus:border-brand-300 focus:bg-white/85 focus:outline-none focus:ring-4 focus:ring-brand-500/10"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="Nombre del correo"
        />
        <span className={`inline-flex items-center gap-1 rounded-full border border-white/60 bg-white/35 px-2 py-1 text-[11px] shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] ${saved === "error" ? "text-amber-700" : "text-zinc-500"}`}>
          {saved === "error" ? <LuCircleAlert aria-hidden /> : saved === "saved" ? <LuCircleCheck aria-hidden /> : null}
          {saved === "saving" ? "Guardando…" : saved === "error" ? "No se pudo guardar" : `Guardado${serverStorage ? " en servidor" : ""}`}
        </span>

        <div className="mx-auto flex items-center gap-1">
          <Btn variant="ghost" onClick={store.undo} disabled={!store.canUndo} title="Deshacer (Ctrl+Z)" className="px-2"><LuUndo2 aria-hidden /></Btn>
          <Btn variant="ghost" onClick={store.redo} disabled={!store.canRedo} title="Rehacer (Ctrl+Shift+Z)" className="px-2"><LuRedo2 aria-hidden /></Btn>
          <div className="mx-2 flex gap-0.5 rounded-[11px] border border-white/80 bg-zinc-200/55 p-0.5 shadow-[inset_0_1px_3px_rgba(24,24,27,0.08)]">
            <button type="button" className={`rounded-lg px-3 py-1.5 text-sm transition ${device === "desktop" ? "bg-white text-brand-700 shadow-[0_2px_7px_rgba(24,24,27,0.12)]" : "text-zinc-500 hover:text-zinc-900"}`} onClick={() => setDevice("desktop")} title="Escritorio"><LuMonitor aria-hidden /></button>
            <button type="button" className={`rounded-lg px-3 py-1.5 text-sm transition ${device === "mobile" ? "bg-white text-brand-700 shadow-[0_2px_7px_rgba(24,24,27,0.12)]" : "text-zinc-500 hover:text-zinc-900"}`} onClick={() => setDevice("mobile")} title="Móvil"><LuSmartphone aria-hidden /></button>
          </div>
          {doc.settings.darkMode && doc.mode === "visual" && (
            <Btn variant={darkCanvas ? "primary" : "ghost"} onClick={() => setDarkCanvas((x) => !x)} title="Ver fondos en modo oscuro" className="px-2"><LuMoonStar aria-hidden /></Btn>
          )}
        </div>

        <Btn variant="ghost" onClick={() => setModal("import")}><LuUpload aria-hidden /> Cargar</Btn>
        <Btn variant="ghost" onClick={() => download(`${slug(name)}.mailing.json`, JSON.stringify({ name, doc }, null, 2), "application/json")} title="Descargar el proyecto editable"><LuFileDown aria-hidden /> Proyecto</Btn>
        <Btn onClick={() => setModal("preview")}><LuEye aria-hidden /> Vista previa</Btn>
        <Btn variant="primary" onClick={() => setModal("export")}>
          <LuDownload aria-hidden /> Exportar HTML
          {(errors > 0 || warnings > 0) && (
            <span className={`ml-1 rounded-full px-1.5 text-[11px] ${errors ? "bg-red-500" : "bg-amber-400 text-zinc-900"}`}>{errors || warnings}</span>
          )}
        </Btn>
        {user && <Btn variant="ghost" onClick={() => setModal("account")} title={`Cuenta de ${user.name}`} className="px-2"><LuUserRound aria-hidden /></Btn>}
      </header>

      <div className="flex min-h-0 flex-1 gap-2.5 p-2.5 pt-2">
        {doc.mode === "visual" ? (
          <>
            <aside className="workspace-panel w-72 shrink-0 overflow-hidden rounded-[16px]">
              <LeftPanel store={store} selectedId={selectedId} onSelect={setSelectedId} />
            </aside>
            <main className="canvas-stage soft-scrollbar min-w-0 flex-1 overflow-auto rounded-[18px]">
              <Canvas store={store} selectedId={selectedId} onSelect={setSelectedId} device={device} dark={darkCanvas} />
            </main>
            <aside className="workspace-panel soft-scrollbar w-80 shrink-0 overflow-y-auto rounded-[16px]">
              <Inspector store={store} selectedId={selectedId} onSelect={setSelectedId} />
            </aside>
          </>
        ) : (
          <>
            <aside className="workspace-panel w-72 shrink-0 overflow-hidden rounded-[16px]">
              <LeftPanel store={store} selectedId={null} onSelect={() => {}} />
            </aside>
            <main className="workspace-panel min-w-0 flex-1 overflow-hidden rounded-[18px]">
              <CodeEditor store={store} device={device} />
            </main>
          </>
        )}
      </div>

      {modal === "preview" && <PreviewModal doc={doc} onClose={() => setModal(null)} />}
      {modal === "export" && <ExportModal doc={doc} name={name} onClose={() => setModal(null)} />}
      {modal === "import" && <ImportModal onClose={() => setModal(null)} onImport={(d, n) => newProject(d, n ?? "Correo importado")} />}
      {modal === "account" && user && (
        <AccountModal
          user={user}
          authBackend={authBackend}
          onUserUpdated={onUserUpdated}
          onClose={() => setModal(null)}
          onSignedOut={onSignedOut}
        />
      )}
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
            if (serverStorage) void fetch(`/api/projects?id=${encodeURIComponent(id)}`, { method: "DELETE" });
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
