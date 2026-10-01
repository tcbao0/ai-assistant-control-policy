import { NextResponse } from "next/server";
import { getReadOnlySuiClient } from "@/services/sui.service";

export const runtime = "nodejs";

export async function GET() {
  try {
    const packageId = process.env.NEXT_PUBLIC_LEGACY_PACKAGE_ID?.trim().toLowerCase();
    const policyId = process.env.NEXT_PUBLIC_LEGACY_POLICY_ID?.trim();
    if (!packageId || !policyId) throw new Error("Legacy policy IDs are not configured");

    const { object } = await getReadOnlySuiClient().getObject({ objectId: policyId, include: { json: true } });
    if (!object?.json || object.type.toLowerCase() !== `${packageId}::policy::subscriptionpolicy`) {
      throw new Error("Configured legacy policy does not match the legacy package");
    }
    if (typeof object.json.active !== "boolean") throw new Error("Legacy policy has no readable active status");
    return NextResponse.json({ policyId, active: object.json.active }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Cannot read legacy policy status" },
      { status: 503, headers: { "cache-control": "no-store" } });
  }
}
