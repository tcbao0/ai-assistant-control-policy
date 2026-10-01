#[test_only]
module subscription_manager::vault_tests;

use sui::coin;
use sui::sui::SUI;
use sui::test_scenario::{Self as ts};
use subscription_manager::vault::{Self, Vault};

const OWNER: address = @0xA11CE;
const OTHER: address = @0xBAD;
const ONE_SUI: u64 = 1_000_000_000;

#[test]
fun owner_can_withdraw_to_own_wallet() {
    let mut scenario = ts::begin(OWNER);
    ts::next_tx(&mut scenario, OWNER);
    vault::create_vault(ts::ctx(&mut scenario));
    ts::next_tx(&mut scenario, OWNER);
    {
        let mut vault = ts::take_shared<Vault>(&scenario);
        vault::fund_vault(&mut vault, coin::mint_for_testing<SUI>(5 * ONE_SUI, ts::ctx(&mut scenario)));
        vault::withdraw_to(&mut vault, 2 * ONE_SUI, OWNER, ts::ctx(&mut scenario));
        assert!(vault::balance_mist(&vault) == 3 * ONE_SUI, 0);
        ts::return_shared(vault);
    };
    ts::next_tx(&mut scenario, OWNER);
    {
        let paid = ts::take_from_sender<coin::Coin<SUI>>(&scenario);
        assert!(paid.value() == 2 * ONE_SUI, 1);
        coin::burn_for_testing(paid);
    };
    ts::end(scenario);
}

#[test]
#[expected_failure(abort_code = 4, location = subscription_manager::vault)]
fun outsider_cannot_withdraw() {
    let mut scenario = ts::begin(OWNER);
    ts::next_tx(&mut scenario, OWNER);
    vault::create_vault(ts::ctx(&mut scenario));
    ts::next_tx(&mut scenario, OWNER);
    {
        let mut vault = ts::take_shared<Vault>(&scenario);
        vault::fund_vault(&mut vault, coin::mint_for_testing<SUI>(ONE_SUI, ts::ctx(&mut scenario)));
        ts::return_shared(vault);
    };
    ts::next_tx(&mut scenario, OTHER);
    {
        let mut vault = ts::take_shared<Vault>(&scenario);
        vault::withdraw_to(&mut vault, ONE_SUI, OTHER, ts::ctx(&mut scenario));
        ts::return_shared(vault);
    };
    ts::end(scenario);
}

#[test]
#[expected_failure(abort_code = 8, location = subscription_manager::vault)]
fun owner_cannot_withdraw_zero() {
    let mut scenario = ts::begin(OWNER);
    ts::next_tx(&mut scenario, OWNER);
    vault::create_vault(ts::ctx(&mut scenario));
    ts::next_tx(&mut scenario, OWNER);
    {
        let mut vault = ts::take_shared<Vault>(&scenario);
        vault::fund_vault(&mut vault, coin::mint_for_testing<SUI>(ONE_SUI, ts::ctx(&mut scenario)));
        vault::withdraw_to(&mut vault, 0, OWNER, ts::ctx(&mut scenario));
        ts::return_shared(vault);
    };
    ts::end(scenario);
}
