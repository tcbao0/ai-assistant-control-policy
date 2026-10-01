# Testnet demonstration runbook

This runbook demonstrates that AI interpretation is off chain and the spending authority is enforced by Sui Move. Use a newly published package, a fresh vault, test SUI, a test owner wallet and a separate test agent key.

## Before the demo

1. Revoke any old policy bound to a key that was exposed. Connect its owner wallet and sign `revoke_policy` with the matching `PolicyAdminCap` before moving on.
2. Publish the rebuilt `sui-contracts` package and create a new shared vault.
3. Set the new package, owner network and newly generated agent key in `web/.env`; restart Next.js.
4. Sign in as the vault owner. Fund the vault. Optionally create a subscription policy and register Spotify with recipient, fixed charge, service budget, duration and payment day for **automatic** monthly pay.
5. Create a passcode and a command grant with conservative per-payment and **daily** limits and a short expiry. Add Spotify and An by name and address; enter the passcode and sign with the owner wallet.
6. Refresh the dashboard and confirm it shows the command whitelist; no `.env` edits are needed for per-owner object IDs.

## Demo flow

1. In **Ask the agent**, enter `Thanh toán Spotify 1 SUI` or `Transfer 0.1 SUI to An`. Check recipient, amount, vault and command grant, then confirm. A successful transaction should show a digest.
2. Upload a valid bill image or paste invoice text for a command-whitelist name. A different address, merchant or over-limit amount is refused before signing.
3. Try an unknown recipient, a request above the per-payment limit, an amount above the daily remainder, an ambiguous name, or multiple actions in one message. The server should ask for clarification or refuse without signing.
4. For chain-level evidence, submit a direct Move transaction as the agent with an unlisted recipient or wrong nonce. The transaction should abort and leave vault funds and grant counters unchanged.
5. Revoke the command grant, then retry. The agent should refuse and Move should reject a direct execution.
6. Show automatic monthly pay separately: the scheduler pays a due registered service; a direct Move call before the due day aborts.

## Expected controls

- Command grant: correct agent, active grant bound to this vault, registered recipient, per-payment limit, daily budget, expiry and expected nonce.
- Subscription: correct agent, active policy, matching vault, registered service address, due date, subscription duration, service limit and total monthly budget. Chat does not execute this grant.
- Every chat or bill payment has a ten-minute proposal preview. Confirm submits the immutable proposal; retry checks or reuses the original signed transaction and never reinterprets the command.
- The passcode is checked by the web server and stored as a salted scrypt verifier in MongoDB. It is not sent to Sui. Owner wallet signature and the matching admin capability authorize on-chain grant changes. Recipient names and addresses on Sui are public.

## Automated monthly payments

The existing scheduler can run registered subscription payments daily using `SCHEDULER_SECRET`. Configure an external cron after the interactive demo. The scheduler does not run automatically in local development.
