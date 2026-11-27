#!/usr/bin/env node
/**
 * Arranca en paralelo el Backend en Go (:8080, SQLite por defecto) y Next.js (:3000)
 * conectados automáticamente mediante GO_BACKEND_URL.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const backendDir = path.join(rootDir, "backend");
const goPort = process.env.GO_PORT || "8080";
const goHost = process.env.GO_HOST || "127.0.0.1";
const goBackendUrl = process.env.GO_BACKEND_URL || `http://${goHost}:${goPort}`;

const children = [];

function start(name, cmd, args, cwd, extraEnv = {}) {
  const proc = spawn(cmd, args, {
    cwd,
    env: { ...process.env, ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(proc);

  const prefix = name === "go" ? "\x1b[36m[go-backend]\x1b[0m" : "\x1b[32m[nextjs]\x1b[0m";
  proc.stdout.on("data", (chunk) => {
    for (const line of chunk.toString().split(/\r?\n/).filter(Boolean)) {
      process.stdout.write(`${prefix} ${line}\n`);
    }
  });
  proc.stderr.on("data", (chunk) => {
    for (const line of chunk.toString().split(/\r?\n/).filter(Boolean)) {
      process.stderr.write(`${prefix} ${line}\n`);
    }
  });
  proc.on("exit", (code, signal) => {
    if (!shuttingDown && code !== 0) {
      process.stderr.write(`${prefix} finalizó inesperadamente (code=${code ?? signal}). Deteniendo servicios…\n`);
      shutdown(code ?? 1);
    }
  });
  return proc;
}

let shuttingDown = false;
function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  setTimeout(() => process.exit(exitCode), 400);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

process.stdout.write(`\x1b[1mIniciando Misiva en modo paralelo (Go Backend @ ${goBackendUrl} + Next.js @ :3000)…\x1b[0m\n`);

start("go", "go", ["run", "./cmd/server"], backendDir, {
  GO_HOST: goHost,
  GO_PORT: goPort,
});

start("next", "npx", ["next", "dev"], rootDir, {
  GO_BACKEND_URL: goBackendUrl,
  MISIVA_SERVER_PROJECTS: "1",
});
