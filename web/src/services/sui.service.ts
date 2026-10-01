import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";

import { getAgentEnv, type AgentEnv, type SuiNetwork } from "@/lib/env";
import {
  explainAbortCode,
  mapSuiErrorToPolicy,
  type ParsedMoveAbort,
  stringifyError,
} from "@/lib/sui/abort-codes";
import { mistToString, suiToMist } from "@/lib/sui/mist";
import type { ParsedInvoice } from "@/types/invoice";

export class SuiPolicyRejectedError extends Error {
  readonly code = "POLICY_REJECTED" as const;
  readonly abort: ParsedMoveAbort;
  readonly txDigest: string | null;

  constructor(abort: ParsedMoveAbort, txDigest: string | null = null) {
    super(abort.policyMessage);
    this.name = "SuiPolicyRejectedError";
    this.abort = abort;
    this.txDigest = txDigest;
  }
}

export class SuiExecutionError extends Error {
  readonly code = "SUI_EXECUTION_ERROR" as const;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SuiExecutionError";
  }
}

export interface ExecutePaymentInput {
  parsed: ParsedInvoice;
  /** Resolved from the authenticated owner's workspace. */
  policyId: string;
  vaultId: string;
  /** Optional overrides for tests */
  env?: AgentEnv;
  onSigned?: (tx: { digest: string; bytes: string; signature: string }) => Promise<void>;
}

export interface ExecutePaymentSuccess {
  ok: true;
  txDigest: string;
  amountMist: string;
  vendorAddress: string;
  agentAddress: string;
}

let cachedClient: SuiGrpcClient | null = null;
let cachedKeypair: Ed25519Keypair | null = null;
let cachedKeyFingerprint: string | null = null;

export function getSuiClient(env: Pick<AgentEnv, "suiNetwork" | "suiRpcUrl"> = getAgentEnv()): SuiGrpcClient {
  if (cachedClient) return cachedClient;
  const url = env.suiRpcUrl ?? resolveFullnodeUrl(env.suiNetwork);
  cachedClient = new SuiGrpcClient({ baseUrl: url, network: env.suiNetwork });
  return cachedClient;
}

export function getReadOnlySuiClient(): SuiGrpcClient {
  const network = process.env.SUI_NETWORK ?? "testnet";
  if (!["mainnet", "testnet", "devnet", "localnet"].includes(network)) throw new Error("Invalid SUI_NETWORK");
  return getSuiClient({ suiNetwork: network as SuiNetwork, suiRpcUrl: process.env.SUI_RPC_URL });
}

export function getAgentKeypair(env: AgentEnv = getAgentEnv()): Ed25519Keypair {
  if (cachedKeypair && cachedKeyFingerprint === env.agentPrivateKey) {
    return cachedKeypair;
  }
  cachedKeypair = loadEd25519Keypair(env.agentPrivateKey);
  cachedKeyFingerprint = env.agentPrivateKey;
  return cachedKeypair;
}

function resolveFullnodeUrl(network: SuiNetwork): string {
  if (network === "localnet") {
    return "http://127.0.0.1:9000";
  }
  return `https://fullnode.${network}.sui.io:443`;
}

/**
 * Load agent key from:
 * - `suiprivkey1...` bech32 (recommended)
 * - `0x` / bare hex of a 32-byte Ed25519 secret key
 */
export function loadEd25519Keypair(secret: string): Ed25519Keypair {
  const trimmed = secret.trim();
  if (!trimmed) {
    throw new SuiExecutionError("AGENT_PRIVATE_KEY is empty.");
  }

  if (trimmed.startsWith("suiprivkey")) {
    const decoded = decodeSuiPrivateKey(trimmed);
    return Ed25519Keypair.fromSecretKey(decoded.secretKey);
  }

  const hex = trimmed.startsWith("0x") ? trimmed.slice(2) : trimmed;
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length !== 64) {
    throw new SuiExecutionError(
      "AGENT_PRIVATE_KEY must be suiprivkey... or 32-byte hex (64 chars).",
    );
  }
  const bytes = Uint8Array.from(Buffer.from(hex, "hex"));
  return Ed25519Keypair.fromSecretKey(bytes);
}

/**
 * Build + sign + execute `payment::execute_payment_or_abort`.
 *
 * We intentionally call the hard-abort entrypoint so Move policy violations
 * surface as VM abort codes that map cleanly to UI strings. Soft-fail
 * `execute_payment` remains available on-chain for event-indexing demos.
 */
export async function executeSubscriptionPayment(
  input: ExecutePaymentInput,
): Promise<ExecutePaymentSuccess> {
  const env = input.env ?? getAgentEnv();
  const { policyId, vaultId } = input;
  const client = getSuiClient(env);
  const keypair = getAgentKeypair(env);
  const agentAddress = keypair.getPublicKey().toSuiAddress();

  const amountMist = suiToMist(input.parsed.amount);
  const amountMistStr = mistToString(amountMist);

  const tx = new Transaction();
  tx.setSender(agentAddress);

  tx.moveCall({
    target: env.paymentTarget as `${string}::${string}::${string}`,
    arguments: [
      tx.object(policyId),
      tx.object(vaultId),
      tx.object(env.clockId),
      tx.pure.address(input.parsed.vendorAddress),
      tx.pure.u64(amountMist),
    ],
  });

  try {
    const transactionBytes = await tx.build({ client });
    const digest = await tx.getDigest({ client });
    const signed = await keypair.signTransaction(transactionBytes);
    await input.onSigned?.({ digest, bytes: signed.bytes, signature: signed.signature });
    const result = await client.executeTransaction({
      transaction: Uint8Array.from(Buffer.from(signed.bytes, "base64")),
      signatures: [signed.signature],
      include: { effects: true, events: true },
    });
    const executed = result.Transaction ?? result.FailedTransaction;
    const returnedDigest = executed.digest;

    if (!executed.status.success) {
      const abort = mapFailureToAbort(executed.status.error);
      throw new SuiPolicyRejectedError(abort, returnedDigest);
    }

    return {
      ok: true,
      txDigest: returnedDigest,
      amountMist: amountMistStr,
      vendorAddress: input.parsed.vendorAddress,
      agentAddress,
    };
  } catch (error) {
    if (error instanceof SuiPolicyRejectedError) throw error;

    const abort = mapSuiErrorToPolicy(error);
    if (abort) {
      throw new SuiPolicyRejectedError(abort, null);
    }

    throw toSuiExecutionError(error, agentAddress);
  }
}

/** Map RPC/gas failures to an actionable error. Vault SUI never pays agent gas. */
export function toSuiExecutionError(error: unknown, agentAddress?: string): SuiExecutionError {
  if (error instanceof SuiExecutionError) return error;
  const text = stringifyError(error);
  if (/insufficient SUI balance|gas selection/i.test(text)) {
    const address = agentAddress ?? getAgentKeypair().getPublicKey().toSuiAddress();
    return new SuiExecutionError(
      `Agent wallet ${address} has no SUI for gas. Vault funds pay the recipient only. Send ~0.1 testnet SUI to that agent address (https://faucet.sui.io).`,
      { cause: error instanceof Error ? error : undefined },
    );
  }
  return new SuiExecutionError(`Sui transaction failed: ${text}`, {
    cause: error instanceof Error ? error : undefined,
  });
}

/** Reconcile or rebroadcast the exact signed transaction on retry. */
export async function reconcileSignedPayment(signed: { digest: string; bytes: string; signature: string }) {
  const client = getSuiClient();
  try {
    const found = await client.getTransaction({ digest: signed.digest, include: { effects: true } });
    const tx = found.Transaction ?? found.FailedTransaction;
    return { digest: tx.digest, status: tx.status.success ? "success" : "failure", error: tx.status.error ? stringifyError(tx.status.error) : null };
  } catch {
    const result = await client.executeTransaction({ transaction: Uint8Array.from(Buffer.from(signed.bytes, "base64")), signatures: [signed.signature], include: { effects: true } });
    const tx = result.Transaction ?? result.FailedTransaction;
    return { digest: tx.digest, status: tx.status.success ? "success" : "failure", error: tx.status.error ? stringifyError(tx.status.error) : null };
  }
}

function mapFailureToAbort(error: unknown): ParsedMoveAbort {
  const mapped = mapSuiErrorToPolicy(error);
  if (mapped) return mapped;

  // effects.status.error is often a structured object — stringify and retry.
  const text = stringifyError(error);
  const retry = mapSuiErrorToPolicy(text);
  if (retry) return retry;

  return explainAbortCode(-1);
}

/** Convert ParsedInvoice amount → MIST string (exposed for route logging). */
export function invoiceAmountToMistString(parsed: ParsedInvoice): string {
  return mistToString(suiToMist(parsed.amount));
}

/** Reset singleton caches (tests). */
export function __resetSuiServiceCache(): void {
  cachedClient = null;
  cachedKeypair = null;
  cachedKeyFingerprint = null;
}
