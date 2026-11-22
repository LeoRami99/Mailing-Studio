import { getRequestUser } from "@/lib/server/auth";
import { databaseEnabled } from "@/lib/server/db";

export async function GET(request: Request) {
  const authRequired = databaseEnabled();
  const user = await getRequestUser(request);
  return Response.json({ authRequired, authenticated: Boolean(user), user }, { headers: { "Cache-Control": "no-store" } });
}
