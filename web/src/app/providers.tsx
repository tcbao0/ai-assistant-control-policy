"use client";

import { DAppKitProvider } from "@mysten/dapp-kit-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import { dAppKit } from "@/app/dapp-kit";

/**
 * App providers.
 *
 * Maps the Phase 3 prompt's legacy pair:
 *   <SuiClientProvider> + <WalletProvider>
 * onto Mysten Sui 2.x:
 *   <DAppKitProvider dAppKit={...}>
 */
export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <DAppKitProvider dAppKit={dAppKit}>{children}</DAppKitProvider>
    </QueryClientProvider>
  );
}
