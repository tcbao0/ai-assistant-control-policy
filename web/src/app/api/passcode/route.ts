import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireOwner } from "@/services/auth.service";
import { changePasscode, createPasscode, passcodeConfigured, verifyPasscode } from "@/services/passcode.service";
import { requireWorkspace } from "@/services/workspace.service";

export const runtime = "nodejs";

const RequestBody = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("create"), passcode: z.string() }),
  z.object({ operation: z.literal("verify"), passcode: z.string() }),
  z.object({ operation: z.literal("change"), passcode: z.string(), nextPasscode: z.string() }),
]);

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : "Passcode request failed";
  const status = /owner|Session|Sign in/.test(message) ? 401 : /Too many attempts/.test(message) ? 429 : 400;
  return NextResponse.json({ error: message }, { status });
}

export async function GET(req: NextRequest) {
  try {
    const owner = await requireOwner(req);
    const workspace = await requireWorkspace(owner);
    return NextResponse.json({ configured: await passcodeConfigured(owner, workspace.vaultId) });
  } catch (error) { return failure(error); }
}

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const owner = await requireOwner(req);
    const input = RequestBody.parse(await req.json());
    const workspace = await requireWorkspace(owner);
    const vault = workspace.vaultId;
    if (input.operation === "create") await createPasscode(owner, vault, input.passcode);
    else if (input.operation === "verify") await verifyPasscode(owner, vault, input.passcode);
    else await changePasscode(owner, vault, input.passcode, input.nextPasscode);
    return NextResponse.json({ ok: true });
  } catch (error) { return failure(error); }
}
