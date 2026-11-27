import { createMcpHandler } from "@modelcontextprotocol/server";
import { createMisivaMcpServer } from "@/lib/mcp/server";
import { sameSecret, userFromApiToken } from "@/lib/server/auth";
import { databaseEnabled } from "@/lib/server/db";
import { goBackendEnabled, verifyGoMcpToken } from "@/lib/server/go-backend";

function allowedOriginsSet() {
  return new Set(
    (process.env.MISIVA_MCP_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin");
  if (!origin) return {};
  const allowed = allowedOriginsSet();
  const sameOrigin = origin === new URL(request.url).origin;
  if (!sameOrigin && !allowed.has(origin) && !allowed.has("*")) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, MCP-Protocol-Version, Mcp-Session-Id, Last-Event-ID",
    "Access-Control-Expose-Headers": "MCP-Protocol-Version, Mcp-Session-Id",
    Vary: "Origin",
  };
}

function withHeaders(response: Response, extra: Record<string, string>): Response {
  if (Object.keys(extra).length === 0) return response;
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(extra)) headers.set(k, v);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export async function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

async function mcp(request: Request) {
  const cors = corsHeaders(request);
  const origin = request.headers.get("origin");
  const allowed = allowedOriginsSet();
  if (origin && origin !== new URL(request.url).origin && !allowed.has(origin) && !allowed.has("*")) {
    return Response.json({ error: "Origen no permitido." }, { status: 403 });
  }

  const authorization = request.headers.get("authorization") ?? "";
  const received = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";

  // Si un usuario abre /mcp desde el navegador para verificar que el endpoint existe:
  const accept = request.headers.get("accept") ?? "";
  if (request.method === "GET" && !received && accept.includes("text/html") && !accept.includes("text/event-stream")) {
    return Response.json({
      service: "misiva-mcp",
      version: "0.2.0",
      transport: "Streamable HTTP",
      status: "ready",
      authBackend: goBackendEnabled() ? "go" : databaseEnabled() ? "postgres" : "local-token",
      usage: "Conecte su cliente MCP con POST /mcp y el encabezado 'Authorization: Bearer <TOKEN_MCP>'.",
    }, { headers: { "Cache-Control": "no-store", ...cors } });
  }

  let userId: string | undefined;
  let scopes: string[] = ["projects:read", "projects:write", "assets:read"];
  let authenticated = false;
  let goBearer: string | undefined;

  if (goBackendEnabled()) {
    const verified = received ? await verifyGoMcpToken(received) : null;
    if (verified) {
      authenticated = true;
      userId = verified.user.id;
      scopes = verified.scopes;
      goBearer = received;
    }
  } else if (databaseEnabled()) {
    const verified = received ? await userFromApiToken(received) : null;
    if (verified) {
      authenticated = true;
      userId = verified.user.id;
      scopes = verified.scopes;
    }
  } else {
    const legacyToken = process.env.MISIVA_MCP_TOKEN;
    if (legacyToken && received && sameSecret(received, legacyToken)) {
      authenticated = true;
      scopes = ["projects:read", "projects:write", "projects:delete", "assets:read", "assets:write"];
    }
  }

  if (!authenticated) {
    return Response.json(
      { error: "No autorizado. Envíe un token MCP válido en 'Authorization: Bearer <token>'." },
      { status: 401, headers: { "WWW-Authenticate": "Bearer", ...cors } },
    );
  }

  const handler = createMcpHandler(
    () =>
      createMisivaMcpServer({
        userId,
        scopes,
        goAuth: goBearer ? { bearerToken: goBearer } : undefined,
      }),
    { responseMode: "auto" },
  );

  const response = await handler.fetch(request, {
    authInfo: {
      token: received,
      clientId: userId ?? "misiva-mcp-local",
      scopes,
    },
  });

  return withHeaders(response, cors);
}

export const GET = mcp;
export const POST = mcp;
export const DELETE = mcp;
