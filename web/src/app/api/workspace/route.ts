import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/services/auth.service";
import { deploymentConfig, findWorkspace } from "@/services/workspace.service";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const owner = await requireOwner(req);
    const workspace = await findWorkspace(owner);
    if (!workspace) return NextResponse.json({ workspace: null }, { status: 404, headers: { "cache-control": "no-store" } });
    return NextResponse.json({ workspace: {
      ...workspace,
      ...deploymentConfig(),
      owner,
    } }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cannot load wallet workspace";
    return NextResponse.json({ error: message }, { status: /owner|Session|Sign in/.test(message) ? 401 : 400,
      headers: { "cache-control": "no-store" } });
  }
}
