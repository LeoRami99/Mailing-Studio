import { randomUUID } from "node:crypto";
import { z } from "zod";
import { allowAuthAttempt, createSession, hashPassword, normalizeEmail, sessionCookie, trustedMutation } from "@/lib/server/auth";
import { databaseEnabled, query } from "@/lib/server/db";

const schema = z.object({
  name: z.string().trim().min(2, "Escriba al menos 2 caracteres.").max(80),
  email: z.email("Escriba un correo válido.").max(320),
  password: z.string().min(12, "Use al menos 12 caracteres.").max(128, "La contraseña es demasiado larga."),
});

export async function POST(request: Request) {
  if (!databaseEnabled()) return Response.json({ error: "PostgreSQL no está configurado." }, { status: 503 });
  if (!trustedMutation(request)) return Response.json({ error: "Origen no permitido." }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  const email = normalizeEmail(parsed.data.email);
  if (!await allowAuthAttempt("register", request, email, 5)) return Response.json({ error: "Demasiados intentos. Espere 15 minutos." }, { status: 429 });

  try {
    const id = randomUUID();
    const passwordHash = await hashPassword(parsed.data.password);
    const created = await query<{ id: string; name: string; email: string; role: "member" | "admin" }>(`
      INSERT INTO users (id, name, email, password_hash, role)
      VALUES ($1, $2, $3, $4, CASE WHEN EXISTS (SELECT 1 FROM users) THEN 'member' ELSE 'admin' END)
      RETURNING id, name, email, role
    `, [id, parsed.data.name, email, passwordHash]);
    const user = created.rows[0];
    const session = await createSession(user.id, request.headers.get("user-agent"));
    return Response.json({ user }, { status: 201, headers: { "Set-Cookie": sessionCookie(session.token, session.expiresAt, request), "Cache-Control": "no-store" } });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") return Response.json({ error: "Ya existe una cuenta con ese correo." }, { status: 409 });
    return Response.json({ error: "No se pudo crear la cuenta." }, { status: 500 });
  }
}
