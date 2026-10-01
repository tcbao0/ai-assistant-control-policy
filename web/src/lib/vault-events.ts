export const VAULT_BALANCES_CHANGED = "vault-balances-changed";

export function notifyVaultBalancesChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(VAULT_BALANCES_CHANGED));
}
