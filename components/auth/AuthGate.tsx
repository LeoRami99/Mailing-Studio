"use client";

import { useEffect, useState } from "react";
import { LuCircleAlert, LuLoaderCircle, LuLockKeyhole, LuMail, LuShieldCheck, LuUserRound } from "react-icons/lu";
import Editor from "@/components/editor/Editor";
import { inputCls } from "@/components/editor/fields";

export type AuthUser = { id: string; name: string; email: string; role: "member" | "admin" };
type SessionState = { authRequired: boolean; authenticated: boolean; user: AuthUser | null };

export default function AuthGate() {
  const [session, setSession] = useState<SessionState | null>(null);
  const [loadError, setLoadError] = useState("");

  const fetchSession = async () => {
    const response = await fetch("/api/auth/session", { cache: "no-store" });
    if (!response.ok) throw new Error("No se pudo conectar con PostgreSQL.");
    return response.json() as Promise<SessionState>;
  };

  const load = async () => {
    setLoadError("");
    try {
      setSession(await fetchSession());
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "No se pudo comprobar la sesión.");
    }
  };

  useEffect(() => {
    let active = true;
    void fetchSession()
      .then((value) => { if (active) setSession(value); })
      .catch((error: unknown) => { if (active) setLoadError(error instanceof Error ? error.message : "No se pudo comprobar la sesión."); });
    return () => { active = false; };
  }, []);

  if (loadError) return <AuthStatus message={loadError} action={load} />;
  if (!session) return <AuthStatus message="Comprobando sesión segura…" loading />;
  if (session.authRequired && !session.authenticated) return <AuthScreen onAuthenticated={(user) => setSession({ ...session, authenticated: true, user })} />;
  return <Editor user={session.authRequired ? session.user : null} onSignedOut={() => setSession({ ...session, authenticated: false, user: null })} />;
}

function AuthStatus({ message, loading, action }: { message: string; loading?: boolean; action?: () => void }) {
  return (
    <main className="misiva-shell flex min-h-screen items-center justify-center p-6">
      <div className="workspace-panel flex max-w-sm flex-col items-center rounded-2xl p-7 text-center">
        {loading ? <LuLoaderCircle className="mb-3 h-7 w-7 animate-spin text-brand-600" aria-hidden /> : <LuCircleAlert className="mb-3 h-7 w-7 text-amber-600" aria-hidden />}
        <p className="text-sm text-zinc-600">{message}</p>
        {action && <button type="button" onClick={action} className="mt-4 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white">Reintentar</button>}
      </div>
    </main>
  );
}

function AuthScreen({ onAuthenticated }: { onAuthenticated: (user: AuthUser) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });
      const result = await response.json() as { user?: AuthUser; error?: string };
      if (!response.ok || !result.user) throw new Error(result.error || "No se pudo iniciar la sesión.");
      onAuthenticated(result.user);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo continuar.");
    } finally {
      setBusy(false);
    }
  };

  const changeMode = (next: "login" | "register") => {
    setMode(next);
    setError("");
    setPassword("");
  };

  return (
    <main className="misiva-shell flex min-h-screen items-center justify-center p-3 sm:p-8">
      <section className="grid w-full max-w-5xl overflow-hidden rounded-[28px] border border-white/80 bg-white/90 shadow-[0_30px_100px_rgba(6,32,21,0.2)] md:grid-cols-[0.92fr_1.08fr]">
        <div className="relative hidden min-h-[620px] overflow-hidden bg-[#050806] p-10 text-white md:flex md:flex-col">
          <div className="absolute -left-24 top-10 h-72 w-72 rounded-full bg-[#00e878]/20 blur-3xl" />
          <div className="absolute -right-16 bottom-4 h-80 w-80 rounded-full bg-[#c8ff00]/20 blur-3xl" />
          <div className="relative flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/icon.svg" alt="" className="h-11 w-11 rounded-xl" />
            <span className="text-xl font-extrabold tracking-tight">misiva<span className="text-[#c8ff00]">.</span></span>
          </div>
          <div className="relative my-auto max-w-sm">
            <div className="mb-7 inline-flex rounded-2xl border border-white/10 bg-white/5 p-4 shadow-[0_0_45px_rgba(0,232,120,0.18)] backdrop-blur-xl">
              <LuShieldCheck className="h-8 w-8 text-[#c8ff00]" aria-hidden />
            </div>
            <h1 className="text-4xl font-semibold leading-[1.08] tracking-[-0.04em]">Sus campañas y agentes, bajo la misma identidad.</h1>
            <p className="mt-5 max-w-[38ch] text-sm leading-6 text-white/60">Cada cuenta mantiene separados sus proyectos y controla qué asistentes pueden acceder mediante tokens MCP revocables.</p>
          </div>
          <p className="relative text-xs text-white/35">Desarrollado con Claude y Codex por Zegiru Labs</p>
        </div>

        <div className="flex min-h-[600px] items-center p-6 sm:p-12 lg:p-16">
          <div className="mx-auto w-full max-w-sm">
            <div className="mb-8 md:hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/icon.svg" alt="Misiva" className="h-12 w-12 rounded-xl" />
            </div>
            <p className="text-sm font-semibold text-brand-700">{mode === "login" ? "Bienvenido de nuevo" : "Crear una cuenta"}</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-[-0.035em] text-zinc-950">{mode === "login" ? "Ingrese a Misiva" : "Prepare su espacio seguro"}</h2>
            <p className="mt-2 text-sm leading-6 text-zinc-500">{mode === "login" ? "Use el correo y la contraseña de su cuenta." : "Podrá crear sus tokens MCP después de registrarse."}</p>

            <form className="mt-8 flex flex-col gap-4" onSubmit={submit}>
              {mode === "register" && <AuthField icon={<LuUserRound aria-hidden />} label="Nombre" type="text" autoComplete="name" value={name} onChange={setName} placeholder="Su nombre" />}
              <AuthField icon={<LuMail aria-hidden />} label="Correo" type="email" autoComplete="email" value={email} onChange={setEmail} placeholder="nombre@empresa.com" />
              <AuthField icon={<LuLockKeyhole aria-hidden />} label="Contraseña" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={setPassword} placeholder={mode === "register" ? "Mínimo 12 caracteres" : "Su contraseña"} />
              {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">{error}</p>}
              <button disabled={busy} className="mt-2 inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-brand-500 to-brand-600 px-4 py-3 text-sm font-semibold text-white shadow-[0_8px_24px_rgba(0,143,85,0.25)] transition hover:-translate-y-px hover:shadow-[0_12px_30px_rgba(0,143,85,0.3)] disabled:opacity-50">
                {busy && <LuLoaderCircle className="animate-spin" aria-hidden />}
                {mode === "login" ? "Iniciar sesión" : "Crear cuenta"}
              </button>
            </form>

            <p className="mt-7 text-center text-sm text-zinc-500">
              {mode === "login" ? "¿Aún no tiene cuenta?" : "¿Ya tiene una cuenta?"}{" "}
              <button type="button" className="font-semibold text-brand-700 hover:underline" onClick={() => changeMode(mode === "login" ? "register" : "login")}>
                {mode === "login" ? "Registrarse" : "Iniciar sesión"}
              </button>
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}

function AuthField({ icon, label, value, onChange, ...props }: { icon: React.ReactNode; label: string; value: string; onChange: (value: string) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  return (
    <label className="flex flex-col gap-1.5 text-sm font-medium text-zinc-700">
      {label}
      <span className="relative">
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-zinc-400">{icon}</span>
        <input {...props} required className={`${inputCls} py-2.5 pl-10`} value={value} onChange={(event) => onChange(event.target.value)} />
      </span>
    </label>
  );
}
