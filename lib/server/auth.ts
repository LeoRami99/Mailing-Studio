import "server-only";

import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { hash as argonHash, verify as argonVerify } from "@node-rs/argon2";
import { databaseEnabled, query, transaction } from "./db";
import { getGoRequestUser, goBackendEnabled } from "./go-backend";

export const SESSION_COOKIE = "misiva_session";
const SESSION_DAYS = 30;
const PASSWORD_POLICY = { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1, outputLen: 32 } as const;

export type SafeUser = {
  id: string;
  name: string;
  email: string;
  company?: string;
  role: "member" | "admin";
  active?: boolean;
};

export type ApiTokenInfo = {
  id: string;
  name: string;
  prefix: string;
  scopes?: string[];
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt?: string | null;
};

const localUser: SafeUser = { id: "local", name: "Usuario local", email: "local@misiva", role: "admin" };
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");

export function authRequired() {
  return goBackendEnabled() || databaseEnabled();
}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export async function hashPassword(password: string) {
  return argonHash(password, PASSWORD_POLICY);
}

export async function verifyPassword(passwordHash: string, password: string) {
  try {
    return await argonVerify(passwordHash, password);
  } catch {
    return false;
  }
}

export async function createSession(userId: string, userAgent?: string | null) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await query(
    "INSERT INTO sessions (id, user_id, token_hash, user_agent, expires_at) VALUES ($1, $2, $3, $4, $5)",
    [randomUUID(), userId, digest(token), userAgent?.slice(0, 500) || null, expiresAt],
  );
  return { token, expiresAt };
}

export async function deleteSession(token: string | undefined) {
  if (!token || !databaseEnabled()) return;
  await query("DELETE FROM sessions WHERE token_hash = $1", [digest(token)]);
}

function cookieValue(request: Request, name: string) {
  const cookie = request.headers.get("cookie") ?? "";
  for (const part of cookie.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
}

export async function userFromSessionToken(token: string | undefined): Promise<SafeUser | null> {
  if (!databaseEnabled()) return localUser;
  if (!token) return null;
  const result = await query<SafeUser & { session_id: string }>(`
    SELECT u.id, u.name, u.email, u.role, s.id AS session_id
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = $1 AND s.expires_at > NOW()
  `, [digest(token)]);
  const row = result.rows[0];
  if (!row) return null;
  void query("UPDATE sessions SET last_seen_at = NOW() WHERE id = $1 AND last_seen_at < NOW() - INTERVAL '1 hour'", [row.session_id]);
  return { id: row.id, name: row.name, email: row.email, role: row.role };
}

export async function getRequestUser(request: Request): Promise<SafeUser | null> {
  if (goBackendEnabled()) {
    return getGoRequestUser(request);
  }
  return userFromSessionToken(cookieValue(request, SESSION_COOKIE));
}

export async function requireRequestUser(request: Request) {
  const user = await getRequestUser(request);
  return user ? { user } : { response: Response.json({ error: "Inicie sesión para continuar." }, { status: 401 }) };
}

function secureRequest(request: Request) {
  return (process.env.APP_ORIGIN || "").startsWith("https://") || request.headers.get("x-forwarded-proto") === "https" || new URL(request.url).protocol === "https:";
}

export function sessionCookie(token: string, expires: Date, request: Request) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Expires=${expires.toUTCString()}${secureRequest(request) ? "; Secure" : ""}; Priority=High`;
}

export function expiredSessionCookie(request: Request) {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureRequest(request) ? "; Secure" : ""}; Priority=High`;
}

export function trustedMutation(request: Request) {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const expected = process.env.APP_ORIGIN;
  if (expected) return origin === expected;
  const forwardedHost = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  return !forwardedHost || new URL(origin).host === forwardedHost;
}

export async function createApiToken(
  userId: string,
  name: string,
  scopes: string[] = ["projects:read", "projects:write", "assets:read"],
) {
  const raw = `misiva_mcp_${randomToken(36)}`;
  const prefix = raw.slice(0, 22);
  const id = randomUUID();
  await query(
    "INSERT INTO api_tokens (id, user_id, name, token_prefix, token_hash, scopes) VALUES ($1, $2, $3, $4, $5, $6)",
    [id, userId, name.trim(), prefix, digest(raw), scopes],
  );
  return { id, token: raw, prefix, scopes };
}

export async function listApiTokens(userId: string): Promise<ApiTokenInfo[]> {
  const result = await query<{ id: string; name: string; token_prefix: string; scopes: string[]; created_at: Date; last_used_at: Date | null }>(`
    SELECT id, name, token_prefix, scopes, created_at, last_used_at FROM api_tokens
    WHERE user_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC
  `, [userId]);
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    prefix: row.token_prefix,
    scopes: row.scopes ?? ["projects:read", "projects:write"],
    createdAt: row.created_at.toISOString(),
    lastUsedAt: row.last_used_at?.toISOString() ?? null,
  }));
}

export async function revokeApiToken(userId: string, id: string) {
  const result = await query("UPDATE api_tokens SET revoked_at = NOW() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL", [id, userId]);
  return result.rowCount === 1;
}

export async function userFromApiToken(token: string): Promise<{ user: SafeUser; scopes: string[] } | null> {
  if (!databaseEnabled()) return null;
  const result = await query<SafeUser & { token_id: string; scopes: string[] }>(`
    SELECT u.id, u.name, u.email, u.role, t.id AS token_id, t.scopes
    FROM api_tokens t JOIN users u ON u.id = t.user_id
    WHERE t.token_hash = $1 AND t.revoked_at IS NULL
  `, [digest(token)]);
  const row = result.rows[0];
  if (!row) return null;
  void query("UPDATE api_tokens SET last_used_at = NOW() WHERE id = $1 AND (last_used_at IS NULL OR last_used_at < NOW() - INTERVAL '5 minutes')", [row.token_id]);
  return {
    user: { id: row.id, name: row.name, email: row.email, role: row.role },
    scopes: row.scopes ?? ["projects:read", "projects:write"],
  };
}

export function sameSecret(received: string, expected: string) {
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function allowAuthAttempt(scope: string, request: Request, identity: string, max: number) {
  if (!databaseEnabled()) return true;
  const ip = (request.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
  const key = digest(`${scope}:${ip}:${identity}`);
  return transaction(async (client) => {
    const current = await client.query<{ attempts: number; window_started_at: Date; blocked_until: Date | null }>("SELECT attempts, window_started_at, blocked_until FROM auth_attempts WHERE key_hash = $1 FOR UPDATE", [key]);
    const row = current.rows[0];
    const now = Date.now();
    if (!row) {
      await client.query("INSERT INTO auth_attempts (key_hash, attempts, window_started_at) VALUES ($1, 1, NOW())", [key]);
      return true;
    }
    if (row.blocked_until && row.blocked_until.getTime() > now) return false;
    if (now - row.window_started_at.getTime() > 15 * 60_000) {
      await client.query("UPDATE auth_attempts SET attempts = 1, window_started_at = NOW(), blocked_until = NULL WHERE key_hash = $1", [key]);
      return true;
    }
    if (row.attempts >= max) {
      await client.query("UPDATE auth_attempts SET blocked_until = NOW() + INTERVAL '15 minutes' WHERE key_hash = $1", [key]);
      return false;
    }
    await client.query("UPDATE auth_attempts SET attempts = attempts + 1 WHERE key_hash = $1", [key]);
    return true;
  });
}

export async function clearAuthAttempts(scope: string, request: Request, identity: string) {
  if (!databaseEnabled()) return;
  const ip = (request.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
  await query("DELETE FROM auth_attempts WHERE key_hash = $1", [digest(`${scope}:${ip}:${identity}`)]);
}
