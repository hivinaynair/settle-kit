# S5 · Credit-card onramp feasibility — 2026-10-14

**Status: documentation review and public API probes complete; authenticated checkout,
webhooks and token delivery remain untested.** Neither provider account exists yet.
No accounts, sessions, orders or payments were created. No dependencies were added.

**Recommendation:** try Transak first for an optional adapter, conditional on approval
for the actual recipient and use case. Its published merchant exception and Base
Sepolia sandbox make it a promising fit for Settle Kit. MoonPay remains a candidate,
especially for buyer-owned wallets. This is a feasibility recommendation, not proof
of a working card integration. Keep cards outside v1 until the gates below pass.

## Account access: developer, business and buyer are different

| Requirement | Transak | MoonPay |
|---|---|---|
| Developer signup | Public partner dashboard; signup guide asks for a corporate email | Public partner dashboard; partner account onboarding is documented |
| Test keys | Staging key immediately after signup, before KYB | Test keys available while account review / business verification are pending |
| Live access | Business verification (KYB) approval | Project/account review, KYB, product approval/activation; domains also reviewed |
| Customer buying crypto | Separate payer KYC, varying by region, amount and payment method | Separate payer KYC; sandbox identity information is not verified |
| Webhook setup | Team-assisted registration for staging/production; KYB restriction explicitly mentions production. Staging activation before KYB has not been tested | Dashboard-managed endpoints; actual access with an unapproved account untested |

The documented path permits testing before business approval. It does **not** prove
that literally anybody, from any country or with any email, can obtain an account.
Transak explicitly asks for a corporate email. We have not tested signup acceptance
with a personal email or an unregistered individual project. Sources:
[Transak partner signup](https://docs.transak.com/guides/how-to-create-partner-dashboard-account),
[MoonPay partner onboarding](https://support.moonpay.com/en/articles/694185-partner-onboarding-overview-from-signup-to-going-live).

KYB means verification of the business operating the integration. MoonPay lists
company registration, ownership and director documents, plus identity checks for
directors and beneficial owners. We cannot assume an unregistered solo project can
go live. Transak's acceptance of a sole proprietor also remains unverified.
[MoonPay KYB requirements](https://support.moonpay.com/en/articles/694369-business-verification-kyb-for-partners-documents-and-what-to-expect).

For an open-source SDK, use each app operator's own provider credentials and
approvals. Publishing the library does not grant its users live provider access.
Our sandbox demo needs test credentials; our own live demo would need its own approval.
Never publish a shared partner secret or turn our account into a proxy for unrelated apps.

Buyer KYC is separate from partner signup. Prefilling identity information does not
remove the buyer's verification requirements. Keep this in the provider-hosted flow.
[Transak partner FAQs](https://docs.transak.com/guides/partner-faqs),
[MoonPay consumer signup](https://support.moonpay.com/en/articles/362450-how-do-i-open-an-account-with-moonpay).

## Who receives the USDC?

There are three distinct products: buying USDC for the payer's own wallet, paying an
approved merchant's wallet, and sending USDC to another individual. We should not
promise all three through a standard onramp widget.

Transak's Rest-of-World terms define a merchant as a business agreed with Transak,
permit a designated merchant wallet, and require that merchant to be on its approved
list (§§3, 10.1(b)(v), 11.1, 11.4). That makes a treasury payment plausible, but the
demo's exact use case and recipient still require confirmation. Locking the wallet
field in a widget is a UI capability, not merchant approval.
[Transak terms](https://transak.com/terms-of-service).

MoonPay's standard US buying terms require the buyer to own and control the receiving
wallet (§8). This does not establish permission for our app treasury or another end
user, and it does not rule out separately approved Commerce arrangements. If we pursue
MoonPay, ask which product supports the exact recipient model rather than assuming
the standard onramp covers it.
[MoonPay US terms](https://www.moonpay.com/legal/terms_of_use_usa).

## What actually ran

Read-only GET requests ran without provider credentials. Full sanitized results are
in [the snapshot](card-onramp/2026-10-14-public-probes.json). Its UTC timestamp is
October 13, 19:45; that is October 14 in the workspace's India timezone.

| Probe | Observed result | What it establishes |
|---|---|---|
| Transak staging crypto coverage | HTTP 200; 295 entries; USDC label enabled on `base`, chain `84532` | Public sandbox route metadata exists |
| Transak staging fiat coverage | HTTP 200; 26 currencies; USD card method active, metadata range $5–$3,000 | A staging card method is advertised, not a live quote |
| Transak staging country coverage | HTTP 200; 26 entries; US allowed, light KYC false | Staging country metadata only |
| MoonPay currencies | Transport error; no HTTP response | Request could not reach an API response from this environment |
| MoonPay countries | Transport error; no HTTP response | Same limitation |

MoonPay's dashboard also failed with a connection reset. An independent request to
its currencies endpoint reported a connection reset, HTTP `000`. This is not a
missing-key rejection, proof of geographic ineligibility, or proof of a provider outage.
The Transak dashboard showed its email signup/login entry point; nothing was submitted.

The filtered staging response did not include INR or SGD. This does not establish
production support or lack of support. Country, currency, card acceptance, limits
and fees need the actual partner configuration and payer-specific quote. A $2 minimum
from the crypto-deposit design must not be reused for cards without validation.

## Sandbox differences and webhook feasibility

Transak documents simulated card payments and failure/refund scenarios. A purchase
labelled USDC delivers its **TRNSK test token**, including on Base Sepolia; it does not
deliver Circle USDC. This aligns with our Base verification work, but needs an explicit
test token configuration and must never be reported as real USDC settlement.
[Transak sandbox guide](https://docs.transak.com/guides/sandbox-credentials).

MoonPay documents test keys, test cards and skipped document verification in sandbox.
Its ERC-20 sandbox delivery uses **MoonPayToken on Ethereum Sepolia** and delivers
1/100 of the quoted amount. Base Sepolia delivery is not established by that guide.
Use a separate chain/token/amount expectation if testing MoonPay.
[MoonPay sandbox guide](https://dev.moonpay.com/widget/sandbox-testing).

Transak requires a backend-generated widget session URL under its current integration
flow. Do not implement the old query-string-only integration.
[Transak session URL guide](https://docs.transak.com/guides/migration-to-api-based-transak-widget-url).

Transak order notifications contain a signed JWT verified with the Partner Access
Token. The webhook setup page explicitly scopes its KYB restriction to the production
environment and accepts registration requests for either staging or production.
The partner FAQ also says KYB only gates production access. Taken together, staging
webhook setup before KYB appears available; this is a documentation-based inference,
not an observed account activation. Registration still needs team confirmation.
Request staging activation and test delivery before treating it as proven.
An authenticated status lookup can support the checkout spike if webhook activation
is unavailable, but does not prove webhook delivery.
[Transak webhooks](https://docs.transak.com/features/webhooks),
[Transak partner FAQs](https://docs.transak.com/guides/partner-faqs).

MoonPay documents dashboard configuration, signed webhooks, duplicate/out-of-order
delivery and retries. This is an integration convenience; no signed event was received
or verified in this spike.
[MoonPay webhooks](https://dev.moonpay.com/api-reference/widget/webhooks/overview).

## Proposed SDK boundary

Keep cards in an optional onramp adapter, separate from Relay's deposit-address router.
Where approved, buy USDC directly on the destination chain for the allowed recipient;
an extra Relay hop is unnecessary for that path. A buyer-owned-wallet flow may need
a separate transfer before an app can receive funds.

1. Backend creates a local operation before requesting a provider session, recording
   provider, environment, intended recipient, chain, token and expected settlement.
2. Hosted provider UI collects card details and payer KYC. Server secrets stay server-side.
3. Persist a provider order ID correlated to the local operation. Browser close,
   redirect success or a widget callback must not credit the app.
4. Authenticate webhook events, persist pending work and use Workflow for durable
   processing. Fetch current provider order state; periodically reconcile pending orders.
5. Verify the destination receipt, recipient, token contract, amount and chain finality
   before emitting the existing settlement event. Attribute it to the stored operation;
   a treasury transfer alone does not identify the payer's account.
6. Reuse the host's atomic dedupe-and-credit boundary. A duplicate event, retry or replay
   must not cause another credit. Model failure and refund states separately.

Order identifiers and chain transfer identifiers are separate dedupe keys. Database
state remains the source of truth; a workflow alone does not discover lost notifications.

## Reproduce the public probes

From the repository root, using Bun:

```sh
bun scripts/spikes/card-onramp.ts
bun scripts/spikes/card-onramp.ts --output /tmp/settle-kit-card-probes.json
bun test scripts/spikes/card-onramp.test.ts
```

Optional variables are `TRANSAK_STAGING_API_KEY` and
`MOONPAY_TEST_PUBLISHABLE_KEY` (only `pk_test_` accepted). Put credentials in a local
gitignored environment file, not command arguments, committed fixtures or reports.
This runner requests metadata only; it does not use API secrets or create sessions.
It returns exit code 1 when any probe is incomplete, as happened for MoonPay here.

The report whitelists coverage fields and omits query strings, credentials, raw errors
and customer data. Local tests exercise redaction and distinguish HTTP rejection,
transport failure and unexpected response shapes. Passing those tests proves the
probe behavior, not either provider's checkout or settlement behavior.

Local validation passed: repository formatting/lint, workspace type checks, semantic
token check and all 11 Bun tests (7 for this probe). A separate strict TypeScript
check passed for the new standalone script and its tests, since the root type-check
configuration does not include this directory.

## Remaining gates

- **Partner signup:** create a [Transak partner account](https://dashboard.transak.com)
  with the requested corporate email and retrieve staging credentials. Alternatively,
  create a [MoonPay partner account](https://dashboard.moonpay.com) for test keys.
  Account creation, terms acceptance and verification have not been performed.
- **Authenticated checkout:** generate a session with the current API, confirm domain
  restrictions, run documented test-card success and decline/refund cases, and record
  provider order IDs plus actual chain receipts. Use documented sandbox identities
  only in the sandbox; do not infer live eligibility from those simulations.
- **Webhook/recovery proof:** confirm endpoint activation requirements; verify an
  authentic signed event, reject a modified payload, replay a duplicate, close the
  browser, interrupt processing and suppress an event. Prove no double credit and
  that reconciliation eventually discovers settlement.
- **Recipient approval:** obtain confirmation for buyer-owned wallet versus merchant
  treasury versus another individual. Do not route through a Relay address to bypass
  a provider recipient restriction.
- **Live readiness:** business approval, permitted payer regions/payment methods,
  actual fees/minimums, and agreed refund/chargeback responsibilities. A sandbox
  receipt alone does not satisfy this gate. No live card charge is authorized by this spike.

Proceed with a small Transak sandbox prototype once credentials are available. If its
merchant or webhook requirements cannot be met for our demo, keep cards out and ship
the deposit/recovery SDK; the core product does not depend on card-provider approval.
