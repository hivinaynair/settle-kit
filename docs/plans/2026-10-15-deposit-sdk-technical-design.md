# Settle Kit: technical design

2026-10-15 · Reviewed and clarified 2026-10-17. Design only; no product implementation is claimed.

Build one self-hosted deposit engine, three TypeScript packages and a usable consumer.
[Decisions](../decisions.md) own policy; the [journey spine](../journeys/settle-kit.md)
owns acceptance behavior. This document assigns technical responsibilities, durable
identities and transaction boundaries. The [task plan](../tasks/README.md) assigns work.
The superseded checkout plan in `docs/archive` is not a dependency.

## System boundary

```mermaid
flowchart LR
    U["Deposit widget / hooks"] --> H["Host authentication + SDK handlers"]
    H --> DB["Postgres: operations, evidence, allocations, outbox"]
    DB <--> W["DBOS: resume due work"]
    W --> S["Persisted transaction submitter"]
    S --> C["Own contracts: Base forward / Arbitrum burn"]
    C --> F["Circle forwards original burn to Base"]
    C --> V["Source and Base chain verification"]
    F --> V
    V --> DB
    DB --> E["Signed webhook delivery"]
    E --> B["Host transaction: event deduplication + account balance"]
```

The host owns Postgres, the operator ETH, fixed treasury/refund/fee destinations and
account authorization. Contracts move funds; chain readers establish evidence;
database transactions protect attribution and credit; DBOS schedules recoverable
work. Circle handles forwarding, not account credit (D21, D27, D36, D124, D138).

| Location | Responsibility | Boundary |
|---|---|---|
| `packages/core` | Amount codecs, public records, quote/attempt/settlement/delivery types, stable errors | No wallet keys, RPC or database imports |
| `packages/server` | Configuration, handlers, Drizzle store, chain adapters, submissions, verification, workflows, outbox and operator procedures | One engine per long-running process; no generic provider plugin API |
| `packages/react` | Shared client state, two hooks, Deposit, CSS-variable styles | No server import, Tailwind or `@repo/ui` dependency |
| `contracts` (planned) | Factory and deposit contracts, ABI/bytecode manifest, Foundry tests | Fixed money settings, no upgrade/admin redirection |
| `apps/demo` | Reference account, balance, deposits and readable alerts | Host integration example, not an operator dashboard product |
| Separate consumer fixture (planned) | Install built package archives outside workspace resolution | Proves the actual dependency and setup contract |

Keep live adapters behind the explicit mode boundary. Simulated mode uses the same
database transitions, events and UI with a deterministic local evidence adapter; it
never imports a live signer or calls an RPC. Use a separate database/schema and
fixture destinations. Simulation is visibly labeled and is not chain evidence
(D44; J1.S2, J11.S1).

## API and host integration

Keep the D44/D140 API. HTTP paths and internal helpers are implementation details,
not additional public domain methods. All JSON amounts use decimal base-unit strings.

| Surface | Inputs and result | Authorization |
|---|---|---|
| `createSettle(config)`, `handlers`, `start()`, `webhook(handler)` | Validated configuration, web-standard HTTP, background startup, raw-body signed-event receiver | Host mounts account/operator routes and supplies authorization; receiver verifies signature |
| `depositAddress(accountId, chain)` | Stored address plus route instructions | Account owner |
| `listDeposits(accountId)` | Manual observations and accepted wallet attempts, including attempts without a transaction | Account owner |
| `preparePayment({accountId, chain, payer, amount, idempotencyKey})` | Exactly one `pay` or `receive`; returns immutable quote, deadlines, ID and signing data | Account owner |
| `submitPayment({paymentId, signature})` | Durable acceptance of the stored quote; repeats return the original operation | Stored payment owner |
| `getPayment(paymentId)` | Attempt, settlement and host-delivery state separately | Stored payment owner |
| `listAlerts()`, `resendWebhook(eventId)`, `reconcile()` | Existing operator surface | Host operator |

Handlers must receive a host-authenticated principal through server wiring. Account
IDs from JSON cannot establish identity. Resolve a payment's stored owner before
returning its data or accepting a signature; direct in-process methods are trusted
host calls with the same documented authorization responsibility. Reject missing
authorization and protect cookie-authenticated mutations against cross-origin use.
The separate consumer must provide the actual session and operator wiring, not
leave placeholder `host.*` functions (D26, D140, D142).

Use a discriminated result/error contract: validation/conflict/auth failures before
acceptance; durable operation state afterward. An HTTP timeout is not proof that
submission failed. A retry uses the same payment identity. Never send raw provider
errors, signed transaction bytes, private keys or webhook secrets to the client.
The [integration sketch](../examples/minimal-host.md) remains pseudocode until the
consumer task replaces it with runnable wiring.

## Persistence and atomic boundaries

Use Drizzle over host Postgres with numbered SQL migrations. Keep queryable identities,
amounts and state in columns. JSON is for versioned immutable quote/signing data and
raw evidence retained for audit, not a substitute for uniqueness constraints.
Use integer `numeric` amounts with nonnegative/range checks and `bigint` conversion;
never pass through a JavaScript number (D22, D30, D31).

| Record group | Why it must survive a crash | Key / constraint |
|---|---|---|
| Deployment settings and addresses | Namespace and complete CREATE2 inputs remain stable across config changes | Unique host/account/route; atomically return first stored winner |
| Quotes and accepted payments | Recover consent and pre-chain history | Unique host/account/idempotency key with canonical-input hash; unique chain/token/payer/authorization nonce |
| SDK commands and worker claims | Resume submission without recreating an external action | One open SDK manual-sweep command per address; payment ID unique; expiring claim plus generation |
| Observed drains and settlement records | Track every successful on-chain sweep or recovery independently of the submitting command | Unique chain/tx/log drain identity; optional command link; separate verification state per drain |
| Shared contract-deployment actions | Let a first wallet payment and a manual sweep reuse deployment work | Unique chain/address/creation-code-version action; retained submitter nonce family |
| Signer nonces and transaction attempts | Recover an uncertain broadcast or replacement | Unique chain/signer/nonce reservation; many replacement hashes belong to one action |
| Chain events and drain memberships | Discover third-party sweeps and attribute late-indexed transfers | Event key chain/tx/log; one drain or quoted payment owns each source transfer; retained block hash and execution order |
| CCTP messages and Base evidence | Link one source action to the destination receipt | Protected operation tag plus source event identity; destination domain/nonce; unique transfer backing owner |
| Backing groups, allocations and credits | Preserve exact quoted credit or full manual net with no double allocation | Each transfer belongs to one group; credit and host residual partition that group; one credit per successful manual drain or quoted payment |
| Outbox events and delivery attempts | Recover credit-to-notification handoff | Immutable event ID/body; mutable attempt budget and next due time |
| Scan ranges and checkpoints | Distinguish a complete captured range from a partial read | Chain/scope cursor plus boundary number/hash; separate per-address catch-up |
| Spend reservations and Iris request budget | Bound concurrent workers' external spending/calls | Shared chain/window accounting; reservation tied to transaction nonce family; serialized request permits |
| Alert episodes and operator evidence | Explain unresolved funds and audit closure | Stable case/episode IDs with over_limit_usdc or asset_rescue kind; immutable resolution request ID; chain pause and retained evidence |

Five transaction boundaries are mandatory:

1. Preparation stores the immutable quote. Acceptance atomically records the accepted
   state and its operation before scheduling work. The due-work scanner repairs a crash
   before enqueue; unsigned drafts do not become runnable operations (D111, D140).
2. Reserve signer nonce and spend, then persist signed bytes/hash before any broadcast.
   Signing follows nonce reservation; after a signing crash resume the reserved action.
   Reconcile externally consumed nonces before advancing (D128, D139).
3. Read all RPC pages for a bounded scan range, then commit its events, memberships and
   cursor together. A failed or partial page cannot advance that range's cursor. Advertise
   the overall captured-boundary check complete only after all required ranges and
   verifications succeed (D34, I8).
4. In one credit transaction lock/check the chain-pause state, claim source and backing,
   insert the credit/allocation and immutable outbox event. Concurrent reorg incident creation
   uses that same chain lock. A scheduler crash cannot strand the event (D125, D230).
5. Append a repayment resolution and close that case atomically. A repeated request returns
   its existing result; conflicting reuse is rejected. It cannot write the credit ledger
   (D129; J12.S4–S5).

The host's event-ID insert and balance update are a **separate** transaction (D124).
DBOS completion, SDK credit and host acknowledgment are never collapsed into one status.

The one-open-command constraint limits SDK-initiated sweeps; it cannot prevent another
caller from executing the permissionless contract. Each discovered drain gets its own
settlement record even while an older command awaits a mint. Reconciliation may verify
and credit a later drain without completing the earlier one. An SDK command links only
to its proven source execution; an external drain does not make an unknown signed SDK
transaction safe to replace or forget. Retain that attempt until its outcome is known.
This separates submission mutual exclusion from D121's per-drain accounting
(D34, D36; J6.S1.c9, J6.S1.c14). M1.T2 owns the constraints; M2.T2/M2.T3 own discovery
and attribution, and M2.T6 credits the independently verified drain.

## Contracts and source attribution

Version the factory and creation-code manifest together. Verify chain ID and factory
runtime hash before issuing an address. Use `abi.encode` for namespace/account salt
and complete constructor settings; do not deploy a mutable initializer. Store the
prediction inputs first. Reuse a predeployed contract only after checking the expected
code and immutable configuration (D33, D134, D135).

The wallet entry point receives the exact authorization and quote commitment. Define
a versioned ABI encoding for the nonce commitment covering payment identity, payer,
contract/route, debit, source fee, credit, burn/maxFee and validity. The contract
recomputes it, consumes `receiveWithAuthorization`, applies its fixed destinations,
then forwards or burns atomically. Emit the payment identity and amounts. Manual
balances are untouched by this entry point (D231, D126).

### First wallet payment and contract deployment

Preparation uses the same internal address-issuance service as depositAddress to save
the complete recipient contract settings and discovery start before returning signing
data. It predicts the address without spending gas. M1.T4 consumes that service contract;
M2.T2 supplies its live implementation before M2.T4 enables the wallet path.

After durable acceptance, the wallet workflow runs ensure_contract before authorization
submission. M2.T1 owns the shared deployment action and D139 transaction recovery. An
existing supported contract skips deployment; absent code starts or resumes the one
saved factory deployment. Manual and wallet commands reuse that deployment action and
verify runtime/settings before payment execution. Recheck after a deployment reorg.
Deployment and payment costs both use D128 budgets. Recheck original validity after
deployment; a delay cannot extend the signature or trigger a new authorization. A
deployment-only success is never a payment or settlement. Test a fresh account with no
manual deposit, racing deployment requests, and a crash after deployment broadcast
(D134, D135, D139, D231; J8.S5.c18).

Manual sweep and over-limit recovery emit full-drain boundaries; quote transfers are
excluded from manual membership. Reconstruct attribution in chain execution order,
not discovery or workflow order. A mismatch between membership sum and emitted gross
blocks credit. A non-USDC rescue emits separate asset/refund evidence and is **not**
a USDC drain. Use a documented native-ETH marker for `rescue(token)`; handle failed
ERC20 return values and reentrancy. Do not treat an arbitrary token's fabricated
Transfer log as verified receipt (D121, D33; J7, J12).

## Verification across Arbitrum and Base

### Unique source-to-destination identity

Every Arbitrum burn carries a bytes32 operation tag in protected hookData. A successful
manual USDC drain increments a per-contract drain sequence; derive its tag from a
versioned abi.encode of source chain, contract, manual kind and that sequence. Recovery
also advances the USDC drain sequence; non-USDC rescue does not. A wallet tag instead
binds the saved payment identity and its authorization commitment. M1.T3 freezes the
encoding, emits the tag with the matching burn, and constructs it in the contract.
Repeated equal-amount burns must have different tags; rollback also rolls back sequence
changes. Callers cannot substitute an unrelated tag.

Use two complete version-1 frames: Circle's cctp-forward frame and a Settle Kit frame
containing the encoding version and tag. Custom bytes stay in their own frame. The
decoder compares that protected tag from the source event/message with the attested
message and destination consumption. A source tx hash from Iris cannot replace it.
M2.T5 must prove equal-amount messages remain distinguishable, including out-of-order
arrival and manual/wallet payments with otherwise identical burn fields
(D121, D138, D231; J4.S2.c18, J8.S6.c8; I10).

Circle documents the [composable forwarding frames](https://developers.circle.com/cctp/concepts/forwarding-service#version-1).
Its [source message encoder](https://github.com/circlefin/evm-cctp-contracts/blob/63ab1f0ac06ce0793c0bbfbb8d09816bc211386d/src/messages/v2/MessageV2.sol)
writes an empty nonce before attestation. These are source-backed format choices;
compatibility with the deployed testnet service remains M2.T5 acceptance evidence.

Persist the source payment/sweep event, matching burn and `MessageSent` log identity.
Match the attested message's protected source fields to that evidence, then match
destination message consumption and its native-USDC mint/transfer to the stored
Base recipient. Check domains, authorized protocol contracts, sender, token, amounts,
fee bounds and executed finality. Bind logs within the same message execution;
equal amounts in a transaction are not sufficient. Ambiguity remains attention.

CCTP V2 assigns its nonce off-chain and fills attestation fields after the source
event. Comparing entire source and attested byte strings for equality would therefore
be wrong. Pin decoding to the deployed V2 ABI and distinguish protected source fields
from attestation-populated fields. [Circle technical guide](https://developers.circle.com/cctp/references/technical-guide).

Treat a successful receipt from the configured Base MessageTransmitter as evidence
that its attestation checks ran; independently verify the matching money movement
and canonical source/Base safe boundaries. Iris supplies discovery hints, not credit
authority. Circle Forwarding handles mint submission and attestation recovery for the
original burn; keep tracking it if delayed. The combined fee bound includes forwarding.
[Circle Forwarding](https://developers.circle.com/cctp/concepts/forwarding-service).

Use the same exclusive-backing allocator for both entry paths. Manual credit is full
verified net; quoted credit is fixed with residual accounted separately. Exceptional
shortfall funding must be separately verified and unallocated (D21, D126, D127).

## Background work and recovery

Use small versioned DBOS workflows for wallet operations, manual sweeps and event
delivery. Each stage reads durable operation state before doing work. Claims fence
database stage changes; transaction identity protects external effects if an old
worker wakes up. A sleep stores its next action and releases the claim, not the
operation identity. An empty address after a burn is not completed work (D36).

Keep `applicationVersion` explicit and distinct from package version. Compatible
upgrades preserve workflow ordering; incompatible sequences retain the old named
implementation until drained. Keep an old-version worker when changing compatibility
versions. This is required because DBOS recovery is version-specific, not automatic
migration of history. [DBOS upgrade documentation](https://docs.dbos.dev/typescript/tutorials/upgrading-workflows).

Reserve finite gas/data-fee budgets before each submission or replacement. Same-nonce
replacement reserves only the increase in maximum possible charge; unknown outcomes
retain their reservation. Hold one address's manual operation open across uncertainty
so a later deposit cannot be swept by two independent retries (D128, D139).

Indexing, account-targeted reads and reconciliation share one scanner. New addresses
persist their discovery start boundary and catch up independently of the global
cursor. Read-only recovery continues when spending is paused. Iris uses a shared
persisted request limiter; no per-process limiter masquerades as a global one
(D34, D56, D131). Webhook attempts use stable event bytes with fresh signatures;
exhaustion remains failed until explicit resend (D45).

## Product state and operator procedures

Use one React controller for Deposit and custom hooks. Receive-first inputs send one
authoritative amount; the server returns both amounts and fee. Only the matching
response may update consent. Account, wallet, network or input changes invalidate
unsigned consent. Accepted attempts reload from server history. Address text, QR and
copy share the same scoped record and loading guard (D43, D110, D140; J2, J3, J8, J9).

Display observation, source confirmation, Base verification and host acknowledgment
as separate progress. `source_succeeded` is not `credited`; rejected signing is not
`failed_no_debit`. Only the complete D111 evidence scan permits that terminal state.

Provide documented authenticated **operator scripts**, not a new public resolve API.
Use narrow internal services with DB transactions for shortfall evidence, reorg
acknowledgment and repayment records. The host wires operator identity; scripts never
accept an untrusted caller-supplied operator name as authentication. Explorer/manual
contract calls remain outside SDK submission (D51, X6).

For J12, the script first loads the saved case and verified source-safe recovery evidence:
either J7's over_limit_usdc full-drain recovery or J12's asset_rescue event and receipt.
The case kind selects verification and attribution; a USDC recovery must not require a
rescue event, and an asset rescue must not advance USDC drain membership. M3.T1 owns
both inputs to the same repayment procedure (J7.S3.c5, J12.S4.c6). It
accepts a repayment reference plus either `chain_verified` or `host_reported`, requires
the host's beneficiary/full-resolution confirmation, prints the recorded label and
preserves the audit trail. Chain verification cannot prove who owns a recipient.
Unknown token mechanics or unsupported chain evidence can only be host-reported,
never silently promoted. Repeated reconciliation must respect a resolved episode;
new contradictory canonical evidence creates a linked investigation, not deletion of
the original record. This is separate from acknowledging a D125 incident.

## Build gates and evidence limits

Do not schedule more preliminary spikes. S14–S16 supply primitive/browser evidence;
the product still needs the combined route and recovery proofs in D57. Contracts and
verification tasks must demonstrate a real Arbitrum authorization → burn → Base
arrival before polishing packaging. Record each stage's timing separately.

Use Foundry for contract invariants, Bun for amount/encoding logic and integration
tests against real Postgres for uniqueness, rollback and concurrent workers. Test
crashes before broadcast, after broadcast, after credit commit and after host commit
before acknowledgment. Exercise a compatible upgrade with unfinished work and an
incompatible workflow running alongside its retained predecessor. These prove distinct
boundaries; a single happy-path browser run does not replace them.

The first consumer preview may be simulated and shown early. The coherent public
demonstration requires live evidence, recoverable delivery, built-package installation
and the documented independent onboarding attempt (J11). All task tests cite exact
criteria/invariants. `check-journeys` proves trace integrity; `--complete` checks test
citations, not that assertions are correct or that live gates have passed.
