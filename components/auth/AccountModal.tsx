"use client";

import { useEffect, useState } from "react";
import { LuCheck, LuCopy, LuKeyRound, LuLogOut, LuPlus, LuShieldCheck, LuTrash2 } from "react-icons/lu";
import type { AuthUser } from "./AuthGate";
import { Btn, inputCls, Modal } from "@/components/editor/fields";

type TokenInfo = { id: string; name: string; prefix: string; createdAt: string; lastUsedAt: string | null };

export function AccountModal({ user, onClose, onSignedOut }: { user: AuthUser; onClose: () => void; onSignedOut: () => void }) {
  const [tokens, setTokens] = useState<TokenInfo[]>([]);
  const [name, setName] = useState("Claude / Codex");
  const [newToken, setNewToken] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const fetchTokens = async () => {
    const response = await fetch("/api/auth/tokens", { cache: "no-store" });
    return response.ok ? ((await response.json()) as { tokens: TokenInfo[] }).tokens : [];
  };
  const loadTokens = async () => setTokens(await fetchTokens());
  useEffect(() => {
    let active = true;
    void fetchTokens().then((value) => { if (active) setTokens(value); });
    return () => { active = false; };
  }, []);

  const create = async () => {
    setBusy(true); setError(""); setNewToken("");
    const response = await fetch("/api/auth/tokens", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    const result = await response.json() as { token?: string; error?: string };
    setBusy(false);
    if (!response.ok || !result.token) return setError(result.error || "No se pudo crear el token.");
    setNewToken(result.token);
    await loadTokens();
  };

  const revoke = async (id: string) => {
    await fetch("/api/auth/tokens", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    setTokens((current) => current.filter((token) => token.id !== id));
  };

  const copy = async (value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(true); setTimeout(() => setCopied(false), 1500);
  };

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    onSignedOut();
  };

  return (
    <Modal title="Cuenta y acceso MCP" onClose={onClose} footer={<Btn variant="danger" onClick={logout}><LuLogOut aria-hidden /> Cerrar sesión</Btn>}>
      <div className="flex flex-col gap-6 p-4 sm:p-5">
        <div className="flex items-center gap-3 rounded-2xl border border-brand-100 bg-brand-50/70 p-4">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-700 font-bold text-white">{user.name.slice(0, 1).toUpperCase()}</div>
          <div className="min-w-0">
            <p className="truncate font-semibold text-zinc-900">{user.name}</p>
            <p className="truncate text-sm text-zinc-500">{user.email}</p>
          </div>
          <LuShieldCheck className="ml-auto h-5 w-5 text-brand-600" aria-label="Sesión protegida" />
        </div>

        <section>
          <div className="mb-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-900"><LuKeyRound aria-hidden /> Tokens MCP</h3>
            <p className="mt-1 text-xs leading-5 text-zinc-500">Use un token distinto por aplicación. El valor completo sólo aparece una vez y puede revocarlo en cualquier momento.</p>
          </div>
          <div className="flex gap-2">
            <input className={inputCls} value={name} onChange={(event) => setName(event.target.value)} placeholder="Nombre del cliente" />
            <Btn variant="primary" onClick={create} disabled={busy}><LuPlus aria-hidden /> Crear</Btn>
          </div>
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

          {newToken && (
            <div className="mt-3 rounded-xl border border-lime-300 bg-lime-50 p-3">
              <p className="text-xs font-semibold text-lime-900">Copie este token ahora. No volverá a mostrarse.</p>
              <div className="mt-2 flex items-center gap-2">
                <code className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap rounded-lg bg-white px-2 py-2 text-xs text-zinc-700">{newToken}</code>
                <Btn onClick={() => void copy(newToken)}>{copied ? <LuCheck aria-hidden /> : <LuCopy aria-hidden />}{copied ? "Copiado" : "Copiar"}</Btn>
              </div>
            </div>
          )}

          <div className="mt-4 overflow-hidden rounded-xl border border-zinc-200/80 bg-white/70">
            {tokens.length === 0 ? <p className="p-4 text-center text-sm text-zinc-500">Todavía no hay tokens MCP.</p> : tokens.map((token) => (
              <div key={token.id} className="flex items-center gap-3 border-b border-zinc-100 px-3 py-3 last:border-0">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-zinc-800">{token.name}</p>
                  <p className="font-mono text-[11px] text-zinc-400">{token.prefix}… · {token.lastUsedAt ? `Usado ${new Date(token.lastUsedAt).toLocaleDateString("es")}` : "Sin uso"}</p>
                </div>
                <button type="button" onClick={() => void revoke(token.id)} className="rounded-lg p-2 text-zinc-400 transition hover:bg-red-50 hover:text-red-600" aria-label={`Revocar ${token.name}`}><LuTrash2 aria-hidden /></button>
              </div>
            ))}
          </div>
          <div className="mt-3 rounded-xl bg-zinc-100/80 p-3 text-xs text-zinc-600">
            Endpoint MCP: <code className="font-mono text-zinc-800">{typeof location !== "undefined" ? `${location.origin}/mcp` : "/mcp"}</code><br />
            Encabezado: <code className="font-mono text-zinc-800">Authorization: Bearer SU_TOKEN</code>
          </div>
        </section>
      </div>
    </Modal>
  );
}
