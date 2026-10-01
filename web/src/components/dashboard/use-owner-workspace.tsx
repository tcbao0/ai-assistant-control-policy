"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

import { useWalletAuth } from "@/hooks/use-wallet-auth";

export interface OwnerWorkspaceView {
  owner: string;
  network: string;
  packageId: string;
  vaultId: string;
  policyId: string | null;
  policyAdminCapId: string | null;
  transferGrantId: string | null;
  transferAdminCapId: string | null;
}

type WorkspaceState = {
  workspace: OwnerWorkspaceView | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<OwnerWorkspaceView | null>;
};

const WorkspaceContext = createContext<WorkspaceState | null>(null);

export function OwnerWorkspaceProvider({ children }: { children: ReactNode }) {
  const { authorized } = useWalletAuth();
  const [workspace, setWorkspace] = useState<OwnerWorkspaceView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const workspaceRef = useRef<OwnerWorkspaceView | null>(null);
  workspaceRef.current = workspace;

  const refresh = useCallback(async () => {
    if (!workspaceRef.current) setLoading(true);
    try {
      const response = await fetch("/api/workspace", { cache: "no-store" });
      const body = await response.json() as { workspace?: OwnerWorkspaceView | null; error?: string };
      if (response.status === 401 || response.status === 404) {
        setWorkspace(null);
        setError(null);
        return null;
      }
      if (!response.ok || !body.workspace) throw new Error(body.error ?? "Cannot load this wallet's workspace");
      setWorkspace(body.workspace);
      setError(null);
      return body.workspace;
    } catch (cause) {
      setWorkspace(null);
      setError(cause instanceof Error ? cause.message : String(cause));
      return null;
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (authorized && !workspaceRef.current) void refresh();
  }, [authorized, refresh]);

  return (
    <WorkspaceContext.Provider value={{ workspace, loading, error, refresh }}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useOwnerWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useOwnerWorkspace must be used inside OwnerWorkspaceProvider");
  return value;
}
