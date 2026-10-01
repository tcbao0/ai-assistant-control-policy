/**
 * Mirrors `subscription_manager::errors` abort codes from Phase 1.
 * Used to turn Move VM aborts into UI / API messages.
 */
export const MOVE_ABORT_CODES = {
  VENDOR_NOT_WHITELISTED: 1,
  AMOUNT_EXCEEDS_LIMIT: 2,
  COOLDOWN_NOT_REACHED: 3,
  NOT_VAULT_OWNER: 4,
  NOT_POLICY_ISSUER: 5,
  VAULT_POLICY_MISMATCH: 6,
  POLICY_INACTIVE: 7,
  ZERO_AMOUNT: 8,
  INSUFFICIENT_VAULT_BALANCE: 9,
  VENDOR_ALREADY_EXISTS: 10,
  VENDOR_NOT_FOUND: 11,
  AGENT_ONLY: 12,
  POLICY_ALREADY_BOUND: 13,
  MONTHLY_BUDGET: 14,
  NOT_DUE: 15,
  SUBSCRIPTION_EXPIRED: 16,
  INVALID_SCHEDULE: 17,
  TRANSFER_GRANT_ALREADY_BOUND: 18,
  TRANSFER_RECIPIENT_NOT_ALLOWED: 19,
  TRANSFER_RECIPIENT_EXISTS: 20,
  TRANSFER_RECIPIENT_NOT_FOUND: 21,
  TRANSFER_PAYMENT_LIMIT: 22,
  TRANSFER_DAILY_BUDGET: 23,
  TRANSFER_EXPIRED: 24,
  TRANSFER_NONCE: 25,
  INVALID_TRANSFER_GRANT: 26,
} as const;

export type MoveAbortCode =
  (typeof MOVE_ABORT_CODES)[keyof typeof MOVE_ABORT_CODES];

const ABORT_MESSAGES: Record<number, { name: string; message: string; policyMessage: string }> = {
  [MOVE_ABORT_CODES.VENDOR_NOT_WHITELISTED]: {
    name: "EVendorNotWhitelisted",
    message: "Vendor address is not on the SubscriptionPolicy whitelist.",
    policyMessage: "Blocked by Policy Plane: Vendor not whitelisted",
  },
  [MOVE_ABORT_CODES.AMOUNT_EXCEEDS_LIMIT]: {
    name: "EAmountExceedsLimit",
    message: "Payment amount exceeds the service monthly cap.",
    policyMessage: "Blocked by Policy Plane: Over budget",
  },
  [MOVE_ABORT_CODES.COOLDOWN_NOT_REACHED]: {
    name: "ECooldownNotReached",
    message: "Cooldown / interval since the last payment has not elapsed.",
    policyMessage: "Blocked by Policy Plane: Cooldown not reached",
  },
  [MOVE_ABORT_CODES.NOT_VAULT_OWNER]: {
    name: "ENotVaultOwner",
    message: "Caller is not the vault owner.",
    policyMessage: "Blocked by Policy Plane: Not vault owner",
  },
  [MOVE_ABORT_CODES.NOT_POLICY_ISSUER]: {
    name: "ENotPolicyIssuer",
    message: "Caller is not the policy issuer / admin cap mismatch.",
    policyMessage: "Blocked by Policy Plane: Not policy issuer",
  },
  [MOVE_ABORT_CODES.VAULT_POLICY_MISMATCH]: {
    name: "EVaultPolicyMismatch",
    message: "Policy is bound to a different vault.",
    policyMessage: "Blocked by Policy Plane: Vault / policy mismatch",
  },
  [MOVE_ABORT_CODES.POLICY_INACTIVE]: {
    name: "EPolicyInactive",
    message: "SubscriptionPolicy has been revoked / deactivated.",
    policyMessage: "Blocked by Policy Plane: Policy revoked",
  },
  [MOVE_ABORT_CODES.ZERO_AMOUNT]: {
    name: "EZeroAmount",
    message: "Payment amount must be greater than zero.",
    policyMessage: "Blocked by Policy Plane: Zero amount",
  },
  [MOVE_ABORT_CODES.INSUFFICIENT_VAULT_BALANCE]: {
    name: "EInsufficientVaultBalance",
    message: "Vault does not hold enough SUI for this payment.",
    policyMessage: "Blocked by Policy Plane: Insufficient vault balance",
  },
  [MOVE_ABORT_CODES.VENDOR_ALREADY_EXISTS]: {
    name: "EVendorAlreadyExists",
    message: "Vendor rule already exists.",
    policyMessage: "Blocked by Policy Plane: Vendor already exists",
  },
  [MOVE_ABORT_CODES.VENDOR_NOT_FOUND]: {
    name: "EVendorNotFound",
    message: "Vendor rule was not found.",
    policyMessage: "Blocked by Policy Plane: Vendor not found",
  },
  [MOVE_ABORT_CODES.AGENT_ONLY]: { name: "EAgentOnly", message: "Only the configured agent can pay.", policyMessage: "Blocked by Policy Plane: Wrong agent" },
  [MOVE_ABORT_CODES.POLICY_ALREADY_BOUND]: { name: "EPolicyAlreadyBound", message: "Vault already has a policy.", policyMessage: "Blocked by Policy Plane: Policy exists" },
  [MOVE_ABORT_CODES.MONTHLY_BUDGET]: { name: "EMonthlyBudget", message: "Monthly service or vault budget exceeded.", policyMessage: "Blocked by Policy Plane: Monthly budget exceeded" },
  [MOVE_ABORT_CODES.NOT_DUE]: { name: "ENotDue", message: "This subscription is not due today or was already paid this month.", policyMessage: "Blocked by Policy Plane: Not due" },
  [MOVE_ABORT_CODES.SUBSCRIPTION_EXPIRED]: { name: "ESubscriptionExpired", message: "Subscription duration has ended.", policyMessage: "Blocked by Policy Plane: Subscription expired" },
  [MOVE_ABORT_CODES.INVALID_SCHEDULE]: { name: "EInvalidSchedule", message: "Invalid budget or schedule.", policyMessage: "Blocked by Policy Plane: Invalid schedule" },
  [MOVE_ABORT_CODES.TRANSFER_GRANT_ALREADY_BOUND]: { name: "ETransferGrantAlreadyBound", message: "Vault already has a transfer grant.", policyMessage: "Blocked by Policy Plane: Transfer grant exists" },
  [MOVE_ABORT_CODES.TRANSFER_RECIPIENT_NOT_ALLOWED]: { name: "ETransferRecipientNotAllowed", message: "Recipient is not in the on-chain transfer whitelist.", policyMessage: "Blocked by Policy Plane: Recipient not whitelisted" },
  [MOVE_ABORT_CODES.TRANSFER_RECIPIENT_EXISTS]: { name: "ETransferRecipientExists", message: "Recipient already exists in the transfer grant.", policyMessage: "Blocked by Policy Plane: Recipient exists" },
  [MOVE_ABORT_CODES.TRANSFER_RECIPIENT_NOT_FOUND]: { name: "ETransferRecipientNotFound", message: "Recipient was not found in the transfer grant.", policyMessage: "Blocked by Policy Plane: Recipient not found" },
  [MOVE_ABORT_CODES.TRANSFER_PAYMENT_LIMIT]: { name: "ETransferPaymentLimit", message: "Transfer exceeds the per-payment limit.", policyMessage: "Blocked by Policy Plane: Transfer exceeds per-payment limit" },
  [MOVE_ABORT_CODES.TRANSFER_DAILY_BUDGET]: { name: "ETransferDailyBudget", message: "Transfer would exceed the daily budget.", policyMessage: "Blocked by Policy Plane: Transfer daily budget exceeded" },
  [MOVE_ABORT_CODES.TRANSFER_EXPIRED]: { name: "ETransferExpired", message: "Transfer grant has expired.", policyMessage: "Blocked by Policy Plane: Transfer grant expired" },
  [MOVE_ABORT_CODES.TRANSFER_NONCE]: { name: "ETransferNonce", message: "Transfer nonce has already been used.", policyMessage: "Blocked by Policy Plane: Transfer replay rejected" },
  [MOVE_ABORT_CODES.INVALID_TRANSFER_GRANT]: { name: "EInvalidTransferGrant", message: "Invalid transfer grant settings.", policyMessage: "Blocked by Policy Plane: Invalid transfer grant" },
};

export interface ParsedMoveAbort {
  code: number;
  name: string;
  message: string;
  policyMessage: string;
}

/** Pull a numeric abort code out of Mysten / RPC error strings. */
export function extractAbortCode(error: unknown): number | null {
  const text = stringifyError(error);

  const patterns = [
    /abort[_\s]*code[:\s]+(?:0x)?([0-9a-f]+)/i,
    /\(code:\s*(\d+)\)/i,
    /",\s*(\d+)\s*\)/,
  ];

  for (const re of patterns) {
    const match = text.match(re);
    if (!match?.[1]) continue;
    const raw = match[1];
    const code = raw.startsWith("0x") || /[a-f]/i.test(raw) ? Number.parseInt(raw, 16) : Number.parseInt(raw, 10);
    if (Number.isFinite(code)) return code;
  }

  return null;
}

export function explainAbortCode(code: number): ParsedMoveAbort {
  const known = ABORT_MESSAGES[code];
  if (known) {
    return { code, ...known };
  }
  return {
    code,
    name: `EUnknown(${code})`,
    message: `Move abort with unknown code ${code}.`,
    policyMessage: `Blocked by Policy Plane: Abort code ${code}`,
  };
}

export function mapSuiErrorToPolicy(error: unknown): ParsedMoveAbort | null {
  const code = extractAbortCode(error);
  if (code === null) return null;
  return explainAbortCode(code);
}

/** Wallet / RPC failures while creating a grant that already exists on the vault. */
export function describeWalletError(error: unknown): string {
  const abort = mapSuiErrorToPolicy(error);
  if (abort?.code === MOVE_ABORT_CODES.POLICY_ALREADY_BOUND) {
    return "This vault already has a subscription policy on chain. Reload the page to attach it instead of creating another.";
  }
  if (abort?.code === MOVE_ABORT_CODES.TRANSFER_GRANT_ALREADY_BOUND) {
    return "This vault already has a transfer grant on chain. Reload the page to attach it instead of creating another.";
  }
  if (abort) return abort.message;
  return error instanceof Error ? error.message : String(error);
}

export function stringifyError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}${error.cause ? ` | cause=${stringifyError(error.cause)}` : ""}`;
  }
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
