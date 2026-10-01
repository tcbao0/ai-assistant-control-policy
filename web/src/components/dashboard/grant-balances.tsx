"use client";

import { Loader2, RefreshCw, Vault, Wallet, CalendarClock } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FundVaultControl } from "@/components/dashboard/fund-vault";
import { WithdrawVaultControl } from "@/components/dashboard/withdraw-vault";
import { useOwnerWorkspace } from "@/components/dashboard/use-owner-workspace";
import { explorerTxUrl } from "@/lib/public-env";
import { formatSuiFromMist } from "@/lib/sui/mist";
import { VAULT_BALANCES_CHANGED } from "@/lib/vault-events";
import type { AutoBalance, CommandBalance, VaultBalances } from "@/services/balances.service";
import type { LedgerEntry } from "@/services/ledger.service";

function usedRatio(spentMist: string, budgetMist: string): number {
  try {
    const budget = BigInt(budgetMist);
    if (budget <= 0n) return 0;
    const spent = BigInt(spentMist);
    if (spent <= 0n) return 0;
    const pct = Number((spent * 1000n) / budget) / 10;
    return Math.min(100, Math.max(0, pct));
  } catch {
    return 0;
  }
}

function Bar({ spentMist, budgetMist }: { spentMist: string; budgetMist: string }) {
  const pct = usedRatio(spentMist, budgetMist);
  const tone = pct >= 90 ? "bg-rose-400" : pct >= 70 ? "bg-amber-400" : "bg-emerald-400";
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
      <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function Amount({ mist, className }: { mist: string; className?: string }) {
  return <span className={className}>{formatSuiFromMist(mist)} SUI</span>;
}

function CommandCard({ command, loading }: { command: CommandBalance | null; loading: boolean }) {
  if (!command) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Wallet className="h-4 w-4 text-sui-dark" /> Command grant</CardTitle>
          <CardDescription>Pay-on-command whitelist. Chat spends this daily budget.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-slate-500">{loading ? "Loading remaining daily budget…" : <>No command grant yet. Create one under <Link className="text-sui-dark underline" href="/policies">Policies</Link>.</>}</p>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="flex items-center gap-2"><Wallet className="h-4 w-4 text-sui-dark" /> Command grant</CardTitle>
          <Badge variant={command.active ? "success" : "danger"}>{command.active ? "Active" : "Revoked"}</Badge>
        </div>
        <CardDescription>Remaining today against the daily cap. Vault SUI is still required to pay.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-2xl font-semibold tracking-tight">
          <Amount mist={command.remainingMist} />
        </p>
        <p className="text-xs text-slate-500">Daily remaining cap. Spendable now is the smaller of this and vault SUI.</p>
        <Bar spentMist={command.spentMist} budgetMist={command.dailyBudgetMist} />
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-slate-500">Daily cap</dt>
          <dd><Amount mist={command.dailyBudgetMist} /></dd>
          <dt className="text-slate-500">Spent today</dt>
          <dd><Amount mist={command.spentMist} /></dd>
          <dt className="text-slate-500">Per payment</dt>
          <dd><Amount mist={command.perPaymentLimitMist} /></dd>
          <dt className="text-slate-500">Whitelist</dt>
          <dd>{command.recipientCount} name{command.recipientCount === 1 ? "" : "s"}</dd>
        </dl>
      </CardContent>
    </Card>
  );
}

function AutoCard({ auto, loading }: { auto: AutoBalance | null; loading: boolean }) {
  if (!auto) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><CalendarClock className="h-4 w-4 text-cyan-300" /> Automatic monthly</CardTitle>
          <CardDescription>Scheduler spends this monthly budget on the due day.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-slate-500">{loading ? "Loading remaining monthly budget…" : <>No automatic policy yet. Optional under <Link className="text-sui-dark underline" href="/policies">Policies</Link>.</>}</p>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="flex items-center gap-2"><CalendarClock className="h-4 w-4 text-cyan-300" /> Automatic monthly</CardTitle>
          <Badge variant={auto.active ? "success" : "danger"}>{auto.active ? "Active" : "Revoked"}</Badge>
        </div>
        <CardDescription>Remaining this UTC month. Chat does not spend this budget.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-2xl font-semibold tracking-tight">
          <Amount mist={auto.remainingMist} />
        </p>
        <p className="text-xs text-slate-500">Monthly remaining cap. Spendable now is the smaller of this and vault SUI.</p>
        <Bar spentMist={auto.spentMist} budgetMist={auto.monthlyBudgetMist} />
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-slate-500">Monthly cap</dt>
          <dd><Amount mist={auto.monthlyBudgetMist} /></dd>
          <dt className="text-slate-500">Spent this month</dt>
          <dd><Amount mist={auto.spentMist} /></dd>
        </dl>
        {auto.services.length > 0 ? (
          <ul className="space-y-2 border-t border-slate-200 pt-3 text-sm">
            {auto.services.map((service) => (
              <li key={service.address} className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-slate-800">{service.name}<span className="ml-2 text-xs text-slate-500">day {service.paymentDay}</span></span>
                <span className="text-slate-700">
                  <Amount mist={service.remainingMist} /> / <Amount mist={service.monthlyBudgetMist} className="text-slate-500" />
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-slate-500">No services registered yet.</p>
        )}
      </CardContent>
    </Card>
  );
}

function kindLabel(kind: LedgerEntry["kind"]): string {
  if (kind === "fund") return "Fund";
  if (kind === "withdraw") return "Withdraw";
  if (kind === "command_pay") return "Command pay";
  return "Auto pay";
}

export function GrantBalances() {
  const { workspace } = useOwnerWorkspace();
  const [data, setData] = useState<VaultBalances | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!workspace?.vaultId) return;
    try {
      const [balanceRes, ledgerRes] = await Promise.all([
        fetch("/api/balances", { cache: "no-store" }),
        fetch("/api/vault/ledger", { cache: "no-store" }),
      ]);
      const body = await balanceRes.json() as VaultBalances & { error?: string };
      if (!balanceRes.ok) throw new Error(body.error ?? "Cannot load balances");
      setData(body);
      const ledgerBody = await ledgerRes.json() as { entries?: LedgerEntry[]; error?: string };
      if (ledgerRes.ok) setLedger(ledgerBody.entries ?? []);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [workspace?.vaultId]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const onChange = () => { void refresh(); };
    window.addEventListener(VAULT_BALANCES_CHANGED, onChange);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener(VAULT_BALANCES_CHANGED, onChange);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  if (!workspace?.vaultId) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-black">Digital assets</p>
          <p className="text-xs text-slate-500">SUI in the shared vault is the holding. Grants only cap how much the agent may spend.</p>
        </div>
        <Button variant="outline" size="sm" disabled={loading} onClick={() => void refresh()}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Refresh
        </Button>
      </div>
      {error ? <p className="text-sm text-rose-700">{error}</p> : null}
      <div className="grid gap-3 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Vault className="h-4 w-4 text-emerald-700" /> Shared vault</CardTitle>
            <CardDescription>On-chain SUI the owner custodied. Agent spends from here under grants.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-2xl font-semibold tracking-tight">
              {data ? <Amount mist={data.vaultBalanceMist} /> : loading ? "…" : "—"}
            </p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-slate-500">Command can spend now</dt>
              <dd>{data ? <Amount mist={data.spendableCommandMist} /> : "—"}</dd>
              <dt className="text-slate-500">Auto can spend now</dt>
              <dd>{data ? <Amount mist={data.spendableAutoMist} /> : "—"}</dd>
            </dl>
            <p className="break-all text-xs text-slate-500">{workspace.vaultId}</p>
            <div className="space-y-4 border-t border-slate-200 pt-3">
              <FundVaultControl />
              <WithdrawVaultControl maxMist={data?.vaultBalanceMist} />
            </div>
          </CardContent>
        </Card>
        <CommandCard command={data?.command ?? null} loading={loading && !data} />
        <AutoCard auto={data?.auto ?? null} loading={loading && !data} />
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <p className="text-sm font-semibold text-black">Vault movements</p>
        <p className="mb-3 text-xs text-slate-500">Funds in, owner withdrawals, command pays, automatic pays.</p>
        {ledger.length === 0 ? (
          <p className="text-sm text-slate-500">{loading ? "Loading ledger…" : "No movements recorded yet."}</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {ledger.map((row) => (
              <li key={`${row.digest}:${row.kind}`} className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2">
                <span>
                  <span className="font-medium text-black">{kindLabel(row.kind)}</span>
                  {row.counterparty ? <span className="ml-2 text-slate-500">{row.counterparty}</span> : null}
                </span>
                <span className="text-slate-800">
                  {row.kind === "withdraw" || row.kind === "command_pay" || row.kind === "auto_pay" ? "−" : "+"}
                  <Amount mist={row.amountMist} />
                  {row.digest ? (
                    <a className="ml-2 text-xs text-sui-dark underline" href={explorerTxUrl(row.digest)} target="_blank" rel="noreferrer">tx</a>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
