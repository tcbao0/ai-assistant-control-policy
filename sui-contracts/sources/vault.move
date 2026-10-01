/// Shared SUI vault that holds user funds the agent may spend under policy.
module subscription_manager::vault;

use sui::balance::{Self, Balance};
use sui::coin::{Self, Coin};
use sui::sui::SUI;
use subscription_manager::errors;
use subscription_manager::events;

/// Shared object holding the user's spendable SUI balance (in MIST).
public struct Vault has key {
    id: UID,
    /// Address authorized to fund / withdraw / create policies against this vault.
    owner: address,
    /// Escrowed SUI. All agent payments are split from this balance.
    funds: Balance<SUI>,
    /// Exactly one subscription policy may be bound to this vault.
    policy_id: Option<ID>,
    /// A separately budgeted transfer grant may also be bound once.
    transfer_grant_id: Option<ID>,
}

/// Create an empty shared vault owned by the transaction sender.
public fun create_vault(ctx: &mut TxContext) {
    let owner = ctx.sender();
    let id = object::new(ctx);
    let vault_id = id.to_inner();

    let vault = Vault {
        id,
        owner,
        funds: balance::zero<SUI>(),
        policy_id: option::none(),
        transfer_grant_id: option::none(),
    };

    events::emit_vault_created(vault_id, owner);
    transfer::share_object(vault);
}

/// Deposit a `Coin<SUI>` into the vault. Anyone may fund; only owner withdraws.
public fun fund_vault(vault: &mut Vault, payment: Coin<SUI>) {
    let amount = payment.value();
    balance::join(&mut vault.funds, coin::into_balance(payment));
    events::emit_vault_funded(
        object::id(vault),
        amount,
        vault.funds.value(),
    );
}

/// Owner-only withdrawal of `amount` MIST back to the owner as a Coin.
public fun withdraw(
    vault: &mut Vault,
    amount: u64,
    ctx: &mut TxContext,
): Coin<SUI> {
    take_for_owner(vault, amount, ctx.sender(), ctx)
}

/// Owner-only convenience: withdraw and transfer the coin to `recipient`.
public fun withdraw_to(
    vault: &mut Vault,
    amount: u64,
    recipient: address,
    ctx: &mut TxContext,
) {
    let coin = take_for_owner(vault, amount, recipient, ctx);
    transfer::public_transfer(coin, recipient);
}

fun take_for_owner(
    vault: &mut Vault,
    amount: u64,
    recipient: address,
    ctx: &mut TxContext,
): Coin<SUI> {
    assert!(ctx.sender() == vault.owner, errors::not_vault_owner());
    assert!(amount > 0, errors::zero_amount());
    assert!(vault.funds.value() >= amount, errors::insufficient_vault_balance());
    let paid = balance::split(&mut vault.funds, amount);
    events::emit_vault_withdrawn(object::id(vault), recipient, amount, vault.funds.value());
    coin::from_balance(paid, ctx)
}

/// Package-visible: split `amount` MIST out of the vault for a policy payment.
public(package) fun split_for_payment(vault: &mut Vault, amount: u64): Balance<SUI> {
    assert!(vault.funds.value() >= amount, errors::insufficient_vault_balance());
    balance::split(&mut vault.funds, amount)
}

/// Package-visible accessors used by the payment / policy modules.
public(package) fun id(vault: &Vault): ID {
    object::id(vault)
}

public(package) fun bind_policy(vault: &mut Vault, policy_id: ID) {
    assert!(vault.policy_id.is_none(), errors::policy_already_bound());
    vault.policy_id.fill(policy_id);
}

public(package) fun bind_transfer_grant(vault: &mut Vault, grant_id: ID) {
    assert!(vault.transfer_grant_id.is_none(), errors::transfer_grant_already_bound());
    vault.transfer_grant_id.fill(grant_id);
}

/// Replace only the current transfer grant after its owner has revoked it.
public(package) fun replace_transfer_grant(vault: &mut Vault, old_id: ID, new_id: ID) {
    assert!(is_bound_transfer_grant(vault, old_id), errors::vault_policy_mismatch());
    *vault.transfer_grant_id.borrow_mut() = new_id;
}

public(package) fun is_bound_transfer_grant(vault: &Vault, grant_id: ID): bool {
    if (vault.transfer_grant_id.is_none()) false
    else *vault.transfer_grant_id.borrow() == grant_id
}

public(package) fun owner(vault: &Vault): address {
    vault.owner
}

public fun balance_mist(vault: &Vault): u64 {
    vault.funds.value()
}

public fun is_owner(vault: &Vault, addr: address): bool {
    vault.owner == addr
}
