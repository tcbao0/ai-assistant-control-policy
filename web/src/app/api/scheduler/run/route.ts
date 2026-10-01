import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { listOwnerWorkspaces } from "@/services/mongo.service";
import { runDueSubscriptionsForWorkspace } from "@/services/scheduler.service";
import { deploymentConfig } from "@/services/workspace.service";

export const runtime = "nodejs";

function authorized(req: NextRequest) {
  const supplied = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  const secrets = [process.env.SCHEDULER_SECRET, process.env.CRON_SECRET]
    .filter((secret): secret is string => !!secret && secret.length >= 32);
  return secrets.some((secret) =>
    Buffer.byteLength(secret) === Buffer.byteLength(supplied) &&
    timingSafeEqual(Buffer.from(secret), Buffer.from(supplied)),
  );
}

export async function GET(req: NextRequest) {
  return POST(req);
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const config = deploymentConfig();
    const results = [];
    const workspaces = await listOwnerWorkspaces(config.network, config.packageId);
    for (const workspace of workspaces) {
      if (!workspace.policyId) continue;
      results.push(...await runDueSubscriptionsForWorkspace(workspace));
    }
    return NextResponse.json({ processed: results.length, results });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Scheduler failed" }, { status: 500 });
  }
}
