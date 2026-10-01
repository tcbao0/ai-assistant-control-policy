import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/services/auth.service";
import { readTransferGrant } from "@/services/agent-transfer.service";
import { requireWorkspace } from "@/services/workspace.service";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const owner = await requireOwner(req);
    const workspace = await requireWorkspace(owner);
    const grant = await readTransferGrant(owner);
    if (grant.owner.toLowerCase() !== owner.toLowerCase() ||
        grant.vaultId.toLowerCase() !== workspace.vaultId.toLowerCase()) {
      throw new Error("Transfer grant does not belong to the signed-in vault owner");
    }
    return NextResponse.json(grant, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cannot read transfer grant";
    return NextResponse.json({ error: message }, { status: /owner|Session|Sign in/.test(message) ? 401 : 400 });
  }
}
