# Coverage review: inventory before journey mapping

2026-10-15. Reviewed source revision: `635fc602b2d247027decca5715741917c63da026`.
This list comes from the accepted decision record, before detailed journey mapping.
It is a review artifact, not another policy source. IDs below are local coverage IDs.

| ID | Actor goal / recovery entry | Policy source |
|---|---|---|
| C1 | Developer configures, starts and independently integrates simulated/live SDK | D5, D37, D44, D142 |
| C2 | User obtains a stable, account-bound manual address despite config changes or concurrent requests | D26, D134, D135 |
| C3 | User deposits manually, accumulates the minimum and sees provisional versus verified progress | D10, D17, D18, D28 |
| C4 | Engine settles eligible manual funds on Base or through Arbitrum CCTP without misattribution | D21, D33, D38, D121 |
| C5 | User gets a quote, consents, signs and submits one exact-amount wallet payment | D110, D126, D140, D141, D231 |
| C6 | User recovers an accepted attempt after reload/device change or uncertain submission | D111, D139, D140 |
| C7 | Host commits balance credit once and acknowledges; operator resends exhausted delivery | D124, D45, D230 |
| C8 | Engine discovers missed activity, resumes interrupted work and survives compatible/incompatible upgrades | D34, D35, D36, D131 |
| C9 | Engine keeps following the original CCTP message through service errors and shared throttling | D38, D56, D138 |
| C10 | Operator investigates missing backing, pauses credits and acknowledges canonical recovery | D125, D35, D51, D54 |
| C11 | Operator handles over-limit/non-USDC recovery and records host repayment resolution | D27, D28, D33, D51, D54 |
| C12 | Host funds quote shortfalls and controls relayer spending without changing payer consent | D126, D127, D128 |
| C13 | Developer uses accessible themed UI or headless hooks with equivalent state/actions | D40, D41, D42, D43 |
| C14 | Operator sees actionable alerts and honest stale/incomplete reconciliation status | D51, D54 |
| C15 | Developer demonstrates the separate consumer, route evidence and experimental release limits | D5, D50, D52, D53, D57, D142 |
| C16 | Checkout orders and withdrawals | Excluded: X11, X17 |
| C17 | SDK recovery buttons, generic resolve API, embedded dashboard | Excluded: X6, X15 |
| C18 | Serverless deployment and framework adapters | Excluded: X14 |

The existing spec overview says no owner product questions remain. Do not invent new
policy questions merely because implementation evidence is still pending. A missing
mapping calls for a spec check first; a missing implementation proof stays an acceptance
check. Scope is the current deposit release, not archived checkout/Relay designs.
