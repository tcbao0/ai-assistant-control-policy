/// Package overview module (documentation anchor).
///
/// Modules:
/// - `errors`  — shared abort codes for the agent/UI mapper
/// - `events`  — PaymentExecuted / PaymentRejected / lifecycle events
/// - `vault`   — shared SUI escrow (`Vault`)
/// - `policy`  — automatic monthly `SubscriptionPolicy` + service rules + owner admin cap
/// - `payment` — scheduler-gated `execute_payment` / `execute_payment_or_abort`
/// - `transfer_grant` — command whitelist with per-payment and daily budgets
module subscription_manager::subscription_manager;
