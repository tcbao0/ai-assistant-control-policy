import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { mapSuiErrorToPolicy } from "@/lib/sui/abort-codes";
import { normalizeSuiAddress } from "@/lib/vendors";
import { assertSameOrigin, requireOwner } from "@/services/auth.service";
import { executeAgentTransfer, readTransferGrant } from "@/services/agent-transfer.service";
import { assertCurrentVaultGrant, IntentRefusal, validateTransferPayment } from "@/services/intent.service";
import { chatProposals, type ChatProposal } from "@/services/mongo.service";
import { reconcileSignedPayment, SuiPolicyRejectedError } from "@/services/sui.service";
import { requireWorkspace } from "@/services/workspace.service";

export const runtime = "nodejs";
const ConfirmBody = z.object({ proposalId: z.string().uuid() });

function result(status: "submitted" | "confirmed" | "failed" | "rejected", message: string,
  txDigest: string | null, reasonSource: "server" | "chain", httpStatus = 200) {
  return NextResponse.json({ status, txDigest, message, reasonSource }, { status: httpStatus });
}

async function reconcile(proposal: ChatProposal) {
  if (!proposal.txDigest || !proposal.signedBytes || !proposal.signature)
    return result("submitted", "Giao dịch đang được ký; hãy kiểm tra lại sau.", null, "server", 202);
  try {
    const execution = await reconcileSignedPayment({ digest: proposal.txDigest,
      bytes: proposal.signedBytes, signature: proposal.signature });
    if (execution.status === "success") {
      await (await chatProposals()).updateOne({ owner: proposal.owner, vaultId: proposal.vaultId,
        proposalId: proposal.proposalId, state: "submitted" },
      { $set: { state: "confirmed", txDigest: execution.digest, errorMessage: null,
        executionLease: null, lockUntil: null, updatedAt: new Date() } });
      return result("confirmed", "Giao dịch đã hoàn tất trên Sui.", execution.digest, "chain");
    }
    const abort = mapSuiErrorToPolicy(execution.error);
    const message = abort?.policyMessage ?? execution.error ?? "Sui từ chối giao dịch.";
    await (await chatProposals()).updateOne({ owner: proposal.owner, vaultId: proposal.vaultId,
      proposalId: proposal.proposalId, state: "submitted" },
    { $set: { state: "failed", txDigest: execution.digest,
      errorMessage: message, executionLease: null,
      lockUntil: null, updatedAt: new Date() } });
    return result("failed", message, execution.digest, "chain", 422);
  } catch {
    return result("submitted", "Đã ký giao dịch; đang chờ Sui xác nhận. Thử kiểm tra lại sau.", proposal.txDigest, "server", 202);
  }
}

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const owner = await requireOwner(req);
    const { proposalId } = ConfirmBody.parse(await req.json());
    const workspace = await requireWorkspace(owner);
    const vaultId = workspace.vaultId;
    const collection = await chatProposals();
    const key = { owner, vaultId, proposalId };
    let proposal = await collection.findOne(key);
    if (!proposal) return result("rejected", "Không tìm thấy yêu cầu cần xác nhận.", null, "server", 404);
    if (proposal.state === "confirmed") return result("confirmed", "Giao dịch đã hoàn tất trên Sui.", proposal.txDigest, "chain");
    if (proposal.state === "submitted") return reconcile(proposal);
    if (proposal.state === "failed" || proposal.state === "rejected" || proposal.state === "expired")
      return result(proposal.state === "expired" ? "rejected" : proposal.state,
        proposal.errorMessage ?? "Yêu cầu này đã kết thúc.", proposal.txDigest, "server", 409);
    if (proposal.expiresAt <= new Date()) {
      await collection.updateOne({ ...key, state: "ready" }, { $set: { state: "expired", updatedAt: new Date() } });
      return result("rejected", "Bản xem trước đã hết hạn; hãy gửi lại lệnh.", null, "server", 409);
    }
    const lease = randomUUID();
    proposal = await collection.findOneAndUpdate({ ...key, txDigest: null,
      state: { $in: ["ready", "signing"] }, expiresAt: { $gt: new Date() },
      $or: [{ lockUntil: null }, { lockUntil: { $lt: new Date() } }] },
      { $set: { state: "signing", executionLease: lease,
        lockUntil: new Date(Date.now() + 10 * 60_000), updatedAt: new Date() } },
      { returnDocument: "after" });
    if (!proposal) {
      const current = await collection.findOne(key);
      if (current?.state === "submitted") return reconcile(current);
      if (current?.state === "confirmed") return result("confirmed", "Giao dịch đã hoàn tất trên Sui.", current.txDigest, "chain");
      return result("submitted", "Yêu cầu đang được xử lý.", current?.txDigest ?? null, "server", 202);
    }
    const claimed = proposal;
    const onSigned = async (signed: { digest: string; bytes: string; signature: string }) => {
      const updated = await collection.updateOne({ ...key, state: "signing", executionLease: lease,
        txDigest: null }, { $set: { state: "submitted", txDigest: signed.digest,
          signedBytes: signed.bytes, signature: signed.signature,
          executionLease: null, lockUntil: null, updatedAt: new Date() } });
      if (updated.modifiedCount !== 1) throw new Error("Transaction signing lease was lost; execution cancelled");
    };

    try {
      if (claimed.action !== "transfer")
        throw new IntentRefusal("rejected", "Chat chỉ thanh toán grant lệnh tay. Subscription tự động chạy qua scheduler.");
      const grant = await readTransferGrant(owner);
      if (normalizeSuiAddress(grant.id) !== normalizeSuiAddress(claimed.grantId))
        throw new IntentRefusal("rejected", "TransferGrant đã thay đổi; hãy tạo yêu cầu mới.");
      const recipient = grant.recipients.find((row) => normalizeSuiAddress(row.address) === normalizeSuiAddress(claimed.recipientAddress));
      if (!recipient || recipient.name !== claimed.recipientName)
        throw new IntentRefusal("rejected", "Người nhận đã thay đổi trên chain; hãy tạo yêu cầu mới.");
      validateTransferPayment(grant, recipient.address, claimed.amountMist, owner, vaultId);
      await assertCurrentVaultGrant(vaultId, grant.id);
      const execution = await executeAgentTransfer({ grantId: grant.id, vaultId, recipientAddress: recipient.address,
        amountMist: claimed.amountMist, expectedNonce: grant.nonce, onSigned });
      await collection.updateOne({ ...key, state: "submitted", txDigest: execution.txDigest },
        { $set: { state: "confirmed", errorMessage: null, updatedAt: new Date() } });
      return result("confirmed", "Đã chuyển SUI từ vault qua TransferGrant.", execution.txDigest, "chain");
    } catch (error) {
      const latest = await collection.findOne(key);
      if (latest?.state === "submitted") return reconcile(latest);
      const message = error instanceof SuiPolicyRejectedError ? error.abort.policyMessage :
        error instanceof Error ? error.message : "Không thể xử lý giao dịch";
      const state = error instanceof IntentRefusal ? "rejected" : "failed";
      await collection.updateOne({ ...key, state: "signing", executionLease: lease },
        { $set: { state, errorMessage: message, executionLease: null,
          lockUntil: null, updatedAt: new Date() } });
      return result(state, message, error instanceof SuiPolicyRejectedError ? error.txDigest : null,
        error instanceof SuiPolicyRejectedError ? "chain" : "server", 422);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cannot confirm command";
    return NextResponse.json({ error: message }, { status: /owner|Session|Sign in/.test(message) ? 401 : 400 });
  }
}
