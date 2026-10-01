import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Monorepo: keep tracing rooted on this package, not a random parent lockfile.
  outputFileTracingRoot: path.join(__dirname, ".."),
  transpilePackages: ["@mysten/dapp-kit-react", "@mysten/dapp-kit-core"],
};

export default nextConfig;
