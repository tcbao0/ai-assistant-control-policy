/// Automatic monthly `SubscriptionPolicy` plus per-vendor spend rules.
///
/// The scheduler pays registered services on the due day. Chat commands use
/// `transfer_grant` instead. The policy is shared; the issuer owns a capability
/// for administration.
///
/// Extensibility: vendor rules live in a `VecMap`. Future rule kinds (daily
/// limit, category cap, etc.) can be attached as dynamic fields on the policy
/// UID without reshaping this core map.
module subscription_manager::policy;

use sui::vec_map::{Self, VecMap};
use sui::clock::Clock;
use std::string::String;
use subscription_manager::errors;
use subscription_manager::events;
use subscription_manager::calendar;
use subscription_manager::vault::{Self, Vault};

/// Per-vendor constraints enforced on every payment attempt.
/// Amounts are in MIST (1 SUI = 1_000_000_000 MIST).
public struct VendorRule has store, copy, drop {
    name: String,
    /// Fixed amount used by the off-chain monthly scheduler.
    charge_amount: u64,
    monthly_budget: u64,
    spent_month: u64,
    spent_amount: u64,
    months: u64,
    start_month: u64,
    payment_day: u64,
    last_paid_month: u64,
}

/// Shared policy. Payment calls verify the recorded agent address.
public struct SubscriptionPolicy has key, store {
    id: UID,
    /// Vault this policy is allowed to spend from.
    vault_id: ID,
    /// User who minted the policy (admin).
    issuer: address,
    /// Only this address may execute payments.
    agent: address,
    /// Soft revoke switch — issuer can deactivate without destroying the object.
    active: bool,
    /// Whitelist: vendor address -> spend rule.
    vendors: VecMap<address, VendorRule>,
    monthly_budget: u64,
    spent_month: u64,
    spent_amount: u64,
}

/// Issuer-owned admin capability bound to a specific policy id.
/// Used for revoke / rule updates without relying on address checks alone.
public struct PolicyAdminCap has key, store {
    id: UID,
    policy_id: ID,
}

/// Mint one shared policy for a vault and transfer its admin cap to the owner.
#[allow(lint(self_transfer))]
public fun create_policy(
    vault: &mut Vault,
    agent: address,
    monthly_budget: u64,
    ctx: &mut TxContext,
) {
    let issuer = ctx.sender();
    assert!(vault::is_owner(vault, issuer), errors::not_vault_owner());
    assert!(monthly_budget > 0, errors::invalid_schedule());

    let id = object::new(ctx);
    let policy_id = id.to_inner();
    vault::bind_policy(vault, policy_id);
    let vault_id = vault::id(vault);

    let policy = SubscriptionPolicy {
        id,
        vault_id,
        issuer,
        agent,
        active: true,
        vendors: vec_map::empty(),
        monthly_budget,
        spent_month: 0,
        spent_amount: 0,
    };

    let admin_cap = PolicyAdminCap {
        id: object::new(ctx),
        policy_id,
    };

    events::emit_policy_created(policy_id, vault_id, issuer, agent);
    transfer::public_transfer(admin_cap, issuer);
    transfer::share_object(policy);
}

/// Whitelist a new service and set its monthly schedule in UTC.
public fun add_service(
    policy: &mut SubscriptionPolicy,
    admin_cap: &PolicyAdminCap,
    vendor: address,
    name: String,
    charge_amount: u64,
    monthly_budget: u64,
    months: u64,
    payment_day: u64,
    clock: &Clock,
    ctx: &TxContext,
) {
    assert_admin(policy, admin_cap, ctx);
    assert!(!policy.vendors.contains(&vendor), errors::vendor_already_exists());
    assert!(charge_amount > 0 && monthly_budget >= charge_amount, errors::invalid_schedule());
    assert!(months > 0 && months <= 120, errors::invalid_schedule());
    assert!(payment_day >= 1 && payment_day <= 31, errors::invalid_schedule());
    let (current_month, current_day, days_in_month) = calendar::month(clock.timestamp_ms());
    let start_month = if (current_day > payment_day || payment_day > days_in_month) {
        current_month + 1
    } else {
        current_month
    };
    policy.vendors.insert(vendor, VendorRule {
        name, charge_amount,
        monthly_budget, spent_month: 0, spent_amount: 0,
        months, start_month, payment_day, last_paid_month: 0,
    });
}

public fun set_monthly_budget(
    policy: &mut SubscriptionPolicy,
    admin_cap: &PolicyAdminCap,
    monthly_budget: u64,
    ctx: &TxContext,
) {
    assert_admin(policy, admin_cap, ctx);
    assert!(monthly_budget > 0, errors::invalid_schedule());
    policy.monthly_budget = monthly_budget;
}

public fun set_agent(
    policy: &mut SubscriptionPolicy,
    admin_cap: &PolicyAdminCap,
    agent: address,
    ctx: &TxContext,
) {
    assert_admin(policy, admin_cap, ctx);
    policy.agent = agent;
}

/// Remove a vendor from the whitelist.
public fun remove_service(
    policy: &mut SubscriptionPolicy,
    admin_cap: &PolicyAdminCap,
    vendor: address,
    ctx: &TxContext,
) {
    assert_admin(policy, admin_cap, ctx);
    assert!(policy.vendors.contains(&vendor), errors::vendor_not_found());
    let (_, _) = policy.vendors.remove(&vendor);
}

/// Soft-revoke: payments abort with E_POLICY_INACTIVE afterwards.
public fun revoke_policy(
    policy: &mut SubscriptionPolicy,
    admin_cap: &PolicyAdminCap,
    ctx: &TxContext,
) {
    assert_admin(policy, admin_cap, ctx);
    policy.active = false;
    events::emit_policy_revoked(object::id(policy), policy.vault_id, policy.issuer);
}

/// Re-enable a previously revoked policy.
public fun reactivate_policy(
    policy: &mut SubscriptionPolicy,
    admin_cap: &PolicyAdminCap,
    ctx: &TxContext,
) {
    assert_admin(policy, admin_cap, ctx);
    policy.active = true;
}

fun assert_admin(policy: &SubscriptionPolicy, admin_cap: &PolicyAdminCap, ctx: &TxContext) {
    assert!(ctx.sender() == policy.issuer, errors::not_policy_issuer());
    assert!(admin_cap.policy_id == object::id(policy), errors::not_policy_issuer());
}

/// Validate vendor whitelist, max amount, and cooldown.
/// Returns `0` on success, otherwise an `errors` reason code.
public(package) fun check_payment(
    policy: &SubscriptionPolicy,
    vault_id: ID,
    agent: address,
    vendor: address,
    amount: u64,
    now_ms: u64,
): u64 {
    if (!policy.active) {
        return errors::policy_inactive()
    };
    if (policy.vault_id != vault_id) {
        return errors::vault_policy_mismatch()
    };
    if (agent != policy.agent) {
        return errors::agent_only()
    };
    if (amount == 0) {
        return errors::zero_amount()
    };
    if (!policy.vendors.contains(&vendor)) {
        return errors::vendor_not_whitelisted()
    };

    let rule = policy.vendors.get(&vendor);
    if (amount > rule.monthly_budget) {
        return errors::amount_exceeds_limit()
    };
    let (month, day, days_in_month) = calendar::month(now_ms);
    if (month < rule.start_month) return errors::not_due();
    if (month >= rule.start_month + rule.months) return errors::subscription_expired();
    if (rule.payment_day > days_in_month || day < rule.payment_day || rule.last_paid_month == month) {
        return errors::not_due()
    };
    let service_spent = if (rule.spent_month == month) rule.spent_amount else 0;
    let policy_spent = if (policy.spent_month == month) policy.spent_amount else 0;
    if (service_spent > rule.monthly_budget || amount > rule.monthly_budget - service_spent) {
        return errors::monthly_budget()
    };
    if (policy_spent > policy.monthly_budget || amount > policy.monthly_budget - policy_spent) {
        return errors::monthly_budget()
    };

    0
}

/// Record a successful payment timestamp for the vendor (mutates rule state).
public(package) fun mark_paid(policy: &mut SubscriptionPolicy, vendor: address, amount: u64, now_ms: u64) {
    let (month, _, _) = calendar::month(now_ms);
    if (policy.spent_month != month) {
        policy.spent_month = month;
        policy.spent_amount = 0;
    };
    policy.spent_amount = policy.spent_amount + amount;
    let rule = policy.vendors.get_mut(&vendor);
    if (rule.spent_month != month) {
        rule.spent_month = month;
        rule.spent_amount = 0;
    };
    rule.spent_amount = rule.spent_amount + amount;
    rule.last_paid_month = month;
}

// --- accessors ---

public fun policy_id(policy: &SubscriptionPolicy): ID {
    object::id(policy)
}

public fun vault_id(policy: &SubscriptionPolicy): ID {
    policy.vault_id
}

public fun issuer(policy: &SubscriptionPolicy): address {
    policy.issuer
}

public fun agent(policy: &SubscriptionPolicy): address {
    policy.agent
}

public fun is_active(policy: &SubscriptionPolicy): bool {
    policy.active
}

public fun is_vendor_whitelisted(policy: &SubscriptionPolicy, vendor: address): bool {
    policy.vendors.contains(&vendor)
}

public fun vendor_rule(policy: &SubscriptionPolicy, vendor: address): VendorRule {
    *policy.vendors.get(&vendor)
}

public fun vendor_count(policy: &SubscriptionPolicy): u64 {
    policy.vendors.length()
}

public fun rule_charge_amount(rule: &VendorRule): u64 { rule.charge_amount }
public fun rule_monthly_budget(rule: &VendorRule): u64 { rule.monthly_budget }
public fun rule_payment_day(rule: &VendorRule): u64 { rule.payment_day }
public fun rule_last_paid_month(rule: &VendorRule): u64 { rule.last_paid_month }
