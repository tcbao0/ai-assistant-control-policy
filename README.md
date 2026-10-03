# AI Assistant with Sui as a Control and Policy Plane

This demo lets an AI assistant interpret payment instructions while Sui Move enforces the spending authority that the owner approved beforehand. The assistant cannot alter a grant. Both grant types are revocable, scoped to one agent address and one shared vault, and checked again on chain for every payment.

The live UI is three pages behind the header **Sui Agent Control Plane** (*Agent proposes · Owner holds · Chain enforces*):

| Page | Route | What the owner does |
| --- | --- | --- |
| Agent | `/` | See vault / command / auto amounts, chat, paste a bill, upload a bill image, confirm a proposal |
| Assets | `/assets` | See shared-vault SUI, fund, withdraw, see remaining caps, read **Vault movements** |
| Policies | `/policies` | **Pay on command** (chat whitelist) and optional **Automatic monthly** services |

Signed-out visitors see **Start here** (connect, **Sign in with wallet**, or **Open first-time setup**). A signed-in owner with no vault is sent to `/setup`. The Vietnamese walkthrough is [`docs/USER_FLOW_VI.md`](docs/USER_FLOW_VI.md).

## What the demo proves

| Action | Owner approval | Agent action | On-chain checks |
| --- | --- | --- | --- |
| Pay on command | Owner creates a `TransferGrant` and signs each recipient name and address | Agent pays after a chat or bill proposal is confirmed | Agent, current grant binding, recipient address, per-payment limit, **daily** budget, expiry, nonce, revoke state |
| Automatic monthly subscription | Owner creates a `SubscriptionPolicy` and registers a service with charge, due day and duration | Scheduler pays the registered charge when due | Agent, service address, due month/day, duration, per-service and total monthly budgets |

The two grants share vault funds and have **independent** budgets. Chat never uses the subscription policy. The vault owner can withdraw the remaining balance from **Assets**. No grant lets the agent spend SUI directly from the owner's personal wallet.

The model classifies a chat message or a bill. The server resolves the name and amount against the command grant on chain. Ambiguous or out-of-scope requests are declined or returned for clarification. The model's judgment is not the security boundary: an incorrect proposal still must pass Move checks before funds leave the vault. For each chat or bill request, the owner reviews **Review agent proposal** and clicks **Confirm agent action**. The agent signs the resulting transaction; the owner's wallet does not sign that payment.

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

1. Create a fresh agent key locally. Set its secret only in `AGENT_PRIVATE_KEY` and its derived address in `NEXT_PUBLIC_AGENT_ADDRESS`. The owner wallet and agent wallet must be different. If a prior key was shared, do not reuse it. `SUI_NETWORK` and `NEXT_PUBLIC_SUI_NETWORK` must match. `PACKAGE_ID` and `NEXT_PUBLIC_PACKAGE_ID` are the published package. Per-owner vault, policy, and grant IDs are stored in MongoDB after the owner signs; they are not `.env` entries.
2. Open `/setup`. **Connect wallet** on that network, **Sign in with wallet**, then **Create vault on Sui**. The app stores the vault on the owner's workspace.
3. **Fund vault** (the form suggests 10 SUI; **Skip for now** is allowed). Funding later is **Add SUI to vault** → **Fund vault** on Assets. Withdrawing is **Withdraw SUI to owner wallet** on the same card. The owner signs both. The agent cannot withdraw.
4. Step 5, **Automatic monthly policy (optional)**, creates a `SubscriptionPolicy` with a total monthly budget, or **Skip for now**. The same **Create shared policy** action is on Policies if you skip it here. **Go to agent home** when the wizard finishes.
5. On **Policies → Pay on command**, create a passcode (at least 12 characters), then **Create command grant** with max per payment, **daily** budget, and a local expiry. **Verify and sign** checks the passcode, then the owner wallet signs. Add recipient **Name** and **Sui address** the same way. Names and addresses stored on Sui are public.
6. On **Policies → Automatic monthly**, register a service with name, recipient, charge, monthly cap, months, and a UTC payment day. **Run due payments now** pays this signed-in workspace when a service is due. An external cron can call `POST /api/scheduler/run` with `Authorization: Bearer <SCHEDULER_SECRET>` (`SCHEDULER_SECRET` must be at least 32 characters). The scheduler does not start by itself in local development.
7. On **Agent → Ask the agent**, use **Chat command** (`Pay Spotify 1 SUI` or `Transfer 0.1 SUI to An`; the name must be on the command whitelist) and **Check instruction**. Or use **Bill text** / **Bill image** (PNG, JPEG, or WebP, up to 8 MB) and **Read and review bill**. Review recipient, amount, and **Shared vault**, then **Confirm agent action**. The image is not kept in invoice history. Automatic subscriptions are not paid from chat.

After revoking a transfer grant, **Replace grant** creates a new grant on the same vault with an empty whitelist. The owner adds each name again. The app records the replacement IDs after the signed transaction.

`MONGODB_URI`, `MONGODB_DB`, and `GEMINI_API_KEY` configure the server. The owner wallet must hold the relevant admin caps for grant changes. The agent wallet needs gas; vault funds pay recipients, not agent gas.

## Passcode and authority

Sui object contents and transaction inputs are public. The app **never sends the passcode to Sui**. It stores a salted, memory-hard scrypt verifier in MongoDB, limits failed attempts, and checks the passcode before the UI asks the owner to sign a grant change (**Verify and sign** on Pay on command). This is a secondary confirmation step. The owner's wallet signature and admin cap are the on-chain authority; a direct owner-signed Move call is possible without the web passcode. Do not describe the passcode as an on-chain secret or as an on-chain authorization mechanism. Funding and withdrawing the vault do not ask for the passcode.

## Processing and retries

`POST /api/chat` prepares a command, and `POST /api/chat/bill` prepares invoice text or an image. Neither endpoint moves funds. `POST /api/chat/confirm` checks current grants, signs and submits a transaction after **Confirm agent action**. A ready proposal expires after ten minutes. **Recent** can **Review** a still-valid ready proposal or **Check status** while it is `signing` or `submitted`. MongoDB records proposal state and signed transaction bytes and digest before broadcasting. A retry of a submitted proposal checks the digest and reuses the same signed transaction rather than signing another payment. The Move transfer nonce rejects replay of an already executed transfer.

The daily command budget resets on the UTC day. The subscription budget resets on the UTC month. **Run due payments now** calls `POST /api/scheduler/mine` for the signed-in owner's workspace only. The cron route pays every workspace on the configured network and package that has a policy.

For a policy-plane demo, show both an allowed payment and a direct Move call that attempts to pay an unapproved address or amount. The invoice API rejects many invalid inputs **before** making an on-chain call, so an API rejection alone is not proof of a Move abort. Move unit tests cover wrong agent, unlisted recipient, overspending, revoke and replay behavior.

## Verification

```bash
pnpm run test:move
pnpm --filter web typecheck
pnpm --filter web test:unit
pnpm --filter web build
```

`pnpm --filter web test:smoke` performs offline checks. Set `SMOKE_BASE_URL` to a running local URL for HTTP authentication checks. A live end-to-end payment additionally requires fresh published package/grants, owner signatures, MongoDB, Gemini, agent gas and vault funds.
