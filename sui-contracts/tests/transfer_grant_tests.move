#[test_only]
module subscription_manager::transfer_grant_tests;

use std::string;
use sui::clock::{Self, Clock};
use sui::coin;
use sui::sui::SUI;
use sui::test_scenario::{Self as ts, Scenario};
use subscription_manager::policy::{Self, SubscriptionPolicy};
use subscription_manager::transfer_grant::{Self, TransferAdminCap, TransferGrant};
use subscription_manager::vault::{Self, Vault};

const OWNER: address = @0xA11CE;
const AGENT: address = @0xB0B;
const RECIPIENT: address = @0xBEE;
const OUTSIDER: address = @0xBAD;
const ONE_SUI: u64 = 1_000_000_000;
const NOW: u64 = 1_700_000_000_000;
const EXPIRES: u64 = 1_800_000_000_000;

fun clock_at(scenario: &mut Scenario, when: u64): Clock {
    let mut clock = clock::create_for_testing(ts::ctx(scenario));
    clock::set_for_testing(&mut clock, when);
    clock
}

fun setup(scenario: &mut Scenario) {
    ts::next_tx(scenario, OWNER);
    vault::create_vault(ts::ctx(scenario));
    ts::next_tx(scenario, OWNER);
    {
        let mut vault = ts::take_shared<Vault>(scenario);
        vault::fund_vault(&mut vault, coin::mint_for_testing<SUI>(10 * ONE_SUI, ts::ctx(scenario)));
        let clock = clock_at(scenario, NOW);
        transfer_grant::create_grant(
            &mut vault, AGENT, 2 * ONE_SUI, 3 * ONE_SUI, EXPIRES, &clock, ts::ctx(scenario),
        );
        clock::destroy_for_testing(clock);
        ts::return_shared(vault);
    };
    ts::next_tx(scenario, OWNER);
    {
        let mut grant = ts::take_shared<TransferGrant>(scenario);
        let cap = ts::take_from_sender<TransferAdminCap>(scenario);
        transfer_grant::add_recipient(
            &mut grant, &cap, RECIPIENT, string::utf8(b"Alice"), ts::ctx(scenario),
        );
        ts::return_shared(grant);
        ts::return_to_sender(scenario, cap);
    };
}

#[test]
fun agent_can_transfer_to_owner_approved_recipient() {
    let mut scenario = ts::begin(OWNER);
    setup(&mut scenario);
    ts::next_tx(&mut scenario, AGENT);
    {
        let mut grant = ts::take_shared<TransferGrant>(&scenario);
        let mut vault = ts::take_shared<Vault>(&scenario);
        let clock = clock_at(&mut scenario, NOW);
        transfer_grant::execute_transfer_or_abort(
            &mut grant, &mut vault, &clock, RECIPIENT, ONE_SUI, 0, ts::ctx(&mut scenario),
        );
        assert!(vault::balance_mist(&vault) == 9 * ONE_SUI, 0);
        assert!(transfer_grant::nonce(&grant) == 1, 1);
        assert!(transfer_grant::recipient_name(&grant, RECIPIENT) == string::utf8(b"Alice"), 2);
        clock::destroy_for_testing(clock);
        ts::return_shared(grant);
        ts::return_shared(vault);
    };
    ts::end(scenario);
}

#[test]
#[expected_failure(abort_code = 12, location = subscription_manager::transfer_grant)]
fun only_authorized_agent_can_transfer() {
    let mut scenario = ts::begin(OWNER);
    setup(&mut scenario);
    ts::next_tx(&mut scenario, OUTSIDER);
    let mut grant = ts::take_shared<TransferGrant>(&scenario);
    let mut vault = ts::take_shared<Vault>(&scenario);
    let clock = clock_at(&mut scenario, NOW);
    transfer_grant::execute_transfer_or_abort(
        &mut grant, &mut vault, &clock, RECIPIENT, ONE_SUI, 0, ts::ctx(&mut scenario),
    );
    clock::destroy_for_testing(clock);
    ts::return_shared(grant);
    ts::return_shared(vault);
    ts::end(scenario);
}

#[test]
#[expected_failure(abort_code = 19, location = subscription_manager::transfer_grant)]
fun unapproved_recipient_is_blocked() {
    let mut scenario = ts::begin(OWNER);
    setup(&mut scenario);
    ts::next_tx(&mut scenario, AGENT);
    let mut grant = ts::take_shared<TransferGrant>(&scenario);
    let mut vault = ts::take_shared<Vault>(&scenario);
    let clock = clock_at(&mut scenario, NOW);
    transfer_grant::execute_transfer_or_abort(
        &mut grant, &mut vault, &clock, OUTSIDER, ONE_SUI, 0, ts::ctx(&mut scenario),
    );
    clock::destroy_for_testing(clock);
    ts::return_shared(grant);
    ts::return_shared(vault);
    ts::end(scenario);
}

#[test]
#[expected_failure(abort_code = 22, location = subscription_manager::transfer_grant)]
fun per_payment_limit_is_enforced() {
    let mut scenario = ts::begin(OWNER);
    setup(&mut scenario);
    ts::next_tx(&mut scenario, AGENT);
    let mut grant = ts::take_shared<TransferGrant>(&scenario);
    let mut vault = ts::take_shared<Vault>(&scenario);
    let clock = clock_at(&mut scenario, NOW);
    transfer_grant::execute_transfer_or_abort(
        &mut grant, &mut vault, &clock, RECIPIENT, 2 * ONE_SUI + 1, 0, ts::ctx(&mut scenario),
    );
    clock::destroy_for_testing(clock);
    ts::return_shared(grant);
    ts::return_shared(vault);
    ts::end(scenario);
}

#[test]
#[expected_failure(abort_code = 23, location = subscription_manager::transfer_grant)]
fun daily_budget_counts_successful_transfers() {
    let mut scenario = ts::begin(OWNER);
    setup(&mut scenario);
    ts::next_tx(&mut scenario, AGENT);
    {
        let mut grant = ts::take_shared<TransferGrant>(&scenario);
        let mut vault = ts::take_shared<Vault>(&scenario);
        let clock = clock_at(&mut scenario, NOW);
        transfer_grant::execute_transfer_or_abort(
            &mut grant, &mut vault, &clock, RECIPIENT, 2 * ONE_SUI, 0, ts::ctx(&mut scenario),
        );
        clock::destroy_for_testing(clock);
        ts::return_shared(grant);
        ts::return_shared(vault);
    };
    ts::next_tx(&mut scenario, AGENT);
    let mut grant = ts::take_shared<TransferGrant>(&scenario);
    let mut vault = ts::take_shared<Vault>(&scenario);
    let clock = clock_at(&mut scenario, NOW);
    transfer_grant::execute_transfer_or_abort(
        &mut grant, &mut vault, &clock, RECIPIENT, 2 * ONE_SUI, 1, ts::ctx(&mut scenario),
    );
    clock::destroy_for_testing(clock);
    ts::return_shared(grant);
    ts::return_shared(vault);
    ts::end(scenario);
}

#[test]
fun daily_budget_resets_on_the_next_utc_day() {
    let mut scenario = ts::begin(OWNER);
    setup(&mut scenario);
    ts::next_tx(&mut scenario, AGENT);
    {
        let mut grant = ts::take_shared<TransferGrant>(&scenario);
        let mut vault = ts::take_shared<Vault>(&scenario);
        let clock = clock_at(&mut scenario, NOW);
        transfer_grant::execute_transfer_or_abort(
            &mut grant, &mut vault, &clock, RECIPIENT, 2 * ONE_SUI, 0, ts::ctx(&mut scenario),
        );
        clock::destroy_for_testing(clock);
        ts::return_shared(grant);
        ts::return_shared(vault);
    };
    ts::next_tx(&mut scenario, AGENT);
    {
        let mut grant = ts::take_shared<TransferGrant>(&scenario);
        let mut vault = ts::take_shared<Vault>(&scenario);
        let clock = clock_at(&mut scenario, NOW + 86_400_000);
        transfer_grant::execute_transfer_or_abort(
            &mut grant, &mut vault, &clock, RECIPIENT, 2 * ONE_SUI, 1, ts::ctx(&mut scenario),
        );
        assert!(transfer_grant::nonce(&grant) == 2, 0);
        clock::destroy_for_testing(clock);
        ts::return_shared(grant);
        ts::return_shared(vault);
    };
    ts::end(scenario);
}

#[test]
#[expected_failure(abort_code = 25, location = subscription_manager::transfer_grant)]
fun transfer_nonce_blocks_replayed_intent() {
    let mut scenario = ts::begin(OWNER);
    setup(&mut scenario);
    ts::next_tx(&mut scenario, AGENT);
    {
        let mut grant = ts::take_shared<TransferGrant>(&scenario);
        let mut vault = ts::take_shared<Vault>(&scenario);
        let clock = clock_at(&mut scenario, NOW);
        transfer_grant::execute_transfer_or_abort(
            &mut grant, &mut vault, &clock, RECIPIENT, ONE_SUI, 0, ts::ctx(&mut scenario),
        );
        clock::destroy_for_testing(clock);
        ts::return_shared(grant);
        ts::return_shared(vault);
    };
    ts::next_tx(&mut scenario, AGENT);
    let mut grant = ts::take_shared<TransferGrant>(&scenario);
    let mut vault = ts::take_shared<Vault>(&scenario);
    let clock = clock_at(&mut scenario, NOW);
    transfer_grant::execute_transfer_or_abort(
        &mut grant, &mut vault, &clock, RECIPIENT, ONE_SUI, 0, ts::ctx(&mut scenario),
    );
    clock::destroy_for_testing(clock);
    ts::return_shared(grant);
    ts::return_shared(vault);
    ts::end(scenario);
}

#[test]
#[expected_failure(abort_code = 24, location = subscription_manager::transfer_grant)]
fun expired_grant_is_blocked() {
    let mut scenario = ts::begin(OWNER);
    setup(&mut scenario);
    ts::next_tx(&mut scenario, AGENT);
    let mut grant = ts::take_shared<TransferGrant>(&scenario);
    let mut vault = ts::take_shared<Vault>(&scenario);
    let clock = clock_at(&mut scenario, EXPIRES);
    transfer_grant::execute_transfer_or_abort(
        &mut grant, &mut vault, &clock, RECIPIENT, ONE_SUI, 0, ts::ctx(&mut scenario),
    );
    clock::destroy_for_testing(clock);
    ts::return_shared(grant);
    ts::return_shared(vault);
    ts::end(scenario);
}

#[test]
#[expected_failure(abort_code = 7, location = subscription_manager::transfer_grant)]
fun owner_revoke_blocks_agent() {
    let mut scenario = ts::begin(OWNER);
    setup(&mut scenario);
    ts::next_tx(&mut scenario, OWNER);
    {
        let mut grant = ts::take_shared<TransferGrant>(&scenario);
        let cap = ts::take_from_sender<TransferAdminCap>(&scenario);
        transfer_grant::revoke_grant(&mut grant, &cap, ts::ctx(&mut scenario));
        assert!(!transfer_grant::is_active(&grant), 0);
        ts::return_shared(grant);
        ts::return_to_sender(&scenario, cap);
    };
    ts::next_tx(&mut scenario, AGENT);
    let mut grant = ts::take_shared<TransferGrant>(&scenario);
    let mut vault = ts::take_shared<Vault>(&scenario);
    let clock = clock_at(&mut scenario, NOW);
    transfer_grant::execute_transfer_or_abort(
        &mut grant, &mut vault, &clock, RECIPIENT, ONE_SUI, 0, ts::ctx(&mut scenario),
    );
    clock::destroy_for_testing(clock);
    ts::return_shared(grant);
    ts::return_shared(vault);
    ts::end(scenario);
}

#[test]
#[expected_failure(abort_code = 5, location = subscription_manager::transfer_grant)]
fun only_owner_with_admin_cap_can_change_whitelist() {
    let mut scenario = ts::begin(OWNER);
    setup(&mut scenario);
    ts::next_tx(&mut scenario, OWNER);
    let mut grant = ts::take_shared<TransferGrant>(&scenario);
    let cap = ts::take_from_sender<TransferAdminCap>(&scenario);
    ts::next_tx(&mut scenario, AGENT);
    transfer_grant::add_recipient(
        &mut grant, &cap, OUTSIDER, string::utf8(b"Eve"), ts::ctx(&mut scenario),
    );
    ts::return_shared(grant);
    ts::return_to_sender(&scenario, cap);
    ts::end(scenario);
}

#[test]
fun owner_removes_recipient_and_agent_loses_permission() {
    let mut scenario = ts::begin(OWNER);
    setup(&mut scenario);
    ts::next_tx(&mut scenario, OWNER);
    {
        let mut grant = ts::take_shared<TransferGrant>(&scenario);
        let cap = ts::take_from_sender<TransferAdminCap>(&scenario);
        transfer_grant::remove_recipient(&mut grant, &cap, RECIPIENT, ts::ctx(&mut scenario));
        assert!(!transfer_grant::is_recipient_allowed(&grant, RECIPIENT), 0);
        ts::return_shared(grant);
        ts::return_to_sender(&scenario, cap);
    };
    ts::end(scenario);
}

#[test]
#[expected_failure(abort_code = 18, location = subscription_manager::vault)]
fun only_one_transfer_grant_per_vault() {
    let mut scenario = ts::begin(OWNER);
    setup(&mut scenario);
    ts::next_tx(&mut scenario, OWNER);
    let mut vault = ts::take_shared<Vault>(&scenario);
    let clock = clock_at(&mut scenario, NOW);
    transfer_grant::create_grant(
        &mut vault, AGENT, ONE_SUI, ONE_SUI, EXPIRES, &clock, ts::ctx(&mut scenario),
    );
    clock::destroy_for_testing(clock);
    ts::return_shared(vault);
    ts::end(scenario);
}

#[test]
fun owner_can_replace_revoked_grant_without_new_vault() {
    let mut scenario = ts::begin(OWNER);
    setup(&mut scenario);
    ts::next_tx(&mut scenario, OWNER);
    {
        let mut grant = ts::take_shared<TransferGrant>(&scenario);
        let cap = ts::take_from_sender<TransferAdminCap>(&scenario);
        transfer_grant::revoke_grant(&mut grant, &cap, ts::ctx(&mut scenario));
        ts::return_shared(grant);
        ts::return_to_sender(&scenario, cap);
    };
    ts::next_tx(&mut scenario, OWNER);
    {
        let grant = ts::take_shared<TransferGrant>(&scenario);
        let old_id = transfer_grant::grant_id(&grant);
        let cap = ts::take_from_sender<TransferAdminCap>(&scenario);
        let mut vault = ts::take_shared<Vault>(&scenario);
        let clock = clock_at(&mut scenario, NOW);
        transfer_grant::replace_grant(
            &mut vault, &grant, &cap, AGENT, ONE_SUI, 2 * ONE_SUI, EXPIRES,
            &clock, ts::ctx(&mut scenario),
        );
        assert!(!vault::is_bound_transfer_grant(&vault, old_id), 0);
        assert!(vault::balance_mist(&vault) == 10 * ONE_SUI, 1);
        clock::destroy_for_testing(clock);
        ts::return_shared(grant);
        ts::return_shared(vault);
        ts::return_to_sender(&scenario, cap);
    };
    ts::end(scenario);
}

#[test]
#[expected_failure(abort_code = 20, location = subscription_manager::transfer_grant)]
fun duplicate_recipient_name_is_blocked() {
    let mut scenario = ts::begin(OWNER);
    setup(&mut scenario);
    ts::next_tx(&mut scenario, OWNER);
    let mut grant = ts::take_shared<TransferGrant>(&scenario);
    let cap = ts::take_from_sender<TransferAdminCap>(&scenario);
    transfer_grant::add_recipient(
        &mut grant, &cap, OUTSIDER, string::utf8(b"Alice"), ts::ctx(&mut scenario),
    );
    ts::return_shared(grant);
    ts::return_to_sender(&scenario, cap);
    ts::end(scenario);
}

#[test]
fun subscription_and_transfer_grant_coexist_on_one_vault() {
    let mut scenario = ts::begin(OWNER);
    setup(&mut scenario);
    ts::next_tx(&mut scenario, OWNER);
    {
        let mut vault = ts::take_shared<Vault>(&scenario);
        policy::create_policy(&mut vault, AGENT, ONE_SUI, ts::ctx(&mut scenario));
        ts::return_shared(vault);
    };
    ts::next_tx(&mut scenario, OWNER);
    {
        let policy = ts::take_shared<SubscriptionPolicy>(&scenario);
        let grant = ts::take_shared<TransferGrant>(&scenario);
        assert!(policy::vault_id(&policy) == transfer_grant::vault_id(&grant), 0);
        ts::return_shared(policy);
        ts::return_shared(grant);
    };
    ts::end(scenario);
}
