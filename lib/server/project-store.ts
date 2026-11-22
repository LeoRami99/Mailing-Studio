import "server-only";

import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { createBlock, defaultSettings } from "@/lib/email/defaults";
import type { Block, BlockType, EmailDoc, Project } from "@/lib/email/types";
import { databaseEnabled, query } from "./db";

const MAX_PROJECT_BYTES = 2 * 1024 * 1024;

function storageRoot() {
  return process.env.MAILING_STORAGE_DIR || path.join(process.cwd(), "storage");
}

function projectsDir() {
  return path.join(storageRoot(), "projects");
}

function validId(id: string) {
  return /^[a-zA-Z0-9_-]{1,80}$/.test(id);
}

function matchesShape(value: unknown, template: unknown): boolean {
  if (template === null || typeof template !== "object") return typeof value === typeof template;
  if (!value || typeof value !== "object" || Array.isArray(value) !== Array.isArray(template)) return false;
  if (Array.isArray(template)) return Array.isArray(value);
  const object = value as Record<string, unknown>;
  return Object.entries(template as Record<string, unknown>).every(([key, expected]) =>
    key in object && matchesShape(object[key], expected));
}

const BLOCK_TYPES = new Set<BlockType>(["heading", "text", "image", "button", "divider", "spacer", "social", "html", "footer", "columns", "hero"]);

function isBlock(value: unknown): value is Block {
  if (!value || typeof value !== "object") return false;
  const block = value as Record<string, unknown>;
  if (typeof block.type !== "string" || !BLOCK_TYPES.has(block.type as BlockType)) return false;
  const template = createBlock(block.type as BlockType) as unknown as Record<string, unknown>;
  const scalarShape = Object.fromEntries(Object.entries(template).filter(([, item]) => !Array.isArray(item)));
  if (!matchesShape(value, scalarShape)) return false;
  if (block.type === "social") {
    const items = block.items;
    const itemTemplate = (template.items as unknown[])[0];
    return Array.isArray(items) && items.every((item) => matchesShape(item, itemTemplate));
  }
  if (block.type === "columns") {
    return Array.isArray(block.columns) && block.columns.every((column) => {
      if (!column || typeof column !== "object") return false;
      const candidate = column as Record<string, unknown>;
      return typeof candidate.id === "string" && typeof candidate.width === "number" &&
        typeof candidate.background === "string" && ["top", "middle", "bottom"].includes(String(candidate.verticalAlign)) &&
        Array.isArray(candidate.blocks) && candidate.blocks.every(isBlock);
    });
  }
  return true;
}

export function isEmailDoc(value: unknown): value is EmailDoc {
  if (!value || typeof value !== "object") return false;
  const doc = value as Partial<EmailDoc>;
  return doc.version === 1 && (doc.mode === "visual" || doc.mode === "code") &&
    matchesShape(doc.settings, defaultSettings()) && Array.isArray(doc.blocks) && doc.blocks.every(isBlock) &&
    typeof doc.code === "string" && Array.isArray(doc.variables) &&
    doc.variables.every((variable) => {
      if (!variable || typeof variable !== "object") return false;
      const item = variable as unknown as Record<string, unknown>;
      return typeof item.key === "string" && typeof item.label === "string" &&
        typeof item.sample === "string" && typeof item.fallback === "string" &&
        !!item.tags && typeof item.tags === "object" && !Array.isArray(item.tags) &&
        Object.values(item.tags as Record<string, unknown>).every((tag) => typeof tag === "string");
    });
}

export function isProject(value: unknown): value is Project {
  if (!value || typeof value !== "object") return false;
  const project = value as Partial<Project>;
  return typeof project.id === "string" && validId(project.id) &&
    typeof project.name === "string" && project.name.trim().length > 0 && project.name.length <= 160 &&
    typeof project.updatedAt === "number" && Number.isFinite(project.updatedAt) && isEmailDoc(project.doc);
}

function projectPath(id: string) {
  if (!validId(id)) throw new Error("Identificador de proyecto inválido.");
  return path.join(projectsDir(), `${id}.json`);
}

export async function listProjects(userId?: string): Promise<Project[]> {
  if (databaseEnabled()) {
    if (!userId) throw new Error("Usuario requerido.");
    const result = await query<{ id: string; name: string; updated_at: string; doc: EmailDoc }>(
      "SELECT id, name, updated_at, doc FROM projects WHERE user_id = $1 ORDER BY updated_at DESC",
      [userId],
    );
    return result.rows.map((row) => ({ id: row.id, name: row.name, updatedAt: Number(row.updated_at), doc: row.doc }));
  }
  const dir = projectsDir();
  await mkdir(dir, { recursive: true });
  const names = await readdir(dir);
  const projects = await Promise.all(names.filter((name) => name.endsWith(".json")).map(async (name) => {
    try {
      const value: unknown = JSON.parse(await readFile(path.join(dir, name), "utf8"));
      return isProject(value) ? value : null;
    } catch {
      return null;
    }
  }));
  return projects.filter((project): project is Project => project !== null).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getProject(id: string, userId?: string): Promise<Project | null> {
  if (!validId(id)) return null;
  if (databaseEnabled()) {
    if (!userId) throw new Error("Usuario requerido.");
    const result = await query<{ id: string; name: string; updated_at: string; doc: EmailDoc }>(
      "SELECT id, name, updated_at, doc FROM projects WHERE user_id = $1 AND id = $2",
      [userId, id],
    );
    const row = result.rows[0];
    return row ? { id: row.id, name: row.name, updatedAt: Number(row.updated_at), doc: row.doc } : null;
  }
  try {
    const value: unknown = JSON.parse(await readFile(projectPath(id), "utf8"));
    return isProject(value) ? value : null;
  } catch {
    return null;
  }
}

export async function saveProject(project: Project, userId?: string): Promise<Project> {
  if (!isProject(project)) throw new Error("El proyecto no tiene un formato válido.");
  const normalized: Project = { ...project, name: project.name.trim(), updatedAt: Date.now() };
  const data = JSON.stringify(normalized, null, 2);
  if (Buffer.byteLength(data) > MAX_PROJECT_BYTES) throw new Error("El proyecto supera el límite de 2 MB.");

  if (databaseEnabled()) {
    if (!userId) throw new Error("Usuario requerido.");
    await query(`
      INSERT INTO projects (user_id, id, name, doc, updated_at)
      VALUES ($1, $2, $3, $4::jsonb, $5)
      ON CONFLICT (user_id, id) DO UPDATE
      SET name = EXCLUDED.name, doc = EXCLUDED.doc, updated_at = EXCLUDED.updated_at
    `, [userId, normalized.id, normalized.name, data, normalized.updatedAt]);
    return normalized;
  }

  const dir = projectsDir();
  await mkdir(dir, { recursive: true });
  const target = projectPath(normalized.id);
  const temp = path.join(dir, `.${normalized.id}-${process.pid}-${Date.now()}.tmp`);
  await writeFile(temp, data, { encoding: "utf8", mode: 0o600 });
  await rename(temp, target);
  return normalized;
}

export async function deleteProject(id: string, userId?: string): Promise<boolean> {
  if (!validId(id)) return false;
  if (databaseEnabled()) {
    if (!userId) throw new Error("Usuario requerido.");
    const result = await query("DELETE FROM projects WHERE user_id = $1 AND id = $2", [userId, id]);
    return result.rowCount === 1;
  }
  try {
    await unlink(projectPath(id));
    return true;
  } catch {
    return false;
  }
}
