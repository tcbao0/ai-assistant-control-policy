import { NextRequest, NextResponse } from "next/server";
import { getReadOnlySuiClient } from "@/services/sui.service";
import { z } from "zod";
import { assertSameOrigin, requireOwner } from "@/services/auth.service";
import { registerOwnerVault } from "@/services/mongo.service";
import { deploymentConfig } from "@/services/workspace.service";

export const runtime = "nodejs";

const Body = z.object({ digest: z.string().regex(/^[A-HJ-NP-Za-km-z1-9]{40,50}$/) });

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const owner = await requireOwner(req);
    const { digest } = Body.parse(await req.json());
    const { packageId, network } = deploymentConfig();
    const result = await getReadOnlySuiClient().getTransaction({ digest, include: { effects: true, objectTypes: true, transaction: true } });
    const tx = result.Transaction ?? result.FailedTransaction;
    if (!tx.status.success || !tx.transaction?.sender || tx.transaction.sender.toLowerCase() !== owner) throw new Error("Vault transaction must succeed and be signed by this wallet");
    const created = tx.effects?.changedObjects.find((change) => change.idOperation === "Created" &&
      tx.objectTypes?.[change.objectId]?.toLowerCase() === `${packageId}::vault::vault`);
    if (!created) throw new Error("No vault from the configured package was created in this transaction");
    const { object } = await getReadOnlySuiClient().getObject({ objectId: created.objectId, include: { json: true } });
    if (!object?.json || object.type.toLowerCase() !== `${packageId}::vault::vault` ||
        String(object.json.owner ?? "").toLowerCase() !== owner) throw new Error("Created vault owner or package does not match the signed-in wallet");
    const workspace = await registerOwnerVault({ owner, network, packageId, vaultId: created.objectId });
    return NextResponse.json({ vaultId: workspace?.vaultId, owner, packageId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cannot register vault";
    return NextResponse.json({ error: message }, { status: /owner|Session|Sign in/.test(message) ? 401 : 400 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const digest = req.nextUrl.searchParams.get("digest");
    if (!digest || !/^[A-HJ-NP-Za-km-z1-9]{40,50}$/.test(digest)) throw new Error("Invalid transaction digest");
    const packageId = process.env.PACKAGE_ID?.toLowerCase();
    if (!packageId) throw new Error("PACKAGE_ID is missing");
    const result = await getReadOnlySuiClient().getTransaction({ digest, include: { effects: true, objectTypes: true, transaction: true } });
    const tx = result.Transaction ?? result.FailedTransaction;
    if (!tx.status.success) throw new Error("Vault creation transaction failed");
    const vault = tx.effects?.changedObjects.find((change) => change.idOperation === "Created" &&
      tx.objectTypes?.[change.objectId]?.toLowerCase() === `${packageId}::vault::vault`);
    if (!vault) throw new Error("Vault creation not found in transaction");
    return NextResponse.json({ vaultId: vault.objectId, owner: tx.transaction?.sender });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Cannot read vault transaction" }, { status: 400 });
  }
}
