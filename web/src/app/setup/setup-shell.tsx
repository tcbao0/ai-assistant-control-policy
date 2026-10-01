"use client";

import { ConnectButton } from "@mysten/dapp-kit-react/ui";
import { Transaction, coinWithBalance } from "@mysten/sui/transactions";
import { useDAppKit } from "@mysten/dapp-kit-react";
import {
  ArrowRight,
  CheckCircle2,
  Coins,
  Loader2,
  Shield,
  Vault,
  WandSparkles,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { useOwnerWorkspace } from "@/components/dashboard/use-owner-workspace";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Stepper } from "@/components/ui/stepper";
import { useWalletAuth } from "@/hooks/use-wallet-auth";
import { explorerTxUrl, getPublicSuiConfig } from "@/lib/public-env";
import { describeWalletError, extractAbortCode, MOVE_ABORT_CODES } from "@/lib/sui/abort-codes";

const MIST = 1_000_000_000n;

const STEPS = [
  { id: "connect", label: "Connect wallet" },
  { id: "signin", label: "Sign in" },
  { id: "vault", label: "Create vault" },
  { id: "fund", label: "Fund vault" },
  { id: "policy", label: "Auto sub (optional)" },
] as const;

function toMist(value: string): bigint {
  if (!/^\d+(?:\.\d{1,9})?$/.test(value) || Number(value) <= 0) {
    throw new Error("Enter a positive SUI amount (max 9 decimals)");
  }
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * MIST + BigInt(fraction.padEnd(9, "0"));
}

function digestOf(result: unknown): string {
  if (
    result &&
    typeof result === "object" &&
    "Transaction" in result &&
    result.Transaction &&
    typeof result.Transaction === "object" &&
    "digest" in result.Transaction
  ) {
    return String((result.Transaction as { digest: string }).digest);
  }
  if (result && typeof result === "object" && "digest" in result) {
    return String((result as { digest: string }).digest);
  }
  return "";
}

export function SetupShell() {
  const router = useRouter();
  const kit = useDAppKit();
  const cfg = getPublicSuiConfig();
  const auth = useWalletAuth();
  const { workspace, loading: workspaceLoading, refresh } = useOwnerWorkspace();

  const [fundAmount, setFundAmount] = useState("10");
  const [monthlyBudget, setMonthlyBudget] = useState("50");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [lastDigest, setLastDigest] = useState<string | null>(null);
  const [fundedOnce, setFundedOnce] = useState(false);
  const [policySkipped, setPolicySkipped] = useState(false);

  const vaultId = workspace?.vaultId ?? null;
  const policyId = workspace?.policyId ?? null;

  const stepIndex = useMemo(() => {
    if (!auth.account) return 0;
    if (!auth.authorized) return 1;
    if (!vaultId) return 2;
    if (!fundedOnce && !policyId && !policySkipped) return 3;
    if (!policyId && !policySkipped) return 4;
    return 5;
  }, [auth.account, auth.authorized, vaultId, fundedOnce, policyId, policySkipped]);

  useEffect(() => {
    // Already fully set up → home
    if (!workspaceLoading && auth.authorized && vaultId && policyId) {
      // stay on done step; user clicks continue
    }
  }, [workspaceLoading, auth.authorized, vaultId, policyId]);

  const error = localError ?? auth.error;

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setLocalError(null);
    auth.setError(null);
    try {
      await work();
    } catch (cause) {
      setLocalError(describeWalletError(cause));
    } finally {
      setBusy(false);
    }
  }

  function requireReadyWallet() {
    if (!auth.account) throw new Error("Connect a wallet first");
    if (!auth.networkOk) throw new Error(`Switch wallet network to ${auth.expectedNetwork}`);
    if (!auth.authorized) throw new Error("Sign in with your wallet first");
    if (!cfg.packageId) throw new Error("NEXT_PUBLIC_PACKAGE_ID is missing");
  }

  async function createVault() {
    requireReadyWallet();
    const tx = new Transaction();
    tx.moveCall({ target: `${cfg.publishedAt}::vault::create_vault` });
    const result = await kit.signAndExecuteTransaction({ transaction: tx });
    const digest = digestOf(result);
    if (!digest) throw new Error("Wallet did not return a transaction digest");
    const response = await fetch("/api/bootstrap/vault", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ digest }),
    });
    const body = (await response.json()) as {
      vaultId?: string;
      owner?: string;
      error?: string;
    };
    if (!response.ok || !body.vaultId) {
      throw new Error(body.error ?? `Vault created; inspect tx ${digest}`);
    }
    setLastDigest(digest);
    await refresh();
  }

  async function fundVault() {
    requireReadyWallet();
    if (!vaultId) throw new Error("Create a vault first");
    const amount = toMist(fundAmount);
    const tx = new Transaction();
    tx.moveCall({
      target: `${cfg.publishedAt}::vault::fund_vault`,
      arguments: [
        tx.object(vaultId),
        coinWithBalance({ balance: amount, type: "0x2::sui::SUI" }),
      ],
    });
    const result = await kit.signAndExecuteTransaction({ transaction: tx });
    const digest = digestOf(result);
    if (!digest) throw new Error("Wallet did not return a transaction digest");
    setLastDigest(digest);
    setFundedOnce(true);
  }

  async function createPolicy() {
    requireReadyWallet();
    if (!vaultId) throw new Error("Create a vault first");
    if (!cfg.agentAddress) throw new Error("NEXT_PUBLIC_AGENT_ADDRESS is missing");
    const existing = await refresh();
    if (existing?.policyId) return;
    try {
      const tx = new Transaction();
      tx.moveCall({
        target: `${cfg.publishedAt}::policy::create_policy`,
        arguments: [
          tx.object(vaultId),
          tx.pure.address(cfg.agentAddress),
          tx.pure.u64(toMist(monthlyBudget)),
        ],
      });
      const result = await kit.signAndExecuteTransaction({ transaction: tx });
      const digest = digestOf(result);
      if (!digest) throw new Error("Wallet did not return a transaction digest");
      const response = await fetch("/api/setup-objects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ digest }),
      });
      const ids = (await response.json()) as {
        policyId?: string;
        adminCapId?: string;
        error?: string;
      };
      if (!response.ok) throw new Error(ids.error ?? "Could not register the policy");
      setLastDigest(digest);
      await refresh();
    } catch (cause) {
      if (extractAbortCode(cause) === MOVE_ABORT_CODES.POLICY_ALREADY_BOUND) {
        const recovered = await refresh();
        if (recovered?.policyId) return;
      }
      throw cause;
    }
  }

  const done = Boolean(auth.authorized && vaultId);

  return (
    <div className="min-h-screen">
      {/* Lightweight top bar — full Header is on agent home */}
      <div className="border-b border-slate-200 bg-white/90 px-4 py-3 text-sm text-slate-700 sm:px-6">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <Link href="/" className="font-medium text-black hover:text-sui-dark">
            ← Agent home
          </Link>
          <span className="text-xs text-slate-500">First-time setup</span>
        </div>
      </div>
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6">
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sui-dark">
          First-time setup
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-black">
          Set up your control plane
        </h1>
        <p className="max-w-2xl text-sm text-slate-500">
          New here? Finish these steps once. After that you land on Agent.
          Create a command grant under Policies before chatting. Automatic
          monthly subscriptions are optional.
        </p>
      </div>

      <Stepper steps={[...STEPS]} current={Math.min(stepIndex, STEPS.length - 1)} />

      <Card>
        <CardHeader>
          <CardTitle>
            {stepIndex === 0 && "Step 1 · Connect wallet"}
            {stepIndex === 1 && "Step 2 · Sign in"}
            {stepIndex === 2 && "Step 3 · Create vault"}
            {stepIndex === 3 && "Step 4 · Fund vault"}
            {stepIndex === 4 && "Step 5 · Automatic monthly policy (optional)"}
            {stepIndex >= 5 && "Setup complete"}
          </CardTitle>
          <CardDescription>
            {stepIndex === 0 &&
              `Use a Sui wallet on ${auth.expectedNetwork}. This wallet becomes the vault owner.`}
            {stepIndex === 1 &&
              "Sign a one-time message so the app knows this browser session belongs to your wallet."}
            {stepIndex === 2 &&
              "Create an on-chain shared vault that holds SUI the agent may spend under policy."}
            {stepIndex === 3 &&
              "Deposit some SUI into the vault. You can skip and fund later from Assets."}
            {stepIndex === 4 &&
              "Optional: create the automatic monthly subscription policy. Chat payments use a separate command grant under Policies."}
            {stepIndex >= 5 &&
              "Vault is ready. Create a command grant under Policies for chat. Automatic monthly subscriptions can be added later."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {workspaceLoading || auth.checking ? (
            <p className="flex items-center gap-2 text-sm text-slate-700">
              <Loader2 className="h-4 w-4 animate-spin" /> Checking your workspace…
            </p>
          ) : null}

          {stepIndex === 0 && (
            <div className="space-y-4">
              <div className="rounded-xl border border-slate-200 bg-white/90 p-4">
                <ConnectButton />
              </div>
              {auth.account ? (
                <p className="break-all text-xs text-slate-500">
                  Connected: {auth.account.address}
                </p>
              ) : (
                <p className="text-sm text-slate-500">
                  Install / open Slush, Suiet, or another Sui wallet, then connect.
                </p>
              )}
              {!auth.networkOk && auth.account ? (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  Wrong network. Switch wallet to <strong>{auth.expectedNetwork}</strong>.
                </p>
              ) : null}
            </div>
          )}

          {stepIndex === 1 && (
            <div className="space-y-4">
              <p className="break-all text-xs text-slate-500">
                Wallet: {auth.account?.address}
              </p>
              <Button
                disabled={busy || auth.busy || !auth.networkOk}
                onClick={() => void run(async () => {
                  const ok = await auth.signIn();
                  if (ok) await refresh();
                })}
              >
                {busy || auth.busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Shield className="h-4 w-4" />
                )}
                Sign in with wallet
              </Button>
            </div>
          )}

          {stepIndex === 2 && (
            <div className="space-y-4">
              <Button disabled={busy} onClick={() => void run(createVault)}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Vault className="h-4 w-4" />}
                Create vault on Sui
              </Button>
              <p className="text-xs text-slate-500">
                Approves one wallet transaction. The vault ID is saved to your workspace automatically.
              </p>
            </div>
          )}

          {stepIndex === 3 && (
            <div className="space-y-4">
              <label className="block space-y-1 text-sm">
                <span className="text-slate-700">Amount (SUI)</span>
                <Input
                  type="number"
                  min="0.000000001"
                  step="0.1"
                  value={fundAmount}
                  onChange={(e) => setFundAmount(e.target.value)}
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <Button disabled={busy} onClick={() => void run(fundVault)}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Coins className="h-4 w-4" />}
                  Fund vault
                </Button>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => setFundedOnce(true)}
                >
                  Skip for now
                </Button>
              </div>
            </div>
          )}

          {stepIndex === 4 && (
            <div className="space-y-4">
              <label className="block space-y-1 text-sm">
                <span className="text-slate-700">Total monthly budget (SUI)</span>
                <Input
                  type="number"
                  min="0.000000001"
                  step="1"
                  value={monthlyBudget}
                  onChange={(e) => setMonthlyBudget(e.target.value)}
                />
              </label>
              <p className="text-xs text-slate-500">
                Agent address from env:{" "}
                <code className="text-sui-dark">
                  {cfg.agentAddress || "(missing NEXT_PUBLIC_AGENT_ADDRESS)"}
                </code>
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={busy || !cfg.agentAddress}
                  onClick={() => void run(createPolicy)}
                >
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <WandSparkles className="h-4 w-4" />
                  )}
                  Create automatic subscription policy
                </Button>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => setPolicySkipped(true)}
                >
                  Skip for now
                </Button>
              </div>
            </div>
          )}

          {stepIndex >= 5 && (
            <div className="space-y-4">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                <p className="mb-2 flex items-center gap-2 font-semibold">
                  <CheckCircle2 className="h-4 w-4" /> You&apos;re ready
                </p>
                <ul className="space-y-1 text-xs text-emerald-800">
                  <li>Vault: <code className="break-all">{vaultId}</code></li>
                  <li>Auto policy: {policyId ? <code className="break-all">{policyId}</code> : "skipped (optional)"}</li>
                </ul>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => router.push("/")}>
                  Go to agent home <ArrowRight className="h-4 w-4" />
                </Button>
                <Button variant="outline" asChild>
                  <Link href="/">Maybe later</Link>
                </Button>
              </div>
              <p className="text-xs text-slate-500">
                Next: create a command grant under{" "}
                <Link href="/policies" className="text-sui-dark underline">Policies</Link>
                {" "}before chatting. Fund or withdraw on{" "}
                <Link href="/assets" className="text-sui-dark underline">Assets</Link>.
              </p>
            </div>
          )}

          {lastDigest ? (
            <a
              className="inline-block text-xs text-sui-dark underline"
              href={explorerTxUrl(lastDigest)}
              target="_blank"
              rel="noreferrer"
            >
              View last transaction {lastDigest.slice(0, 10)}…
            </a>
          ) : null}

          {error ? (
            <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
              {error}
            </p>
          ) : null}
          {auth.error ? (
            <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
              {auth.error}
            </p>
          ) : null}
          {auth.authorized ? (
            <Button variant="outline" disabled={auth.busy} onClick={() => void auth.signOut()}>
              Log out
            </Button>
          ) : null}

          {done && stepIndex < 5 ? null : null}
        </CardContent>
      </Card>

      {auth.authorized && vaultId && !policyId && stepIndex < 5 ? (
        <p className="text-center text-xs text-slate-500">
          Already have a vault? You can{" "}
          <button
            type="button"
            className="text-sui-dark underline"
            onClick={() => router.push("/")}
          >
            open the home page
          </button>{" "}
          and finish policy setup under Policies.
        </p>
      ) : null}
    </main>
    </div>
  );
}
