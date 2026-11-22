import { deleteSession, expiredSessionCookie, getRequestUser, SESSION_COOKIE, trustedMutation } from "@/lib/server/auth";

function cookieValue(request: Request) {
  const cookie = request.headers.get("cookie") ?? "";
  return cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
}

export async function POST(request: Request) {
  if (!trustedMutation(request)) return Response.json({ error: "Origen no permitido." }, { status: 403 });
  await getRequestUser(request);
  await deleteSession(cookieValue(request));
  return Response.json({ ok: true }, { headers: { "Set-Cookie": expiredSessionCookie(request), "Cache-Control": "no-store" } });
}
