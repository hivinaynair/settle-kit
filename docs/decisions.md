# Decisions

Status: DRAFT, waiting for Vinay to confirm. Rows are proposed from the planning
conversation of 2026-10-14 and the archived plan; nothing is settled until confirmed.

Settled choices for Settle Kit. One row per decision; never edit a row's meaning.
To change one, add a new row with `Supersedes`. Open questions live at the bottom.
Rules: Spec process section of [AGENTS.md](../AGENTS.md). ID ranges keep related choices
together: scope D1–D9, product behavior D10–D19, money D20–D29, architecture D30–D39,
SDK D40–D49, operations and release D50–D59 (if a range fills, continue in the next free hundred, e.g. D120). Journey
steps cite these IDs; `bun run check-journeys` fails on an unknown or superseded one.

## Scope (D1–D9)

| ID | Decision | Why | Rejected | Date | Supersedes |
|---|---|---|---|---|---|
| D1 | Settle Kit is an open-source (MIT), self-hosted, non-custodial SDK that takes crypto payments from any wallet or exchange and settles them as USDC on Base | Show Daimo and Fun.xyz the same engine they run, readable line by line; no hosted closed engine does this in the open | A hosted service; closed source; a business of its own | 2026-10-14 | |
| D2 | Ship one complete v1.0 and present it only when done. Build it in milestones, each working, tested and merged before the next; the repo stays public throughout | One strong launch beats several half-products; milestones keep something working at all times | Public phases (1, 2a, 2b, 2c); building in one long branch | 2026-10-14 | |
| D3 | v1.0 has two products: **checkout** (a fixed-price order paid to a single-use address before an expiry) and **deposits** (a reusable address per user, credited any amount) | Deposits are Fun.xyz's and Daimo's core product; checkout is the simpler, exact case | Checkout only, deposits later | 2026-10-14 | |
| D4 | Two lanes feed one verify → settle → deliver pipeline: the **Relay lane** (Relay deposit addresses, swaps and bridging) and the **own-rails lane** (our deposit contracts plus CCTP V2 for USDC) | Owning the USDC rails is what makes this infrastructure rather than a wrapper; Relay covers tokens CCTP cannot move | Relay only; own rails only (no non-USDC tokens) | 2026-10-14 | |
| D5 | Done means: a stranger installs the packages, takes a checkout payment and a deposit through both lanes on mainnet, customizes the widget or builds their own UI with hooks, and sees every payment verified, credited once and reconciled against the treasury | A testable finish line, so scope can't drift | "Done when it feels done" | 2026-10-14 | |

## Product behavior (D10–D19)

| ID | Decision | Why | Rejected | Date | Supersedes |
|---|---|---|---|---|---|
| D10 | Three ways to pay: (1) send to an address or scan a QR code (EIP-681) from any wallet or exchange; (2) connect a browser wallet (EIP-6963) and pay in USDC with one click; (3) connect a browser wallet and pay with any token it holds, swapped and bridged to USDC by Relay | (1) reaches exchanges and phone wallets; (2) locks the amount and network; (3) matches Fun.xyz for payers without USDC | Wallet only; address only | 2026-10-14 | |
| D11 | Address and QR payments accept a fixed list of proven routes: USDC on Base, Arbitrum and Ethereum; USDT on Ethereum and Arbitrum; ETH on Base and Arbitrum; USDT on Tron only if Relay supports deposit addresses there (Q11). A route is added only after a recorded mainnet payment. Wallet payments may use any token Relay can quote above a minimum value | An address payment can't be stopped if it's wrong, so each route needs a known minimum, fee and refund behavior; a failed wallet quote charges nothing. USDT on Base is left out: it is a bridged copy that exchanges rarely send, and look-alike contracts invite mistakes | Every token Relay supports on the address path; USDC-only; USDT on Base | 2026-10-14 | |
| D12 | A deposit is delivered either to the treasury or straight to the user's own wallet (the trading-app model) | Both are common in Fun.xyz-style products | Treasury only | 2026-10-14 | |
| D13 | The payer bears route fees. The widget shows the estimate ("you'll receive about X") before sending; credit is the verified arrival amount | Merchants receive what they priced; fees are visible up front | The merchant absorbs fees | 2026-10-13 | |
| D14 | The host is told by signed webhook events: `order.paid`, `order.needs_attention`, `deposit.credited` | Merchants hear about problems, not only successes; three events stay small | A settlement-only callback; a general event bus | 2026-10-14 | |

## Money rules (D20–D29)

| ID | Decision | Why | Rejected | Date | Supersedes |
|---|---|---|---|---|---|
| D20 | The destination is always USDC on Base. Every order and deposit address stores its destination (chain ID and token contract) next to its recipient, and every check reads it from there; no code assumes Base. Tokens are identified by chain ID and contract address, never by symbol | One asset keeps verification exact and the host's accounting simple; a stored destination makes USDC on another chain a config entry plus a live proof later | USDC on Base, Arbitrum and Ethereum in v1.0 (up to 21 route proofs, minutes-long waits on Ethereum); any coin as destination; matching by symbol | 2026-10-14 | |
| D21 | Credit only what we verified ourselves on Base at the `safe` block (~30 s). The buyer sees "Paid" as soon as our own check of the Base transaction succeeds at the `latest` block (~2–5 s). Relay's status may drive progress messages ("payment received") but never marks a payment paid and never authorizes credit; elapsed time never authorizes credit or a "lost" verdict | Feels instant to the buyer while money moves only on proof; reading the Base receipt costs one call; a rollback after "Paid" shows in needs_attention with nothing credited. S3: `safe` is ~30 s on Base | Crediting on Relay's status; a per-host "credit at latest" option (two money paths for little gain); a fixed confirmation count; waiting for `finalized` (~16 min) | 2026-10-14 | |
| D22 | Amounts are base units: `bigint` in code, `numeric` in Postgres, decimal strings in JSON. Never floats | Floats lose cents | Floats; decimal libraries in the hot path | 2026-10-13 | |
| D23 | Credit exactly once: unique keys per provider fill, per on-chain transfer `(chain ID, tx hash, log index)` and per paid order | Duplicate webhooks, retries and two workers are normal; the database must refuse the second credit | Application-level checks only | 2026-10-14 | |
| D24 | Checkout on the Relay lane uses a strict `EXACT_OUTPUT` deposit address: the order is paid only when the treasury receives exactly the order amount. Less is refunded by Relay; more fills the exact amount and Relay refunds the excess | A transfer can't be stopped from carrying the wrong amount, so the outcome is made exact | Open addresses with tolerance for checkout | 2026-10-14 | |
| D25 | On the CCTP Fast path the fee comes out of the minted USDC, so checkout accepts at least the order amount and records any surplus | CCTP Fast can't deliver an exact amount; Standard is exact but takes 15–19 minutes | CCTP Standard for checkout; rejecting every non-exact amount | 2026-10-14 | |
| D26 | Treasury and refund addresses come from server config only. An order's or address's recipient is stored when it is created, and verification checks against the stored value, not current settings | A changed setting must not redirect or reject money already in flight | Client-supplied addresses; checking current config | 2026-10-14 | |
| D27 | Settle Kit never holds keys that move user funds and never repays payers itself. Relay refunds go to the host's configured refund address; the host repays through its own support process | Exchange senders can't receive a refund at the sending address; automatic transfers to unverified destinations lose money | Refund to the sender automatically | 2026-10-13 | |

## Architecture (D30–D39)

| ID | Decision | Why | Rejected | Date | Supersedes |
|---|---|---|---|---|---|
| D30 | Postgres with Drizzle in the host's own database, shipped with numbered SQL migrations that are never edited once published | Unique constraints, conditional updates and transactions are what make credit-once safe | Our own hosted database; a pluggable database layer | 2026-10-13 | |
| D31 | One schema covers orders and deposit addresses from the first migration | With one release, design the data once instead of reshaping it halfway | Checkout tables first, deposits added later | 2026-10-14 | |
| D32 | Payments move through a state machine with final states and compare-and-set transitions (update only if still in the expected state) | Two workers can't both move the same payment; final states never change | Free-form status updates | 2026-10-14 | |
| D33 | Own-rails contracts (Foundry, MIT, written from scratch, not copied from Daimo's GPL code): a CREATE2 deposit address per user or order, known before deployment; `sweep()` anyone can call, sending USDC only to the stored treasury (Base forwards directly; Arbitrum and Ethereum go through CCTP V2 Fast with the Forwarding Service); `rescue(token)` anyone can call, sending any other token or native ETH only to the stored refund address (never USDC); a refund anyone can trigger after a checkout address expires | No trusted operator role: every function can only send to a destination fixed when the address was created; the address can be shown before any gas is spent; wrong tokens are recoverable instead of stuck; CCTP needs no account or KYC; V1 pauses on 2026-12-01 | Relay for USDC too; CCTP V1; a privileged sweeper role; no rescue (wrong tokens stuck forever) | 2026-10-14 | |
| D34 | Our own indexer per chain reads USDC `Transfer` logs up to the `safe` block, saves its position in the same transaction as the transfers, and stores each transfer once by `(chain ID, tx hash, log index)` | A chain never notifies anyone; our own addresses have no Relay to ask; reading only to `safe` avoids rollback logic | Ponder or another indexing framework; reading to the chain head | 2026-10-14 | |
| D35 | Payments are found by push (Relay webhooks, the indexer), with discovery reconciliation on a schedule as the safety net and treasury reconciliation (every treasury arrival matched to a settled payment, and the reverse) | Webhooks get lost; long-lived deposit addresses can't each be polled every 10 seconds; reconciliation proves production matches the books | Polling every address; trusting webhooks alone | 2026-10-14 | |
| D36 | Per-payment processes run as Workflow SDK workflows: Relay settlement, the own-rails sweep through CCTP, and webhook delivery. Scanning work runs as plain functions on a schedule: the indexer, discovery reconciliation and treasury reconciliation. The database stays the source of truth (D32, D23); workflows are keyed by payment ID, and reconciliation restarts any unfinished one | A multi-step payment with external waits reads top to bottom as a durable workflow, each `await` a checkpoint; scans are batch work a cron does well; S1 showed a run can get stuck, so correctness never depends on the workflow finishing | Our own `tick()` for everything (a status column and retry time per step, harder to read); Workflow SDK for everything (a never-ending indexer is the wrong shape); workflows as the source of truth | 2026-10-14 | |
| D37 | Hosts run a framework the Workflow SDK supports, Next.js first, with the Vercel World or the Postgres World (in the host's own database) for durable runs. The local World is for development only | The SDK is open source (Apache-2.0) and self-hostable through the Postgres World; the local World keeps its queue in memory (S1) | Supporting Express or plain Node in v1.0 (no SDK adapter); the local World in production | 2026-10-14 | |
| D38 | Settle Kit chooses the lane when it issues an address, and the lane is stored and never changes: USDC on Base, Arbitrum or Ethereum → own rails; USDT, ETH and any token through a wallet → Relay. Fallback to Relay happens only at issue time, when own rails can't issue an address, with the reason recorded. If CCTP fails after a permanent deposit address was issued, the funds wait at the contract and the sweep retries; the user is never moved to a new address | The address is the lane, and a payer may already have sent to it; own rails stay the default for USDC (D4) | Switching lanes after the address is shown; the buyer choosing; Relay for everything | 2026-10-14 | |
| D39 | Sweeps are sent by a small gas wallet the host runs per chain (key in server config, used only to deploy addresses and call `sweep()`). Each sweep deducts its gas cost from the deposit in USDC and pays it to that gas wallet's address, which is fixed in the contract with a per-sweep cap, so the buyer bears gas like Relay's fee (D13). Wallet payments skip the sweep: the buyer signs one transaction (USDC `permit`, EIP-2612) that forwards straight to the treasury | Someone must sign the second transaction and only the host can; the buyer still pays; a stolen gas key can't move user funds (D27), and the fixed recipient and cap stop a stranger's `sweep()` from taking more than the cap | A USDC paymaster (ERC-4337 machinery); the host absorbing gas; reimbursing whoever calls `sweep()` | 2026-10-14 | |

## SDK and developer experience (D40–D49)

| ID | Decision | Why | Rejected | Date | Supersedes |
|---|---|---|---|---|---|
| D40 | The React SDK works like Clerk, in three layers: prebuilt components; `appearance` (theme, variables, per-element overrides, layout) plus `localization`; and headless hooks with building blocks for a fully custom UI | Plug-and-play for most hosts, full control for the rest | Components only; hooks only | 2026-10-14 | |
| D41 | Components: `<Checkout>`, `<CheckoutButton mode="modal">`, `<Deposit>`, `<DepositButton>`, `<Receipt>`, `<SettleDashboard>`. Hooks: `useCheckout`, `useDeposits`, `useWallets`, `usePayWithWallet`. Building blocks: `<PaymentQR>`, `<Address>`, `<Amount>`, `<Timeline>` | The approved v1.0 surface | — | 2026-10-14 | |
| D42 | Every element has a stable key (`payButton`, `qrCode`…), rendered as `class="sk-<key>"` and `data-sk="<key>"`; the keys are public API. The published widget doesn't depend on Tailwind or `@repo/ui` and themes through CSS variables | Hosts style it with their own CSS or Tailwind without forking | Shipping Tailwind; unstable class names | 2026-10-14 | |
| D43 | The widget guards the payer: address-poisoning protection, a test-mode watermark on the QR code, a "don't send twice" guard, and accessible markup | Payer mistakes cost real money and can't be undone | — | 2026-10-14 | |
| D44 | Server SDK: `createSettle()` and `settle.handlers`; `createOrder`, `depositAddress`, `listOrders`, `resendWebhook`, `resolve`, `reindex`, `reconcile`; a `settle.webhook(handler)` helper for receiving events. `SETTLE_MODE` is required, with no default | One small surface; never fall into live mode by accident | A default mode | 2026-10-14 | |
| D45 | Webhooks follow Standard Webhooks signing, with a 10 s timeout and 10 retries at `2^(n-1)` minutes (about 17 hours), then an operator resend | A known scheme hosts can verify; retries cover a host outage overnight | A custom signature; unlimited retries | 2026-10-13 | |
| D46 | A host may force the lane per coin in config (e.g. `lanes: { usdc: "relay" }`); unset, Settle Kit chooses (D38). A forced lane applies to addresses issued after the change; existing addresses keep theirs | Lets a host start on Relay only, without a gas wallet or contracts, and switch USDC to own rails later | Settle Kit always choosing; changing the lane of addresses already issued | 2026-10-14 | |

## Operations and release (D50–D59)

| ID | Decision | Why | Rejected | Date | Supersedes |
|---|---|---|---|---|---|
| D50 | Development uses test mode with simulated scenarios. Live proof is small Base mainnet payments (demo prices 0.50 / 1.00 / 2.00 USDC). Contracts and CCTP are tested on testnets first | S4a and S4b: Relay's testnet never sweeps deposit addresses; CCTP testnets work | Relay testnet as the development profile | 2026-10-14 | |
| D51 | Operator tools: an embeddable `<SettleDashboard>` (search, timelines, resend, resolve, Relay reindex), refund evidence with a guided refund flow, a CLI (`bunx settle-kit trigger <scenario>`, `migrate`), and public speed stats | Operators need to see and fix things without SQL | — | 2026-10-14 | |
| D52 | Launch includes: a mainnet run on every lane, a contract threat model and self-review, a docs site, `SECURITY.md`, the npm release under `@settle-kit`, a demo shop with dashboard and receipts, a video and write-ups | Proof that it works, and that money risks were taken seriously | Launching on demo screenshots | 2026-10-14 | |

## Out of scope (X1…)

| ID | Not building | Why |
|---|---|---|
| X1 | Card onramps (Transak, MoonPay) | Need business verification and partner approval one person can't get; S5 |
| X2 | Exchange account connections (log in to Coinbase or Binance to pay) | Partner contracts and KYC |
| X3 | Settling anywhere but USDC on Base: no other chains in v1.0, and never a non-USDC destination such as ETH or USDT | D20. Other USDC chains are a follow-up after launch. Non-USDC destinations need a price source, multi-currency books and Relay for every payment, so own rails would no longer cover them |
| X4 | A hosted Settle Kit service, or holding anyone's funds | D1; also avoids the regulatory side of running others' money |
| X5 | A unified cross-chain balance (Circle Gateway) | Different product; not needed for checkout or deposits |
| X6 | Tooling for `rescue(token)`: a dashboard balance lookup for non-USDC tokens and a Rescue button. The contract function itself ships (D33); an operator calls it from a block explorer or a one-line script | Contracts can't be changed later, so the function goes in now; the tooling is ordinary TypeScript that can be added in any later version |
| X7 | Hosts on Express or plain Node | D37: the Workflow SDK has no adapter for them; revisit if one appears |

## Open questions (Q1…)

| ID | Question | Recommendation | Blocks | Who answers |
|---|---|---|---|---|
| Q5 | Where does the own-rails "refund after expiry" send funds? | To the host's refund address on that chain, the same as Relay refunds (D27) | Contract design | Vinay |
| Q6 | How does a deposit to the user's own wallet (D12) get its recipient? | The host passes it server-side when creating the deposit address; it is stored once (D26) and never taken from the browser | Deposit journeys | Vinay |
| Q7 | When does a payment go to `needs_attention`, and how often is it checked after that? | After 30 minutes without a verified outcome; then by discovery reconciliation every 15 minutes | Checkout and deposit failure branches | Vinay |
| Q8 | Deposit limits: a minimum, a displayed maximum, and a per-transfer cap in the contracts until someone else has reviewed them? | Minimum 2 USDC (fees stay under 2%); a displayed maximum of 1,000 USDC; a contract cap of 1,000 USDC per sweep | Deposit journeys, contracts | Vinay |
| Q9 | Is the release labelled 1.0 or 0.x "experimental" while the contracts are unaudited? | Call the launch v1.0 of the project, publish the packages as 0.x, and mark the contracts experimental with the caps from Q8 | Release and docs | Vinay |
| Q10 | Does Relay's 2 req/min `/requests` limit apply to `/requests/v3`, and can we get a testnet key? (S7) | Design for webhooks first and treat polling as the fallback whatever the answer | Discovery reconciliation budget | Relay support |
| Q11 | Does Relay support deposit addresses on Tron for USDT? | Check Relay's `/chains` list and quote one Tron USDT → Base USDC deposit address; add the route only if a live payment succeeds | The Tron route in D11 | Vinay (one script run) |
