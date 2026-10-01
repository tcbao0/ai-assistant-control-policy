import { readTransferGrant } from "@/services/agent-transfer.service";
import { readPolicy } from "@/services/policy-read.service";
import { getSuiClient } from "@/services/sui.service";
import { requireWorkspace } from "@/services/workspace.service";

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

export function utcDayKey(nowMs = Date.now()): bigint {
  return BigInt(Math.floor(nowMs / 86_400_000));
}

export function utcMonthKey(now = new Date()): bigint {
  return BigInt(now.getUTCFullYear() * 12 + now.getUTCMonth());
}

export function remainingMist(periodKey: bigint, spentPeriod: string, spentAmount: string, budget: string): string {
  const spent = BigInt(spentPeriod || "0") === periodKey ? BigInt(spentAmount || "0") : 0n;
  const left = BigInt(budget || "0") - spent;
  return (left < 0n ? 0n : left).toString();
}

export function minMist(left: string, right: string): string {
  const a = BigInt(left || "0");
  const b = BigInt(right || "0");
  return (a < b ? a : b).toString();
}

export interface CommandBalance {
  active: boolean;
  dailyBudgetMist: string;
  spentMist: string;
  remainingMist: string;
  perPaymentLimitMist: string;
  expiresAtMs: string;
  recipientCount: number;
}

export interface AutoServiceBalance {
  name: string;
  address: string;
  chargeAmountMist: string;
  monthlyBudgetMist: string;
  remainingMist: string;
  paymentDay: number;
}

export interface AutoBalance {
  active: boolean;
  monthlyBudgetMist: string;
  spentMist: string;
  remainingMist: string;
  services: AutoServiceBalance[];
}

export interface VaultBalances {
  vaultId: string;
  vaultBalanceMist: string;
  /** min(vault SUI, remaining command daily cap). */
  spendableCommandMist: string;
  /** min(vault SUI, remaining auto monthly cap). */
  spendableAutoMist: string;
  command: CommandBalance | null;
  auto: AutoBalance | null;
}

export async function readVaultBalances(owner: string): Promise<VaultBalances> {
  const workspace = await requireWorkspace(owner);
  const { object } = await getSuiClient().getObject({ objectId: workspace.vaultId, include: { json: true } });
  if (!object?.json) throw new Error("Vault object not found on chain");
  const vault = fields(object.json);
  const vaultBalanceMist = mistField(vault.funds);

  const command = workspace.transferGrantId ? await readCommandBalance(owner) : null;
  const auto = workspace.policyId ? await readAutoBalance(owner) : null;
  return {
    vaultId: workspace.vaultId,
    vaultBalanceMist,
    spendableCommandMist: command?.active ? minMist(vaultBalanceMist, command.remainingMist) : "0",
    spendableAutoMist: auto?.active ? minMist(vaultBalanceMist, auto.remainingMist) : "0",
    command,
    auto,
  };
}

async function readCommandBalance(owner: string): Promise<CommandBalance> {
  const grant = await readTransferGrant(owner);
  const remaining = remainingMist(utcDayKey(), grant.spentDay, grant.spentAmount, grant.dailyBudget);
  const spent = BigInt(grant.dailyBudget) - BigInt(remaining);
  return {
    active: grant.active,
    dailyBudgetMist: grant.dailyBudget,
    spentMist: (spent < 0n ? 0n : spent).toString(),
    remainingMist: remaining,
    perPaymentLimitMist: grant.perPaymentLimit,
    expiresAtMs: grant.expiresAtMs,
    recipientCount: grant.recipients.length,
  };
}

async function readAutoBalance(owner: string): Promise<AutoBalance> {
  const policy = await readPolicy(owner);
  const month = utcMonthKey();
  const remaining = remainingMist(month, policy.spentMonth, policy.spentAmount, policy.monthlyBudget);
  const spent = BigInt(policy.monthlyBudget) - BigInt(remaining);
  return {
    active: policy.active,
    monthlyBudgetMist: policy.monthlyBudget,
    spentMist: (spent < 0n ? 0n : spent).toString(),
    remainingMist: remaining,
    services: policy.services.map((service) => ({
      name: service.name,
      address: service.address,
      chargeAmountMist: service.chargeAmount,
      monthlyBudgetMist: service.monthlyBudget,
      remainingMist: remainingMist(month, service.spentMonth, service.spentAmount, service.monthlyBudget),
      paymentDay: service.paymentDay,
    })),
  };
}
