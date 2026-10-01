import { createHash, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireOwner } from "@/services/auth.service";
import { IntentRefusal, prepareIntent } from "@/services/intent.service";
import { chatProposals, type ChatProposal } from "@/services/mongo.service";
import { requireWorkspace } from "@/services/workspace.service";

export const runtime = "nodejs";
const PrepareBody = z.object({ message: z.string().trim().min(1).max(500), requestId: z.string().uuid() });

function preview(proposal: ChatProposal) {
  return { recipientName: proposal.recipientName, recipientAddress: proposal.recipientAddress,
    amountMist: proposal.amountMist, source: "vault" as const, grantId: proposal.grantId,
  };
}
function publicProposal(proposal: ChatProposal) {
  return { proposalId: proposal.proposalId, requestId: proposal.requestId, action: proposal.action,
    recipientName: proposal.recipientName, recipientAddress: proposal.recipientAddress,
    amountMist: proposal.amountMist, grantId: proposal.grantId, state: proposal.state,
    txDigest: proposal.txDigest, errorMessage: proposal.errorMessage,
    expiresAt: proposal.expiresAt, createdAt: proposal.createdAt };
}
function responseFor(proposal: ChatProposal) {
  if (proposal.state === "ready" && proposal.expiresAt > new Date())
    return { status: "ready", action: proposal.action, proposalId: proposal.proposalId,
      preview: preview(proposal), message: "Kiểm tra thông tin và xác nhận để agent gửi giao dịch.", reasonSource: "server" };
  return { status: proposal.state, action: proposal.action, proposalId: proposal.proposalId,
    preview: preview(proposal), txDigest: proposal.txDigest,
    message: proposal.errorMessage ?? (proposal.state === "confirmed" ? "Giao dịch đã hoàn tất." : "Yêu cầu đã được xử lý."),
    reasonSource: "server" };
}

export async function GET(req: NextRequest) {
  try {
    const owner = await requireOwner(req);
    const vaultId = (await requireWorkspace(owner)).vaultId;
    const proposals = await (await chatProposals()).find({ owner, vaultId },
      { projection: { _id: 0, signedBytes: 0, signature: 0, executionLease: 0, messageHash: 0 } })
      .sort({ createdAt: -1 }).limit(30).toArray();
    return NextResponse.json({ proposals: proposals.map(publicProposal) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Cannot load chat history" }, { status: 401 });
  }
}

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const owner = await requireOwner(req);
    const { message, requestId } = PrepareBody.parse(await req.json());
    const vaultId = (await requireWorkspace(owner)).vaultId;
    const collection = await chatProposals();
    const hash = createHash("sha256").update(message).digest("hex");
    const key = { owner, vaultId, requestId };
    let existing = await collection.findOne(key);
    if (existing) {
      if (existing.messageHash !== hash) throw new Error("requestId already belongs to a different command");
      return NextResponse.json(responseFor(existing));
    }
    const intent = await prepareIntent(message, owner, vaultId);
    const now = new Date();
    const proposal: ChatProposal = {
      proposalId: randomUUID(), requestId, owner, vaultId, grantId: intent.grantId,
      action: intent.action, messageHash: hash,
      recipientName: intent.recipientName, recipientAddress: intent.recipientAddress,
      amountMist: intent.amountMist, state: "ready", txDigest: null, signedBytes: null,
      signature: null, errorMessage: null, executionLease: null, lockUntil: null,
      expiresAt: new Date(now.getTime() + 10 * 60_000), createdAt: now, updatedAt: now,
    };
    try { await collection.insertOne(proposal); }
    catch (error) {
      if (!error || typeof error !== "object" || !("code" in error) || error.code !== 11000) throw error;
      existing = await collection.findOne(key);
      if (!existing || existing.messageHash !== hash) throw new Error("requestId already belongs to a different command");
      return NextResponse.json(responseFor(existing));
    }
    return NextResponse.json(responseFor(proposal));
  } catch (error) {
    if (error instanceof IntentRefusal)
      return NextResponse.json({ status: error.status, message: error.message,
        reasonSource: error.source });
    const message = error instanceof Error ? error.message : "Cannot prepare command";
    return NextResponse.json({ error: message },
      { status: /owner|Session|Sign in/.test(message) ? 401 : /Gemini|AI could not/.test(message) ? 503 : 400 });
  }
}
