"use client";

import { useCurrentAccount, useCurrentNetwork, useDAppKit } from "@mysten/dapp-kit-react";
import { Transaction } from "@mysten/sui/transactions";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const packageId = process.env.NEXT_PUBLIC_LEGACY_PACKAGE_ID ?? "";
const policyId = process.env.NEXT_PUBLIC_LEGACY_POLICY_ID ?? "";
const adminCapId = process.env.NEXT_PUBLIC_LEGACY_ADMIN_CAP_ID ?? "";
const ownerAddress = process.env.NEXT_PUBLIC_LEGACY_OWNER_ADDRESS?.toLowerCase() ?? "";
const expectedNetwork = process.env.NEXT_PUBLIC_SUI_NETWORK ?? "testnet";

export function LegacyPolicyRevoker() {
  const account = useCurrentAccount();
  const network = useCurrentNetwork();
  const kit = useDAppKit();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<"loading" | "active" | "revoked" | "error">("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isOwner = account?.address.toLowerCase() === ownerAddress;

  const refreshStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/legacy-policy", { cache: "no-store" });
      const body = await response.json() as { active?: boolean; error?: string };
      if (!response.ok || typeof body.active !== "boolean") throw new Error(body.error ?? "Cannot verify legacy policy status");
      setStatus(body.active ? "active" : "revoked");
      setError(null);
      return body.active;
    } catch (cause) {
      setStatus("error");
      setError(cause instanceof Error ? cause.message : String(cause));
      return null;
    }
  }, []);

  useEffect(() => { void refreshStatus(); }, [refreshStatus]);

  if (!packageId || !policyId || !adminCapId || !ownerAddress) return null;

  async function revoke() {
    if (!account || !isOwner) return;
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      if (network !== expectedNetwork) throw new Error(`Switch the wallet to ${expectedNetwork}`);
      const tx = new Transaction();
      tx.moveCall({
        target: `${packageId}::policy::revoke_policy`,
        arguments: [tx.object(policyId), tx.object(adminCapId)],
      });
      const result = await kit.signAndExecuteTransaction({ transaction: tx });
      const digest = "Transaction" in result && result.Transaction
        ? result.Transaction.digest
        : "digest" in result ? String(result.digest) : "";
      if (!digest) throw new Error("Wallet did not return a transaction digest");
      let active: boolean | null = true;
      for (let attempt = 0; attempt < 6 && active; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        active = await refreshStatus();
      }
      if (active === false) setMessage(`Legacy policy is revoked. Transaction: ${digest}`);
      else setMessage(`Revoke transaction submitted: ${digest}. The policy status could not yet be confirmed; refresh to check again.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  if (status === "loading" || status === "revoked") return null;

  if (status === "error") return <Card className="mx-auto mt-6 max-w-7xl border-slate-600 bg-slate-900/70">
    <CardHeader><CardTitle>Legacy policy status could not be verified</CardTitle></CardHeader>
    <CardContent className="space-y-3 text-sm">
      <p className="text-slate-300">The app could not read the policy from Sui, so it cannot tell whether revocation is complete.</p>
      {error && <p className="break-all text-rose-300">{error}</p>}
      <Button variant="outline" onClick={() => void refreshStatus()}>Check status again</Button>
    </CardContent>
  </Card>;

  return <Card className="mx-auto mt-6 max-w-7xl border-amber-500/40 bg-amber-950/20">
    <CardHeader><CardTitle>Previous testnet policy is still active</CardTitle></CardHeader>
    <CardContent className="space-y-3 text-sm">
      <p className="text-amber-100">This legacy policy is separate from the newly published package. Revoke it with the owner wallet before using the new vault.</p>
      {!account && <p className="text-slate-300">Connect the owner wallet {ownerAddress} to continue.</p>}
      {account && !isOwner && <p className="break-all text-rose-300">Connected wallet does not own this policy. Expected {ownerAddress}.</p>}
      <Button variant="danger" disabled={!isOwner || busy || network !== expectedNetwork} onClick={() => void revoke()}>
        {busy ? "Waiting for owner signature…" : "Revoke previous policy"}
      </Button>
      <Button variant="outline" disabled={busy} onClick={() => void refreshStatus()}>Refresh on-chain status</Button>
      {message && <p className="break-all text-emerald-300">{message}</p>}
      {error && <p className="break-all text-rose-300">{error}</p>}
    </CardContent>
  </Card>;
}
