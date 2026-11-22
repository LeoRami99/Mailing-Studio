import { connection } from "next/server";

export async function GET() {
  // La misma imagen Docker puede promoverse entre entornos con configuración
  // diferente. connection() evita que Cache Components congele process.env al compilar.
  await connection();
  return Response.json({
    projectStorage: process.env.MISIVA_SERVER_PROJECTS === "1" ? "server" : "browser",
    authRequired: Boolean(process.env.DATABASE_URL),
    mcpEnabled: Boolean(process.env.DATABASE_URL || process.env.MISIVA_MCP_TOKEN),
  }, { headers: { "Cache-Control": "no-store" } });
}
