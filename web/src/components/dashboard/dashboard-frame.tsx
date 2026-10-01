"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { AuthGate } from "@/components/dashboard/auth-gate";
import { Header } from "@/components/dashboard/header";
import { LegacyPolicyRevoker } from "@/components/dashboard/legacy-policy-revoker";
import { OwnerWorkspaceProvider, useOwnerWorkspace } from "@/components/dashboard/use-owner-workspace";
import { Button } from "@/components/ui/button";
import { WalletAuthProvider } from "@/hooks/use-wallet-auth";

export function DashboardFrame({ children }: { children: ReactNode }) {
  return (
    <WalletAuthProvider>
      <OwnerWorkspaceProvider>
        <div className="min-h-screen">
          <Header />
          <LegacyPolicyRevoker />
          <AuthGate>
            <VaultRequired>{children}</VaultRequired>
          </AuthGate>
        </div>
      </OwnerWorkspaceProvider>
    </WalletAuthProvider>
  );
}

function VaultRequired({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { workspace, loading } = useOwnerWorkspace();

  useEffect(() => {
    if (loading) return;
    if (!workspace?.vaultId) router.replace("/setup");
  }, [loading, workspace?.vaultId, router]);

  if (workspace?.vaultId) {
    return <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">{children}</main>;
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-7xl px-4 py-16 text-center text-slate-700">
        <Loader2 className="mx-auto mb-3 h-5 w-5 animate-spin" />
        Loading your workspace…
      </main>
    );
  }

  if (!workspace?.vaultId) {
    return (
      <main className="mx-auto max-w-xl px-4 py-16 text-center text-slate-700">
        <p className="mb-4">No vault yet. Taking you to first-time setup…</p>
        <Button asChild>
          <Link href="/setup">Open setup</Link>
        </Button>
      </main>
    );
  }

  return null;
}
