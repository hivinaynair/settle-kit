# Archive

The earlier checkout-first plan, kept as input for the decisions step. Not the current
spec: do not build from these. The current process is in [docs/spec](../spec/README.md).

| Path | What it was |
|---|---|
| `plans/2026-10-13-deposit-kit-design.md` | The original design doc (checkout first, Workflow SDK, Relay only) |
| `tasks/` | Task specs T1–T9. T1 is built: `packages/core/src/router.ts` and `packages/server/src/routers/` |
| `handoffs/` | Notes passed between agents (request-ID tracking for T1) |

The T1 Relay router (`packages/server/src/routers/`, its fixtures, and the `Route`/`Fill` types in
`packages/core`) was removed on 2026-10-15 when the slice 1 journeys landed: it served the
Relay lane (slice 2, D7) and no journey traced its tests. Restore it from commit `a059d4f`.
