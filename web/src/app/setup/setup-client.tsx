"use client";

import dynamic from "next/dynamic";

import { OwnerWorkspaceProvider } from "@/components/dashboard/use-owner-workspace";
import { WalletAuthProvider } from "@/hooks/use-wallet-auth";

const SetupShell = dynamic(() => import("./setup-shell").then((module) => module.SetupShell), {
  ssr: false,
  loading: () => <main className="mx-auto max-w-2xl p-8 text-slate-700">Loading wallet setup…</main>,
});

export function SetupClient() {
  return (
    <WalletAuthProvider>
      <OwnerWorkspaceProvider>
        <SetupShell />
      </OwnerWorkspaceProvider>
    </WalletAuthProvider>
  );
}
