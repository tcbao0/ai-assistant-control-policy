import { MongoClient, type Collection } from "mongodb";
import type { ParsedInvoice } from "@/types/invoice";

export type RunState = "pending" | "submitted" | "confirmed" | "failed";
export interface InvoiceRun {
  invoiceId: string;
  owner: string;
  vaultId: string;
  policyId: string;
  invoiceRaw: string;
  state: RunState;
  parsed: ParsedInvoice | null;
  amountMist: string | null;
  txDigest: string | null;
  signedBytes: string | null;
  signature: string | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  lockUntil: Date | null;
}

let clientPromise: Promise<MongoClient> | null = null;
let indexPromise: Promise<void> | null = null;

export async function database() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is required");
  try {
    clientPromise ??= new MongoClient(uri, { serverSelectionTimeoutMS: 8000, connectTimeoutMS: 8000 })
      .connect()
      .catch((error) => { clientPromise = null; throw error; });
    return (await clientPromise).db(process.env.MONGODB_DB ?? "subscription_manager");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/timed out|ECONNREFUSED|ENOTFOUND|MongoNetworkError/i.test(message)) {
      throw new Error("Cannot reach MongoDB. Start MongoDB on 127.0.0.1:27017 and retry.");
    }
    throw error;
  }
}

export async function runs(): Promise<Collection<InvoiceRun>> {
  const collection = (await database()).collection<InvoiceRun>("invoice_runs");
  indexPromise ??= (async () => {
    await collection.createIndex({ owner: 1, vaultId: 1, invoiceId: 1 }, { unique: true });
    await collection.createIndex({ owner: 1, vaultId: 1, createdAt: -1 });
  })().catch((error) => { indexPromise = null; throw error; });
  await indexPromise;
  return collection;
}

export async function createOrGetRun(input: Pick<InvoiceRun, "invoiceId" | "owner" | "vaultId" | "policyId" | "invoiceRaw">) {
  const collection = await runs();
  const key = { owner: input.owner, vaultId: input.vaultId, invoiceId: input.invoiceId };
  const now = new Date();
  try {
    await collection.updateOne(key, {
      $setOnInsert: {
        ...input, state: "pending", parsed: null, amountMist: null,
        txDigest: null, signedBytes: null, signature: null, errorMessage: null,
        createdAt: now, updatedAt: now, lockUntil: null,
      },
    }, { upsert: true });
  } catch (error) {
    if (!error || typeof error !== "object" || !("code" in error) || error.code !== 11000) throw error;
  }
  const run = await collection.findOne(key);
  if (!run) throw new Error("Unable to read invoice run");
  if (run.invoiceRaw !== input.invoiceRaw || run.policyId !== input.policyId) {
    throw new Error("invoiceId already belongs to different invoice data");
  }
  return run;
}

export async function claimPendingRun(run: InvoiceRun) {
  return (await runs()).findOneAndUpdate(
    { owner: run.owner, vaultId: run.vaultId, invoiceId: run.invoiceId,
      state: "pending", $or: [{ lockUntil: null }, { lockUntil: { $lt: new Date() } }] },
    { $set: { lockUntil: new Date(Date.now() + 5 * 60_000), updatedAt: new Date() } },
    { returnDocument: "after" },
  );
}

export async function resetUnsignedFailure(run: InvoiceRun) {
  return (await runs()).findOneAndUpdate(
    { owner: run.owner, vaultId: run.vaultId, invoiceId: run.invoiceId,
      state: "failed", txDigest: null },
    { $set: { state: "pending", errorMessage: null, lockUntil: null, updatedAt: new Date() } },
    { returnDocument: "after" },
  );
}

export async function updateRun(run: InvoiceRun, patch: Partial<InvoiceRun>) {
  const collection = await runs();
  await collection.updateOne(
    { owner: run.owner, vaultId: run.vaultId, invoiceId: run.invoiceId },
    { $set: { ...patch, updatedAt: new Date() } },
  );
}

export async function listRuns(owner: string, vaultId: string, limit = 30) {
  const collection = await runs();
  return collection.find(
    { owner, vaultId },
    { projection: { _id: 0, invoiceId: 1, state: 1, parsed: 1, amountMist: 1, txDigest: 1, errorMessage: 1, createdAt: 1 } },
  ).sort({ createdAt: -1 }).limit(Math.min(limit, 50)).toArray();
}

export interface AuthChallenge {
  address: string;
  nonce: string;
  message: string;
  expiresAt: Date;
}

export async function challenges() {
  const collection = (await database()).collection<AuthChallenge>("auth_challenges");
  await collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await collection.createIndex({ nonce: 1 }, { unique: true });
  return collection;
}

export interface Session {
  tokenHash: string;
  owner: string;
  expiresAt: Date;
}

export async function sessions() {
  const collection = (await database()).collection<Session>("sessions");
  await collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await collection.createIndex({ tokenHash: 1 }, { unique: true });
  return collection;
}

export type ChatAction = "subscription" | "transfer";
export type ChatProposalState = "ready" | "signing" | "submitted" | "confirmed" | "failed" | "rejected" | "expired";

/** The reviewed intent is immutable once saved. Never regenerate it from the LLM on confirm. */
export interface ChatProposal {
  proposalId: string;
  requestId: string;
  owner: string;
  vaultId: string;
  grantId: string;
  action: ChatAction;
  messageHash: string;
  /** Set only for bill uploads; unique per owner, vault and UTC month while active. */
  billFingerprint?: string;
  billPeriod?: string;
  recipientName: string;
  recipientAddress: string;
  amountMist: string;
  state: ChatProposalState;
  txDigest: string | null;
  signedBytes: string | null;
  signature: string | null;
  errorMessage: string | null;
  executionLease: string | null;
  lockUntil: Date | null;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

let chatIndexPromise: Promise<void> | null = null;
export async function chatProposals(): Promise<Collection<ChatProposal>> {
  const collection = (await database()).collection<ChatProposal>("chat_proposals");
  chatIndexPromise ??= (async () => {
    await collection.createIndex({ owner: 1, vaultId: 1, requestId: 1 }, { unique: true });
    await collection.createIndex({ owner: 1, vaultId: 1, proposalId: 1 }, { unique: true });
    await collection.createIndex({ owner: 1, vaultId: 1, billPeriod: 1, billFingerprint: 1 },
      { unique: true, partialFilterExpression: { billFingerprint: { $exists: true } } });
    await collection.createIndex({ owner: 1, vaultId: 1, createdAt: -1 });
  })().catch((error) => { chatIndexPromise = null; throw error; });
  await chatIndexPromise;
  return collection;
}

export interface OwnerWorkspace {
  owner: string;
  network: string;
  packageId: string;
  vaultId: string;
  policyId: string | null;
  policyAdminCapId: string | null;
  transferGrantId: string | null;
  transferAdminCapId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

let workspaceIndexPromise: Promise<void> | null = null;
export async function ownerWorkspaces(): Promise<Collection<OwnerWorkspace>> {
  const collection = (await database()).collection<OwnerWorkspace>("owner_workspaces");
  workspaceIndexPromise ??= (async () => {
    await collection.createIndex({ owner: 1, network: 1, packageId: 1 }, { unique: true });
    await collection.createIndex({ network: 1, vaultId: 1 }, { unique: true });
  })().catch((error) => { workspaceIndexPromise = null; throw error; });
  await workspaceIndexPromise;
  return collection;
}

export async function findOwnerWorkspace(owner: string, network: string, packageId: string) {
  return (await ownerWorkspaces()).findOne({ owner: owner.toLowerCase(), network, packageId: packageId.toLowerCase() });
}

export async function listOwnerWorkspaces(network: string, packageId: string) {
  return (await ownerWorkspaces()).find({ network, packageId: packageId.toLowerCase() }).toArray();
}

export type VaultMovementKind = "fund" | "withdraw" | "command_pay" | "auto_pay";
export interface VaultMovement {
  owner: string;
  vaultId: string;
  kind: VaultMovementKind;
  amountMist: string;
  digest: string;
  counterparty: string | null;
  createdAt: Date;
}

let movementIndexPromise: Promise<void> | null = null;
export async function vaultMovements(): Promise<Collection<VaultMovement>> {
  const collection = (await database()).collection<VaultMovement>("vault_movements");
  movementIndexPromise ??= (async () => {
    await collection.createIndex({ owner: 1, vaultId: 1, digest: 1 }, { unique: true });
    await collection.createIndex({ owner: 1, vaultId: 1, createdAt: -1 });
  })().catch((error) => { movementIndexPromise = null; throw error; });
  await movementIndexPromise;
  return collection;
}

export async function recordVaultMovement(input: Omit<VaultMovement, "createdAt"> & { createdAt?: Date }) {
  const collection = await vaultMovements();
  const createdAt = input.createdAt ?? new Date();
  try {
    await collection.updateOne(
      { owner: input.owner, vaultId: input.vaultId, digest: input.digest },
      { $setOnInsert: { ...input, owner: input.owner.toLowerCase(), vaultId: input.vaultId.toLowerCase(), createdAt } },
      { upsert: true },
    );
  } catch (error) {
    if (!error || typeof error !== "object" || !("code" in error) || error.code !== 11000) throw error;
  }
}

export async function registerOwnerVault(input: Pick<OwnerWorkspace, "owner" | "network" | "packageId" | "vaultId">) {
  const collection = await ownerWorkspaces();
  const key = { owner: input.owner.toLowerCase(), network: input.network, packageId: input.packageId.toLowerCase() };
  const now = new Date();
  const current = await collection.findOne(key);
  if (current && current.vaultId.toLowerCase() !== input.vaultId.toLowerCase()) {
    throw new Error("This wallet already has a vault for this network and package");
  }
  await collection.updateOne(key, { $setOnInsert: {
    ...key, vaultId: input.vaultId.toLowerCase(), policyId: null, policyAdminCapId: null,
    transferGrantId: null, transferAdminCapId: null, createdAt: now,
  }, $set: { updatedAt: now } }, { upsert: true });
  return collection.findOne(key);
}

export async function updateOwnerWorkspace(
  owner: string, network: string, packageId: string,
  patch: Partial<Pick<OwnerWorkspace, "policyId" | "policyAdminCapId" | "transferGrantId" | "transferAdminCapId">>,
) {
  const collection = await ownerWorkspaces();
  const key = { owner: owner.toLowerCase(), network, packageId: packageId.toLowerCase() };
  const result = await collection.findOneAndUpdate(key,
    { $set: { ...patch, updatedAt: new Date() } }, { returnDocument: "after" });
  if (!result) throw new Error("Create a vault before registering its policy or transfer grant");
  return result;
}
