import { z } from "zod";
import { createApiToken, listApiTokens, requireRequestUser, revokeApiToken, trustedMutation } from "@/lib/server/auth";
import { goBackendEnabled, proxyToGoBackend } from "@/lib/server/go-backend";

export async function GET(request: Request) {
  if (goBackendEnabled()) {
    return proxyToGoBackend(request, "/api/v1/auth/tokens");
  }
  const auth = await requireRequestUser(request);
  if ("response" in auth) return auth.response;
  if (auth.user.id === "local") return Response.json({ tokens: [] });
  return Response.json({ tokens: await listApiTokens(auth.user.id) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!trustedMutation(request)) return Response.json({ error: "Origen no permitido." }, { status: 403 });
  if (goBackendEnabled()) {
    return proxyToGoBackend(request, "/api/v1/auth/tokens");
  }
  const auth = await requireRequestUser(request);
  if ("response" in auth) return auth.response;
  if (auth.user.id === "local") return Response.json({ error: "Configure GO_BACKEND_URL o PostgreSQL para crear tokens MCP." }, { status: 409 });
  const parsed = z.object({
    name: z.string().trim().min(2).max(80),
    scopes: z.array(z.string()).optional(),
  }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Escriba un nombre para identificar el token." }, { status: 400 });
  const active = await listApiTokens(auth.user.id);
  if (active.length >= 10) return Response.json({ error: "Revocar un token antes de crear otro." }, { status: 409 });
  const token = await createApiToken(auth.user.id, parsed.data.name, parsed.data.scopes);
  return Response.json(token, { status: 201, headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(request: Request) {
  if (!trustedMutation(request)) return Response.json({ error: "Origen no permitido." }, { status: 403 });
  if (goBackendEnabled()) {
    return proxyToGoBackend(request, "/api/v1/auth/tokens");
  }
  const auth = await requireRequestUser(request);
  if ("response" in auth) return auth.response;
  const parsed = z.object({ id: z.uuid() }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Token inválido." }, { status: 400 });
  return Response.json({ revoked: await revokeApiToken(auth.user.id, parsed.data.id) });
}
