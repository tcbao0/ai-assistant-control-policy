"use client";

import { useCurrentAccount, useCurrentNetwork, useDAppKit } from "@mysten/dapp-kit-react";
import { Transaction } from "@mysten/sui/transactions";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useOwnerWorkspace } from "@/components/dashboard/use-owner-workspace";
import { getPublicSuiConfig } from "@/lib/public-env";
import { describeWalletError } from "@/lib/sui/abort-codes";
import { notifyVaultBalancesChanged } from "@/lib/vault-events";

const MIST = 1_000_000_000n;

function toMist(value: string): bigint {
  if (!/^\d+(?:\.\d{1,9})?$/.test(value) || Number(value) <= 0) {
    throw new Error("Enter a positive SUI amount with at most 9 decimals");
  }
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * MIST + BigInt(fraction.padEnd(9, "0"));
}

export function WithdrawVaultControl({ maxMist }: { maxMist?: string | null }) {
  const account = useCurrentAccount();
  const network = useCurrentNetwork();
  const kit = useDAppKit();
  const cfg = getPublicSuiConfig();
  const { workspace } = useOwnerWorkspace();
  const [amount, setAmount] = useState("1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function withdraw() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (!account) throw new Error("Connect the vault owner wallet");
      if (network !== cfg.network) throw new Error(`Switch wallet to ${cfg.network}`);
      if (!cfg.packageId || !workspace?.vaultId) throw new Error("Create a vault first");
      const mist = toMist(amount);
      if (maxMist && mist > BigInt(maxMist)) throw new Error("Amount is larger than the vault balance");
      const tx = new Transaction();
      tx.moveCall({
        target: `${cfg.publishedAt}::vault::withdraw_to`,
        arguments: [
          tx.object(workspace.vaultId),
          tx.pure.u64(mist),
          tx.pure.address(account.address),
        ],
      });
      const result = await kit.signAndExecuteTransaction({ transaction: tx });
      const digest =
        "Transaction" in result && result.Transaction
          ? result.Transaction.digest
          : "digest" in result
            ? String(result.digest)
            : "";
      if (!digest) throw new Error("Wallet did not return a transaction digest");
      await fetch("/api/vault/ledger", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ digest, kind: "withdraw", amountMist: mist.toString() }),
      }).catch(() => undefined);
      setMessage(`Withdrawn to your wallet. Transaction ${digest.slice(0, 10)}…`);
      notifyVaultBalancesChanged();
    } catch (cause) {
      setError(describeWalletError(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-sm">
          Withdraw SUI to owner wallet
          <Input
            type="number"
            min="0.000000001"
            step="any"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </label>
        <Button variant="outline" disabled={busy || !workspace?.vaultId} onClick={() => void withdraw()}>
          {busy ? "Withdrawing…" : "Withdraw"}
        </Button>
      </div>
      <p className="text-xs text-slate-400">
        Owner wallet signs this. The agent cannot withdraw. Grants do not block owner withdrawal.
      </p>
      {message ? <p role="status" className="text-sm text-emerald-300">{message}</p> : null}
      {error ? <p role="alert" className="text-sm text-rose-300">{error}</p> : null}
    </div>
  );
}
