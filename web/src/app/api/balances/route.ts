import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/services/auth.service";
import { readVaultBalances } from "@/services/balances.service";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const owner = await requireOwner(req);
    return NextResponse.json(await readVaultBalances(owner), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cannot read balances";
    return NextResponse.json({ error: message }, {
      status: /owner|Session|Sign in/.test(message) ? 401 : 400,
      headers: { "cache-control": "no-store" },
    });
  }
}
