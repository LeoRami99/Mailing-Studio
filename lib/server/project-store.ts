import "server-only";

import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { createBlock, defaultSettings } from "@/lib/email/defaults";
import type { Block, BlockType, EmailDoc, Project } from "@/lib/email/types";
import { databaseEnabled, query } from "./db";
import {
  goBackendEnabled,
  goDeleteProject,
  goGetProject,
  goListProjects,
  goSaveProject,
  type GoAuthContext,
} from "./go-backend";

const MAX_PROJECT_BYTES = 2 * 1024 * 1024;

export interface StoreActor {
  userId?: string;
  goAuth?: GoAuthContext;
}

function resolveActor(actor?: string | StoreActor): StoreActor {
  if (!actor) return {};
  if (typeof actor === "string") return { userId: actor };
  return actor;
}

export function serverProjectsEnabled(): boolean {
  if (process.env.MISIVA_SERVER_PROJECTS === "0") return false;
  return process.env.MISIVA_SERVER_PROJECTS === "1" || goBackendEnabled();
}

function storageRoot() {
  return process.env.MAILING_STORAGE_DIR || path.join(process.cwd(), "storage");
}

function projectsDir() {
  return path.join(storageRoot(), "projects");
}

export function validProjectId(id: string) {
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

function findShapeMismatch(value: unknown, template: unknown, currentPath: string): string | null {
  if (template === null || typeof template !== "object") {
    if (typeof value !== typeof template) {
      return `${currentPath}: se esperaba ${typeof template}, recibió ${value === null ? "null" : typeof value}`;
    }
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value) !== Array.isArray(template)) {
    return `${currentPath}: se esperaba ${Array.isArray(template) ? "array" : "object"}`;
  }
  if (Array.isArray(template)) return null;
  const object = value as Record<string, unknown>;
  for (const [key, expected] of Object.entries(template as Record<string, unknown>)) {
    if (!(key in object)) {
      return `${currentPath}.${key}: propiedad obligatoria ausente`;
    }
    const err = findShapeMismatch(object[key], expected, `${currentPath}.${key}`);
    if (err) return err;
  }
  return null;
}

export const BLOCK_TYPES = new Set<BlockType>([
  "heading",
  "text",
  "image",
  "button",
  "divider",
  "spacer",
  "social",
  "html",
  "footer",
  "columns",
  "hero",
]);

export function isBlock(value: unknown): value is Block {
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

export function explainBlockError(value: unknown, pathPrefix = "block"): string | null {
  if (!value || typeof value !== "object") return `${pathPrefix}: debe ser un objeto`;
  const block = value as Record<string, unknown>;
  if (typeof block.type !== "string" || !BLOCK_TYPES.has(block.type as BlockType)) {
    return `${pathPrefix}.type: tipo de bloque inválido (${String(block.type)}). Valores permitidos: ${[...BLOCK_TYPES].join(", ")}`;
  }
  const template = createBlock(block.type as BlockType) as unknown as Record<string, unknown>;
  const scalarShape = Object.fromEntries(Object.entries(template).filter(([, item]) => !Array.isArray(item)));
  const scalarErr = findShapeMismatch(value, scalarShape, `${pathPrefix}(${block.type})`);
  if (scalarErr) return scalarErr;
  if (block.type === "social") {
    if (!Array.isArray(block.items)) return `${pathPrefix}(social).items: debe ser un array`;
    const itemTemplate = (template.items as unknown[])[0];
    for (let i = 0; i < block.items.length; i++) {
      const err = findShapeMismatch(block.items[i], itemTemplate, `${pathPrefix}(social).items[${i}]`);
      if (err) return err;
    }
  }
  if (block.type === "columns") {
    if (!Array.isArray(block.columns)) return `${pathPrefix}(columns).columns: debe ser un array`;
    for (let i = 0; i < block.columns.length; i++) {
      const col = block.columns[i] as Record<string, unknown> | undefined;
      if (!col || typeof col !== "object") return `${pathPrefix}(columns).columns[${i}]: debe ser un objeto`;
      if (typeof col.id !== "string") return `${pathPrefix}(columns).columns[${i}].id: debe ser string`;
      if (typeof col.width !== "number") return `${pathPrefix}(columns).columns[${i}].width: debe ser number`;
      if (typeof col.background !== "string") return `${pathPrefix}(columns).columns[${i}].background: debe ser string`;
      if (!["top", "middle", "bottom"].includes(String(col.verticalAlign))) {
        return `${pathPrefix}(columns).columns[${i}].verticalAlign: debe ser 'top', 'middle' o 'bottom'`;
      }
      if (!Array.isArray(col.blocks)) return `${pathPrefix}(columns).columns[${i}].blocks: debe ser un array`;
      for (let j = 0; j < col.blocks.length; j++) {
        const nestedErr = explainBlockError(col.blocks[j], `${pathPrefix}(columns).columns[${i}].blocks[${j}]`);
        if (nestedErr) return nestedErr;
      }
    }
  }
  return null;
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

export function explainEmailDocError(value: unknown): string | null {
  if (!value || typeof value !== "object") return "El documento debe ser un objeto JSON.";
  const doc = value as Record<string, unknown>;
  if (doc.version !== 1) return `doc.version debe ser 1 (recibió ${String(doc.version)}).`;
  if (doc.mode !== "visual" && doc.mode !== "code") return `doc.mode debe ser 'visual' o 'code' (recibió ${String(doc.mode)}).`;
  const settingsErr = findShapeMismatch(doc.settings, defaultSettings(), "doc.settings");
  if (settingsErr) return settingsErr;
  if (!Array.isArray(doc.blocks)) return "doc.blocks debe ser un array.";
  for (let i = 0; i < doc.blocks.length; i++) {
    const bErr = explainBlockError(doc.blocks[i], `doc.blocks[${i}]`);
    if (bErr) return bErr;
  }
  if (typeof doc.code !== "string") return "doc.code debe ser un string.";
  if (!Array.isArray(doc.variables)) return "doc.variables debe ser un array.";
  for (let i = 0; i < doc.variables.length; i++) {
    const v = doc.variables[i] as Record<string, unknown> | undefined;
    if (!v || typeof v !== "object") return `doc.variables[${i}] debe ser un objeto.`;
    for (const k of ["key", "label", "sample", "fallback"]) {
      if (typeof v[k] !== "string") return `doc.variables[${i}].${k} debe ser string.`;
    }
    if (!v.tags || typeof v.tags !== "object" || Array.isArray(v.tags)) {
      return `doc.variables[${i}].tags debe ser un objeto Record<string, string>.`;
    }
  }
  return null;
}

export function isProject(value: unknown): value is Project {
  if (!value || typeof value !== "object") return false;
  const project = value as Partial<Project>;
  return typeof project.id === "string" && validProjectId(project.id) &&
    typeof project.name === "string" && project.name.trim().length > 0 && project.name.length <= 160 &&
    typeof project.updatedAt === "number" && Number.isFinite(project.updatedAt) && isEmailDoc(project.doc);
}

function unwrapStoredDoc(stored: unknown): EmailDoc {
  if (stored && typeof stored === "object" && "doc" in stored && !("version" in stored)) {
    return (stored as { doc: EmailDoc }).doc;
  }
  return stored as EmailDoc;
}

function projectPath(id: string) {
  if (!validProjectId(id)) throw new Error("Identificador de proyecto inválido.");
  return path.join(projectsDir(), `${id}.json`);
}

export async function listProjects(actorInput?: string | StoreActor): Promise<Project[]> {
  const actor = resolveActor(actorInput);
  if (goBackendEnabled() && actor.goAuth) {
    return goListProjects(actor.goAuth);
  }
  if (databaseEnabled()) {
    if (!actor.userId) throw new Error("Usuario requerido.");
    const result = await query<{ id: string; name: string; updated_at: string; doc: unknown }>(
      "SELECT id, name, updated_at, doc FROM projects WHERE user_id = $1 ORDER BY updated_at DESC",
      [actor.userId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      updatedAt: Number(row.updated_at),
      doc: unwrapStoredDoc(row.doc),
    }));
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

export async function getProject(id: string, actorInput?: string | StoreActor): Promise<Project | null> {
  if (!validProjectId(id)) return null;
  const actor = resolveActor(actorInput);
  if (goBackendEnabled() && actor.goAuth) {
    return goGetProject(id, actor.goAuth);
  }
  if (databaseEnabled()) {
    if (!actor.userId) throw new Error("Usuario requerido.");
    const result = await query<{ id: string; name: string; updated_at: string; doc: unknown }>(
      "SELECT id, name, updated_at, doc FROM projects WHERE user_id = $1 AND id = $2",
      [actor.userId, id],
    );
    const row = result.rows[0];
    if (!row) return null;
    return { id: row.id, name: row.name, updatedAt: Number(row.updated_at), doc: unwrapStoredDoc(row.doc) };
  }
  try {
    const value: unknown = JSON.parse(await readFile(projectPath(id), "utf8"));
    return isProject(value) ? value : null;
  } catch {
    return null;
  }
}

export async function saveProject(
  project: Project,
  actorInput?: string | StoreActor,
  expectedUpdatedAt?: number,
): Promise<Project> {
  const candidate: unknown = project;
  if (!isProject(candidate)) {
    const rawDoc = candidate && typeof candidate === "object" ? (candidate as { doc?: unknown }).doc : undefined;
    const detail = explainEmailDocError(rawDoc);
    throw new Error(detail ? `Documento inválido: ${detail}` : "El proyecto no tiene un formato válido.");
  }
  const normalized: Project = { ...candidate, name: candidate.name.trim(), updatedAt: Date.now() };
  const docJson = JSON.stringify(normalized.doc);
  const fullData = JSON.stringify(normalized, null, 2);
  if (Buffer.byteLength(fullData) > MAX_PROJECT_BYTES) throw new Error("El proyecto supera el límite de 2 MB.");

  const actor = resolveActor(actorInput);
  if (goBackendEnabled() && actor.goAuth) {
    return goSaveProject(normalized, actor.goAuth, expectedUpdatedAt);
  }

  if (databaseEnabled()) {
    if (!actor.userId) throw new Error("Usuario requerido.");
    await query(`
      INSERT INTO projects (user_id, id, name, doc, updated_at)
      VALUES ($1, $2, $3, $4::jsonb, $5)
      ON CONFLICT (user_id, id) DO UPDATE
      SET name = EXCLUDED.name, doc = EXCLUDED.doc, updated_at = EXCLUDED.updated_at
    `, [actor.userId, normalized.id, normalized.name, docJson, normalized.updatedAt]);
    return normalized;
  }

  const dir = projectsDir();
  await mkdir(dir, { recursive: true });
  const target = projectPath(normalized.id);
  const temp = path.join(dir, `.${normalized.id}-${process.pid}-${Date.now()}.tmp`);
  await writeFile(temp, fullData, { encoding: "utf8", mode: 0o600 });
  await rename(temp, target);
  return normalized;
}

export async function deleteProject(id: string, actorInput?: string | StoreActor): Promise<boolean> {
  if (!validProjectId(id)) return false;
  const actor = resolveActor(actorInput);
  if (goBackendEnabled() && actor.goAuth) {
    return goDeleteProject(id, actor.goAuth);
  }
  if (databaseEnabled()) {
    if (!actor.userId) throw new Error("Usuario requerido.");
    const result = await query("DELETE FROM projects WHERE user_id = $1 AND id = $2", [actor.userId, id]);
    return result.rowCount === 1;
  }
  try {
    await unlink(projectPath(id));
    return true;
  } catch {
    return false;
  }
}
