/// Centralized abort codes for the subscription policy plane.
/// Backend (Phase 2) maps these numeric codes to human-readable UI strings.
module subscription_manager::errors;

/// Vendor address is missing from the policy whitelist.
const E_VENDOR_NOT_WHITELISTED: u64 = 1;
/// Requested payment amount exceeds the service monthly cap (MIST).
const E_AMOUNT_EXCEEDS_LIMIT: u64 = 2;
/// Cooldown / interval has not elapsed since last_payment_timestamp.
const E_COOLDOWN_NOT_REACHED: u64 = 3;
/// Caller is not the vault owner.
const E_NOT_VAULT_OWNER: u64 = 4;
/// Caller is not the policy issuer (user/admin).
const E_NOT_POLICY_ISSUER: u64 = 5;
/// Policy is bound to a different vault than the one provided.
const E_VAULT_POLICY_MISMATCH: u64 = 6;
/// Policy has been deactivated / revoked.
const E_POLICY_INACTIVE: u64 = 7;
/// Payment amount must be > 0.
const E_ZERO_AMOUNT: u64 = 8;
/// Vault does not hold enough SUI (MIST) for this payment.
const E_INSUFFICIENT_VAULT_BALANCE: u64 = 9;
/// Vendor rule already exists when using insert-only helpers.
const E_VENDOR_ALREADY_EXISTS: u64 = 10;
/// Vendor rule not found for remove / update.
const E_VENDOR_NOT_FOUND: u64 = 11;
const E_AGENT_ONLY: u64 = 12;
const E_POLICY_ALREADY_BOUND: u64 = 13;
const E_MONTHLY_BUDGET: u64 = 14;
const E_NOT_DUE: u64 = 15;
const E_SUBSCRIPTION_EXPIRED: u64 = 16;
const E_INVALID_SCHEDULE: u64 = 17;
/// A transfer grant has already been registered for this vault.
const E_TRANSFER_GRANT_ALREADY_BOUND: u64 = 18;
/// Transfer recipient is not in the owner-approved grant whitelist.
const E_TRANSFER_RECIPIENT_NOT_ALLOWED: u64 = 19;
/// Transfer recipient is already in the whitelist.
const E_TRANSFER_RECIPIENT_EXISTS: u64 = 20;
/// Transfer recipient is not in the whitelist for removal.
const E_TRANSFER_RECIPIENT_NOT_FOUND: u64 = 21;
/// Requested transfer is over the grant's single-payment limit.
const E_TRANSFER_PAYMENT_LIMIT: u64 = 22;
/// Requested transfer is over the grant's daily budget.
const E_TRANSFER_DAILY_BUDGET: u64 = 23;
/// Grant has expired according to the Sui Clock.
const E_TRANSFER_EXPIRED: u64 = 24;
/// Intent nonce has already been used or is out of order.
const E_TRANSFER_NONCE: u64 = 25;
/// Grant configuration is invalid.
const E_INVALID_TRANSFER_GRANT: u64 = 26;

public fun vendor_not_whitelisted(): u64 { E_VENDOR_NOT_WHITELISTED }
public fun amount_exceeds_limit(): u64 { E_AMOUNT_EXCEEDS_LIMIT }
public fun cooldown_not_reached(): u64 { E_COOLDOWN_NOT_REACHED }
public fun not_vault_owner(): u64 { E_NOT_VAULT_OWNER }
public fun not_policy_issuer(): u64 { E_NOT_POLICY_ISSUER }
public fun vault_policy_mismatch(): u64 { E_VAULT_POLICY_MISMATCH }
public fun policy_inactive(): u64 { E_POLICY_INACTIVE }
public fun zero_amount(): u64 { E_ZERO_AMOUNT }
public fun insufficient_vault_balance(): u64 { E_INSUFFICIENT_VAULT_BALANCE }
public fun vendor_already_exists(): u64 { E_VENDOR_ALREADY_EXISTS }
public fun vendor_not_found(): u64 { E_VENDOR_NOT_FOUND }
public fun agent_only(): u64 { E_AGENT_ONLY }
public fun policy_already_bound(): u64 { E_POLICY_ALREADY_BOUND }
public fun monthly_budget(): u64 { E_MONTHLY_BUDGET }
public fun not_due(): u64 { E_NOT_DUE }
public fun subscription_expired(): u64 { E_SUBSCRIPTION_EXPIRED }
public fun invalid_schedule(): u64 { E_INVALID_SCHEDULE }
public fun transfer_grant_already_bound(): u64 { E_TRANSFER_GRANT_ALREADY_BOUND }
public fun transfer_recipient_not_allowed(): u64 { E_TRANSFER_RECIPIENT_NOT_ALLOWED }
public fun transfer_recipient_exists(): u64 { E_TRANSFER_RECIPIENT_EXISTS }
public fun transfer_recipient_not_found(): u64 { E_TRANSFER_RECIPIENT_NOT_FOUND }
public fun transfer_payment_limit(): u64 { E_TRANSFER_PAYMENT_LIMIT }
public fun transfer_daily_budget(): u64 { E_TRANSFER_DAILY_BUDGET }
public fun transfer_expired(): u64 { E_TRANSFER_EXPIRED }
public fun transfer_nonce(): u64 { E_TRANSFER_NONCE }
public fun invalid_transfer_grant(): u64 { E_INVALID_TRANSFER_GRANT }
