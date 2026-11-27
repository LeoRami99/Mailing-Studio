import { connection } from "next/server";
import { goBackendEnabled } from "@/lib/server/go-backend";
import { serverProjectsEnabled } from "@/lib/server/project-store";

export async function GET() {
  // connection() evita que Cache Components congele process.env al compilar.
  await connection();
  const goActive = goBackendEnabled();
  const pgActive = Boolean(process.env.DATABASE_URL);
  return Response.json({
    projectStorage: serverProjectsEnabled() ? "server" : "browser",
    authRequired: goActive || pgActive,
    authBackend: goActive ? "go" : pgActive ? "postgres" : "local",
    mcpEnabled: goActive || pgActive || Boolean(process.env.MISIVA_MCP_TOKEN),
  }, { headers: { "Cache-Control": "no-store" } });
}
