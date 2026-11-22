import { createMcpHandler } from "@modelcontextprotocol/server";
import { createMisivaMcpServer } from "@/lib/mcp/server";
import { sameSecret, userFromApiToken } from "@/lib/server/auth";
import { databaseEnabled } from "@/lib/server/db";

async function mcp(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const received = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const user = received ? await userFromApiToken(received) : null;
  const legacyToken = process.env.MISIVA_MCP_TOKEN;
  const legacy = !databaseEnabled() && Boolean(legacyToken) && sameSecret(received, legacyToken!);
  if (!user && !legacy) {
    return Response.json({ error: "No autorizado." }, { status: 401, headers: { "WWW-Authenticate": "Bearer" } });
  }

  const origin = request.headers.get("origin");
  const allowed = new Set((process.env.MISIVA_MCP_ALLOWED_ORIGINS ?? "").split(",").map((item) => item.trim()).filter(Boolean));
  if (origin && origin !== new URL(request.url).origin && !allowed.has(origin)) {
    return Response.json({ error: "Origen no permitido." }, { status: 403 });
  }
  const handler = createMcpHandler(() => createMisivaMcpServer(user?.id), { responseMode: "auto" });
  return handler.fetch(request, { authInfo: { token: received, clientId: user?.id ?? "misiva-mcp-local", scopes: ["projects:read", "projects:write"] } });
}

export const GET = mcp;
export const POST = mcp;
export const DELETE = mcp;
