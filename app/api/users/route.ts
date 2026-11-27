import { trustedMutation } from "@/lib/server/auth";
import { goBackendEnabled, proxyToGoBackend } from "@/lib/server/go-backend";

export async function GET(request: Request) {
  if (!goBackendEnabled()) {
    return Response.json({ error: "La administración avanzada de usuarios requiere el backend en Go (GO_BACKEND_URL)." }, { status: 501 });
  }
  const type = new URL(request.url).searchParams.get("type");
  if (type === "audit") {
    return proxyToGoBackend(request, "/api/v1/audit-logs?limit=40");
  }
  return proxyToGoBackend(request, "/api/v1/users");
}

export async function PATCH(request: Request) {
  if (!trustedMutation(request)) return Response.json({ error: "Origen no permitido." }, { status: 403 });
  if (!goBackendEnabled()) {
    return Response.json({ error: "Requiere GO_BACKEND_URL." }, { status: 501 });
  }
  const body = (await request.json().catch(() => null)) as { id?: string; role?: string; active?: boolean } | null;
  if (!body?.id) return Response.json({ error: "Identificador requerido." }, { status: 400 });
  return proxyToGoBackend(request, `/api/v1/users/${encodeURIComponent(body.id)}`, {
    method: "PATCH",
    body: JSON.stringify({ role: body.role, active: body.active }),
  });
}

export async function DELETE(request: Request) {
  if (!trustedMutation(request)) return Response.json({ error: "Origen no permitido." }, { status: 403 });
  if (!goBackendEnabled()) {
    return Response.json({ error: "Requiere GO_BACKEND_URL." }, { status: 501 });
  }
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!id) return Response.json({ error: "Identificador requerido." }, { status: 400 });
  return proxyToGoBackend(request, `/api/v1/users/${encodeURIComponent(id)}`);
}
