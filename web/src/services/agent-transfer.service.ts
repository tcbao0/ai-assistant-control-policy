import { Transaction } from "@mysten/sui/transactions";
import { getAgentEnv } from "@/lib/env";
import { mapSuiErrorToPolicy } from "@/lib/sui/abort-codes";
import { getAgentKeypair, getSuiClient, SuiPolicyRejectedError, toSuiExecutionError } from "@/services/sui.service";
import { requireWorkspace } from "@/services/workspace.service";

type Fields = Record<string, unknown>;
function fields(value: unknown): Fields {
  if (!value || typeof value !== "object") return {};
  const row = value as Fields;
  return row.fields && typeof row.fields === "object" ? row.fields as Fields : row;
}
function moveString(value: unknown): string {
  if (typeof value === "string") return value;
  const row = fields(value);
  if (Array.isArray(row.bytes)) return new TextDecoder().decode(Uint8Array.from(row.bytes as number[]));
  return "";
}
function moveAddress(value: unknown): string {
  if (typeof value === "string") return value.toLowerCase();
  const row = fields(value);
  return typeof row.id === "string" ? row.id.toLowerCase() : "";
}

export interface ChainTransferGrant {
  id: string;
  vaultId: string;
  owner: string;
  agent: string;
  active: boolean;
  perPaymentLimit: string;
  dailyBudget: string;
  spentDay: string;
  spentAmount: string;
  expiresAtMs: string;
  nonce: string;
  recipients: Array<{ address: string; name: string }>;
}

/** Read the public, owner-approved grant directly from Sui. Mongo is never whitelist authority. */
export async function readTransferGrant(owner: string): Promise<ChainTransferGrant> {
  const workspace = await requireWorkspace(owner);
  const id = workspace.transferGrantId;
  if (!id) throw new Error("No transfer grant is registered for this vault");
  const { object } = await getSuiClient().getObject({ objectId: id, include: { json: true } });
  if (!object?.json) throw new Error("Transfer grant object not found on chain");
  const grant = fields(object.json);
  const map = fields(grant.recipients);
  const contents = Array.isArray(map.contents) ? map.contents : [];
  return {
    id,
    vaultId: moveAddress(grant.vault_id),
    owner: moveAddress(grant.owner),
    agent: moveAddress(grant.agent),
    active: grant.active === true,
    perPaymentLimit: String(grant.per_payment_limit ?? "0"),
    dailyBudget: String(grant.daily_budget ?? "0"),
    spentDay: String(grant.spent_day ?? "0"),
    spentAmount: String(grant.spent_amount ?? "0"),
    expiresAtMs: String(grant.expires_at_ms ?? "0"),
    nonce: String(grant.nonce ?? "0"),
    recipients: contents.map((entry) => {
      const pair = fields(entry);
      return { address: moveAddress(pair.key), name: moveString(pair.value) };
    }).filter((recipient) => !!recipient.address && !!recipient.name),
  };
}

export async function executeAgentTransfer(input: {
  grantId: string;
  vaultId: string;
  recipientAddress: string;
  amountMist: string;
  expectedNonce: string;
  onSigned: (signed: { digest: string; bytes: string; signature: string }) => Promise<void>;
}): Promise<{ txDigest: string }> {
  const env = getAgentEnv();
  const client = getSuiClient(env);
  const keypair = getAgentKeypair(env);
  const tx = new Transaction();
  tx.setSender(keypair.getPublicKey().toSuiAddress());
  tx.moveCall({
    target: `${env.publishedAt}::transfer_grant::execute_transfer_or_abort`,
    arguments: [
      tx.object(input.grantId), tx.object(input.vaultId), tx.object(env.clockId),
      tx.pure.address(input.recipientAddress), tx.pure.u64(BigInt(input.amountMist)),
      tx.pure.u64(BigInt(input.expectedNonce)),
    ],
  });
  try {
    const transactionBytes = await tx.build({ client });
    const digest = await tx.getDigest({ client });
    const signed = await keypair.signTransaction(transactionBytes);
    await input.onSigned({ digest, bytes: signed.bytes, signature: signed.signature });
    const result = await client.executeTransaction({
      transaction: Uint8Array.from(Buffer.from(signed.bytes, "base64")),
      signatures: [signed.signature], include: { effects: true, events: true },
    });
    const executed = result.Transaction ?? result.FailedTransaction;
    if (!executed.status.success) {
      const abort = mapSuiErrorToPolicy(executed.status.error);
      if (abort) throw new SuiPolicyRejectedError(abort, executed.digest);
      throw toSuiExecutionError(executed.status.error, keypair.getPublicKey().toSuiAddress());
    }
    return { txDigest: executed.digest };
  } catch (error) {
    if (error instanceof SuiPolicyRejectedError) throw error;
    const abort = mapSuiErrorToPolicy(error);
    if (abort) throw new SuiPolicyRejectedError(abort);
    throw toSuiExecutionError(error, keypair.getPublicKey().toSuiAddress());
  }
}
