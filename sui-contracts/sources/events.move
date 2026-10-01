/// Structured events for indexer / off-chain audit trails.
///
/// Note on rejections: a hard `abort` rolls back events in that transaction.
/// `PaymentRejected` is therefore emitted by the soft-fail path in `payment`
/// (early return, no fund movement). The strict abort path still exposes the
/// same numeric `reason_code` values via Move abort codes for the agent API.
module subscription_manager::events;

use sui::event;
use std::string::String;

/// Emitted after a successful policy-gated payment from the vault.
public struct PaymentExecuted has copy, drop {
    policy_id: ID,
    vault_id: ID,
    vendor: address,
    amount_mist: u64,
    timestamp_ms: u64,
    agent: address,
}

/// Emitted when a payment attempt is rejected by policy without aborting.
public struct PaymentRejected has copy, drop {
    policy_id: ID,
    vault_id: ID,
    vendor: address,
    amount_mist: u64,
    timestamp_ms: u64,
    /// Matches `subscription_manager::errors` constants (1, 2, 3, ...).
    reason_code: u64,
    agent: address,
}

/// Emitted when a vault is created and shared.
public struct VaultCreated has copy, drop {
    vault_id: ID,
    owner: address,
}

/// Emitted when the issuer funds the vault.
public struct VaultFunded has copy, drop {
    vault_id: ID,
    amount_mist: u64,
    new_balance_mist: u64,
}

/// Emitted when the vault owner withdraws SUI from escrow.
public struct VaultWithdrawn has copy, drop {
    vault_id: ID,
    recipient: address,
    amount_mist: u64,
    new_balance_mist: u64,
}

/// Emitted when a subscription policy is minted for an agent.
public struct PolicyCreated has copy, drop {
    policy_id: ID,
    vault_id: ID,
    issuer: address,
    agent: address,
}

/// Emitted when the issuer deactivates (revokes) a policy.
public struct PolicyRevoked has copy, drop {
    policy_id: ID,
    vault_id: ID,
    issuer: address,
}

/// Owner approval of a transfer grant is recorded when it is created.
public struct TransferGrantCreated has copy, drop {
    grant_id: ID,
    vault_id: ID,
    owner: address,
    agent: address,
    per_payment_limit: u64,
    daily_budget: u64,
    expires_at_ms: u64,
}

public struct TransferGrantRevoked has copy, drop {
    grant_id: ID,
    vault_id: ID,
    owner: address,
}

public struct TransferRecipientAdded has copy, drop {
    grant_id: ID,
    recipient: address,
    name: String,
}

public struct TransferRecipientRemoved has copy, drop {
    grant_id: ID,
    recipient: address,
}

/// Emitted only after a successful agent transfer from the vault.
public struct TransferExecuted has copy, drop {
    grant_id: ID,
    vault_id: ID,
    recipient: address,
    amount_mist: u64,
    timestamp_ms: u64,
    agent: address,
    nonce: u64,
}

public fun emit_payment_executed(
    policy_id: ID,
    vault_id: ID,
    vendor: address,
    amount_mist: u64,
    timestamp_ms: u64,
    agent: address,
) {
    event::emit(PaymentExecuted {
        policy_id,
        vault_id,
        vendor,
        amount_mist,
        timestamp_ms,
        agent,
    })
}

public fun emit_payment_rejected(
    policy_id: ID,
    vault_id: ID,
    vendor: address,
    amount_mist: u64,
    timestamp_ms: u64,
    reason_code: u64,
    agent: address,
) {
    event::emit(PaymentRejected {
        policy_id,
        vault_id,
        vendor,
        amount_mist,
        timestamp_ms,
        reason_code,
        agent,
    })
}

public fun emit_vault_created(vault_id: ID, owner: address) {
    event::emit(VaultCreated { vault_id, owner })
}

public fun emit_vault_funded(vault_id: ID, amount_mist: u64, new_balance_mist: u64) {
    event::emit(VaultFunded { vault_id, amount_mist, new_balance_mist })
}

public fun emit_vault_withdrawn(
    vault_id: ID,
    recipient: address,
    amount_mist: u64,
    new_balance_mist: u64,
) {
    event::emit(VaultWithdrawn { vault_id, recipient, amount_mist, new_balance_mist })
}

public fun emit_policy_created(
    policy_id: ID,
    vault_id: ID,
    issuer: address,
    agent: address,
) {
    event::emit(PolicyCreated { policy_id, vault_id, issuer, agent })
}

public fun emit_policy_revoked(policy_id: ID, vault_id: ID, issuer: address) {
    event::emit(PolicyRevoked { policy_id, vault_id, issuer })
}

public fun emit_transfer_grant_created(
    grant_id: ID,
    vault_id: ID,
    owner: address,
    agent: address,
    per_payment_limit: u64,
    daily_budget: u64,
    expires_at_ms: u64,
) {
    event::emit(TransferGrantCreated {
        grant_id, vault_id, owner, agent, per_payment_limit, daily_budget, expires_at_ms,
    })
}

public fun emit_transfer_grant_revoked(grant_id: ID, vault_id: ID, owner: address) {
    event::emit(TransferGrantRevoked { grant_id, vault_id, owner })
}

public fun emit_transfer_recipient_added(grant_id: ID, recipient: address, name: String) {
    event::emit(TransferRecipientAdded { grant_id, recipient, name })
}

public fun emit_transfer_recipient_removed(grant_id: ID, recipient: address) {
    event::emit(TransferRecipientRemoved { grant_id, recipient })
}

public fun emit_transfer_executed(
    grant_id: ID,
    vault_id: ID,
    recipient: address,
    amount_mist: u64,
    timestamp_ms: u64,
    agent: address,
    nonce: u64,
) {
    event::emit(TransferExecuted {
        grant_id, vault_id, recipient, amount_mist, timestamp_ms, agent, nonce,
    })
}
