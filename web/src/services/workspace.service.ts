import { getAgentEnv } from "@/lib/env";
import { findOwnerWorkspace, registerOwnerVault, updateOwnerWorkspace, type OwnerWorkspace } from "@/services/mongo.service";
import { getReadOnlySuiClient } from "@/services/sui.service";

type Fields = Record<string, unknown>;
function fields(value: unknown): Fields {
  if (!value || typeof value !== "object") return {};
  const row = value as Fields;
  return row.fields && typeof row.fields === "object" ? row.fields as Fields : row;
}

function moveOptionId(value: unknown): string | null {
  if (typeof value === "string") return value.toLowerCase();
  if (Array.isArray(value)) return value.length === 1 ? moveOptionId(value[0]) : null;
  const row = fields(value);
  if (typeof row.id === "string") return row.id.toLowerCase();
  if (Array.isArray(row.vec)) return moveOptionId(row.vec);
  if ("some" in row) return moveOptionId(row.some);
  return null;
}

export function deploymentConfig() {
  const env = getAgentEnv();
  return { network: env.suiNetwork, packageId: env.packageId.toLowerCase() };
}

function boundId(json: Fields, key: string): string | null {
  const value = json[key];
  return moveOptionId(value) ?? (typeof value === "string" ? value.toLowerCase() : null);
}

async function findOwnedCap(owner: string, type: string, field: string, expectedId: string): Promise<string | null> {
  const client = getReadOnlySuiClient();
  const wanted = expectedId.toLowerCase();
  let cursor: string | undefined;
  for (let page = 0; page < 8; page += 1) {
    const pageCursor = cursor;
    const listed = await client.listOwnedObjects({
      owner, type, limit: 50, cursor: pageCursor, include: { json: true },
    });
    for (const object of listed.objects) {
      const json = object.json ? fields(object.json) : fields(
        (await client.getObject({ objectId: object.objectId, include: { json: true } })).object?.json,
      );
      if (boundId(json, field) === wanted) return object.objectId;
    }
    if (!listed.hasNextPage || !listed.cursor) break;
    cursor = listed.cursor;
  }
  return null;
}

export async function findWorkspace(owner: string) {
  const config = deploymentConfig();
  let workspace = await findOwnerWorkspace(owner, config.network, config.packageId);
  // One-time migration for the previous single-owner env-based deployment.
  const configuredVaultId = process.env.VAULT_ID?.trim();
  if (!workspace && configuredVaultId) {
    const { object } = await getReadOnlySuiClient().getObject({ objectId: configuredVaultId, include: { json: true } });
    if (object?.json && object.type.toLowerCase() === `${config.packageId}::vault::vault` &&
        String(object.json.owner ?? "").toLowerCase() === owner.toLowerCase()) {
      workspace = await registerOwnerVault({ owner, network: config.network, packageId: config.packageId, vaultId: configuredVaultId });
      const policyId = moveOptionId(fields(object.json).policy_id);
      const transferGrantId = moveOptionId(fields(object.json).transfer_grant_id);
      const policyAdminCapId = process.env.NEXT_PUBLIC_ADMIN_CAP_ID?.trim() || null;
      const transferAdminCapId = process.env.NEXT_PUBLIC_TRANSFER_ADMIN_CAP_ID?.trim() || null;
      workspace = await updateOwnerWorkspace(owner, config.network, config.packageId, {
        policyId, transferGrantId, policyAdminCapId, transferAdminCapId,
      });
    }
  }
  if (!workspace) return null;

  const { object } = await getReadOnlySuiClient().getObject({ objectId: workspace.vaultId, include: { json: true } });
  if (!object?.json || object.type.toLowerCase() !== `${config.packageId}::vault::vault` ||
      String(object.json.owner ?? "").toLowerCase() !== owner.toLowerCase()) {
    throw new Error("Registered vault no longer matches this wallet and package");
  }

  const vault = fields(object.json);
  const policyId = moveOptionId(vault.policy_id);
  const transferGrantId = moveOptionId(vault.transfer_grant_id);
  const patch: Partial<Pick<OwnerWorkspace, "policyId" | "policyAdminCapId" | "transferGrantId" | "transferAdminCapId">> = {};
  if ((workspace.policyId ?? null) !== policyId) patch.policyId = policyId;
  if ((workspace.transferGrantId ?? null) !== transferGrantId) patch.transferGrantId = transferGrantId;

  // Recover admin caps when the on-chain object exists but Mongo never stored the cap
  // (typical after a successful Move call whose follow-up API timed out).
  if (policyId && !(workspace.policyAdminCapId || patch.policyAdminCapId)) {
    const capId = await findOwnedCap(
      owner, `${config.packageId}::policy::PolicyAdminCap`, "policy_id", policyId,
    );
    if (capId) patch.policyAdminCapId = capId;
  }
  if (transferGrantId && !(workspace.transferAdminCapId || patch.transferAdminCapId)) {
    const capId = await findOwnedCap(
      owner, `${config.packageId}::transfer_grant::TransferAdminCap`, "grant_id", transferGrantId,
    );
    if (capId) patch.transferAdminCapId = capId;
  }

  if (Object.keys(patch).length) {
    return updateOwnerWorkspace(owner, config.network, config.packageId, patch);
  }
  return workspace;
}

export async function requireWorkspace(owner: string) {
  const workspace = await findWorkspace(owner);
  if (!workspace) throw new Error("No vault is registered for this wallet yet. Create one from the dashboard.");
  return workspace;
}
