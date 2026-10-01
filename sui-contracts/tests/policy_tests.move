#[test_only]
module subscription_manager::policy_tests;

use std::string;
use sui::clock;
use sui::coin;
use sui::sui::SUI;
use sui::test_scenario::{Self as ts, Scenario};
use subscription_manager::payment;
use subscription_manager::policy::{Self, PolicyAdminCap, SubscriptionPolicy};
use subscription_manager::vault::{Self, Vault};

const OWNER: address = @0xA11CE;
const AGENT: address = @0xB0B;
const OTHER: address = @0xBAD;
const VENDOR: address = @0x51A7;
const VENDOR_B: address = @0x0E11;
const ONE_SUI: u64 = 1_000_000_000;
/// 2023-11-01 00:00 UTC — day 1 of the month.
const NOV_1: u64 = 1_698_796_800_000;
/// 2023-11-02 00:00 UTC — after payment day 1, so start_month rolls forward.
const NOV_2: u64 = 1_698_883_200_000;

fun create_owned_policy(scenario: &mut Scenario) {
    ts::next_tx(scenario, OWNER);
    vault::create_vault(ts::ctx(scenario));
    ts::next_tx(scenario, OWNER);
    {
        let mut vault = ts::take_shared<Vault>(scenario);
        vault::fund_vault(&mut vault, coin::mint_for_testing<SUI>(20 * ONE_SUI, ts::ctx(scenario)));
        policy::create_policy(&mut vault, AGENT, 10 * ONE_SUI, ts::ctx(scenario));
        ts::return_shared(vault);
    };
}

fun add_spotify(scenario: &mut Scenario, payment_day: u64, at_ms: u64) {
    ts::next_tx(scenario, OWNER);
    {
        let mut policy = ts::take_shared<SubscriptionPolicy>(scenario);
        let cap = ts::take_from_sender<PolicyAdminCap>(scenario);
        let mut clock = clock::create_for_testing(ts::ctx(scenario));
        clock::set_for_testing(&mut clock, at_ms);
        policy::add_service(
            &mut policy, &cap, VENDOR, string::utf8(b"Spotify"),
            5 * ONE_SUI, 5 * ONE_SUI, 12, payment_day, &clock, ts::ctx(scenario),
        );
        clock::destroy_for_testing(clock);
        ts::return_shared(policy);
        ts::return_to_sender(scenario, cap);
    };
}

#[test]
fun owner_creates_policy_and_registers_service() {
    let mut scenario = ts::begin(OWNER);
    create_owned_policy(&mut scenario);
    add_spotify(&mut scenario, 1, NOV_1);
    ts::next_tx(&mut scenario, OWNER);
    {
        let policy = ts::take_shared<SubscriptionPolicy>(&scenario);
        assert!(policy::is_active(&policy), 0);
        assert!(policy::issuer(&policy) == OWNER, 1);
        assert!(policy::agent(&policy) == AGENT, 2);
        assert!(policy::vendor_count(&policy) == 1, 3);
        assert!(policy::is_vendor_whitelisted(&policy, VENDOR), 4);
        let rule = policy::vendor_rule(&policy, VENDOR);
        assert!(policy::rule_charge_amount(&rule) == 5 * ONE_SUI, 5);
        assert!(policy::rule_monthly_budget(&rule) == 5 * ONE_SUI, 6);
        assert!(policy::rule_payment_day(&rule) == 1, 7);
        ts::return_shared(policy);
    };
    ts::end(scenario);
}

#[test]
#[expected_failure(abort_code = 4, location = subscription_manager::policy)]
fun outsider_cannot_create_policy() {
    let mut scenario = ts::begin(OWNER);
    ts::next_tx(&mut scenario, OWNER);
    vault::create_vault(ts::ctx(&mut scenario));
    ts::next_tx(&mut scenario, OTHER);
    {
        let mut vault = ts::take_shared<Vault>(&scenario);
        policy::create_policy(&mut vault, AGENT, 10 * ONE_SUI, ts::ctx(&mut scenario));
        ts::return_shared(vault);
    };
    ts::end(scenario);
}

#[test]
#[expected_failure(abort_code = 17, location = subscription_manager::policy)]
fun create_policy_rejects_zero_budget() {
    let mut scenario = ts::begin(OWNER);
    ts::next_tx(&mut scenario, OWNER);
    vault::create_vault(ts::ctx(&mut scenario));
    ts::next_tx(&mut scenario, OWNER);
    {
        let mut vault = ts::take_shared<Vault>(&scenario);
        policy::create_policy(&mut vault, AGENT, 0, ts::ctx(&mut scenario));
        ts::return_shared(vault);
    };
    ts::end(scenario);
}

#[test]
#[expected_failure(abort_code = 13, location = subscription_manager::vault)]
fun second_policy_on_same_vault_aborts() {
    let mut scenario = ts::begin(OWNER);
    create_owned_policy(&mut scenario);
    ts::next_tx(&mut scenario, OWNER);
    {
        let mut vault = ts::take_shared<Vault>(&scenario);
        policy::create_policy(&mut vault, AGENT, 10 * ONE_SUI, ts::ctx(&mut scenario));
        ts::return_shared(vault);
    };
    ts::end(scenario);
}

#[test]
#[expected_failure(abort_code = 10, location = subscription_manager::policy)]
fun duplicate_service_is_rejected() {
    let mut scenario = ts::begin(OWNER);
    create_owned_policy(&mut scenario);
    add_spotify(&mut scenario, 1, NOV_1);
    add_spotify(&mut scenario, 1, NOV_1);
    ts::end(scenario);
}

#[test]
#[expected_failure(abort_code = 17, location = subscription_manager::policy)]
fun add_service_rejects_charge_above_budget() {
    let mut scenario = ts::begin(OWNER);
    create_owned_policy(&mut scenario);
    ts::next_tx(&mut scenario, OWNER);
    {
        let mut policy = ts::take_shared<SubscriptionPolicy>(&scenario);
        let cap = ts::take_from_sender<PolicyAdminCap>(&scenario);
        let mut clock = clock::create_for_testing(ts::ctx(&mut scenario));
        clock::set_for_testing(&mut clock, NOV_1);
        policy::add_service(
            &mut policy, &cap, VENDOR, string::utf8(b"Spotify"),
            6 * ONE_SUI, 5 * ONE_SUI, 12, 1, &clock, ts::ctx(&mut scenario),
        );
        clock::destroy_for_testing(clock);
        ts::return_shared(policy);
        ts::return_to_sender(&scenario, cap);
    };
    ts::end(scenario);
}

#[test]
#[expected_failure(abort_code = 17, location = subscription_manager::policy)]
fun add_service_rejects_invalid_payment_day() {
    let mut scenario = ts::begin(OWNER);
    create_owned_policy(&mut scenario);
    ts::next_tx(&mut scenario, OWNER);
    {
        let mut policy = ts::take_shared<SubscriptionPolicy>(&scenario);
        let cap = ts::take_from_sender<PolicyAdminCap>(&scenario);
        let mut clock = clock::create_for_testing(ts::ctx(&mut scenario));
        clock::set_for_testing(&mut clock, NOV_1);
        policy::add_service(
            &mut policy, &cap, VENDOR, string::utf8(b"Spotify"),
            ONE_SUI, ONE_SUI, 12, 32, &clock, ts::ctx(&mut scenario),
        );
        clock::destroy_for_testing(clock);
        ts::return_shared(policy);
        ts::return_to_sender(&scenario, cap);
    };
    ts::end(scenario);
}

#[test]
#[expected_failure(abort_code = 17, location = subscription_manager::policy)]
fun add_service_rejects_zero_months() {
    let mut scenario = ts::begin(OWNER);
    create_owned_policy(&mut scenario);
    ts::next_tx(&mut scenario, OWNER);
    {
        let mut policy = ts::take_shared<SubscriptionPolicy>(&scenario);
        let cap = ts::take_from_sender<PolicyAdminCap>(&scenario);
        let mut clock = clock::create_for_testing(ts::ctx(&mut scenario));
        clock::set_for_testing(&mut clock, NOV_1);
        policy::add_service(
            &mut policy, &cap, VENDOR, string::utf8(b"Spotify"),
            ONE_SUI, ONE_SUI, 0, 1, &clock, ts::ctx(&mut scenario),
        );
        clock::destroy_for_testing(clock);
        ts::return_shared(policy);
        ts::return_to_sender(&scenario, cap);
    };
    ts::end(scenario);
}

#[test]
#[expected_failure(abort_code = 5, location = subscription_manager::policy)]
fun outsider_cannot_add_service() {
    let mut scenario = ts::begin(OWNER);
    create_owned_policy(&mut scenario);
    ts::next_tx(&mut scenario, OTHER);
    {
        let mut policy = ts::take_shared<SubscriptionPolicy>(&scenario);
        let cap = ts::take_from_address<PolicyAdminCap>(&scenario, OWNER);
        let mut clock = clock::create_for_testing(ts::ctx(&mut scenario));
        clock::set_for_testing(&mut clock, NOV_1);
        policy::add_service(
            &mut policy, &cap, VENDOR, string::utf8(b"Spotify"),
            ONE_SUI, ONE_SUI, 12, 1, &clock, ts::ctx(&mut scenario),
        );
        clock::destroy_for_testing(clock);
        ts::return_shared(policy);
        ts::return_to_address(OWNER, cap);
    };
    ts::end(scenario);
}

#[test]
#[expected_failure(abort_code = 5, location = subscription_manager::policy)]
fun admin_cap_from_other_policy_is_rejected() {
    let mut scenario = ts::begin(OWNER);
    create_owned_policy(&mut scenario);

    let policy_a_id;
    let vault_a_id;
    ts::next_tx(&mut scenario, OWNER);
    {
        let policy_a = ts::take_shared<SubscriptionPolicy>(&scenario);
        let vault_a = ts::take_shared<Vault>(&scenario);
        policy_a_id = object::id(&policy_a);
        vault_a_id = object::id(&vault_a);
        ts::return_shared(policy_a);
        ts::return_shared(vault_a);
        let cap_a = ts::take_from_sender<PolicyAdminCap>(&scenario);
        transfer::public_transfer(cap_a, OTHER);
    };

    ts::next_tx(&mut scenario, OWNER);
    vault::create_vault(ts::ctx(&mut scenario));
    ts::next_tx(&mut scenario, OWNER);
    {
        let vault_a = ts::take_shared_by_id<Vault>(&scenario, vault_a_id);
        let mut vault_b = ts::take_shared<Vault>(&scenario);
        policy::create_policy(&mut vault_b, AGENT, 10 * ONE_SUI, ts::ctx(&mut scenario));
        ts::return_shared(vault_a);
        ts::return_shared(vault_b);
    };

    ts::next_tx(&mut scenario, OWNER);
    {
        let mut policy_a = ts::take_shared_by_id<SubscriptionPolicy>(&scenario, policy_a_id);
        let cap_b = ts::take_from_sender<PolicyAdminCap>(&scenario);
        let mut clock = clock::create_for_testing(ts::ctx(&mut scenario));
        clock::set_for_testing(&mut clock, NOV_1);
        policy::add_service(
            &mut policy_a, &cap_b, VENDOR, string::utf8(b"Spotify"),
            ONE_SUI, ONE_SUI, 12, 1, &clock, ts::ctx(&mut scenario),
        );
        clock::destroy_for_testing(clock);
        ts::return_shared(policy_a);
        ts::return_to_sender(&scenario, cap_b);
    };
    ts::end(scenario);
}

#[test]
fun owner_can_remove_service_and_update_budget_and_agent() {
    let mut scenario = ts::begin(OWNER);
    create_owned_policy(&mut scenario);
    add_spotify(&mut scenario, 1, NOV_1);
    ts::next_tx(&mut scenario, OWNER);
    {
        let mut policy = ts::take_shared<SubscriptionPolicy>(&scenario);
        let cap = ts::take_from_sender<PolicyAdminCap>(&scenario);
        policy::set_monthly_budget(&mut policy, &cap, 20 * ONE_SUI, ts::ctx(&mut scenario));
        policy::set_agent(&mut policy, &cap, OTHER, ts::ctx(&mut scenario));
        policy::remove_service(&mut policy, &cap, VENDOR, ts::ctx(&mut scenario));
        assert!(policy::agent(&policy) == OTHER, 0);
        assert!(!policy::is_vendor_whitelisted(&policy, VENDOR), 1);
        assert!(policy::vendor_count(&policy) == 0, 2);
        ts::return_shared(policy);
        ts::return_to_sender(&scenario, cap);
    };
    ts::end(scenario);
}

#[test]
#[expected_failure(abort_code = 11, location = subscription_manager::policy)]
fun remove_unknown_service_aborts() {
    let mut scenario = ts::begin(OWNER);
    create_owned_policy(&mut scenario);
    ts::next_tx(&mut scenario, OWNER);
    {
        let mut policy = ts::take_shared<SubscriptionPolicy>(&scenario);
        let cap = ts::take_from_sender<PolicyAdminCap>(&scenario);
        policy::remove_service(&mut policy, &cap, VENDOR_B, ts::ctx(&mut scenario));
        ts::return_shared(policy);
        ts::return_to_sender(&scenario, cap);
    };
    ts::end(scenario);
}

#[test]
#[expected_failure(abort_code = 17, location = subscription_manager::policy)]
fun set_monthly_budget_rejects_zero() {
    let mut scenario = ts::begin(OWNER);
    create_owned_policy(&mut scenario);
    ts::next_tx(&mut scenario, OWNER);
    {
        let mut policy = ts::take_shared<SubscriptionPolicy>(&scenario);
        let cap = ts::take_from_sender<PolicyAdminCap>(&scenario);
        policy::set_monthly_budget(&mut policy, &cap, 0, ts::ctx(&mut scenario));
        ts::return_shared(policy);
        ts::return_to_sender(&scenario, cap);
    };
    ts::end(scenario);
}

#[test]
fun owner_can_revoke_and_reactivate() {
    let mut scenario = ts::begin(OWNER);
    create_owned_policy(&mut scenario);
    ts::next_tx(&mut scenario, OWNER);
    {
        let mut policy = ts::take_shared<SubscriptionPolicy>(&scenario);
        let cap = ts::take_from_sender<PolicyAdminCap>(&scenario);
        policy::revoke_policy(&mut policy, &cap, ts::ctx(&mut scenario));
        assert!(!policy::is_active(&policy), 0);
        policy::reactivate_policy(&mut policy, &cap, ts::ctx(&mut scenario));
        assert!(policy::is_active(&policy), 1);
        ts::return_shared(policy);
        ts::return_to_sender(&scenario, cap);
    };
    ts::end(scenario);
}

#[test]
#[expected_failure(abort_code = 15, location = subscription_manager::payment)]
fun service_registered_after_payment_day_is_not_due_until_next_month() {
    let mut scenario = ts::begin(OWNER);
    create_owned_policy(&mut scenario);
    add_spotify(&mut scenario, 1, NOV_2);
    ts::next_tx(&mut scenario, AGENT);
    {
        let mut policy = ts::take_shared<SubscriptionPolicy>(&scenario);
        let mut vault = ts::take_shared<Vault>(&scenario);
        let mut clock = clock::create_for_testing(ts::ctx(&mut scenario));
        clock::set_for_testing(&mut clock, NOV_2);
        payment::execute_payment_or_abort(
            &mut policy, &mut vault, &clock, VENDOR, 5 * ONE_SUI, ts::ctx(&mut scenario),
        );
        clock::destroy_for_testing(clock);
        ts::return_shared(policy);
        ts::return_shared(vault);
    };
    ts::end(scenario);
}
