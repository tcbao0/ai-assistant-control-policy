import { createDAppKit } from "@mysten/dapp-kit-react";
import { SuiGrpcClient } from "@mysten/sui/grpc";

/**
 * Mysten Sui 2.x wallet kit.
 * (Legacy `@mysten/dapp-kit` SuiClientProvider/WalletProvider is deprecated.)
 */
const GRPC_URLS = {
  mainnet: "https://fullnode.mainnet.sui.io:443",
  testnet: "https://fullnode.testnet.sui.io:443",
  devnet: "https://fullnode.devnet.sui.io:443",
  localnet: "http://127.0.0.1:9000",
} as const;

export type AppNetwork = keyof typeof GRPC_URLS;

const defaultNetwork = (process.env.NEXT_PUBLIC_SUI_NETWORK ??
  "testnet") as AppNetwork;

export const dAppKit = createDAppKit({
  networks: ["testnet", "devnet", "mainnet", "localnet"],
  defaultNetwork: defaultNetwork in GRPC_URLS ? defaultNetwork : "testnet",
  createClient(network) {
    return new SuiGrpcClient({
      network,
      baseUrl: GRPC_URLS[network as AppNetwork] ?? GRPC_URLS.testnet,
    });
  },
});

declare module "@mysten/dapp-kit-react" {
  interface Register {
    dAppKit: typeof dAppKit;
  }
}
