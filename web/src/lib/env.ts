function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function optional(name: string, fallback?: string): string | undefined {
  const value = process.env[name]?.trim();
  if (value) return value;
  return fallback;
}

export type SuiNetwork = "mainnet" | "testnet" | "devnet" | "localnet";

/** On-chain agent runtime config (Gemini is handled separately in ai.service). */
export interface AgentEnv {
  suiNetwork: SuiNetwork;
  suiRpcUrl?: string;
  agentPrivateKey: string;
  /** Original package ID. Object types and Mongo workspace keys stay here after upgrades. */
  packageId: string;
  /** Latest package ID used for Move calls and newly added events. */
  publishedAt: string;
  clockId: string;
  paymentTarget: string;
}

export function getAgentEnv(): AgentEnv {
  const packageId = required("PACKAGE_ID").toLowerCase();
  const publishedAt = (optional("PACKAGE_PUBLISHED_AT", packageId) ?? packageId).toLowerCase();
  const paymentTarget =
    optional("PAYMENT_TARGET") ??
    `${publishedAt}::payment::execute_payment_or_abort`;

  const network = (optional("SUI_NETWORK", "testnet") ?? "testnet") as SuiNetwork;

  return {
    suiNetwork: network,
    suiRpcUrl: optional("SUI_RPC_URL"),
    agentPrivateKey: required("AGENT_PRIVATE_KEY"),
    packageId,
    publishedAt,
    clockId: optional("CLOCK_ID", "0x6") ?? "0x6",
    paymentTarget,
  };
}
