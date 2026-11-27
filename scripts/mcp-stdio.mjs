#!/usr/bin/env node
/**
 * Servidor MCP de Misiva sobre transporte STDIO.
 *
 * Modos de ejecución:
 * 1. Conectado al backend en Go (recomendado en multiusuario):
 *    GO_BACKEND_URL=http://127.0.0.1:8080 MISIVA_MCP_TOKEN=misiva_mcp_... npm run mcp:stdio
 * 2. Modo local directo (guarda en ./storage/projects sin requerir base de datos):
 *    npm run mcp:stdio
 */
import { register } from "node:module";
import { pathToFileURL } from "node:url";

register("./mcp-loader.mjs", pathToFileURL(import.meta.filename));

const { serveStdio } = await import("@modelcontextprotocol/server/stdio");
const { createMisivaMcpServer } = await import("../lib/mcp/server.ts");
const { goBackendEnabled, verifyGoMcpToken } = await import("../lib/server/go-backend.ts");
const { databaseEnabled } = await import("../lib/server/db.ts");
const { userFromApiToken } = await import("../lib/server/auth.ts");

async function buildContext() {
  const token = (process.env.MISIVA_MCP_TOKEN ?? "").trim();

  if (goBackendEnabled()) {
    if (!token) {
      process.stderr.write("[misiva-mcp] Error: GO_BACKEND_URL está activa pero falta MISIVA_MCP_TOKEN.\n");
      process.exit(1);
    }
    const verified = await verifyGoMcpToken(token);
    if (!verified) {
      process.stderr.write("[misiva-mcp] Error: MISIVA_MCP_TOKEN inválido, revocado o backend Go inaccesible.\n");
      process.exit(1);
    }
    return {
      userId: verified.user.id,
      scopes: verified.scopes,
      goAuth: { bearerToken: token },
    };
  }

  if (databaseEnabled() && token) {
    const verified = await userFromApiToken(token);
    if (!verified) {
      process.stderr.write("[misiva-mcp] Error: MISIVA_MCP_TOKEN inválido en PostgreSQL.\n");
      process.exit(1);
    }
    return { userId: verified.user.id, scopes: verified.scopes };
  }

  return {
    scopes: ["projects:read", "projects:write", "projects:delete", "assets:read", "assets:write"],
  };
}

const mcpContext = await buildContext();

serveStdio(() => createMisivaMcpServer(mcpContext), {
  onerror: (err) => {
    process.stderr.write(`[misiva-mcp] ${err.message}\n`);
  },
});
