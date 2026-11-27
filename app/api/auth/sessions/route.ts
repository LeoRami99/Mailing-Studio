import { requireRequestUser, trustedMutation } from "@/lib/server/auth";
import { databaseEnabled, query } from "@/lib/server/db";
import { goBackendEnabled, proxyToGoBackend } from "@/lib/server/go-backend";

export async function GET(request: Request) {
  if (goBackendEnabled()) {
    return proxyToGoBackend(request, "/api/v1/auth/sessions");
  }
  const auth = await requireRequestUser(request);
  if ("response" in auth) return auth.response;
  if (!databaseEnabled()) return Response.json({ sessions: [] });
  const result = await query<{ id: string; user_agent: string | null; created_at: Date; last_seen_at: Date; expires_at: Date }>(
    "SELECT id, user_agent, created_at, last_seen_at, expires_at FROM sessions WHERE user_id = $1 AND expires_at > NOW() ORDER BY last_seen_at DESC",
    [auth.user.id],
  );
  return Response.json({
    sessions: result.rows.map((r) => ({
      id: r.id,
      userAgent: r.user_agent ?? "",
      createdAt: r.created_at.toISOString(),
      lastSeenAt: r.last_seen_at.toISOString(),
      expiresAt: r.expires_at.toISOString(),
    })),
  });
}

export async function DELETE(request: Request) {
  if (!trustedMutation(request)) return Response.json({ error: "Origen no permitido." }, { status: 403 });
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (goBackendEnabled()) {
    if (!id) return proxyToGoBackend(request, "/api/v1/auth/logout-all", { method: "POST", body: "{}" });
    return proxyToGoBackend(request, `/api/v1/auth/sessions/${encodeURIComponent(id)}`);
  }
  const auth = await requireRequestUser(request);
  if ("response" in auth) return auth.response;
  if (!databaseEnabled() || !id) return Response.json({ revoked: false });
  const removed = await query("DELETE FROM sessions WHERE id = $1 AND user_id = $2", [id, auth.user.id]);
  return Response.json({ revoked: removed.rowCount === 1 });
}
