"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { useOwnerWorkspace } from "@/components/dashboard/use-owner-workspace";
import { formatSuiFromMist } from "@/lib/sui/mist";
import { VAULT_BALANCES_CHANGED } from "@/lib/vault-events";
import type { VaultBalances } from "@/services/balances.service";

function Amount({ mist }: { mist: string }) {
  return <span className="font-medium text-slate-100">{formatSuiFromMist(mist)} SUI</span>;
}

export function StatusStrip() {
  const { workspace } = useOwnerWorkspace();
  const [data, setData] = useState<VaultBalances | null>(null);

  const refresh = useCallback(async () => {
    if (!workspace?.vaultId) return;
    const response = await fetch("/api/balances", { cache: "no-store" });
    if (!response.ok) return;
    setData(await response.json() as VaultBalances);
  }, [workspace?.vaultId]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const onChange = () => { void refresh(); };
    window.addEventListener(VAULT_BALANCES_CHANGED, onChange);
    return () => window.removeEventListener(VAULT_BALANCES_CHANGED, onChange);
  }, [refresh]);

  const needsTransfer = Boolean(workspace?.vaultId && !workspace.transferGrantId);

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-950/70 px-4 py-3 sm:px-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-sm">
          <Link href="/assets" className="hover:text-white">
            <span className="text-slate-400">Vault </span>
            {data ? <Amount mist={data.vaultBalanceMist} /> : "…"}
          </Link>
          <Link href="/assets" className="hover:text-white">
            <span className="text-slate-400">Command </span>
            {data ? <Amount mist={data.spendableCommandMist} /> : "…"}
          </Link>
          <Link href="/assets" className="hover:text-white">
            <span className="text-slate-400">Auto </span>
            {data ? <Amount mist={data.spendableAutoMist} /> : "…"}
          </Link>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="success">Vault</Badge>
          <Badge variant={workspace?.transferGrantId ? "success" : "warn"}>
            Command {workspace?.transferGrantId ? "ready" : "needed"}
          </Badge>
          <Badge variant={workspace?.policyId ? "success" : "muted"}>
            Auto {workspace?.policyId ? "ready" : "optional"}
          </Badge>
        </div>
      </div>
      {needsTransfer ? (
        <p className="mt-2 text-sm text-amber-100">
          Chat needs a command grant.{" "}
          <Link href="/policies" className="font-semibold underline">Open Policies</Link>
        </p>
      ) : null}
    </section>
  );
}
