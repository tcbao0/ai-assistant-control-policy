import { getSuiClient } from "@/services/sui.service";
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

export interface ChainService {
  address: string;
  name: string;
  chargeAmount: string;
  monthlyBudget: string;
  spentMonth: string;
  spentAmount: string;
  months: number;
  paymentDay: number;
  startMonth: number;
  lastPaidMonth: number;
}

export async function readPolicy(owner: string) {
  const workspace = await requireWorkspace(owner);
  if (!workspace.policyId) throw new Error("No subscription policy is registered for this vault");
  const { object } = await getSuiClient().getObject({ objectId: workspace.policyId, include: { json: true } });
  if (!object?.json) throw new Error("Policy object not found");
  const policy = fields(object.json);
  const vendorMap = fields(policy.vendors);
  const contents = Array.isArray(vendorMap.contents) ? vendorMap.contents : [];
  const services: ChainService[] = contents.map((entry) => {
    const pair = fields(entry);
    const rule = fields(pair.value);
    return {
      address: String(pair.key ?? ""), name: moveString(rule.name),
      chargeAmount: String(rule.charge_amount ?? "0"), monthlyBudget: String(rule.monthly_budget ?? "0"),
      spentMonth: String(rule.spent_month ?? "0"), spentAmount: String(rule.spent_amount ?? "0"),
      months: Number(rule.months ?? 0), paymentDay: Number(rule.payment_day ?? 0),
      startMonth: Number(rule.start_month ?? 0), lastPaidMonth: Number(rule.last_paid_month ?? 0),
    };
  });
  return {
    active: policy.active === true,
    monthlyBudget: String(policy.monthly_budget ?? "0"),
    spentMonth: String(policy.spent_month ?? "0"),
    spentAmount: String(policy.spent_amount ?? "0"),
    services,
  };
}
