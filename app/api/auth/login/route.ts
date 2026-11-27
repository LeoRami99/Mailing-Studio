import { z } from "zod";
import { allowAuthAttempt, clearAuthAttempts, createSession, normalizeEmail, sessionCookie, trustedMutation, verifyPassword } from "@/lib/server/auth";
import { databaseEnabled, query } from "@/lib/server/db";
import { goBackendEnabled, proxyToGoBackend } from "@/lib/server/go-backend";

const schema = z.object({ email: z.email().max(320), password: z.string().min(1).max(128) });

export async function POST(request: Request) {
  if (!trustedMutation(request)) return Response.json({ error: "Origen no permitido." }, { status: 403 });
  if (goBackendEnabled()) {
    return proxyToGoBackend(request, "/api/v1/auth/login");
  }
  if (!databaseEnabled()) return Response.json({ error: "Configure GO_BACKEND_URL o DATABASE_URL para iniciar sesión." }, { status: 503 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Correo o contraseña incorrectos." }, { status: 401 });
  const email = normalizeEmail(parsed.data.email);
  if (!await allowAuthAttempt("login", request, email, 10)) return Response.json({ error: "Demasiados intentos. Espere 15 minutos." }, { status: 429 });

  const result = await query<{ id: string; name: string; email: string; role: "member" | "admin"; password_hash: string }>(
    "SELECT id, name, email, role, password_hash FROM users WHERE email = $1",
    [email],
  );
  const row = result.rows[0];
  if (!row || !await verifyPassword(row.password_hash, parsed.data.password)) {
    return Response.json({ error: "Correo o contraseña incorrectos." }, { status: 401 });
  }
  await clearAuthAttempts("login", request, email);
  const session = await createSession(row.id, request.headers.get("user-agent"));
  const user = { id: row.id, name: row.name, email: row.email, role: row.role };
  return Response.json({ user }, { headers: { "Set-Cookie": sessionCookie(session.token, session.expiresAt, request), "Cache-Control": "no-store" } });
}
