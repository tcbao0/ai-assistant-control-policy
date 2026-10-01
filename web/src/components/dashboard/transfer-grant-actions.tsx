"use client";

import { useCurrentAccount, useCurrentNetwork, useDAppKit } from "@mysten/dapp-kit-react";
import { Transaction } from "@mysten/sui/transactions";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { explorerTxUrl, getPublicSuiConfig } from "@/lib/public-env";
import { formatSuiFromMist } from "@/lib/sui/mist";
import { notifyVaultBalancesChanged, VAULT_BALANCES_CHANGED } from "@/lib/vault-events";
import { useOwnerWorkspace } from "@/components/dashboard/use-owner-workspace";

const MIST = 1_000_000_000n;
type Recipient = { name: string; address: string };
type Grant = {
  id: string;
  vaultId: string;
  agent: string;
  active: boolean;
  perPaymentLimit: string;
  dailyBudget: string;
  spentDay: string;
  spentAmount: string;
  expiresAtMs: string;
  recipients: Recipient[];
};
type Pending =
  | { kind: "create"; perPaymentLimit: string; dailyBudget: string; expiresAtMs: string }
  | { kind: "replace"; perPaymentLimit: string; dailyBudget: string; expiresAtMs: string; agent: string }
  | { kind: "add"; name: string; address: string }
  | { kind: "remove"; name: string; address: string }
  | { kind: "limits"; perPaymentLimit: string; dailyBudget: string }
  | { kind: "expiry"; expiresAtMs: string }
  | { kind: "agent"; address: string }
  | { kind: "revoke" };

function toMist(value: string): bigint {
  if (!/^\d+(?:\.\d{1,9})?$/.test(value)) throw new Error("Enter a SUI amount with up to 9 decimal places");
  const [whole, fraction = ""] = value.split(".");
  const amount = BigInt(whole) * MIST + BigInt(fraction.padEnd(9, "0"));
  if (amount === 0n) throw new Error("Amount must be greater than zero");
  return amount;
}

function fromMist(value: string): string {
  const amount = BigInt(value);
  const decimal = (amount % MIST).toString().padStart(9, "0").replace(/0+$/, "");
  return `${amount / MIST}${decimal ? `.${decimal}` : ""}`;
}

function remainingDailyMist(grant: Pick<Grant, "dailyBudget" | "spentDay" | "spentAmount">): bigint {
  const day = BigInt(Math.floor(Date.now() / 86_400_000));
  const spent = BigInt(grant.spentDay || "0") === day ? BigInt(grant.spentAmount || "0") : 0n;
  const left = BigInt(grant.dailyBudget || "0") - spent;
  return left < 0n ? 0n : left;
}

function futureTime(value: string): string {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || ms <= Date.now()) throw new Error("Choose a future expiry date and time");
  return String(ms);
}

function address(value: string): string {
  const trimmed = value.trim();
  if (!/^0x[0-9a-fA-F]{1,64}$/.test(trimmed) || /^0x0+$/.test(trimmed)) throw new Error("Enter a valid nonzero Sui address");
  return trimmed;
}

function pendingLabel(pending: Pending): string {
  switch (pending.kind) {
    case "create": return "Create command grant";
    case "replace": return "Replace revoked command grant";
    case "add": return `Whitelist ${pending.name} · ${pending.address}`;
    case "remove": return `Remove ${pending.name} · ${pending.address}`;
    case "limits": return "Change transfer limits";
    case "expiry": return "Change grant expiry";
    case "agent": return `Change agent to ${pending.address}`;
    case "revoke": return "Permanently revoke transfer grant";
  }
}

async function json<T>(response: Response): Promise<T> {
  const value = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(value.error ?? "Request failed");
  return value;
}

export function TransferGrantActions() {
  const account = useCurrentAccount();
  const network = useCurrentNetwork();
  const kit = useDAppKit();
  const cfg = getPublicSuiConfig();
  const { workspace, refresh: refreshWorkspace } = useOwnerWorkspace();
  const [grant, setGrant] = useState<Grant | null>(null);
  const [passcodeConfigured, setPasscodeConfigured] = useState<boolean | null>(null);
  const [newPasscode, setNewPasscode] = useState("");
  const [repeatPasscode, setRepeatPasscode] = useState("");
  const [oldPasscode, setOldPasscode] = useState("");
  const [passcode, setPasscode] = useState("");
  const [name, setName] = useState("");
  const [recipient, setRecipient] = useState("");
  const [perPaymentLimit, setPerPaymentLimit] = useState("1");
  const [dailyBudget, setDailyBudget] = useState("5");
  const [expiry, setExpiry] = useState("");
  const [agentAddress, setAgentAddress] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [digest, setDigest] = useState<string | null>(null);
  const [vaultBalanceMist, setVaultBalanceMist] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [passcodeRes, grantRes, balancesRes] = await Promise.all([
      fetch("/api/passcode", { cache: "no-store" }),
      workspace?.transferGrantId ? fetch("/api/transfer-grant", { cache: "no-store" }) : Promise.resolve(null),
      workspace?.vaultId ? fetch("/api/balances", { cache: "no-store" }) : Promise.resolve(null),
    ]);
    setPasscodeConfigured((await json<{ configured: boolean }>(passcodeRes)).configured);
    if (grantRes) setGrant(await json<Grant>(grantRes));
    if (balancesRes) setVaultBalanceMist((await json<{ vaultBalanceMist: string }>(balancesRes)).vaultBalanceMist);
  }, [workspace?.transferGrantId, workspace?.vaultId]);

  useEffect(() => { void refresh().catch((cause) => setError(cause instanceof Error ? cause.message : String(cause))); }, [refresh]);
  useEffect(() => {
    const onFunded = () => { void refresh().catch(() => undefined); };
    window.addEventListener(VAULT_BALANCES_CHANGED, onFunded);
    return () => window.removeEventListener(VAULT_BALANCES_CHANGED, onFunded);
  }, [refresh]);

  async function work(task: () => Promise<void>) {
    setBusy(true); setError(null); setMessage(null);
    try { await task(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }

  function requireWallet() {
    if (!account) throw new Error("Connect the vault owner wallet");
    if (network !== cfg.network) throw new Error(`Switch wallet to ${cfg.network}`);
    if (!cfg.packageId || !workspace?.vaultId) throw new Error("Create a vault first");
  }

  function prepare(candidate: Pending) {
    try {
      requireWallet();
      if (!passcodeConfigured) throw new Error("Create your passcode first");
      if (candidate.kind !== "create" && (!workspace?.transferGrantId || !workspace.transferAdminCapId)) throw new Error("Create a transfer grant for this vault first");
      if (candidate.kind === "add") {
        if (!candidate.name || candidate.name.length > 64) throw new Error("Enter a recipient name of up to 64 characters");
        address(candidate.address);
      }
      if (candidate.kind === "create" || candidate.kind === "replace" || candidate.kind === "limits") {
        if (toMist(candidate.perPaymentLimit) > toMist(candidate.dailyBudget)) throw new Error("Daily budget must cover the per-payment limit");
      }
      if (candidate.kind === "create" || candidate.kind === "replace" || candidate.kind === "expiry") {
        if (BigInt(candidate.expiresAtMs) <= BigInt(Date.now())) throw new Error("Choose a future expiry");
      }
      if (candidate.kind === "agent") address(candidate.address);
      if (candidate.kind === "replace") address(candidate.agent);
      setPending(candidate); setError(null); setPasscode("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }

  async function createPasscode() {
    if (newPasscode.length < 12) throw new Error("Use a passcode of at least 12 characters");
    if (newPasscode !== repeatPasscode) throw new Error("Passcodes do not match");
    await json(await fetch("/api/passcode", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation: "create", passcode: newPasscode }) }));
    setNewPasscode(""); setRepeatPasscode("");
    setMessage("Passcode created. Your wallet signature remains the on-chain authority for grant changes.");
    await refresh();
  }

  async function changePasscode() {
    if (newPasscode.length < 12) throw new Error("Use a new passcode of at least 12 characters");
    if (newPasscode !== repeatPasscode) throw new Error("New passcodes do not match");
    await json(await fetch("/api/passcode", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ operation: "change", passcode: oldPasscode, nextPasscode: newPasscode }) }));
    setOldPasscode(""); setNewPasscode(""); setRepeatPasscode("");
    setMessage("Passcode changed.");
  }

  function buildTransaction(action: Pending): Transaction {
    const tx = new Transaction();
    const target = (name: string) => `${cfg.publishedAt}::transfer_grant::${name}`;
    if (action.kind === "create") {
      tx.moveCall({ target: target("create_grant"), arguments: [
        tx.object(workspace!.vaultId), tx.pure.address(cfg.agentAddress),
        tx.pure.u64(toMist(action.perPaymentLimit)), tx.pure.u64(toMist(action.dailyBudget)),
        tx.pure.u64(action.expiresAtMs), tx.object(cfg.clockId),
      ] });
      return tx;
    }
    if (action.kind === "replace") {
      tx.moveCall({ target: target("replace_grant"), arguments: [
        tx.object(workspace!.vaultId), tx.object(workspace!.transferGrantId!), tx.object(workspace!.transferAdminCapId!),
        tx.pure.address(action.agent), tx.pure.u64(toMist(action.perPaymentLimit)),
        tx.pure.u64(toMist(action.dailyBudget)), tx.pure.u64(action.expiresAtMs), tx.object(cfg.clockId),
      ] });
      return tx;
    }
    const admin = [tx.object(workspace!.transferGrantId!), tx.object(workspace!.transferAdminCapId!)];
    switch (action.kind) {
      case "add":
        tx.moveCall({ target: target("add_recipient"), arguments: [...admin, tx.pure.address(action.address), tx.pure.string(action.name)] });
        break;
      case "remove":
        tx.moveCall({ target: target("remove_recipient"), arguments: [...admin, tx.pure.address(action.address)] });
        break;
      case "limits":
        tx.moveCall({ target: target("set_limits"), arguments: [...admin, tx.pure.u64(toMist(action.perPaymentLimit)), tx.pure.u64(toMist(action.dailyBudget))] });
        break;
      case "expiry":
        tx.moveCall({ target: target("set_expiry"), arguments: [...admin, tx.pure.u64(action.expiresAtMs), tx.object(cfg.clockId)] });
        break;
      case "agent":
        tx.moveCall({ target: target("set_agent"), arguments: [...admin, tx.pure.address(action.address)] });
        break;
      case "revoke":
        tx.moveCall({ target: target("revoke_grant"), arguments: admin });
        break;
    }
    return tx;
  }

  async function verifyAndSign() {
    if (!pending) return;
    requireWallet();
    await json(await fetch("/api/passcode", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation: "verify", passcode }) }));
    setPasscode("");
    const result = await kit.signAndExecuteTransaction({ transaction: buildTransaction(pending) });
    const value = "Transaction" in result && result.Transaction ? result.Transaction.digest : "digest" in result ? String(result.digest) : "";
    if (!value) throw new Error("Wallet did not return a transaction digest");
    setDigest(value);
    if (pending.kind === "create" || pending.kind === "replace") {
      await json(await fetch("/api/setup-objects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ digest: value }) }));
      await refreshWorkspace();
      setMessage("Transfer grant and admin capability registered for this wallet.");
    } else setMessage(`Grant change submitted: ${value}`);
    if (pending.kind === "add") { setName(""); setRecipient(""); }
    setPending(null);
    if (workspace?.transferGrantId) await refresh();
    notifyVaultBalancesChanged();
  }

  return <Card>
    <CardHeader>
      <CardTitle>Pay on command</CardTitle>
      <CardDescription>Whitelist names and addresses for chat payments. The agent may send vault SUI only after you confirm, within the per-transaction and daily caps stored on Sui.</CardDescription>
    </CardHeader>
    <CardContent className="space-y-5">
      {passcodeConfigured === false && <div className="space-y-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
        <p className="text-sm font-semibold text-amber-100">Create a passcode for whitelist changes</p>
        <p className="text-xs text-slate-300">The server checks this passcode before opening a wallet signature. The owner wallet and TransferAdminCap enforce the change on chain; no passcode is sent to Sui.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">Passcode (at least 12 characters)<Input type="password" autoComplete="new-password" value={newPasscode} onChange={(event) => setNewPasscode(event.target.value)} /></label>
          <label className="text-sm">Repeat passcode<Input type="password" autoComplete="new-password" value={repeatPasscode} onChange={(event) => setRepeatPasscode(event.target.value)} /></label>
        </div>
        <Button disabled={busy || newPasscode.length < 12 || !repeatPasscode} onClick={() => void work(createPasscode)}>Create passcode</Button>
      </div>}
      {passcodeConfigured === true && <details className="rounded-lg border border-slate-800 p-3 text-sm">
        <summary className="cursor-pointer font-medium">Change passcode</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <label>Current passcode<Input type="password" autoComplete="current-password" value={oldPasscode} onChange={(event) => setOldPasscode(event.target.value)} /></label>
          <label>New passcode<Input type="password" autoComplete="new-password" value={newPasscode} onChange={(event) => setNewPasscode(event.target.value)} /></label>
          <label>Repeat new passcode<Input type="password" autoComplete="new-password" value={repeatPasscode} onChange={(event) => setRepeatPasscode(event.target.value)} /></label>
        </div>
        <Button className="mt-3" variant="outline" disabled={busy || !oldPasscode || newPasscode.length < 12 || !repeatPasscode} onClick={() => void work(changePasscode)}>Change passcode</Button>
      </details>}

      {!workspace?.transferGrantId ? <div className="space-y-3">
        <p className="text-sm text-slate-300">Create one command grant for this vault. Chat payments use this whitelist; automatic monthly subscriptions use a separate policy.</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm">Max per payment (SUI)<Input type="number" min="0.000000001" step="any" value={perPaymentLimit} onChange={(event) => setPerPaymentLimit(event.target.value)} /></label>
          <label className="text-sm">Daily budget (SUI)<Input type="number" min="0.000000001" step="any" value={dailyBudget} onChange={(event) => setDailyBudget(event.target.value)} /></label>
          <label className="text-sm">Grant expires at (your local time)<Input type="datetime-local" value={expiry} onChange={(event) => setExpiry(event.target.value)} /></label>
        </div>
        <Button disabled={busy || !!pending || !passcodeConfigured || !cfg.agentAddress} onClick={() => {
          try { prepare({ kind: "create", perPaymentLimit, dailyBudget, expiresAtMs: futureTime(expiry) }); }
          catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
        }}>Create command grant</Button>
        <p className="text-xs text-slate-400">The grant and its admin capability are registered to this wallet after you approve creation.</p>
      </div> : grant ? <div className="space-y-5">
        <div className="grid gap-3 rounded-xl border border-slate-700 bg-slate-900/60 p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div><p className="text-xs text-slate-400">Status</p><p className={grant.active ? "font-semibold text-emerald-300" : "font-semibold text-rose-300"}>{grant.active ? "Active" : "Revoked"}</p></div>
          <div><p className="text-xs text-slate-400">Vault SUI</p><p>{vaultBalanceMist ? `${formatSuiFromMist(vaultBalanceMist)} SUI` : "…"}</p></div>
          <div><p className="text-xs text-slate-400">Remaining today</p><p>{fromMist(remainingDailyMist(grant).toString())} / {fromMist(grant.dailyBudget)} SUI</p></div>
          <div><p className="text-xs text-slate-400">Per payment</p><p>{fromMist(grant.perPaymentLimit)} SUI</p></div>
          <div><p className="text-xs text-slate-400">Expiry</p><p>{new Date(Number(grant.expiresAtMs)).toLocaleString()}</p></div>
          <div className="sm:col-span-2 lg:col-span-4"><p className="text-xs text-slate-400">Authorized agent</p><p className="break-all font-mono text-xs">{grant.agent}</p></div>
        </div>

        {(vaultBalanceMist && BigInt(vaultBalanceMist) === 0n) || remainingDailyMist(grant) === 0n ? (
          <div className="space-y-1 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">
            {vaultBalanceMist && BigInt(vaultBalanceMist) === 0n ? (
              <p>Vault is empty. <Link className="underline" href="/assets">Fund on Assets</Link>.</p>
            ) : null}
            {remainingDailyMist(grant) === 0n ? (
              <p>Daily command budget is used up. Wait until the next UTC day or raise the daily cap below.</p>
            ) : null}
          </div>
        ) : null}

        {grant.active ? <>
          <div className="space-y-3">
            <h4 className="text-sm font-semibold">Command whitelist (name + address)</h4>
            <div className="grid gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
              <label className="text-sm">Name<Input value={name} maxLength={64} onChange={(event) => setName(event.target.value)} placeholder="An" /></label>
              <label className="text-sm">Sui address<Input value={recipient} onChange={(event) => setRecipient(event.target.value)} placeholder="0x..." /></label>
              <Button disabled={busy || !!pending || !passcodeConfigured || !workspace?.transferAdminCapId} onClick={() => prepare({ kind: "add", name: name.trim(), address: recipient.trim() })}>Add recipient</Button>
            </div>
            <div className="space-y-2">{grant.recipients.map((entry) => <div key={entry.address} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-700 p-3 text-sm">
              <span className="break-all"><strong>{entry.name}</strong> · <span className="font-mono text-xs">{entry.address}</span></span>
              <Button variant="outline" disabled={busy || !!pending || !workspace?.transferAdminCapId} onClick={() => prepare({ kind: "remove", name: entry.name, address: entry.address })}>Remove</Button>
            </div>)}{grant.recipients.length === 0 && <p className="text-sm text-slate-400">No recipients yet. Add one before requesting a transfer.</p>}</div>
          </div>

          <details className="rounded-lg border border-slate-800 p-3 text-sm">
            <summary className="cursor-pointer font-medium">Change grant limits, expiry, or agent</summary>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <label>Max per payment (SUI)<Input type="number" min="0.000000001" step="any" value={perPaymentLimit} onChange={(event) => setPerPaymentLimit(event.target.value)} /></label>
              <label>Daily budget (SUI)<Input type="number" min="0.000000001" step="any" value={dailyBudget} onChange={(event) => setDailyBudget(event.target.value)} /></label>
              <div className="self-end"><Button variant="outline" disabled={busy || !!pending} onClick={() => prepare({ kind: "limits", perPaymentLimit, dailyBudget })}>Update limits</Button></div>
              <label>Expiry (your local time)<Input type="datetime-local" value={expiry} onChange={(event) => setExpiry(event.target.value)} /></label>
              <div className="self-end"><Button variant="outline" disabled={busy || !!pending} onClick={() => {
                try { prepare({ kind: "expiry", expiresAtMs: futureTime(expiry) }); }
                catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
              }}>Update expiry</Button></div>
              <div />
              <label className="sm:col-span-2">New agent address<Input value={agentAddress} onChange={(event) => setAgentAddress(event.target.value)} placeholder="0x..." /></label>
              <div className="self-end"><Button variant="outline" disabled={busy || !!pending || !agentAddress.trim()} onClick={() => prepare({ kind: "agent", address: agentAddress.trim() })}>Change agent</Button></div>
            </div>
          </details>
          <Button variant="danger" disabled={busy || !!pending} onClick={() => prepare({ kind: "revoke" })}>Revoke transfer grant</Button>
        </> : <div className="space-y-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
          <p className="font-semibold text-amber-100">This grant cannot spend. Create a replacement under the same vault.</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label>Max per payment (SUI)<Input type="number" min="0.000000001" step="any" value={perPaymentLimit} onChange={(event) => setPerPaymentLimit(event.target.value)} /></label>
            <label>Daily budget (SUI)<Input type="number" min="0.000000001" step="any" value={dailyBudget} onChange={(event) => setDailyBudget(event.target.value)} /></label>
            <label>Expiry (your local time)<Input type="datetime-local" value={expiry} onChange={(event) => setExpiry(event.target.value)} /></label>
            <label>Agent address<Input value={agentAddress} onChange={(event) => setAgentAddress(event.target.value)} placeholder={cfg.agentAddress || "0x..."} /></label>
          </div>
          <Button disabled={busy || !!pending || !workspace?.transferAdminCapId} onClick={() => {
            try { prepare({ kind: "replace", perPaymentLimit, dailyBudget, expiresAtMs: futureTime(expiry), agent: agentAddress.trim() || cfg.agentAddress }); }
            catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
          }}>Replace grant</Button>
        </div>}
      </div> : <p className="text-sm text-slate-400">Loading transfer grant…</p>}

      {pending && <div className="space-y-3 rounded-xl border border-indigo-400/40 bg-indigo-500/10 p-4 text-sm">
        <p className="font-semibold">Verify passcode, then approve in your wallet</p>
        <p className="break-all">{pendingLabel(pending)}</p>
        <p className="text-xs text-slate-300">Your passcode is checked by this app. The wallet transaction records your approval on Sui.</p>
        <label className="block">Passcode<Input type="password" autoComplete="off" value={passcode} onChange={(event) => setPasscode(event.target.value)} /></label>
        <div className="flex gap-2"><Button disabled={busy || !passcode} onClick={() => void work(verifyAndSign)}>{busy ? "Checking…" : "Verify and sign"}</Button><Button variant="outline" disabled={busy} onClick={() => { setPending(null); setPasscode(""); }}>Cancel</Button></div>
      </div>}
      <div className="flex flex-wrap items-center gap-3"><Button variant="outline" disabled={busy} onClick={() => void work(refresh)}>Refresh grant</Button>{digest && <a className="break-all text-xs text-indigo-300 underline" href={explorerTxUrl(digest)} target="_blank" rel="noreferrer">View transaction {digest}</a>}</div>
      {message && <p role="status" className="text-sm text-emerald-300">{message}</p>}
      {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
    </CardContent>
  </Card>;
}
