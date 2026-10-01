/// An owner-approved, revocable capability for an agent to transfer SUI.
///
/// The shared grant holds public restrictions only. The owner's private
/// passcode must never be submitted to a Sui transaction or stored here.
module subscription_manager::transfer_grant;

use std::string::{Self, String};
use sui::clock::Clock;
use sui::coin;
use sui::vec_map::{Self, VecMap};
use subscription_manager::calendar;
use subscription_manager::errors;
use subscription_manager::events;
use subscription_manager::vault::{Self, Vault};

/// One current command grant is bound to a vault. A revoked grant may be
/// replaced by the owner. Auto-subscription and command budgets are independent;
/// both spend from the visible vault balance.
public struct TransferGrant has key, store {
    id: UID,
    vault_id: ID,
    owner: address,
    agent: address,
    active: bool,
    /// Owner-signed aliases and recipient addresses. Names are public on chain.
    recipients: VecMap<address, String>,
    per_payment_limit: u64,
    daily_budget: u64,
    spent_day: u64,
    spent_amount: u64,
    expires_at_ms: u64,
    /// Each successful transfer consumes the current nonce, preventing replay.
    nonce: u64,
}

/// This capability is held by the vault owner and required for grant changes.
public struct TransferAdminCap has key, store {
    id: UID,
    grant_id: ID,
}

/// The owner signs once to authorize an agent under fixed limits and expiry.
#[allow(lint(self_transfer))]
public fun create_grant(
    vault: &mut Vault,
    agent: address,
    per_payment_limit: u64,
    daily_budget: u64,
    expires_at_ms: u64,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let owner = ctx.sender();
    assert!(vault::is_owner(vault, owner), errors::not_vault_owner());
    assert_config(agent, per_payment_limit, daily_budget, expires_at_ms, clock);

    publish_grant(vault, option::none(), owner, agent, per_payment_limit, daily_budget, expires_at_ms, ctx);
}

/// Replace a revoked grant without forcing the owner to move funds to a new vault.
/// The old grant remains inactive and is no longer bound to the vault.
public fun replace_grant(
    vault: &mut Vault,
    previous_grant: &TransferGrant,
    previous_admin_cap: &TransferAdminCap,
    agent: address,
    per_payment_limit: u64,
    daily_budget: u64,
    expires_at_ms: u64,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert_admin(previous_grant, previous_admin_cap, ctx);
    assert!(vault::is_owner(vault, ctx.sender()), errors::not_vault_owner());
    assert!(!previous_grant.active, errors::transfer_grant_already_bound());
    assert_config(agent, per_payment_limit, daily_budget, expires_at_ms, clock);

    publish_grant(
        vault, option::some(object::id(previous_grant)), ctx.sender(), agent,
        per_payment_limit, daily_budget, expires_at_ms, ctx,
    );
}

fun assert_config(
    agent: address,
    per_payment_limit: u64,
    daily_budget: u64,
    expires_at_ms: u64,
    clock: &Clock,
) {
    assert!(agent != @0x0 && per_payment_limit > 0 && daily_budget >= per_payment_limit,
        errors::invalid_transfer_grant());
    assert!(expires_at_ms > clock.timestamp_ms(), errors::invalid_transfer_grant());
}

fun publish_grant(
    vault: &mut Vault,
    replacing: Option<ID>,
    owner: address,
    agent: address,
    per_payment_limit: u64,
    daily_budget: u64,
    expires_at_ms: u64,
    ctx: &mut TxContext,
) {
    let id = object::new(ctx);
    let grant_id = id.to_inner();
    let vault_id = vault::id(vault);
    if (replacing.is_some()) {
        vault::replace_transfer_grant(vault, *replacing.borrow(), grant_id);
    } else {
        vault::bind_transfer_grant(vault, grant_id);
    };
    let grant = TransferGrant {
        id,
        vault_id,
        owner,
        agent,
        active: true,
        recipients: vec_map::empty(),
        per_payment_limit,
        daily_budget,
        spent_day: 0,
        spent_amount: 0,
        expires_at_ms,
        nonce: 0,
    };
    let admin_cap = TransferAdminCap { id: object::new(ctx), grant_id };
    events::emit_transfer_grant_created(
        grant_id, vault_id, owner, agent, per_payment_limit, daily_budget, expires_at_ms,
    );
    transfer::public_transfer(admin_cap, owner);
    transfer::share_object(grant);
}

/// The owner signs both the recipient address and its display name.
public fun add_recipient(
    grant: &mut TransferGrant,
    admin_cap: &TransferAdminCap,
    recipient: address,
    name: String,
    ctx: &TxContext,
) {
    assert_admin(grant, admin_cap, ctx);
    assert!(recipient != @0x0, errors::invalid_transfer_grant());
    assert!(!string::is_empty(&name) && string::length(&name) <= 256,
        errors::invalid_transfer_grant());
    assert!(!grant.recipients.contains(&recipient), errors::transfer_recipient_exists());
    let mut idx = 0;
    while (idx < grant.recipients.length()) {
        let (_, registered_name) = grant.recipients.get_entry_by_idx(idx);
        assert!(registered_name != &name, errors::transfer_recipient_exists());
        idx = idx + 1;
    };
    events::emit_transfer_recipient_added(object::id(grant), recipient, name);
    grant.recipients.insert(recipient, name);
}

public fun remove_recipient(
    grant: &mut TransferGrant,
    admin_cap: &TransferAdminCap,
    recipient: address,
    ctx: &TxContext,
) {
    assert_admin(grant, admin_cap, ctx);
    assert!(grant.recipients.contains(&recipient), errors::transfer_recipient_not_found());
    let (_, _) = grant.recipients.remove(&recipient);
    events::emit_transfer_recipient_removed(object::id(grant), recipient);
}

public fun set_limits(
    grant: &mut TransferGrant,
    admin_cap: &TransferAdminCap,
    per_payment_limit: u64,
    daily_budget: u64,
    ctx: &TxContext,
) {
    assert_admin(grant, admin_cap, ctx);
    assert!(per_payment_limit > 0 && daily_budget >= per_payment_limit,
        errors::invalid_transfer_grant());
    grant.per_payment_limit = per_payment_limit;
    grant.daily_budget = daily_budget;
}

public fun set_agent(
    grant: &mut TransferGrant,
    admin_cap: &TransferAdminCap,
    agent: address,
    ctx: &TxContext,
) {
    assert_admin(grant, admin_cap, ctx);
    assert!(agent != @0x0, errors::invalid_transfer_grant());
    grant.agent = agent;
}

public fun set_expiry(
    grant: &mut TransferGrant,
    admin_cap: &TransferAdminCap,
    expires_at_ms: u64,
    clock: &Clock,
    ctx: &TxContext,
) {
    assert_admin(grant, admin_cap, ctx);
    assert!(expires_at_ms > clock.timestamp_ms(), errors::invalid_transfer_grant());
    grant.expires_at_ms = expires_at_ms;
}

/// Revocation is final for this grant. The owner can still withdraw vault funds.
public fun revoke_grant(
    grant: &mut TransferGrant,
    admin_cap: &TransferAdminCap,
    ctx: &TxContext,
) {
    assert_admin(grant, admin_cap, ctx);
    grant.active = false;
    events::emit_transfer_grant_revoked(object::id(grant), grant.vault_id, grant.owner);
}

fun assert_admin(grant: &TransferGrant, admin_cap: &TransferAdminCap, ctx: &TxContext) {
    assert!(ctx.sender() == grant.owner, errors::not_policy_issuer());
    assert!(admin_cap.grant_id == object::id(grant), errors::not_policy_issuer());
}

/// The agent can transfer only when the owner-signed on-chain grant permits it.
/// A failed assertion rolls back the entire transaction, including vault funds.
public fun execute_transfer_or_abort(
    grant: &mut TransferGrant,
    vault: &mut Vault,
    clock: &Clock,
    recipient: address,
    amount_mist: u64,
    expected_nonce: u64,
    ctx: &mut TxContext,
) {
    assert!(grant.active, errors::policy_inactive());
    assert!(grant.vault_id == vault::id(vault), errors::vault_policy_mismatch());
    assert!(vault::is_bound_transfer_grant(vault, object::id(grant)), errors::vault_policy_mismatch());
    assert!(ctx.sender() == grant.agent, errors::agent_only());
    assert!(clock.timestamp_ms() < grant.expires_at_ms, errors::transfer_expired());
    assert!(grant.nonce == expected_nonce, errors::transfer_nonce());
    assert!(grant.recipients.contains(&recipient), errors::transfer_recipient_not_allowed());
    assert!(amount_mist > 0, errors::zero_amount());
    assert!(amount_mist <= grant.per_payment_limit, errors::transfer_payment_limit());

    let day = calendar::day(clock.timestamp_ms());
    let spent = if (grant.spent_day == day) grant.spent_amount else 0;
    assert!(spent <= grant.daily_budget && amount_mist <= grant.daily_budget - spent,
        errors::transfer_daily_budget());

    // All authorization checks run before splitting escrowed SUI.
    let paid = vault::split_for_payment(vault, amount_mist);
    grant.spent_day = day;
    grant.spent_amount = spent + amount_mist;
    grant.nonce = grant.nonce + 1;
    transfer::public_transfer(coin::from_balance(paid, ctx), recipient);
    events::emit_transfer_executed(
        object::id(grant), vault::id(vault), recipient, amount_mist,
        clock.timestamp_ms(), ctx.sender(), expected_nonce,
    );
}

public fun grant_id(grant: &TransferGrant): ID { object::id(grant) }
public fun vault_id(grant: &TransferGrant): ID { grant.vault_id }
public fun owner(grant: &TransferGrant): address { grant.owner }
public fun agent(grant: &TransferGrant): address { grant.agent }
public fun is_active(grant: &TransferGrant): bool { grant.active }
public fun is_recipient_allowed(grant: &TransferGrant, recipient: address): bool {
    grant.recipients.contains(&recipient)
}
public fun recipient_name(grant: &TransferGrant, recipient: address): String {
    *grant.recipients.get(&recipient)
}
public fun recipient_count(grant: &TransferGrant): u64 { grant.recipients.length() }
public fun nonce(grant: &TransferGrant): u64 { grant.nonce }
public fun per_payment_limit(grant: &TransferGrant): u64 { grant.per_payment_limit }
public fun daily_budget(grant: &TransferGrant): u64 { grant.daily_budget }
public fun expires_at_ms(grant: &TransferGrant): u64 { grant.expires_at_ms }
