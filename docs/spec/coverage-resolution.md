# Resolution of the three planning gaps

2026-10-15 · Specification follow-up, not runtime proof.

The earlier review covered 18 goals across 11 journeys and reported three missing
paths in C11/C13. This follow-up adds J12 and concrete address behavior without changing
the narrowed release. It does not edit the other tool's uncommitted coverage report,
inventory or checker, whose observations remain pinned to their reviewed revision.

| Finding | Spec change | Acceptance references | Task owner |
|---|---|---|---|
| Successful non-USDC/native-ETH rescue | D33 specifies success evidence; J12 maps operator request, external contract call, verification, failure and repayment handoff | J12.S1, J12.S2.c1–c3, J12.S3.c1–c4, J12.S6; I11 | [M1.T3](../tasks/M1.T3.md) contract; [M3.T1](../tasks/M3.T1.md) verification/procedure |
| Record repayment and close the alert | D129 records Vinay's choice: chain-verified or explicitly host-reported repayment. D51/D54 point to that procedure. Closure preserves source history and cannot create credit | J7.S3.c5, J12.S4.c1–c5, J12.S5.c1–c3, J12.S6 | [M3.T1](../tasks/M3.T1.md) |
| Address-poisoning protection | D43 defines the actual UI guarantee: one authenticated stored address for display/copy/QR; account/chain switching clears stale instructions; transaction counterparties never select destinations | J2.S1.c11–c13, J3.S1.c12–c14, J9.S2.c5 | [M3.T3](../tasks/M3.T3.md) widget; [M3.T2](../tasks/M3.T2.md) shared hook state |

The ordinary rescue case ends with funds at the fixed host refund address and an
open repayment case. A reverted or unverifiable rescue stays open. Either authorized
repayment evidence route may close that specific case, with its evidence label retained.
An exchange sender address is not assumed to be the payer's repayment destination.

There is no new public resolve endpoint, automated refund, rescue UI or promise that
arbitrary asset behavior can be verified. Unsupported evidence can be host-reported;
it must never be mislabeled chain-verified. A browser or clipboard compromise is outside
the D43 UI guarantee.

All 56 steps now have one primary implementation owner. Native journey validation
and rendering check structural consistency. Implementation tests, real receipts and
independent onboarding remain future work. The pinned supplemental review's completeness
gate is not claimed resolved by this follow-up; updating that report requires a new
review of its observations against the changed specification.
