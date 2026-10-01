#[test_only]
module subscription_manager::payment_tests;

use std::string;
use sui::clock;
use sui::coin;
use sui::sui::SUI;
use sui::test_scenario::{Self as ts, Scenario};
use subscription_manager::payment;
use subscription_manager::policy::{Self, SubscriptionPolicy, PolicyAdminCap};
use subscription_manager::vault::{Self, Vault};

const OWNER: address = @0xA11CE;
const AGENT: address = @0xB0B;
const VENDOR: address = @0x51A7;
const OTHER: address = @0xBAD;
const ONE_SUI: u64 = 1_000_000_000;
const NOW: u64 = 1_700_000_000_000;
const REGISTER: u64 = 1_698_796_800_000;

fun setup(scenario: &mut Scenario) {
    ts::next_tx(scenario, OWNER);
    vault::create_vault(ts::ctx(scenario));
    ts::next_tx(scenario, OWNER);
    {
        let mut vault = ts::take_shared<Vault>(scenario);
        vault::fund_vault(&mut vault, coin::mint_for_testing<SUI>(100 * ONE_SUI, ts::ctx(scenario)));
        policy::create_policy(&mut vault, AGENT, 10 * ONE_SUI, ts::ctx(scenario));
        ts::return_shared(vault);
    };
    ts::next_tx(scenario, OWNER);
    {
        let mut policy = ts::take_shared<SubscriptionPolicy>(scenario);
        let cap = ts::take_from_sender<PolicyAdminCap>(scenario);
        let mut clock = clock::create_for_testing(ts::ctx(scenario));
        clock::set_for_testing(&mut clock, REGISTER);
        policy::add_service(&mut policy, &cap, VENDOR, string::utf8(b"Spotify"), 5 * ONE_SUI,
            5 * ONE_SUI, 12, 1, &clock, ts::ctx(scenario));
        clock::destroy_for_testing(clock);
        ts::return_shared(policy);
        ts::return_to_sender(scenario, cap);
    };
}

#[test]
fun agent_can_pay_once_in_month() {
    let mut scenario = ts::begin(OWNER);
    setup(&mut scenario);
    ts::next_tx(&mut scenario, AGENT);
    {
        let mut policy = ts::take_shared<SubscriptionPolicy>(&scenario);
        let mut vault = ts::take_shared<Vault>(&scenario);
        let mut clock = clock::create_for_testing(ts::ctx(&mut scenario));
        clock::set_for_testing(&mut clock, NOW);
        payment::execute_payment_or_abort(&mut policy, &mut vault, &clock, VENDOR,
            5 * ONE_SUI, ts::ctx(&mut scenario));
        assert!(vault::balance_mist(&vault) == 95 * ONE_SUI, 0);
        clock::destroy_for_testing(clock);
        ts::return_shared(policy);
        ts::return_shared(vault);
    };
    ts::end(scenario);
}

#[test]
fun second_payment_in_month_is_rejected() {
    let mut scenario = ts::begin(OWNER);
    setup(&mut scenario);
    ts::next_tx(&mut scenario, AGENT);
    {
        let mut policy = ts::take_shared<SubscriptionPolicy>(&scenario);
        let mut vault = ts::take_shared<Vault>(&scenario);
        let mut clock = clock::create_for_testing(ts::ctx(&mut scenario));
        clock::set_for_testing(&mut clock, NOW);
        payment::execute_payment_or_abort(&mut policy, &mut vault, &clock, VENDOR,
            ONE_SUI, ts::ctx(&mut scenario));
        assert!(!payment::execute_payment(&mut policy, &mut vault, &clock, VENDOR,
            ONE_SUI, ts::ctx(&mut scenario)), 0);
        assert!(vault::balance_mist(&vault) == 99 * ONE_SUI, 1);
        clock::destroy_for_testing(clock);
        ts::return_shared(policy);
        ts::return_shared(vault);
    };
    ts::end(scenario);
}

#[test]
fun unlisted_recipient_cannot_receive_vault_funds() {
    let mut scenario = ts::begin(OWNER);
    setup(&mut scenario);
    ts::next_tx(&mut scenario, AGENT);
    {
        let mut policy = ts::take_shared<SubscriptionPolicy>(&scenario);
        let mut vault = ts::take_shared<Vault>(&scenario);
        let mut clock = clock::create_for_testing(ts::ctx(&mut scenario));
        clock::set_for_testing(&mut clock, NOW);
        assert!(!payment::execute_payment(&mut policy, &mut vault, &clock, OTHER,
            ONE_SUI, ts::ctx(&mut scenario)), 0);
        assert!(vault::balance_mist(&vault) == 100 * ONE_SUI, 1);
        clock::destroy_for_testing(clock);
        ts::return_shared(policy);
        ts::return_shared(vault);
    };
    ts::end(scenario);
}

#[test]
#[expected_failure(abort_code = 12, location = subscription_manager::payment)]
fun other_caller_cannot_pay() {
    let mut scenario = ts::begin(OWNER);
    setup(&mut scenario);
    ts::next_tx(&mut scenario, OTHER);
    let mut policy = ts::take_shared<SubscriptionPolicy>(&scenario);
    let mut vault = ts::take_shared<Vault>(&scenario);
    let mut clock = clock::create_for_testing(ts::ctx(&mut scenario));
    clock::set_for_testing(&mut clock, NOW);
    payment::execute_payment_or_abort(&mut policy, &mut vault, &clock, VENDOR,
        ONE_SUI, ts::ctx(&mut scenario));
    clock::destroy_for_testing(clock);
    ts::return_shared(policy);
    ts::return_shared(vault);
    ts::end(scenario);
}

#[test]
#[expected_failure(abort_code = 14, location = subscription_manager::payment)]
fun monthly_budget_blocks_large_payment() {
    let mut scenario = ts::begin(OWNER);
    setup(&mut scenario);
    ts::next_tx(&mut scenario, OWNER);
    {
        let mut policy = ts::take_shared<SubscriptionPolicy>(&scenario);
        let cap = ts::take_from_sender<PolicyAdminCap>(&scenario);
        policy::set_monthly_budget(&mut policy, &cap, 4 * ONE_SUI, ts::ctx(&mut scenario));
        ts::return_shared(policy);
        ts::return_to_sender(&scenario, cap);
    };
    ts::next_tx(&mut scenario, AGENT);
    let mut policy = ts::take_shared<SubscriptionPolicy>(&scenario);
    let mut vault = ts::take_shared<Vault>(&scenario);
    let mut clock = clock::create_for_testing(ts::ctx(&mut scenario));
    clock::set_for_testing(&mut clock, NOW);
    payment::execute_payment_or_abort(&mut policy, &mut vault, &clock, VENDOR,
        5 * ONE_SUI, ts::ctx(&mut scenario));
    clock::destroy_for_testing(clock);
    ts::return_shared(policy);
    ts::return_shared(vault);
    ts::end(scenario);
}

#[test]
fun owner_can_revoke_without_agent() {
    let mut scenario = ts::begin(OWNER);
    setup(&mut scenario);
    ts::next_tx(&mut scenario, OWNER);
    {
        let mut policy = ts::take_shared<SubscriptionPolicy>(&scenario);
        let cap = ts::take_from_sender<PolicyAdminCap>(&scenario);
        policy::revoke_policy(&mut policy, &cap, ts::ctx(&mut scenario));
        assert!(!policy::is_active(&policy), 0);
        ts::return_shared(policy);
        ts::return_to_sender(&scenario, cap);
    };
    ts::end(scenario);
}

#[test]
#[expected_failure(abort_code = 13, location = subscription_manager::vault)]
fun second_policy_for_vault_is_blocked() {
    let mut scenario = ts::begin(OWNER);
    setup(&mut scenario);
    ts::next_tx(&mut scenario, OWNER);
    let mut vault = ts::take_shared<Vault>(&scenario);
    policy::create_policy(&mut vault, AGENT, 10 * ONE_SUI, ts::ctx(&mut scenario));
    ts::return_shared(vault);
    ts::end(scenario);
}

#[test]
#[expected_failure(abort_code = 15, location = subscription_manager::payment)]
fun payment_day_must_exist_in_current_month() {
    let mut scenario = ts::begin(OWNER);
    setup(&mut scenario);
    ts::next_tx(&mut scenario, OWNER);
    {
        let mut policy = ts::take_shared<SubscriptionPolicy>(&scenario);
        let cap = ts::take_from_sender<PolicyAdminCap>(&scenario);
        policy::remove_service(&mut policy, &cap, VENDOR, ts::ctx(&mut scenario));
        let mut clock = clock::create_for_testing(ts::ctx(&mut scenario));
        clock::set_for_testing(&mut clock, REGISTER);
        policy::add_service(&mut policy, &cap, VENDOR, string::utf8(b"Spotify"), 5 * ONE_SUI,
            5 * ONE_SUI, 12, 31, &clock, ts::ctx(&mut scenario));
        clock::destroy_for_testing(clock);
        ts::return_shared(policy);
        ts::return_to_sender(&scenario, cap);
    };
    ts::next_tx(&mut scenario, AGENT);
    let mut policy = ts::take_shared<SubscriptionPolicy>(&scenario);
    let mut vault = ts::take_shared<Vault>(&scenario);
    let mut clock = clock::create_for_testing(ts::ctx(&mut scenario));
    clock::set_for_testing(&mut clock, NOW);
    payment::execute_payment_or_abort(&mut policy, &mut vault, &clock, VENDOR,
        ONE_SUI, ts::ctx(&mut scenario));
    clock::destroy_for_testing(clock);
    ts::return_shared(policy);
    ts::return_shared(vault);
    ts::end(scenario);
}
