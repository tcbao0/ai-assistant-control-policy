"use client";

import { useCurrentAccount, useCurrentNetwork, useDAppKit } from "@mysten/dapp-kit-react";
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { getPublicSuiConfig } from "@/lib/public-env";

export function WalletAuthProvider({ children }: { children: ReactNode }) {
  const value = useWalletAuthState();
  return createElement(WalletAuthContext.Provider, { value }, children);
}

export function useWalletAuth() {
  const value = useContext(WalletAuthContext);
  if (!value) throw new Error("WalletAuthProvider is required");
  return value;
}

const WalletAuthContext = createContext<ReturnType<typeof useWalletAuthState> | null>(null);

function useWalletAuthState() {
  const account = useCurrentAccount();
  const network = useCurrentNetwork();
  const kit = useDAppKit();
  const expectedNetwork = getPublicSuiConfig().network;
  const [authorized, setAuthorized] = useState(false);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/auth/me", { cache: "no-store" });
      if (!response.ok) {
        setAuthorized(false);
        return false;
      }
      const data = (await response.json()) as { owner: string };
      const owner = data.owner.toLowerCase();
      if (account && account.address.toLowerCase() !== owner) {
        setAuthorized(false);
        return false;
      }
      setAuthorized(true);
      return true;
    } catch {
      setAuthorized(false);
      return false;
    } finally {
      setChecking(false);
    }
  }, [account?.address]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signIn = useCallback(async (): Promise<boolean> => {
    if (!account) {
      setError("Connect a Sui wallet first.");
      return false;
    }
    if (network !== expectedNetwork) {
      setError(`Switch your wallet network to ${expectedNetwork}.`);
      return false;
    }
    setBusy(true);
    setError(null);
    try {
      const challengeResponse = await fetch("/api/auth/challenge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: account.address }),
      });
      const challenge = (await challengeResponse.json()) as {
        nonce?: string;
        message?: string;
        error?: string;
      };
      if (!challengeResponse.ok || !challenge.message || !challenge.nonce) {
        throw new Error(challenge.error ?? "Cannot create wallet challenge");
      }
      const signed = await kit.signPersonalMessage({
        message: new TextEncoder().encode(challenge.message),
      });
      const verifyResponse = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          address: account.address,
          nonce: challenge.nonce,
          signature: signed.signature,
        }),
      });
      const verified = (await verifyResponse.json()) as { error?: string };
      if (!verifyResponse.ok) {
        throw new Error(verified.error ?? "Wallet verification failed");
      }
      setAuthorized(true);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setAuthorized(false);
      return false;
    } finally {
      setBusy(false);
    }
  }, [account, kit, network, expectedNetwork]);

  const signOut = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? "Cannot log out");
      }
      setAuthorized(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, []);

  return useMemo(() => ({
    account,
    network,
    expectedNetwork,
    authorized,
    checking,
    busy,
    error,
    setError,
    refresh,
    signIn,
    signOut,
    networkOk: network === expectedNetwork,
  }), [account, network, expectedNetwork, authorized, checking, busy, error, refresh, signIn, signOut]);
}
