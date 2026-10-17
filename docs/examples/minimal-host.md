# Minimal host integration

**Integration sketch, not a runnable quickstart.** The package exports are still
placeholders. This example makes the host wiring reviewable before implementation;
D142/J11.S1 require a runnable separate consumer and an independent setup run before
we claim that onboarding works. Config field names, handler mounting and transport
bindings below are illustrative. The public method names are D44/D140.

The example app has one authenticated account, one balance measured in USDC base
units and one deposits page. It needs no checkout, withdrawal API or dashboard.
Scope and money policy remain in [decisions](../decisions.md); acceptance rules are
in [J1, J5, J8 and J11](../journeys/settle-kit.md).

## Files the consumer needs

| File | Host responsibility | Contract |
|---|---|---|
| `server.ts` | Validate environment; apply SDK and app migrations; create one engine; start background work once; mount routes | D30, D44; J1 |
| `auth.ts` | Derive account from the server session; check ownership of payment IDs; isolate operator access | D26, D140; J1.S5 |
| `deposit-page.tsx` | Mount the widget for the authenticated account; configure its local transport and CSS variables | D41–D42; J9 |
| `webhook.ts` | Verify signed events and update the host balance atomically | D124; J5 |
| `.env.example` | Local simulated setup first; live-only settings clearly separate | D44, D128; J1.S2 |

## Server wiring

The following is pseudocode: `host.*` functions belong to the example app, not the
SDK. They must become real, small implementations in the consumer, not undocumented
integration requirements.

```ts
const config = host.readValidatedSettleConfig();
await host.applyShippedSettleMigrations(config.database);
await host.applyAppMigrations(config.database);
const settle = createSettle(config);
await settle.start(); // once per long-running process, not per HTTP request

// Map the host session to the requested account and enforce ownership of IDs.
// Reject unknown routes and isolate operator methods before delegating.
host.mount("/api/settle", host.authorizeSettleRoutes(settle.handlers));

// Accept the original raw body; the SDK verifies it before invoking this handler.
host.mount("/webhooks/settle", settle.webhook(async (event) => {
  if (event.type === "deposit.needs_attention") {
    await host.recordAttention(event); // no balance mutation
    return;
  }
  await host.creditOnceInTransaction(event);
}));
```

The authenticated routes derive `accountId` from the host session for
`depositAddress`, `listDeposits` and `preparePayment`. For `getPayment` and
`submitPayment`, they resolve the payment's stored owner before invoking the action.
Never authorize a payment ID merely because the browser supplied it. Only the host's
operator authorization can reach `listAlerts`, `resendWebhook` and `reconcile`.
Protect session-authenticated mutation routes against cross-origin requests.

`listDeposits` supplies the page's history after reload, including accepted wallet
attempts without a chain transaction. The page can then use those IDs with
`getPayment`. Browser storage is a convenience, not the only recovery mechanism.

## The host's atomic credit

This is the transaction behind `host.creditOnceInTransaction` (D124/J5.S2).
Field mapping comes from the final event schema; values are parameters, never SQL
string interpolation. Reject malformed amounts before opening the transaction.

```sql
BEGIN;
-- credit_events.event_id is a primary key; balance.account_id is unique.
INSERT INTO credit_events (event_id, account_id, amount_usdc_base_units)
VALUES ($1, $2, $3::numeric)
ON CONFLICT (event_id) DO NOTHING
RETURNING event_id;

-- Execute this only if INSERT returned a new row.
UPDATE balances
SET amount_usdc_base_units = amount_usdc_base_units + $3::numeric
WHERE account_id = $2;
-- Require exactly one affected account; otherwise throw and ROLLBACK.
COMMIT;
```

The receiver awaits that commit before responding successfully. A duplicate event
returns success without another balance update. Any error rolls back both writes
and produces a failed delivery attempt. No credit is derived from provider status.

## Two startup paths

For simulated mode, the consumer requires local Postgres and a local webhook URL
and secret. It uses isolated fixture destinations, no real wallet signature and no
chain credentials. The reference run exercises both entry methods, pre-transfer
reload and duplicate delivery. A simulated receipt is labeled simulated throughout.

Live mode adds the D26/D27/D128/D135/D136/D141 settings: fixed destinations, gas operator,
chain RPCs, namespace, quote policy and explicit finite submission/spend limits.
Solana adds the cluster/genesis/program manifest, explicit sweep fee, stored refund/fee
owners and finite host SOL/priority-fee/rent limits. D143 returns owner/ATA instructions
and chain-specific signing messages through the same methods. No Solana configuration
field spelling is claimed runnable by this sketch.
All are validated before live execution. Missing live configuration must not prevent
a correctly configured simulated setup from starting.

## Validation still required

No independent consumer run has occurred. The next implementation must replace the
pseudocode with a runnable consumer outside the monorepo package-resolution shortcuts,
then follow J11.S1. This sketch does not establish that the handler/authentication
contract or install process is complete.
