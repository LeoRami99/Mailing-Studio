import { z } from "zod";
import { hashPassword, normalizeEmail, requireRequestUser, trustedMutation, verifyPassword } from "@/lib/server/auth";
import { databaseEnabled, query } from "@/lib/server/db";
import { goBackendEnabled, proxyToGoBackend } from "@/lib/server/go-backend";

export async function GET(request: Request) {
  if (goBackendEnabled()) {
    return proxyToGoBackend(request, "/api/v1/auth/me");
  }
  const auth = await requireRequestUser(request);
  if ("response" in auth) return auth.response;
  return Response.json({ user: auth.user }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request) {
  if (!trustedMutation(request)) return Response.json({ error: "Origen no permitido." }, { status: 403 });
  if (goBackendEnabled()) {
    return proxyToGoBackend(request, "/api/v1/auth/me");
  }
  if (!databaseEnabled()) return Response.json({ error: "Perfil local no editable." }, { status: 409 });
  const auth = await requireRequestUser(request);
  if ("response" in auth) return auth.response;
  const parsed = z.object({
    name: z.string().trim().min(2).max(80).optional(),
    email: z.email().max(320).optional(),
  }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Datos de perfil inválidos." }, { status: 400 });

  const nextName = parsed.data.name ?? auth.user.name;
  const nextEmail = parsed.data.email ? normalizeEmail(parsed.data.email) : auth.user.email;
  try {
    const res = await query<{ id: string; name: string; email: string; role: "member" | "admin" }>(
      "UPDATE users SET name = $1, email = $2, updated_at = NOW() WHERE id = $3 RETURNING id, name, email, role",
      [nextName, nextEmail, auth.user.id],
    );
    return Response.json({ user: res.rows[0] });
  } catch {
    return Response.json({ error: "No se pudo actualizar el perfil (el correo puede estar en uso)." }, { status: 409 });
  }
}

export async function POST(request: Request) {
  if (!trustedMutation(request)) return Response.json({ error: "Origen no permitido." }, { status: 403 });
  if (goBackendEnabled()) {
    return proxyToGoBackend(request, "/api/v1/auth/password");
  }
  if (!databaseEnabled()) return Response.json({ error: "No disponible en modo local." }, { status: 409 });
  const auth = await requireRequestUser(request);
  if ("response" in auth) return auth.response;
  const parsed = z.object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(12).max(128),
  }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "La nueva contraseña debe tener al menos 12 caracteres." }, { status: 400 });

  const current = await query<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = $1", [auth.user.id]);
  if (!current.rows[0] || !await verifyPassword(current.rows[0].password_hash, parsed.data.currentPassword)) {
    return Response.json({ error: "La contraseña actual es incorrecta." }, { status: 401 });
  }
  const nextHash = await hashPassword(parsed.data.newPassword);
  await query("UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2", [nextHash, auth.user.id]);
  return Response.json({ ok: true });
}
