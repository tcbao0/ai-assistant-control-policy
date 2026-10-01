import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/services/auth.service";
import { readPolicy } from "@/services/policy-read.service";

export const runtime = "nodejs";
export async function GET(req: NextRequest) {
  try {
    const owner = await requireOwner(req);
    return NextResponse.json(await readPolicy(owner), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cannot read policy";
    return NextResponse.json({ error: message }, { status: /owner|Session|Sign in/.test(message) ? 401 : 400 });
  }
}
