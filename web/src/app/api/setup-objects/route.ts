import { NextRequest, NextResponse } from "next/server";
import { assertSameOrigin, requireOwner } from "@/services/auth.service";
import { getReadOnlySuiClient } from "@/services/sui.service";
import { deploymentConfig, requireWorkspace } from "@/services/workspace.service";
import { updateOwnerWorkspace } from "@/services/mongo.service";
import { z } from "zod";

export const runtime = "nodejs";
const Body = z.object({ digest: z.string().regex(/^[A-HJ-NP-Za-km-z1-9]{40,50}$/) });

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const owner = await requireOwner(req);
    const workspace = await requireWorkspace(owner);
    const { digest } = Body.parse(await req.json());
    const { packageId } = deploymentConfig();
    const result = await getReadOnlySuiClient().getTransaction({ digest, include: { effects: true, objectTypes: true, transaction: true } });
    const tx = result.Transaction ?? result.FailedTransaction;
    if (!tx.status.success) throw new Error("Policy creation transaction failed");
    if (!tx.transaction?.sender || tx.transaction.sender.toLowerCase() !== owner) throw new Error("Transaction was not signed by this wallet");
    const created = (tx.effects?.changedObjects ?? []).filter((row) => row.idOperation === "Created");
    const policyId = created.find((row) => tx.objectTypes?.[row.objectId]?.toLowerCase() === `${packageId}::policy::subscriptionpolicy`)?.objectId;
    const policyAdminCapId = created.find((row) => tx.objectTypes?.[row.objectId]?.toLowerCase() === `${packageId}::policy::policyadmincap`)?.objectId;
    if (policyId && policyAdminCapId) {
      const [{ object: policy }, { object: cap }] = await Promise.all([
        getReadOnlySuiClient().getObject({ objectId: policyId, include: { json: true } }),
        getReadOnlySuiClient().getObject({ objectId: policyAdminCapId, include: { json: true } }),
      ]);
      if (String(policy?.json?.vault_id ?? "").toLowerCase() !== workspace.vaultId.toLowerCase() ||
          String(policy?.json?.issuer ?? "").toLowerCase() !== owner ||
          String(cap?.json?.policy_id ?? "").toLowerCase() !== policyId.toLowerCase()) {
        throw new Error("Created policy or admin cap does not match this wallet's vault");
      }
      const updated = await updateOwnerWorkspace(owner, workspace.network, workspace.packageId, { policyId, policyAdminCapId });
      return NextResponse.json({ policyId: updated?.policyId, adminCapId: updated?.policyAdminCapId, workspace: updated });
    }

    const transferGrantId = created.find((row) => tx.objectTypes?.[row.objectId]?.toLowerCase() === `${packageId}::transfer_grant::transfergrant`)?.objectId;
    const transferAdminCapId = created.find((row) => tx.objectTypes?.[row.objectId]?.toLowerCase() === `${packageId}::transfer_grant::transferadmincap`)?.objectId;
    if (!transferGrantId || !transferAdminCapId) throw new Error("Transaction did not create a policy or transfer grant and its admin capability");
    const [{ object: grant }, { object: cap }] = await Promise.all([
      getReadOnlySuiClient().getObject({ objectId: transferGrantId, include: { json: true } }),
      getReadOnlySuiClient().getObject({ objectId: transferAdminCapId, include: { json: true } }),
    ]);
    if (String(grant?.json?.vault_id ?? "").toLowerCase() !== workspace.vaultId.toLowerCase() ||
        String(grant?.json?.owner ?? "").toLowerCase() !== owner ||
        String(cap?.json?.grant_id ?? "").toLowerCase() !== transferGrantId.toLowerCase()) {
      throw new Error("Created transfer grant or admin cap does not match this wallet's vault");
    }
    const updated = await updateOwnerWorkspace(owner, workspace.network, workspace.packageId, { transferGrantId, transferAdminCapId });
    return NextResponse.json({ transferGrantId: updated?.transferGrantId, transferAdminCapId: updated?.transferAdminCapId, workspace: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cannot inspect transaction";
    return NextResponse.json({ error: message }, { status: /owner|Session|Sign in/.test(message) ? 401 : 400 });
  }
}
