import { deleteProject, isProject, listProjects, saveProject } from "@/lib/server/project-store";
import { requireRequestUser, trustedMutation } from "@/lib/server/auth";

export async function GET(request: Request) {
  if (process.env.MISIVA_SERVER_PROJECTS !== "1") {
    return Response.json({ error: "El almacenamiento de servidor no está habilitado." }, { status: 404 });
  }
  const auth = await requireRequestUser(request);
  if ("response" in auth) return auth.response;
  return Response.json({ projects: await listProjects(auth.user.id) }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: Request) {
  if (process.env.MISIVA_SERVER_PROJECTS !== "1") {
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
  if (!isProject(value)) return Response.json({ error: "Proyecto inválido." }, { status: 400 });
  try {
    return Response.json({ project: await saveProject(value, auth.user.id) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "No se pudo guardar." }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  if (process.env.MISIVA_SERVER_PROJECTS !== "1") {
    return Response.json({ error: "El almacenamiento de servidor no está habilitado." }, { status: 404 });
  }
  if (!trustedMutation(request)) return Response.json({ error: "Origen no permitido." }, { status: 403 });
  const auth = await requireRequestUser(request);
  if ("response" in auth) return auth.response;
  const id = new URL(request.url).searchParams.get("id") ?? "";
  return Response.json({ deleted: await deleteProject(id, auth.user.id) });
}
