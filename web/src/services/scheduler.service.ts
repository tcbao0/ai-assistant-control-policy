import { readPolicy, type ChainService } from "@/services/policy-read.service";
import {
  claimPendingRun,
  createOrGetRun,
  resetUnsignedFailure,
  updateRun,
  runs,
} from "@/services/mongo.service";
import { executeSubscriptionPayment, reconcileSignedPayment } from "@/services/sui.service";
import type { OwnerWorkspace } from "@/services/mongo.service";

export interface SchedulerItem {
  invoiceId: string;
  serviceName: string;
  state: string;
  error?: string;
  skipped?: string;
  txDigest?: string | null;
}

function utcNow() {
  const now = new Date();
  return {
    month: now.getUTCFullYear() * 12 + now.getUTCMonth(),
    day: now.getUTCDate(),
    daysInMonth: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate(),
  };
}

function skipReason(service: ChainService, month: number, day: number, daysInMonth: number): string | null {
  if (service.paymentDay > daysInMonth || day < service.paymentDay) {
    return `Not due yet. Payment day is ${service.paymentDay}; UTC today is day ${day}.`;
  }
  if (month >= service.startMonth + service.months) {
    return "Subscription duration has ended.";
  }
  if (service.lastPaidMonth === month) {
    return "Already paid this UTC month.";
  }
  return null;
}

export async function runDueSubscriptionsForWorkspace(workspace: OwnerWorkspace): Promise<SchedulerItem[]> {
  const results: SchedulerItem[] = [];
  if (!workspace.policyId) return results;
  const policy = await readPolicy(workspace.owner);
  if (!policy.active) {
    return [{ invoiceId: workspace.policyId, serviceName: "policy", state: "skipped", skipped: "Policy is revoked." }];
  }
  const { month, day, daysInMonth } = utcNow();
  for (const service of policy.services) {
    const invoiceId = `scheduled:${workspace.policyId}:${service.address}:${month}`;
    const skipped = skipReason(service, month, day, daysInMonth);
    if (skipped) {
      results.push({ invoiceId, serviceName: service.name, state: "skipped", skipped });
      continue;
    }
    const invoiceRaw = `Scheduled subscription: ${service.name} (${service.address}), month ${month}`;
    let run = await createOrGetRun({
      invoiceId, invoiceRaw, owner: workspace.owner, vaultId: workspace.vaultId, policyId: workspace.policyId,
    });
    if (run.state === "failed" && !run.txDigest) {
      run = await resetUnsignedFailure(run) ?? run;
    }
    if (run.state === "confirmed") {
      results.push({ invoiceId, serviceName: service.name, state: "confirmed", txDigest: run.txDigest });
      continue;
    }
    if (run.state === "submitted" && run.txDigest && run.signedBytes && run.signature) {
      try {
        const chain = await reconcileSignedPayment({
          digest: run.txDigest, bytes: run.signedBytes, signature: run.signature,
        });
        const state = chain.status === "success" ? "confirmed" : chain.status === "failure" ? "failed" : "submitted";
        await updateRun(run, { state, errorMessage: chain.error ?? null });
        results.push({ invoiceId, serviceName: service.name, state, txDigest: run.txDigest, error: chain.error ?? undefined });
      } catch (error) {
        results.push({ invoiceId, serviceName: service.name, state: "submitted", txDigest: run.txDigest, error: String(error) });
      }
      continue;
    }
    if (run.state !== "pending" || !await claimPendingRun(run)) {
      results.push({ invoiceId, serviceName: service.name, state: run.state, error: run.errorMessage ?? undefined, txDigest: run.txDigest });
      continue;
    }
    try {
      const amountMist = BigInt(service.chargeAmount);
      if (amountMist <= 0n || amountMist > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Scheduled amount is out of safe range");
      const parsed = { vendorName: service.name, vendorAddress: service.address, amount: Number(amountMist) / 1e9 };
      await updateRun(run, { parsed, amountMist: service.chargeAmount });
      const payment = await executeSubscriptionPayment({
        parsed, policyId: workspace.policyId, vaultId: workspace.vaultId,
        onSigned: async (signed) => {
          await updateRun(run, {
            state: "submitted", txDigest: signed.digest, signedBytes: signed.bytes,
            signature: signed.signature, parsed, amountMist: service.chargeAmount, lockUntil: null,
          });
        },
      });
      await updateRun(run, { state: "confirmed", txDigest: payment.txDigest, lockUntil: null });
      results.push({ invoiceId, serviceName: service.name, state: "confirmed", txDigest: payment.txDigest });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const current = await (await runs()).findOne({ owner: workspace.owner, vaultId: workspace.vaultId, invoiceId });
      if (current?.state !== "submitted") await updateRun(run, { state: "failed", errorMessage: message, lockUntil: null });
      results.push({
        invoiceId, serviceName: service.name, state: current?.state ?? "failed",
        error: message, txDigest: current?.txDigest,
      });
    }
  }
  return results;
}
