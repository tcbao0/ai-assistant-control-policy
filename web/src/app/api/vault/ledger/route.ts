import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireOwner } from "@/services/auth.service";
import { readVaultLedger, recordOwnerMovement } from "@/services/ledger.service";

export const runtime = "nodejs";

const Body = z.object({
  digest: z.string().min(20).max(88),
  kind: z.enum(["fund", "withdraw"]),
  amountMist: z.string().regex(/^\d+$/),
});

export async function GET(req: NextRequest) {
  try {
    const owner = await requireOwner(req);
    return NextResponse.json({ entries: await readVaultLedger(owner) }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cannot load vault ledger";
    return NextResponse.json({ error: message }, { status: /owner|Session|Sign in/.test(message) ? 401 : 400 });
  }
}

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const owner = await requireOwner(req);
    const body = Body.parse(await req.json());
    await recordOwnerMovement(owner, body);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cannot record vault movement";
    return NextResponse.json({ error: message }, { status: /owner|Session|Sign in/.test(message) ? 401 : 400 });
  }
}
