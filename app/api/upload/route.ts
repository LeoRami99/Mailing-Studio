import { mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { requireRequestUser, trustedMutation } from "@/lib/server/auth";
import { databaseEnabled, query } from "@/lib/server/db";

// Almacena imágenes subidas en ./storage/uploads y las sirve en /media/<archivo>.
// En producción puede reemplazarse por S3, Cloudinary u otro CDN público:
// los correos necesitan URLs absolutas accesibles desde internet.

// En Electron se usa la carpeta de datos del usuario (MAILING_STORAGE_DIR).
const UPLOAD_DIR = path.join(process.env.MAILING_STORAGE_DIR || path.join(process.cwd(), "storage"), "uploads");
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

export async function POST(request: Request) {
  if (!trustedMutation(request)) return Response.json({ error: "Origen no permitido." }, { status: 403 });
  const auth = await requireRequestUser(request);
  if ("response" in auth) return auth.response;
  const form = await request.formData();
  const files = form.getAll("file").filter((f): f is File => f instanceof File);
  if (!files.length) return Response.json({ error: "No se recibió ningún archivo." }, { status: 400 });

  await mkdir(UPLOAD_DIR, { recursive: true });
  const saved: { name: string; url: string; size: number }[] = [];
  for (const file of files) {
    const ext = ALLOWED[file.type];
    if (!ext) return Response.json({ error: `Formato no permitido (${file.type}). Use PNG, JPG, GIF o WebP.` }, { status: 415 });
    if (file.size > MAX_BYTES) return Response.json({ error: `«${file.name}» supera 5 MB.` }, { status: 413 });
    const base = file.name
      .replace(/\.[^.]+$/, "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z0-9-_]+/g, "-")
      .slice(0, 40)
      .toLowerCase();
    const name = `${base || "imagen"}-${randomUUID().slice(0, 8)}.${ext}`;
    await writeFile(path.join(UPLOAD_DIR, name), Buffer.from(await file.arrayBuffer()));
    if (databaseEnabled()) await query("INSERT INTO upload_assets (user_id, name, size_bytes, media_type) VALUES ($1, $2, $3, $4)", [auth.user.id, name, file.size, file.type]);
    saved.push({ name, url: `/media/${name}`, size: file.size });
  }
  return Response.json({ files: saved });
}

export async function GET(request: Request) {
  const auth = await requireRequestUser(request);
  if ("response" in auth) return auth.response;
  await mkdir(UPLOAD_DIR, { recursive: true });
  const names = databaseEnabled()
    ? (await query<{ name: string }>("SELECT name FROM upload_assets WHERE user_id = $1 ORDER BY created_at DESC", [auth.user.id])).rows.map((row) => row.name)
    : await readdir(UPLOAD_DIR);
  const files = await Promise.all(
    names
      .filter((n) => /\.(png|jpe?g|gif|webp)$/i.test(n))
      .map(async (n) => {
        const st = await stat(path.join(UPLOAD_DIR, n));
        return { name: n, url: `/media/${n}`, size: st.size, mtime: st.mtimeMs };
      }),
  );
  files.sort((a, b) => b.mtime - a.mtime);
  return Response.json({ files });
}

export async function DELETE(request: Request) {
  if (!trustedMutation(request)) return Response.json({ error: "Origen no permitido." }, { status: 403 });
  const auth = await requireRequestUser(request);
  if ("response" in auth) return auth.response;
  const { name } = (await request.json()) as { name?: string };
  if (!name || name !== path.basename(name)) return Response.json({ error: "Nombre inválido." }, { status: 400 });
  if (databaseEnabled()) {
    const removed = await query("DELETE FROM upload_assets WHERE user_id = $1 AND name = $2", [auth.user.id, name]);
    if (removed.rowCount !== 1) return Response.json({ error: "No encontrado." }, { status: 404 });
  }
  await unlink(path.join(UPLOAD_DIR, name)).catch(() => {});
  return Response.json({ ok: true });
}
