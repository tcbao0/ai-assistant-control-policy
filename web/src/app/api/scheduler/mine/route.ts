import { NextRequest, NextResponse } from "next/server";
import { assertSameOrigin, requireOwner } from "@/services/auth.service";
import { runDueSubscriptionsForWorkspace } from "@/services/scheduler.service";
import { requireWorkspace } from "@/services/workspace.service";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const owner = await requireOwner(req);
    const workspace = await requireWorkspace(owner);
    if (!workspace.policyId) {
      return NextResponse.json({ error: "Create an automatic subscription policy first" }, { status: 400 });
    }
    const results = await runDueSubscriptionsForWorkspace(workspace);
    return NextResponse.json({
      processed: results.length,
      utcDay: new Date().getUTCDate(),
      results,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cannot run due subscriptions";
    return NextResponse.json({ error: message }, { status: /owner|Session|Sign in/.test(message) ? 401 : 400 });
  }
}
