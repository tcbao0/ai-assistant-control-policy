import type { Metadata } from "next";
import type { ReactNode } from "react";

import { ClientProviders } from "@/app/client-providers";

import "./globals.css";

export const metadata: Metadata = {
  title: "AI Subscription & Expense Manager",
  description:
    "Sui policy plane dashboard — AI agent proposes payments, Move enforces limits",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/*
          Providers replace the legacy Phase-3 sketch:
          <SuiClientProvider> + <WalletProvider>
          with Mysten Sui 2.x <DAppKitProvider>.
        */}
        <ClientProviders>{children}</ClientProviders>
      </body>
    </html>
  );
}
