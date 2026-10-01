/** Client-safe env for wallet admin actions (NEXT_PUBLIC_*). */
export function getPublicSuiConfig() {
  return {
    network: (process.env.NEXT_PUBLIC_SUI_NETWORK ?? "testnet") as
      | "mainnet"
      | "testnet"
      | "devnet"
      | "localnet",
    packageId: process.env.NEXT_PUBLIC_PACKAGE_ID ?? "",
    publishedAt:
      process.env.NEXT_PUBLIC_PACKAGE_PUBLISHED_AT ??
      process.env.NEXT_PUBLIC_PACKAGE_ID ??
      "",
    agentAddress: process.env.NEXT_PUBLIC_AGENT_ADDRESS ?? "",
    clockId: process.env.NEXT_PUBLIC_CLOCK_ID ?? "0x6",
    explorerBase:
      process.env.NEXT_PUBLIC_EXPLORER_BASE ??
      "https://suiscan.xyz/testnet/tx",
  };
}

export function explorerTxUrl(digest: string): string {
  const { explorerBase } = getPublicSuiConfig();
  return `${explorerBase}/${digest}`;
}
