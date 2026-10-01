/// Policy-gated payment entrypoints.
///
/// Two modes:
/// 1. `execute_payment` — soft-fail: emits `PaymentRejected` and returns `false`
///    without moving funds (indexable rejection events).
/// 2. `execute_payment_or_abort` — hard policy plane: same checks, then `assert!`
///    with the typed abort code (what the Phase 2 agent should call).
module subscription_manager::payment;

use sui::clock::Clock;
use sui::coin;
use subscription_manager::events;
use subscription_manager::policy::{Self, SubscriptionPolicy};
use subscription_manager::vault::{Self, Vault};

/// Soft-fail payment. Returns `true` on success.
/// On policy failure: emits `PaymentRejected`, leaves vault untouched, returns `false`.
public fun execute_payment(
    policy: &mut SubscriptionPolicy,
    vault: &mut Vault,
    clock: &Clock,
    vendor: address,
    amount_mist: u64,
    ctx: &mut TxContext,
): bool {
    let agent = ctx.sender();
    let now_ms = clock.timestamp_ms();
    let vault_id = vault::id(vault);
    let policy_id = policy::policy_id(policy);

    let reason = policy::check_payment(policy, vault_id, agent, vendor, amount_mist, now_ms);
    if (reason != 0) {
        events::emit_payment_rejected(
            policy_id,
            vault_id,
            vendor,
            amount_mist,
            now_ms,
            reason,
            agent,
        );
        return false
    };

    // Split escrowed SUI and pay the vendor.
    let paid = vault::split_for_payment(vault, amount_mist);
    transfer::public_transfer(coin::from_balance(paid, ctx), vendor);

    policy::mark_paid(policy, vendor, amount_mist, now_ms);
    events::emit_payment_executed(
        policy_id,
        vault_id,
        vendor,
        amount_mist,
        now_ms,
        agent,
    );
    true
}

/// Hard-fail payment for the off-chain agent.
/// Aborts with the specific policy error code on violation (no funds moved).
public fun execute_payment_or_abort(
    policy: &mut SubscriptionPolicy,
    vault: &mut Vault,
    clock: &Clock,
    vendor: address,
    amount_mist: u64,
    ctx: &mut TxContext,
) {
    let now_ms = clock.timestamp_ms();
    let agent = ctx.sender();
    let reason = policy::check_payment(
        policy,
        vault::id(vault),
        agent,
        vendor,
        amount_mist,
        now_ms,
    );
    // Abort BEFORE mutating vault so failed attempts never move funds.
    // Rejection events are not persisted on abort (Sui rolls them back);
    // the agent maps this abort code instead (see `errors` module).
    assert!(reason == 0, reason);

    let paid = vault::split_for_payment(vault, amount_mist);
    transfer::public_transfer(coin::from_balance(paid, ctx), vendor);

    policy::mark_paid(policy, vendor, amount_mist, now_ms);
    events::emit_payment_executed(
        policy::policy_id(policy),
        vault::id(vault),
        vendor,
        amount_mist,
        now_ms,
        agent,
    );
}
