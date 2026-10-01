import { getAgentEnv } from "@/lib/env";
import {
  chatProposals,
  recordVaultMovement,
  runs,
  vaultMovements,
  type VaultMovement,
  type VaultMovementKind,
} from "@/services/mongo.service";
import { getSuiClient } from "@/services/sui.service";
import { requireWorkspace } from "@/services/workspace.service";

export interface LedgerEntry {
  kind: VaultMovementKind;
  amountMist: string;
  digest: string;
  counterparty: string | null;
  createdAt: string;
  source: "chain" | "server";
}

type Fields = Record<string, unknown>;
function fields(value: unknown): Fields {
  if (!value || typeof value !== "object") return {};
  const row = value as Fields;
  return row.fields && typeof row.fields === "object" ? row.fields as Fields : row;
}

function mistField(value: unknown): string {
  if (value == null) return "0";
  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") return String(value);
  return mistField(fields(value).value);
}

function idField(value: unknown): string {
  if (typeof value === "string") return value.toLowerCase();
  const row = fields(value);
  if (typeof row.id === "string") return row.id.toLowerCase();
  return "";
}

function kindFromEventType(eventType: string): VaultMovementKind | null {
  const name = eventType.split("::").pop() ?? "";
  if (name === "VaultFunded") return "fund";
  if (name === "VaultWithdrawn") return "withdraw";
  if (name === "TransferExecuted") return "command_pay";
  if (name === "PaymentExecuted") return "auto_pay";
  return null;
}

async function chainEntries(vaultId: string): Promise<LedgerEntry[]> {
  const env = getAgentEnv();
  const modules = [...new Set([env.packageId, env.publishedAt].map((id) => `${id}::events`))];
  try {
    const listed = await Promise.all(modules.map((emitModule) => getSuiClient().listEvents({
      filter: { emitModule },
      limit: 50,
      order: "descending",
    })));
    const wanted = vaultId.toLowerCase();
    const rows: LedgerEntry[] = [];
    const seen = new Set<string>();
    for (const page of listed) {
      for (const event of page.events) {
        const kind = kindFromEventType(event.eventType);
        if (!kind) continue;
        const json = (event.json ?? {}) as Fields;
        if (idField(json.vault_id) !== wanted) continue;
        const key = `${event.transactionDigest}:${kind}:${mistField(json.amount_mist)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const counterparty = idField(json.recipient) || idField(json.vendor) || null;
        const timestamp = Number(json.timestamp_ms ?? 0);
        rows.push({
          kind,
          amountMist: mistField(json.amount_mist),
          digest: event.transactionDigest,
          counterparty,
          createdAt: Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp).toISOString() : new Date().toISOString(),
          source: "chain",
        });
      }
    }
    return rows;
  } catch {
    return [];
  }
}

function fromMongo(row: VaultMovement): LedgerEntry {
  return {
    kind: row.kind,
    amountMist: row.amountMist,
    digest: row.digest,
    counterparty: row.counterparty,
    createdAt: row.createdAt.toISOString(),
    source: "server",
  };
}

export async function readVaultLedger(owner: string): Promise<LedgerEntry[]> {
  const workspace = await requireWorkspace(owner);
  const vaultId = workspace.vaultId;
  const [chain, stored, chats, scheduled] = await Promise.all([
    chainEntries(vaultId),
    (await vaultMovements()).find({ owner: owner.toLowerCase(), vaultId }).sort({ createdAt: -1 }).limit(40).toArray(),
    (await chatProposals()).find({ owner: owner.toLowerCase(), vaultId, state: "confirmed", txDigest: { $ne: null } })
      .sort({ createdAt: -1 }).limit(40).toArray(),
    (await runs()).find({ owner: owner.toLowerCase(), vaultId, state: "confirmed", txDigest: { $ne: null } })
      .sort({ createdAt: -1 }).limit(40).toArray(),
  ]);
  const merged = new Map<string, LedgerEntry>();
  for (const row of chain) merged.set(row.digest + ":" + row.kind, row);
  for (const row of stored) merged.set(row.digest + ":" + row.kind, fromMongo(row));
  for (const row of chats) {
    if (!row.txDigest) continue;
    merged.set(row.txDigest + ":command_pay", {
      kind: "command_pay",
      amountMist: row.amountMist,
      digest: row.txDigest,
      counterparty: row.recipientName,
      createdAt: row.createdAt.toISOString(),
      source: "server",
    });
  }
  for (const row of scheduled) {
    if (!row.txDigest) continue;
    merged.set(row.txDigest + ":auto_pay", {
      kind: "auto_pay",
      amountMist: row.amountMist ?? "0",
      digest: row.txDigest,
      counterparty: row.parsed?.vendorName ?? null,
      createdAt: row.createdAt.toISOString(),
      source: "server",
    });
  }
  return [...merged.values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 40);
}

export async function recordOwnerMovement(
  owner: string,
  input: { digest: string; kind: "fund" | "withdraw"; amountMist: string },
) {
  const workspace = await requireWorkspace(owner);
  if (!/^[A-Za-z0-9]+$/.test(input.digest) || input.digest.length < 20) throw new Error("Invalid transaction digest");
  await recordVaultMovement({
    owner: owner.toLowerCase(),
    vaultId: workspace.vaultId,
    kind: input.kind,
    amountMist: input.amountMist,
    digest: input.digest,
    counterparty: owner.toLowerCase(),
  });
}
