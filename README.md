# AI Assistant with Sui as a Control and Policy Plane

This demo lets an AI assistant interpret payment instructions while Sui Move enforces the spending authority that the owner approved beforehand. The assistant cannot alter a grant. Both grant types are revocable, scoped to one agent address and one shared vault, and checked again on chain for every payment.

## What the demo proves

| Action | Owner approval | Agent action | On-chain checks |
| --- | --- | --- | --- |
| Pay on command | Owner creates a `TransferGrant` and signs each recipient name and address | Agent pays after a chat or bill proposal is confirmed | Agent, current grant binding, recipient address, per-payment limit, **daily** budget, expiry, nonce, revoke state |
| Automatic monthly subscription | Owner creates a `SubscriptionPolicy` and registers a service with charge, due day and duration | Scheduler pays the registered charge when due | Agent, service address, due month/day, duration, per-service and total monthly budgets |

The two grants share vault funds and have **independent** budgets. Chat never uses the subscription policy. The vault owner can withdraw the remaining balance. No grant lets the agent spend SUI directly from the owner's personal wallet.

The model classifies a chat message and the server resolves its name and amount against the command grant on chain. Ambiguous or out-of-scope requests are declined or returned for clarification. The model's judgment is not the security boundary: an incorrect proposal still must pass Move checks before funds leave the vault. For each chat request, the owner reviews the structured proposal and clicks **Confirm agent action**. The agent signs the resulting transaction; the owner's wallet does not sign that payment.

## Local setup

Requires Node.js 20.19+, pnpm, Sui CLI, MongoDB, and a Gemini API key.

```bash
pnpm install
pnpm run test:move
pnpm --filter web typecheck
pnpm --filter web test:unit
```

Copy `web/.env.example` to `web/.env` and fill the values there. `web/.env` is ignored by Git. Run `pnpm dev` after configuring MongoDB and Gemini. Use testnet SUI for owner and agent gas, and fund the vault only with test SUI during the demo.

**This rebuild changes the `TransferGrant` layout** (daily budget instead of monthly). Publish the rebuilt Move package as a new package and create a **new vault** at `/setup`. Existing deployed grant objects cannot be reused.

Before funding or using the new deployment, revoke any old policy whose agent key was exposed. The old policy is a separate deployment and stays active until its owner signs `revoke_policy` with the matching `PolicyAdminCap`. Do not fund or use that deployment. Its temporary IDs are preserved as `NEXT_PUBLIC_LEGACY_*` settings in `web/.env` so the owner can revoke it from the dashboard.

1. Create a fresh agent key locally. Set its secret only in `AGENT_PRIVATE_KEY` and its derived address in `NEXT_PUBLIC_AGENT_ADDRESS`. The owner wallet and agent wallet must be different. If a prior key was shared, do not reuse it.
2. Connect the owner wallet and sign in. Fund the vault. Optionally create the automatic monthly subscription policy. After the wallet confirms, the app stores the policy and admin cap in the owner's MongoDB workspace.
3. For chat payments, create a passcode, then sign a command grant with per-payment limit, **daily** budget and expiry. Add recipient names and addresses; the app checks the passcode before the wallet signs. `TransferAdminCap` authorizes the on-chain change. Names and addresses stored on Sui are public.
4. For automatic monthly pay, register services with recipient, charge, service budget, duration and UTC payment day. The scheduler uses this whitelist only.
5. In **Ask the agent**, enter `Thanh toán Spotify 1 SUI` or `Transfer 0.1 SUI to An` (the name must be on the command whitelist). Review recipient, amount, vault and grant, then confirm. Automatic subscriptions are not paid from chat.

After revoking a transfer grant, the owner can replace it with a new grant from the same vault. The app records the replacement IDs after verifying the signed transaction.

`SUI_NETWORK` and `NEXT_PUBLIC_SUI_NETWORK` must match. `MONGODB_URI`, `MONGODB_DB`, `GEMINI_API_KEY` and `SCHEDULER_SECRET` configure the server. The owner wallet must hold the relevant admin caps for grant changes. The agent wallet needs gas; vault funds pay recipients, not agent gas.

## Passcode and authority

Sui object contents and transaction inputs are public. The app **never sends the passcode to Sui**. It stores a salted, memory-hard scrypt verifier in MongoDB, limits failed attempts, and checks the passcode before the UI asks the owner to sign a grant change. This is a secondary confirmation step. The owner's wallet signature and admin cap are the on-chain authority; a direct owner-signed Move call is possible without the web passcode. Do not describe the passcode as an on-chain secret or as an on-chain authorization mechanism.

## Processing and retries

`POST /api/chat` prepares a command, and `POST /api/chat/bill` prepares invoice text or an image. Neither endpoint moves funds. `POST /api/chat/confirm` checks current grants, signs and submits a transaction after confirmation. MongoDB records proposal state and signed transaction bytes and digest before broadcasting. A retry of a submitted proposal checks the digest and reuses the same signed transaction rather than signing another payment. The Move transfer nonce rejects replay of an already executed transfer.

The chat accepts a text invoice or PNG/JPEG/WebP bill image up to 8 MB. Gemini extracts merchant, amount and address; the server checks the **command** whitelist and shows a review before signing, and Move checks the command grant again. The image itself is not retained in invoice history. The daily scheduler endpoint can pay due registered subscriptions automatically when called by an external cron with `SCHEDULER_SECRET`; it does not run by itself.

For a policy-plane demo, show both an allowed payment and a direct Move call that attempts to pay an unapproved address or amount. The invoice API rejects many invalid inputs **before** making an on-chain call, so an API rejection alone is not proof of a Move abort. Move unit tests cover wrong agent, unlisted recipient, overspending, revoke and replay behavior.

## Verification

```bash
pnpm run test:move
pnpm --filter web typecheck
pnpm --filter web test:unit
pnpm --filter web build
```

`pnpm --filter web test:smoke` performs offline checks. Set `SMOKE_BASE_URL` to a running local URL for HTTP authentication checks. A live end-to-end payment additionally requires fresh published package/grants, owner signatures, MongoDB, Gemini, agent gas and vault funds.
