import "server-only";

import type { Project } from "@/lib/email/types";
import type { SafeUser } from "./auth";

export interface GoVerifiedMcpToken {
  valid: boolean;
  tokenId: string;
  user: SafeUser & { company?: string; active?: boolean };
  scopes: string[];
  expiresAt?: string | null;
}

export interface GoAuthContext {
  /** Encabezado Cookie original del navegador (para llamadas desde rutas /api de Next.js). */
  cookieHeader?: string;
  /** Token Bearer explícito (p. ej. token MCP misiva_mcp_... o token de sesión). */
  bearerToken?: string;
}

export function goBackendUrl(): string {
  return (process.env.GO_BACKEND_URL ?? "").trim().replace(/\/+$/, "");
}

export function goBackendEnabled(): boolean {
  return goBackendUrl().length > 0;
}

function buildAuthHeaders(auth?: GoAuthContext, extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  if (auth?.bearerToken) {
    headers.Authorization = `Bearer ${auth.bearerToken}`;
  } else if (auth?.cookieHeader) {
    headers.Cookie = auth.cookieHeader;
  }
  return headers;
}

export function authContextFromRequest(request: Request): GoAuthContext {
  const authorization = request.headers.get("authorization") ?? "";
  if (authorization.startsWith("Bearer ")) {
    return { bearerToken: authorization.slice(7).trim() };
  }
  const cookie = request.headers.get("cookie") ?? "";
  return cookie ? { cookieHeader: cookie } : {};
}

/**
 * Reenvía una petición desde un Route Handler de Next.js al backend en Go,
 * preservando cookies de sesión, cabeceras de cliente y respuestas Set-Cookie.
 */
export async function proxyToGoBackend(
  request: Request,
  path: string,
  init?: { method?: string; body?: string | null },
): Promise<Response> {
  const base = goBackendUrl();
  if (!base) {
    return Response.json({ error: "GO_BACKEND_URL no está configurada." }, { status: 503 });
  }

  const method = init?.method ?? request.method;
  const headers = new Headers();
  const forwardNames = ["cookie", "authorization", "content-type", "user-agent", "x-forwarded-for", "x-forwarded-proto"];
  for (const name of forwardNames) {
    const val = request.headers.get(name);
    if (val) headers.set(name, val);
  }

  const hasBody = method !== "GET" && method !== "HEAD";
  const body = init?.body !== undefined ? init.body : hasBody ? await request.text() : undefined;

  let upstream: Response;
  try {
    upstream = await fetch(`${base}${path}`, {
      method,
      headers,
      body: hasBody ? body : undefined,
      cache: "no-store",
    });
  } catch {
    return Response.json(
      { error: "No se pudo conectar con el backend de autenticación en Go. Verifique que esté ejecutándose." },
      { status: 502 },
    );
  }

  const responseHeaders = new Headers({
    "Content-Type": upstream.headers.get("content-type") ?? "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  const setCookies = upstream.headers.getSetCookie?.() ?? [];
  for (const cookie of setCookies) {
    responseHeaders.append("Set-Cookie", cookie);
  }
  if (setCookies.length === 0) {
    const singleCookie = upstream.headers.get("set-cookie");
    if (singleCookie) responseHeaders.set("Set-Cookie", singleCookie);
  }

  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: responseHeaders,
  });
}

export async function verifyGoMcpToken(rawToken: string): Promise<GoVerifiedMcpToken | null> {
  const base = goBackendUrl();
  if (!base || !rawToken) return null;
  try {
    const res = await fetch(`${base}/api/v1/mcp/verify`, {
      method: "POST",
      headers: { Authorization: `Bearer ${rawToken}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as GoVerifiedMcpToken;
    return data.valid ? data : null;
  } catch {
    return null;
  }
}

export async function getGoRequestUser(request: Request): Promise<(SafeUser & { company?: string }) | null> {
  const base = goBackendUrl();
  if (!base) return null;
  try {
    const res = await fetch(`${base}/api/v1/auth/session`, {
      headers: buildAuthHeaders(authContextFromRequest(request)),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { authenticated?: boolean; user?: (SafeUser & { company?: string }) | null };
    return data.authenticated && data.user ? data.user : null;
  } catch {
    return null;
  }
}

export async function goListProjects(auth: GoAuthContext): Promise<Project[]> {
  const res = await fetch(`${goBackendUrl()}/api/v1/projects`, {
    headers: buildAuthHeaders(auth),
    cache: "no-store",
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `Error consultando proyectos (${res.status}).`);
  }
  const data = (await res.json()) as { projects?: Project[] };
  return data.projects ?? [];
}

export async function goGetProject(id: string, auth: GoAuthContext): Promise<Project | null> {
  const res = await fetch(`${goBackendUrl()}/api/v1/projects/${encodeURIComponent(id)}`, {
    headers: buildAuthHeaders(auth),
    cache: "no-store",
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `Error leyendo el proyecto ${id} (${res.status}).`);
  }
  const data = (await res.json()) as { project?: Project };
  return data.project ?? null;
}

export async function goSaveProject(
  project: Project,
  auth: GoAuthContext,
  expectedUpdatedAt?: number,
): Promise<Project> {
  const res = await fetch(`${goBackendUrl()}/api/v1/projects`, {
    method: "PUT",
    headers: buildAuthHeaders(auth, { "Content-Type": "application/json" }),
    body: JSON.stringify({
      ...project,
      ...(expectedUpdatedAt !== undefined ? { expectedUpdatedAt } : {}),
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `No se pudo guardar el proyecto (${res.status}).`);
  }
  const data = (await res.json()) as { project: Project };
  return data.project;
}

export async function goDeleteProject(id: string, auth: GoAuthContext): Promise<boolean> {
  const res = await fetch(`${goBackendUrl()}/api/v1/projects/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: buildAuthHeaders(auth),
    cache: "no-store",
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `No se pudo eliminar el proyecto (${res.status}).`);
  }
  const data = (await res.json()) as { deleted?: boolean };
  return Boolean(data.deleted);
}

export async function goListAssets(auth: GoAuthContext): Promise<{ name: string; size: number; mediaType: string }[]> {
  const res = await fetch(`${goBackendUrl()}/api/v1/assets`, {
    headers: buildAuthHeaders(auth),
    cache: "no-store",
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { assets?: { name: string; size: number; mediaType: string }[] };
  return data.assets ?? [];
}

export async function goRegisterAsset(
  asset: { name: string; size: number; mediaType: string },
  auth: GoAuthContext,
): Promise<void> {
  await fetch(`${goBackendUrl()}/api/v1/assets`, {
    method: "POST",
    headers: buildAuthHeaders(auth, { "Content-Type": "application/json" }),
    body: JSON.stringify(asset),
    cache: "no-store",
  });
}

export async function goDeleteAsset(name: string, auth: GoAuthContext): Promise<boolean> {
  const res = await fetch(`${goBackendUrl()}/api/v1/assets/${encodeURIComponent(name)}`, {
    method: "DELETE",
    headers: buildAuthHeaders(auth),
    cache: "no-store",
  });
  return res.ok;
}
