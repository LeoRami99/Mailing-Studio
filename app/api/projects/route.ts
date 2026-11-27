import { deleteProject, explainEmailDocError, isProject, listProjects, saveProject, serverProjectsEnabled } from "@/lib/server/project-store";
import { requireRequestUser, trustedMutation } from "@/lib/server/auth";
import { authContextFromRequest } from "@/lib/server/go-backend";

export async function GET(request: Request) {
  if (!serverProjectsEnabled()) {
    return Response.json({ error: "El almacenamiento de servidor no está habilitado." }, { status: 404 });
  }
  const auth = await requireRequestUser(request);
  if ("response" in auth) return auth.response;
  const projects = await listProjects({ userId: auth.user.id, goAuth: authContextFromRequest(request) });
  return Response.json({ projects }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: Request) {
  if (!serverProjectsEnabled()) {
    return Response.json({ error: "El almacenamiento de servidor no está habilitado." }, { status: 404 });
  }
  if (!trustedMutation(request)) return Response.json({ error: "Origen no permitido." }, { status: 403 });
  const auth = await requireRequestUser(request);
  if ("response" in auth) return auth.response;
  const raw = await request.text();
  if (raw.length > 2 * 1024 * 1024) return Response.json({ error: "Proyecto demasiado grande." }, { status: 413 });
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return Response.json({ error: "JSON inválido." }, { status: 400 });
  }
  if (!isProject(value)) {
    const detail = explainEmailDocError((value as { doc?: unknown })?.doc);
    return Response.json({ error: detail ? `Proyecto inválido: ${detail}` : "Proyecto inválido." }, { status: 400 });
  }
  try {
    const project = await saveProject(value, { userId: auth.user.id, goAuth: authContextFromRequest(request) });
    return Response.json({ project });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "No se pudo guardar." }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  if (!serverProjectsEnabled()) {
    return Response.json({ error: "El almacenamiento de servidor no está habilitado." }, { status: 404 });
  }
  if (!trustedMutation(request)) return Response.json({ error: "Origen no permitido." }, { status: 403 });
  const auth = await requireRequestUser(request);
  if ("response" in auth) return auth.response;
  const id = new URL(request.url).searchParams.get("id") ?? "";
  const deleted = await deleteProject(id, { userId: auth.user.id, goAuth: authContextFromRequest(request) });
  return Response.json({ deleted });
}
