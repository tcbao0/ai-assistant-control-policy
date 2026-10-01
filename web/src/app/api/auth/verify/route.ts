import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, SESSION_COOKIE, sessionCookie, verifyChallenge } from "@/services/auth.service";

const Schema = z.object({ address: z.string(), nonce: z.string(), signature: z.string() });
export const runtime = "nodejs";
export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const { address, nonce, signature } = Schema.parse(await req.json());
    const token = await verifyChallenge(address, nonce, signature);
    const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE, token, sessionCookie(86400));
    return response;
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid signature" }, { status: 401 });
  }
}
