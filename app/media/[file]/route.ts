import { readFile } from "node:fs/promises";
import path from "node:path";

const TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

export async function GET(_req: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params;
  const name = path.basename(file);
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (name !== file || !TYPES[ext]) return new Response("No encontrado", { status: 404 });
  try {
    const dir = process.env.MAILING_STORAGE_DIR || path.join(process.cwd(), "storage");
    const data = await readFile(path.join(dir, "uploads", name));
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": TYPES[ext],
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response("No encontrado", { status: 404 });
  }
}
