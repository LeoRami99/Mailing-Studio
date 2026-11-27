import { getRequestUser } from "@/lib/server/auth";
import { databaseEnabled } from "@/lib/server/db";
import { goBackendEnabled, proxyToGoBackend } from "@/lib/server/go-backend";

export async function GET(request: Request) {
  if (goBackendEnabled()) {
    return proxyToGoBackend(request, "/api/v1/auth/session");
  }
  const authRequired = databaseEnabled();
  const user = await getRequestUser(request);
  return Response.json(
    { authRequired, backend: authRequired ? "postgres" : "local", authenticated: Boolean(user), user },
    { headers: { "Cache-Control": "no-store" } },
  );
}
