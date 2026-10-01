import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, createChallenge } from "@/services/auth.service";

const Schema = z.object({ address: z.string().regex(/^0x[0-9a-fA-F]{1,64}$/) });
export const runtime = "nodejs";
export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const { address } = Schema.parse(await req.json());
    return NextResponse.json(await createChallenge(address, req.nextUrl.origin));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid request" }, { status: 400 });
  }
}
