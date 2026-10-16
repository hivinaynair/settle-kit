import { afterAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const scratch = await mkdtemp(join(tmpdir(), "settle-coverage-test-"));
afterAll(() => rm(scratch, { recursive: true, force: true }));
const checker = await Bun.file(join(import.meta.dir, "coverage-review.ts")).text();
const decisions = "| D1 | Only verified events count |\n";

async function runFixture(
  options: { changed?: boolean; missing?: boolean; removed?: boolean } = {},
) {
  const root = await mkdtemp(join(scratch, "case-"));
  await mkdir(join(root, "scripts/check"), { recursive: true });
  await mkdir(join(root, "docs/journeys"), { recursive: true });
  await Bun.write(join(root, "scripts/check/coverage-review.ts"), checker);
  await Bun.write(join(root, "docs/decisions.md"), decisions);
  await Bun.write(
    join(root, "docs/journeys/settle-kit.yaml"),
    JSON.stringify({
      actors: [{ id: "developer" }],
      invariants: [],
      journeys: options.removed
        ? []
        : [{ id: "J1", steps: [{ id: "J1.S1", criteria: { c1: "rule" } }] }],
    }),
  );
  const evidence = "Reviewed source content";
  if (!options.missing)
    await Bun.write(
      join(root, "docs/evidence.md"),
      options.changed ? `${evidence} changed` : evidence,
    );
  await Bun.write(
    join(root, "review.yaml"),
    JSON.stringify({
      reviewed_revision: "uncommitted",
      observations: [
        {
          id: "O1",
          sources: [
            {
              ref: "docs/evidence.md",
              locator: evidence,
              sha256: createHash("sha256").update(evidence).digest("hex"),
            },
          ],
        },
      ],
      coverage: [
        {
          id: "C1",
          actor: "developer",
          status: "mapped",
          policy: ["D1"],
          journeys: ["J1"],
          refs: ["J1.S1.c1"],
          observations: ["O1"],
        },
      ],
    }),
  );
  const result = Bun.spawnSync(
    [process.execPath, "scripts/check/coverage-review.ts", "--review", "review.yaml", "--complete"],
    { cwd: root },
  );
  return { exit: result.exitCode, report: JSON.parse(result.stdout.toString()) };
}

test("a dated worktree review passes only with matching sources and mapped references", async () => {
  const result = await runFixture();
  expect(result.exit).toBe(0);
  expect(result.report.complete).toBe(true);
});

test("source changes invalidate a worktree review even when the locator still exists", async () => {
  const result = await runFixture({ changed: true });
  expect(result.exit).toBe(1);
  expect(result.report.errors).toContain(
    "O1: source changed since worktree review: docs/evidence.md",
  );
});

test("sources omitted from a review-only branch produce an explicit incomplete result", async () => {
  const result = await runFixture({ missing: true });
  expect(result.exit).toBe(1);
  expect(result.report.errors).toContain("O1: reviewed source unavailable: docs/evidence.md");
});

test("removing a mapped journey invalidates its goal and criterion references", async () => {
  const result = await runFixture({ removed: true });
  expect(result.exit).toBe(1);
  expect(result.report.errors).toContain("C1: missing journey J1");
  expect(result.report.errors).toContain("C1: missing reference J1.S1.c1");
});
