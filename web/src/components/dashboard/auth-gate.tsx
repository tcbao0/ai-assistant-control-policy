"use client";

import { ConnectButton } from "@mysten/dapp-kit-react/ui";
import { Loader2, Shield } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { useWalletAuth } from "@/hooks/use-wallet-auth";

export function AuthGate({ children }: { children: ReactNode }) {
  const auth = useWalletAuth();

  if (auth.authorized) return <>{children}</>;

  if (auth.checking) {
    return (
      <section className="mx-auto max-w-xl px-4 py-16 text-center text-slate-700">
        <Loader2 className="mx-auto mb-3 h-5 w-5 animate-spin" />
        Checking wallet session…
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-xl space-y-5 px-4 py-10">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm shadow-slate-200/80">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-sui-soft text-sui-dark">
          <Shield className="h-6 w-6" />
        </div>
        <h2 className="text-xl font-semibold text-black">Start here</h2>
        <p className="mt-2 text-sm text-slate-500">
          Connect the vault-owner wallet, sign in, then the app unlocks agent commands.
          First visit? Use the guided setup.
        </p>

        <div className="mt-5 flex justify-center">
          <ConnectButton />
        </div>

        {auth.account ? (
          <p className="mt-3 break-all text-xs text-slate-500">{auth.account.address}</p>
        ) : (
          <p className="mt-3 text-xs text-slate-500">No wallet connected yet.</p>
        )}

        {!auth.networkOk && auth.account ? (
          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Switch wallet network to <strong>{auth.expectedNetwork}</strong>.
          </p>
        ) : null}

        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Button
            disabled={!auth.account || auth.busy || !auth.networkOk}
            onClick={() => void auth.signIn()}
          >
            {auth.busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Shield className="h-4 w-4" />
            )}
            Sign in with wallet
          </Button>
          <Button variant="outline" asChild>
            <Link href="/setup">Open first-time setup</Link>
          </Button>
        </div>

        {auth.error ? (
          <p className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
            {auth.error}
          </p>
        ) : null}
      </div>
    </section>
  );
}
