"use client";

import { useEffect, useState } from "react";
import {
  LuCheck,
  LuCopy,
  LuKeyRound,
  LuLaptop,
  LuLogOut,
  LuPlus,
  LuShieldCheck,
  LuTrash2,
  LuUserCog,
  LuUsers,
} from "react-icons/lu";
import type { AuthUser } from "./AuthGate";
import { Btn, inputCls, Modal } from "@/components/editor/fields";

type TokenInfo = {
  id: string;
  name: string;
  prefix: string;
  scopes?: string[];
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt?: string | null;
};

type SessionItem = {
  id: string;
  userAgent: string;
  ipAddress?: string;
  createdAt: string;
  lastSeenAt: string;
  current?: boolean;
};

type AdminUserItem = AuthUser & {
  projectCount: number;
  activeSessions: number;
  activeTokens: number;
  createdAt: string;
};

const AVAILABLE_SCOPES = [
  { id: "projects:read", label: "Leer proyectos" },
  { id: "projects:write", label: "Crear y editar mailings" },
  { id: "projects:delete", label: "Eliminar proyectos" },
  { id: "assets:read", label: "Ver biblioteca de imágenes" },
];

export function AccountModal({
  user,
  authBackend,
  onUserUpdated,
  onClose,
  onSignedOut,
}: {
  user: AuthUser;
  authBackend?: string;
  onUserUpdated?: (user: AuthUser) => void;
  onClose: () => void;
  onSignedOut: () => void;
}) {
  const [tab, setTab] = useState<"mcp" | "profile" | "users">("mcp");

  // Estado Tokens MCP
  const [tokens, setTokens] = useState<TokenInfo[]>([]);
  const [tokenName, setTokenName] = useState("Claude / Cursor");
  const [selectedScopes, setSelectedScopes] = useState<string[]>(["projects:read", "projects:write", "assets:read"]);
  const [expiresDays, setExpiresDays] = useState<string>("90");
  const [newToken, setNewToken] = useState("");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [mcpError, setMcpError] = useState("");
  const [busy, setBusy] = useState(false);

  // Estado Perfil y Sesiones
  const [profileName, setProfileName] = useState(user.name);
  const [profileEmail, setProfileEmail] = useState(user.email);
  const [profileCompany, setProfileCompany] = useState(user.company ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [profileMsg, setProfileMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [sessions, setSessions] = useState<SessionItem[]>([]);

  // Estado Administración de Usuarios
  const [adminUsers, setAdminUsers] = useState<AdminUserItem[]>([]);
  const [adminError, setAdminError] = useState("");

  const fetchTokens = async () => {
    const response = await fetch("/api/auth/tokens", { cache: "no-store" });
    return response.ok ? ((await response.json()) as { tokens: TokenInfo[] }).tokens : [];
  };

  const fetchSessions = async () => {
    const response = await fetch("/api/auth/sessions", { cache: "no-store" });
    return response.ok ? ((await response.json()) as { sessions: SessionItem[] }).sessions : [];
  };

  const fetchAdminUsers = async () => {
    const response = await fetch("/api/users", { cache: "no-store" });
    if (!response.ok) return [];
    return ((await response.json()) as { users: AdminUserItem[] }).users ?? [];
  };

  useEffect(() => {
    let active = true;
    void fetchTokens().then((value) => { if (active) setTokens(value); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    if (tab === "profile") {
      void fetchSessions().then((value) => { if (active) setSessions(value); });
    } else if (tab === "users" && user.role === "admin") {
      void fetchAdminUsers().then((value) => { if (active) setAdminUsers(value); });
    }
    return () => { active = false; };
  }, [tab, user.role]);

  const toggleScope = (scope: string) => {
    setSelectedScopes((prev) =>
      prev.includes(scope) ? (prev.length > 1 ? prev.filter((s) => s !== scope) : prev) : [...prev, scope],
    );
  };

  const createToken = async () => {
    setBusy(true);
    setMcpError("");
    setNewToken("");
    const days = Number(expiresDays);
    const response = await fetch("/api/auth/tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: tokenName,
        scopes: selectedScopes,
        ...(days > 0 ? { expiresInDays: days } : {}),
      }),
    });
    const result = (await response.json()) as { token?: string; error?: string };
    setBusy(false);
    if (!response.ok || !result.token) return setMcpError(result.error || "No se pudo crear el token.");
    setNewToken(result.token);
    setTokens(await fetchTokens());
  };

  const revokeToken = async (id: string) => {
    await fetch("/api/auth/tokens", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setTokens((current) => current.filter((token) => token.id !== id));
  };

  const copyText = async (key: string, value: string) => {
    await navigator.clipboard.writeText(value);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1600);
  };

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setProfileMsg(null);
    const res = await fetch("/api/auth/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: profileName, email: profileEmail, company: profileCompany }),
    });
    const data = (await res.json()) as { user?: AuthUser; error?: string };
    setBusy(false);
    if (!res.ok || !data.user) {
      setProfileMsg({ ok: false, text: data.error || "No se pudo actualizar el perfil." });
      return;
    }
    onUserUpdated?.(data.user);
    setProfileMsg({ ok: true, text: "Perfil actualizado correctamente." });
  };

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setProfileMsg(null);
    const res = await fetch("/api/auth/me", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const data = (await res.json()) as { ok?: boolean; error?: string };
    setBusy(false);
    if (!res.ok) {
      setProfileMsg({ ok: false, text: data.error || "No se pudo cambiar la contraseña." });
      return;
    }
    setCurrentPassword("");
    setNewPassword("");
    setSessions(await fetchSessions());
    setProfileMsg({ ok: true, text: "Contraseña actualizada y demás sesiones cerradas." });
  };

  const revokeSession = async (id?: string) => {
    await fetch(`/api/auth/sessions${id ? `?id=${encodeURIComponent(id)}` : ""}`, { method: "DELETE" });
    setSessions(await fetchSessions());
  };

  const updateAdminUser = async (id: string, patch: { role?: string; active?: boolean }) => {
    setAdminError("");
    const res = await fetch("/api/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...patch }),
    });
    const data = (await res.json()) as { error?: string };
    if (!res.ok) {
      setAdminError(data.error || "No se pudo actualizar el usuario.");
      return;
    }
    setAdminUsers(await fetchAdminUsers());
  };

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    onSignedOut();
  };

  const mcpEndpoint = typeof location !== "undefined" ? `${location.origin}/mcp` : "http://localhost:3000/mcp";
  const sampleHttpConfig = JSON.stringify(
    {
      mcpServers: {
        misiva: {
          url: mcpEndpoint,
          headers: { Authorization: `Bearer ${newToken || "SU_TOKEN_MCP"}` },
        },
      },
    },
    null,
    2,
  );

  return (
    <Modal
      title="Cuenta, Seguridad y Acceso MCP"
      onClose={onClose}
      footer={
        <Btn variant="danger" onClick={logout}>
          <LuLogOut aria-hidden /> Cerrar sesión
        </Btn>
      }
    >
      <div className="flex flex-col gap-5 p-4 sm:p-5">
        <div className="flex items-center gap-3 rounded-2xl border border-brand-100 bg-brand-50/70 p-4">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-700 font-bold text-white">
            {user.name.slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="truncate font-semibold text-zinc-900">{user.name}</p>
              <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-800">
                {user.role === "admin" ? "Admin" : "Miembro"}
              </span>
            </div>
            <p className="truncate text-sm text-zinc-500">
              {user.email}
              {user.company ? ` · ${user.company}` : ""}
            </p>
          </div>
          <LuShieldCheck className="ml-auto h-5 w-5 shrink-0 text-brand-600" aria-label="Sesión protegida" />
        </div>

        {/* Pestañas */}
        <div className="flex gap-1 rounded-xl bg-zinc-100 p-1 text-xs font-semibold">
          <button
            type="button"
            onClick={() => setTab("mcp")}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 transition ${tab === "mcp" ? "bg-white text-brand-800 shadow-xs" : "text-zinc-600 hover:text-zinc-900"}`}
          >
            <LuKeyRound aria-hidden /> Acceso MCP
          </button>
          <button
            type="button"
            onClick={() => setTab("profile")}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 transition ${tab === "profile" ? "bg-white text-brand-800 shadow-xs" : "text-zinc-600 hover:text-zinc-900"}`}
          >
            <LuUserCog aria-hidden /> Perfil y sesiones
          </button>
          {user.role === "admin" && authBackend === "go" && (
            <button
              type="button"
              onClick={() => setTab("users")}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 transition ${tab === "users" ? "bg-white text-brand-800 shadow-xs" : "text-zinc-600 hover:text-zinc-900"}`}
            >
              <LuUsers aria-hidden /> Usuarios
            </button>
          )}
        </div>

        {tab === "mcp" && (
          <section className="flex flex-col gap-3">
            <div>
              <h3 className="text-sm font-semibold text-zinc-900">Tokens personales MCP</h3>
              <p className="mt-0.5 text-xs leading-5 text-zinc-500">
                Conecte Claude, Cursor, Windsurf o cualquier cliente MCP con permisos controlados por token.
              </p>
            </div>

            <div className="grid gap-2 sm:grid-cols-[1fr_130px_auto]">
              <input
                className={inputCls}
                value={tokenName}
                onChange={(e) => setTokenName(e.target.value)}
                placeholder="Nombre del cliente (ej. Claude Desktop)"
              />
              <select className={inputCls} value={expiresDays} onChange={(e) => setExpiresDays(e.target.value)} aria-label="Caducidad">
                <option value="30">30 días</option>
                <option value="90">90 días</option>
                <option value="365">1 año</option>
                <option value="0">Sin expiración</option>
              </select>
              <Btn variant="primary" onClick={createToken} disabled={busy}>
                <LuPlus aria-hidden /> Crear
              </Btn>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {AVAILABLE_SCOPES.map((sc) => {
                const checked = selectedScopes.includes(sc.id);
                return (
                  <button
                    key={sc.id}
                    type="button"
                    onClick={() => toggleScope(sc.id)}
                    className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium transition ${
                      checked
                        ? "border-brand-300 bg-brand-50 text-brand-800"
                        : "border-zinc-200 bg-white text-zinc-500 hover:border-zinc-300"
                    }`}
                  >
                    {checked ? "✓ " : ""}{sc.label}
                  </button>
                );
              })}
            </div>

            {mcpError && <p className="text-sm text-red-600">{mcpError}</p>}

            {newToken && (
              <div className="rounded-xl border border-lime-300 bg-lime-50 p-3">
                <p className="text-xs font-semibold text-lime-900">Copie este token ahora. Por seguridad no volverá a mostrarse.</p>
                <div className="mt-2 flex items-center gap-2">
                  <code className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap rounded-lg bg-white px-2.5 py-2 text-xs text-zinc-800">
                    {newToken}
                  </code>
                  <Btn onClick={() => void copyText("token", newToken)}>
                    {copiedKey === "token" ? <LuCheck aria-hidden /> : <LuCopy aria-hidden />}
                    {copiedKey === "token" ? "Copiado" : "Copiar"}
                  </Btn>
                </div>
              </div>
            )}

            <div className="overflow-hidden rounded-xl border border-zinc-200/80 bg-white/70">
              {tokens.length === 0 ? (
                <p className="p-4 text-center text-sm text-zinc-500">Todavía no hay tokens MCP activos.</p>
              ) : (
                tokens.map((token) => (
                  <div key={token.id} className="flex items-center gap-3 border-b border-zinc-100 px-3 py-2.5 last:border-0">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-zinc-800">{token.name}</p>
                      <p className="font-mono text-[11px] text-zinc-400">
                        {token.prefix}… · {token.lastUsedAt ? `Usado ${new Date(token.lastUsedAt).toLocaleDateString("es")}` : "Sin uso"}
                        {token.scopes?.length ? ` · [${token.scopes.join(", ")}]` : ""}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void revokeToken(token.id)}
                      className="rounded-lg p-2 text-zinc-400 transition hover:bg-red-50 hover:text-red-600"
                      aria-label={`Revocar ${token.name}`}
                    >
                      <LuTrash2 aria-hidden />
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="rounded-xl bg-zinc-100/85 p-3 text-xs text-zinc-600">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-zinc-800">Configuración rápida MCP (Streamable HTTP)</span>
                <button
                  type="button"
                  onClick={() => void copyText("cfg", sampleHttpConfig)}
                  className="inline-flex items-center gap-1 font-semibold text-brand-700 hover:underline"
                >
                  {copiedKey === "cfg" ? <LuCheck aria-hidden /> : <LuCopy aria-hidden />}
                  {copiedKey === "cfg" ? "JSON copiado" : "Copiar JSON"}
                </button>
              </div>
              <pre className="mt-2 overflow-x-auto rounded-lg bg-zinc-900 p-2.5 font-mono text-[11px] text-emerald-300">
                {sampleHttpConfig}
              </pre>
            </div>
          </section>
        )}

        {tab === "profile" && (
          <section className="flex flex-col gap-5">
            {profileMsg && (
              <p className={`rounded-xl border px-3 py-2 text-xs font-medium ${profileMsg.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-700"}`}>
                {profileMsg.text}
              </p>
            )}
            <form onSubmit={saveProfile} className="flex flex-col gap-3">
              <h3 className="text-sm font-semibold text-zinc-900">Datos de la cuenta</h3>
              <div className="grid gap-2.5 sm:grid-cols-2">
                <input className={inputCls} value={profileName} onChange={(e) => setProfileName(e.target.value)} placeholder="Nombre" required />
                <input className={inputCls} type="email" value={profileEmail} onChange={(e) => setProfileEmail(e.target.value)} placeholder="Correo" required />
              </div>
              {authBackend === "go" && (
                <input className={inputCls} value={profileCompany} onChange={(e) => setProfileCompany(e.target.value)} placeholder="Empresa o equipo" />
              )}
              <div>
                <Btn variant="primary" disabled={busy}>Guardar perfil</Btn>
              </div>
            </form>

            <form onSubmit={changePassword} className="flex flex-col gap-3 border-t border-zinc-200/70 pt-4">
              <h3 className="text-sm font-semibold text-zinc-900">Cambiar contraseña</h3>
              <div className="grid gap-2.5 sm:grid-cols-2">
                <input className={inputCls} type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder="Contraseña actual" required />
                <input className={inputCls} type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Nueva contraseña (mín. 12)" required />
              </div>
              <div>
                <Btn disabled={busy}>Actualizar contraseña</Btn>
              </div>
            </form>

            <div className="border-t border-zinc-200/70 pt-4">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="flex items-center gap-1.5 text-sm font-semibold text-zinc-900">
                  <LuLaptop aria-hidden /> Sesiones activas ({sessions.length})
                </h3>
                {sessions.length > 1 && (
                  <button type="button" onClick={() => void revokeSession()} className="text-xs font-semibold text-red-600 hover:underline">
                    Cerrar demás sesiones
                  </button>
                )}
              </div>
              <div className="overflow-hidden rounded-xl border border-zinc-200/80 bg-white/70">
                {sessions.map((s) => (
                  <div key={s.id} className="flex items-center gap-3 border-b border-zinc-100 px-3 py-2.5 text-xs last:border-0">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-zinc-800">
                        {s.userAgent || "Navegador / Cliente HTTP"}
                        {s.current && <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">Actual</span>}
                      </p>
                      <p className="text-zinc-400">
                        {s.ipAddress ? `${s.ipAddress} · ` : ""}Última actividad: {new Date(s.lastSeenAt).toLocaleString("es")}
                      </p>
                    </div>
                    {!s.current && (
                      <button
                        type="button"
                        onClick={() => void revokeSession(s.id)}
                        className="rounded-lg p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-600"
                        title="Cerrar esta sesión"
                      >
                        <LuTrash2 aria-hidden />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {tab === "users" && user.role === "admin" && (
          <section className="flex flex-col gap-3">
            <div>
              <h3 className="text-sm font-semibold text-zinc-900">Usuarios registrados ({adminUsers.length})</h3>
              <p className="text-xs text-zinc-500">Gestione roles y acceso de las cuentas en el servidor Go.</p>
            </div>
            {adminError && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{adminError}</p>}
            <div className="overflow-hidden rounded-xl border border-zinc-200/80 bg-white/70">
              {adminUsers.map((u) => (
                <div key={u.id} className="flex flex-wrap items-center gap-2 border-b border-zinc-100 px-3 py-2.5 text-xs last:border-0">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-zinc-800">
                      {u.name} {!u.active && <span className="ml-1 rounded bg-red-100 px-1.5 py-0.5 text-[10px] text-red-700">Suspendido</span>}
                    </p>
                    <p className="truncate text-zinc-500">
                      {u.email} · {u.projectCount} correo(s) · {u.activeTokens} token(s) MCP
                    </p>
                  </div>
                  <select
                    className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs"
                    value={u.role}
                    disabled={u.id === user.id}
                    onChange={(e) => void updateAdminUser(u.id, { role: e.target.value })}
                  >
                    <option value="member">Miembro</option>
                    <option value="admin">Admin</option>
                  </select>
                  {u.id !== user.id && (
                    <Btn onClick={() => void updateAdminUser(u.id, { active: !u.active })}>
                      {u.active ? "Suspender" : "Reactivar"}
                    </Btn>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </Modal>
  );
}
