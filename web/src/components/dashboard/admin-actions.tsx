"use client";

import { useCurrentAccount, useCurrentNetwork, useDAppKit } from "@mysten/dapp-kit-react";
import { Transaction } from "@mysten/sui/transactions";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getPublicSuiConfig } from "@/lib/public-env";
import { describeWalletError, extractAbortCode, MOVE_ABORT_CODES } from "@/lib/sui/abort-codes";
import { useOwnerWorkspace } from "@/components/dashboard/use-owner-workspace";
import { notifyVaultBalancesChanged } from "@/lib/vault-events";

const MIST = 1_000_000_000n;
function toMist(value: string) {
  if (!/^\d+(?:\.\d{1,9})?$/.test(value) || Number(value) <= 0) throw new Error("Enter a positive SUI amount with at most 9 decimals");
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * MIST + BigInt(fraction.padEnd(9, "0"));
}
type Service = { address: string; name: string; chargeAmount: string; monthlyBudget: string; months: string; paymentDay: string };

export function AdminActions() {
  const account = useCurrentAccount();
  const network = useCurrentNetwork();
  const kit = useDAppKit();
  const cfg = getPublicSuiConfig();
  const { workspace, refresh: refreshWorkspace } = useOwnerWorkspace();
  const [totalBudget, setTotalBudget] = useState("50");
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [charge, setCharge] = useState("5");
  const [budget, setBudget] = useState("5");
  const [months, setMonths] = useState("12");
  const [day, setDay] = useState(() => String(new Date().getUTCDate()));
  const [services, setServices] = useState<Service[]>([]);
  const [active, setActive] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const now = new Date();
  const daysThisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();

  const refresh = useCallback(async () => {
    if (!workspace?.policyId) { setActive(null); setServices([]); return; }
    const response = await fetch("/api/policy", { cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json() as { active: boolean; monthlyBudget: string; services: Service[] };
    setActive(data.active); setServices(data.services);
    setTotalBudget(String(Number(data.monthlyBudget) / 1e9));
  }, [workspace?.policyId]);
  useEffect(() => { void refresh(); }, [refresh]);

  async function send(tx: Transaction) {
    const result = await kit.signAndExecuteTransaction({ transaction: tx });
    const digest = "Transaction" in result && result.Transaction ? result.Transaction.digest : "digest" in result ? String(result.digest) : "";
    if (!digest) throw new Error("Wallet did not return a transaction digest");
    setMessage(`Transaction sent: ${digest}`);
    await refresh();
    notifyVaultBalancesChanged();
    return digest;
  }
  async function action(work: () => Promise<void>) {
    setBusy(true); setError(null); setMessage(null);
    try { await work(); } catch (cause) { setError(describeWalletError(cause)); }
    finally { setBusy(false); }
  }
  function requireBase() {
    if (!account || !cfg.packageId || !workspace?.vaultId) throw new Error("Connect wallet and create a vault first");
    if (network !== cfg.network) throw new Error(`Switch wallet network to ${cfg.network}`);
  }
  function requireAdmin() {
    requireBase();
    if (!workspace?.policyId || !workspace.policyAdminCapId) throw new Error("Create a policy for this vault first");
  }

  async function createPolicy() {
    requireBase();
    if (!cfg.agentAddress) throw new Error("Set NEXT_PUBLIC_AGENT_ADDRESS");
    const current = await refreshWorkspace();
    if (current?.policyId) {
      setMessage(`Policy already on this vault. Policy ID: ${current.policyId}.`);
      return;
    }
    try {
      const tx = new Transaction();
      tx.moveCall({ target: `${cfg.publishedAt}::policy::create_policy`, arguments: [tx.object(workspace!.vaultId), tx.pure.address(cfg.agentAddress), tx.pure.u64(toMist(totalBudget))] });
      const digest = await send(tx);
      const response = await fetch("/api/setup-objects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ digest }) });
      const ids = await response.json() as { policyId?: string; adminCapId?: string; error?: string };
      if (!response.ok) throw new Error(ids.error ?? "Could not register the created policy");
      await refreshWorkspace();
      setMessage(`Policy registered for this wallet. Policy ID: ${ids.policyId}; admin capability ID: ${ids.adminCapId}.`);
    } catch (cause) {
      if (extractAbortCode(cause) === MOVE_ABORT_CODES.POLICY_ALREADY_BOUND) {
        const recovered = await refreshWorkspace();
        if (recovered?.policyId) {
          setMessage(`Policy already on this vault. Policy ID: ${recovered.policyId}.`);
          return;
        }
      }
      throw cause;
    }
  }
  async function addService() {
    requireAdmin();
    if (!name.trim()) throw new Error("Enter a service name");
    if (!/^0x[0-9a-fA-F]{1,64}$/.test(address)) throw new Error("Enter a valid Sui recipient address");
    if (!Number.isInteger(Number(months)) || Number(months) < 1 || Number(months) > 120) throw new Error("Months must be 1–120");
    if (!Number.isInteger(Number(day)) || Number(day) < 1 || Number(day) > daysThisMonth) throw new Error(`Choose day 1–${daysThisMonth}`);
    if (toMist(charge) > toMist(budget)) throw new Error("Monthly service budget must cover the charge");
    const tx = new Transaction();
    tx.moveCall({ target: `${cfg.publishedAt}::policy::add_service`, arguments: [
      tx.object(workspace!.policyId!), tx.object(workspace!.policyAdminCapId!), tx.pure.address(address), tx.pure.string(name.trim()),
      tx.pure.u64(toMist(charge)), tx.pure.u64(toMist(budget)), tx.pure.u64(Number(months)),
      tx.pure.u64(Number(day)), tx.object(cfg.clockId),
    ] });
    await send(tx);
  }
  async function removeService(vendor: string) {
    requireAdmin();
    const tx = new Transaction();
    tx.moveCall({ target: `${cfg.publishedAt}::policy::remove_service`, arguments: [tx.object(workspace!.policyId!), tx.object(workspace!.policyAdminCapId!), tx.pure.address(vendor)] });
    await send(tx);
  }
  async function setPolicyActive(next: boolean) {
    requireAdmin();
    const tx = new Transaction();
    tx.moveCall({ target: `${cfg.publishedAt}::policy::${next ? "reactivate_policy" : "revoke_policy"}`, arguments: [tx.object(workspace!.policyId!), tx.object(workspace!.policyAdminCapId!)] });
    await send(tx);
  }
  async function updateTotalBudget() {
    requireAdmin();
    const tx = new Transaction();
    tx.moveCall({ target: `${cfg.publishedAt}::policy::set_monthly_budget`, arguments: [tx.object(workspace!.policyId!), tx.object(workspace!.policyAdminCapId!), tx.pure.u64(toMist(totalBudget))] });
    await send(tx);
  }
  async function runDuePayments() {
    requireAdmin();
    const response = await fetch("/api/scheduler/mine", { method: "POST" });
    const body = await response.json() as {
      error?: string;
      utcDay?: number;
      results?: Array<{ serviceName: string; state: string; skipped?: string; error?: string; txDigest?: string | null }>;
    };
    if (!response.ok) throw new Error(body.error ?? "Cannot run due subscriptions");
    const results = body.results ?? [];
    if (results.length === 0) {
      setMessage(`No automatic services registered. UTC today is day ${body.utcDay}.`);
      return;
    }
    const lines = results.map((item) => {
      if (item.state === "confirmed") return `${item.serviceName}: paid${item.txDigest ? ` · ${item.txDigest}` : ""}`;
      if (item.state === "skipped") return `${item.serviceName}: ${item.skipped ?? "skipped"}`;
      return `${item.serviceName}: ${item.state}${item.error ? ` · ${item.error}` : ""}`;
    });
    setMessage(lines.join(" | "));
    notifyVaultBalancesChanged();
    await refresh();
  }

  return <Card><CardHeader>
    <CardTitle>Automatic monthly</CardTitle>
    <CardDescription>Register services the scheduler may pay on the due day. Fund the vault on Assets. Chat does not use this whitelist.</CardDescription>
  </CardHeader><CardContent className="space-y-5">
    <p className="text-sm text-slate-400">Need SUI in the vault? <Link className="text-indigo-300 underline" href="/assets">Open Assets</Link>.</p>
    {!workspace?.policyId && <div className="grid gap-3 sm:grid-cols-[minmax(0,16rem)_auto] sm:items-end">
      <label className="flex min-w-0 flex-col gap-1.5 text-sm">
        <span className="text-slate-300">Total monthly budget (SUI)</span>
        <Input type="number" min="0.000000001" value={totalBudget} onChange={(e) => setTotalBudget(e.target.value)} />
      </label>
      <Button disabled={busy || !workspace?.vaultId} onClick={() => void action(createPolicy)}>Create shared policy</Button>
    </div>}
    {workspace?.policyId && <>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,16rem)_1fr] sm:items-end">
        <label className="flex min-w-0 flex-col gap-1.5 text-sm">
          <span className="text-slate-300">Total monthly budget (SUI)</span>
          <Input type="number" value={totalBudget} onChange={(e) => setTotalBudget(e.target.value)} />
        </label>
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy || !workspace.policyAdminCapId} variant="outline" onClick={() => void action(updateTotalBudget)}>Update budget</Button>
          <Button disabled={busy || !active || !workspace.policyAdminCapId} variant="outline" onClick={() => void action(() => setPolicyActive(false))}>Revoke policy</Button>
          <Button disabled={busy || active === true || !workspace.policyAdminCapId} variant="outline" onClick={() => void action(() => setPolicyActive(true))}>Reactivate</Button>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex min-w-0 flex-col gap-1.5 text-sm">
          <span className="text-slate-300">Service name</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="flex min-w-0 flex-col gap-1.5 text-sm">
          <span className="text-slate-300">Recipient address</span>
          <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="0x…" />
        </label>
        <label className="flex min-w-0 flex-col gap-1.5 text-sm">
          <span className="text-slate-300">Charge (SUI)</span>
          <Input type="number" value={charge} onChange={(e) => setCharge(e.target.value)} />
        </label>
        <label className="flex min-w-0 flex-col gap-1.5 text-sm">
          <span className="text-slate-300">Monthly cap (SUI)</span>
          <Input type="number" value={budget} onChange={(e) => setBudget(e.target.value)} />
        </label>
        <label className="flex min-w-0 flex-col gap-1.5 text-sm">
          <span className="text-slate-300">Months</span>
          <Input type="number" min="1" max="120" value={months} onChange={(e) => setMonths(e.target.value)} />
        </label>
        <label className="flex min-w-0 flex-col gap-1.5 text-sm">
          <span className="text-slate-300">Payment day (UTC)</span>
          <Input type="number" min="1" max={daysThisMonth} value={day} onChange={(e) => setDay(e.target.value)} />
          <span className="text-xs text-slate-500">Today is {now.getUTCDate()}. Use 1–{daysThisMonth}.</span>
        </label>
      </div>
      <Button disabled={busy} onClick={() => void action(addService)}>Register service and whitelist address</Button>
      <div className="space-y-2">{services.map((service) => <div key={service.address} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-700 p-3 text-sm"><span className="min-w-0 break-all">{service.name} · {service.address} · day {service.paymentDay} · {service.months} months · {Number(service.chargeAmount) / 1e9} SUI/month</span><Button variant="outline" disabled={busy} onClick={() => void action(() => removeService(service.address))}>Remove</Button></div>)}</div>
      <div className="space-y-2 rounded-xl border border-slate-700 p-4">
        <p className="text-sm font-semibold">Test automatic pay</p>
        <p className="text-xs text-slate-400">
          Scheduler does not run by itself. Register a service with payment day ≤ UTC today ({now.getUTCDate()}), fund the vault, fund the agent wallet for gas, then run due payments. Chat never pays this grant.
        </p>
        <Button disabled={busy || !active || services.length === 0} onClick={() => void action(runDuePayments)}>
          Run due payments now
        </Button>
      </div>
    </>}
    {message && <p className="text-emerald-300">{message}</p>}{error && <p className="text-rose-300">{error}</p>}
  </CardContent></Card>;
}
