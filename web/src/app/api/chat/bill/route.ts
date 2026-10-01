import { createHash, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { normalizeSuiAddress } from "@/lib/vendors";
import { MAX_BILL_IMAGE_BYTES, validateBillImage, type BillImageMime } from "@/lib/invoice-image";
import { assertSameOrigin, requireOwner } from "@/services/auth.service";
import { parseInvoiceFromImage, parseInvoiceFromRawText } from "@/services/ai.service";
import { readTransferGrant } from "@/services/agent-transfer.service";
import { assertCurrentVaultGrant, IntentRefusal, validateTransferPayment } from "@/services/intent.service";
import { chatProposals, type ChatProposal } from "@/services/mongo.service";
import { getAgentKeypair, invoiceAmountToMistString } from "@/services/sui.service";
import { requireWorkspace } from "@/services/workspace.service";

export const runtime = "nodejs";

const TextBody = z.object({ requestId: z.string().uuid(), invoiceRaw: z.string().trim().min(1).max(20_000) });
const ImageBody = z.object({ requestId: z.string().uuid() });

type BillInput = { requestId: string; fingerprint: string; text: string | null; image: { bytes: Uint8Array; mimeType: BillImageMime } | null };

async function readBill(req: NextRequest): Promise<BillInput> {
  if (!req.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data")) {
    const body = TextBody.parse(await req.json());
    return { requestId: body.requestId, fingerprint: createHash("sha256").update(body.invoiceRaw).digest("hex"), text: body.invoiceRaw, image: null };
  }
  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BILL_IMAGE_BYTES + 100_000) throw new Error("Bill image must be 8 MB or smaller");
  const form = await req.formData();
  const { requestId } = ImageBody.parse({ requestId: form.get("requestId") });
  const file = form.get("image");
  if (!(file instanceof File)) throw new Error("Bill image is required");
  if (file.size > MAX_BILL_IMAGE_BYTES) throw new Error("Bill image must be 8 MB or smaller");
  const bytes = new Uint8Array(await file.arrayBuffer());
  validateBillImage(bytes, file.type);
  const fingerprint = createHash("sha256").update(bytes).digest("hex");
  return { requestId, fingerprint, text: null, image: { bytes, mimeType: file.type } };
}

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const owner = await requireOwner(req);
    const bill = await readBill(req);
    const workspace = await requireWorkspace(owner);
    if (!workspace.transferGrantId) throw new IntentRefusal("rejected", "No command grant is registered for this vault.");
    const vaultId = workspace.vaultId;
    const key = { owner, vaultId, requestId: bill.requestId };
    const billPeriod = new Date().toISOString().slice(0, 7);
    const collection = await chatProposals();
    const messageHash = createHash("sha256").update(`bill:${bill.fingerprint}`).digest("hex");
    const existing = await collection.findOne(key) ?? await collection.findOne({
      owner, vaultId, billPeriod, billFingerprint: bill.fingerprint,
    });
    if (existing) {
      if (existing.messageHash !== messageHash) throw new Error("requestId or invoiceId already belongs to different bill data");
      if (existing.state === "ready" && existing.expiresAt > new Date()) return NextResponse.json(preview(existing));
      return NextResponse.json({ status: existing.state, proposalId: existing.proposalId,
        txDigest: existing.txDigest,
        message: existing.errorMessage ?? "This bill request has already been processed.",
        reasonSource: existing.state === "rejected" ? "server" : "chain" });
    }

    const grant = await readTransferGrant(owner);
    if (grant.owner !== owner.toLowerCase() || grant.vaultId !== vaultId.toLowerCase())
      throw new IntentRefusal("rejected", "Command grant does not belong to this owner and vault.");
    if (grant.agent !== getAgentKeypair().getPublicKey().toSuiAddress().toLowerCase())
      throw new IntentRefusal("rejected", "Agent key does not match the command grant on chain.");

    const approved = grant.recipients.map((recipient) => ({ name: recipient.name, aliases: [], address: recipient.address }));
    const parsed = bill.image
      ? await parseInvoiceFromImage(bill.image.bytes, bill.image.mimeType, approved)
      : await parseInvoiceFromRawText(bill.text ?? "", approved);
    const normalized = normalizeSuiAddress(parsed.parsed.vendorAddress);
    const recipient = grant.recipients.find((row) => normalizeSuiAddress(row.address) === normalized);
    if (!recipient) throw new IntentRefusal("rejected", "Invoice recipient is not on the on-chain command whitelist.");
    if (parsed.parsed.vendorName.trim().toLocaleLowerCase("en-US") !== recipient.name.trim().toLocaleLowerCase("en-US"))
      throw new IntentRefusal("rejected", "Invoice merchant does not match the registered whitelist name.");
    const amountMist = invoiceAmountToMistString(parsed.parsed);
    validateTransferPayment(grant, recipient.address, amountMist, owner, vaultId);
    await assertCurrentVaultGrant(vaultId, grant.id);

    const now = new Date();
    const proposal: ChatProposal = {
      proposalId: randomUUID(), requestId: bill.requestId, owner, vaultId,
      grantId: grant.id, action: "transfer", messageHash,
      billFingerprint: bill.fingerprint, billPeriod,
      recipientName: recipient.name, recipientAddress: recipient.address, amountMist,
      state: "ready", txDigest: null, signedBytes: null, signature: null,
      errorMessage: null, executionLease: null, lockUntil: null,
      expiresAt: new Date(now.getTime() + 10 * 60_000), createdAt: now, updatedAt: now,
    };
    try { await collection.insertOne(proposal); }
    catch (error) {
      if (!error || typeof error !== "object" || !("code" in error) || error.code !== 11000) throw error;
      const raced = await collection.findOne(key) ?? await collection.findOne({
        owner, vaultId, billPeriod, billFingerprint: bill.fingerprint,
      });
      if (!raced || raced.messageHash !== messageHash) throw new Error("requestId or invoiceId already belongs to different bill data");
      if (raced.state === "ready" && raced.expiresAt > new Date()) return NextResponse.json(preview(raced));
      return NextResponse.json({ status: raced.state, proposalId: raced.proposalId,
        txDigest: raced.txDigest, message: raced.errorMessage ?? "This bill request has already been processed.",
        reasonSource: raced.state === "rejected" ? "server" : "chain" });
    }
    return NextResponse.json(preview(proposal));
  } catch (error) {
    if (error instanceof IntentRefusal) return NextResponse.json({ status: error.status,
      message: error.message, reasonSource: "server" });
    const message = error instanceof Error ? error.message : "Cannot read bill";
    const status = /owner|Session|Sign in/.test(message) ? 401 : /Gemini|AI could not/.test(message) ? 503 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

function preview(proposal: ChatProposal) {
  return { status: "ready", action: "transfer", proposalId: proposal.proposalId,
    preview: { recipientName: proposal.recipientName, recipientAddress: proposal.recipientAddress,
      amountMist: proposal.amountMist, source: "vault", grantId: proposal.grantId },
    message: "Review the bill details and confirm to let the agent submit payment.", reasonSource: "server" };
}
