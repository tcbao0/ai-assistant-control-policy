import { NextRequest, NextResponse } from "next/server";
import { assertSameOrigin, SESSION_COOKIE, logoutSession, sessionCookie } from "@/services/auth.service";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    await logoutSession(req.cookies.get(SESSION_COOKIE)?.value);
    const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE, "", sessionCookie(0));
    return response;
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Cannot log out" }, { status: 400 });
  }
}
