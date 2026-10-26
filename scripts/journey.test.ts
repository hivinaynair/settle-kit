import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { parseJourneys, validate } from "../.agents/skills/journeys/scripts/journeys.ts";
import {
  openQuestionRefs,
  parseDecisions,
  requiredIds,
  taskOwners,
  testCitations,
  traceableIds,
} from "./journey.ts";

const spec = (body: string) => {
  const { spec, errors } = parseJourneys(`# Test\n\n## Actors\n- user: User\n\n${body}`);
  expect(errors).toEqual([]);
  return spec;
};
const pay = spec(`## Invariants
- I1 (D21): THE SYSTEM SHALL NOT credit a transfer twice

## J1: Pay
Actor: user · Exits: paid

### J1.S1 Sends (person)
Screen: widget
Basis: D21
- c1: WHEN a transfer arrives THE SYSTEM SHALL show it
→ J1.S2

### J1.S2 Credits (system)
Basis: D21, Q2 · Guards: I1
- c1: WHEN the transfer is safe THE SYSTEM SHALL credit it once
- c2: If the transfer is unsafe: no credit is made.
→ exit paid
`);

describe("parseDecisions", () => {
  const table = [
    "| ID | Decision | Why | Rejected | Date | Supersedes |",
    "|---|---|---|---|---|---|",
    "| D8 | Old rule | | | | |",
    "| D21 | New rule | | | | D8 |",
    "| X11 | No checkout orders | |",
    "| Q2 | Which chain? | |",
  ].join("\n");

  it("reads table rows; a row named under Supersedes is superseded", () => {
    const d = parseDecisions(table);
    expect(d.get("D21")?.status).toBe("accepted");
    expect(d.get("D8")?.status).toBe("superseded");
    expect(d.get("X11")?.status).toBe("accepted");
    expect(d.get("Q2")?.status).toBe("open");
  });

  it("reads the real decisions record", async () => {
    const d = parseDecisions(await Bun.file(join(import.meta.dir, "../docs/decisions.md")).text());
    expect(d.get("D21")?.status).toBe("accepted");
    expect(d.size).toBeGreaterThan(50);
  });
});

describe("taskOwners", () => {
  const task = (id: string, owns: string) => ({
    path: `docs/tasks/${id}.md`,
    text: `# ${id}: Title\n\n- Primary journey ownership: ${owns}.\n`,
  });

  it("maps each owned step to its task", () => {
    const { owners, errors } = taskOwners([task("M1.T1", "J1.S1, J1.S2")], pay);
    expect(errors).toEqual([]);
    expect(owners.get("J1.S2")).toBe("M1.T1");
  });

  it("rejects unknown steps and a step with two owners", () => {
    const { errors } = taskOwners([task("M1.T1", "J1.S1, J9.S1"), task("M1.T2", "J1.S1")], pay);
    expect(errors).toEqual([
      "docs/tasks/M1.T1.md: owns unknown step J9.S1",
      "J1.S1: owned by both M1.T1 and M1.T2",
    ]);
  });
});

describe("citations", () => {
  it("knows every criterion and invariant; requires owned criteria and all invariants", () => {
    expect(traceableIds(pay)).toEqual(["J1.S1.c1", "J1.S2.c1", "J1.S2.c2", "I1"]);
    expect(requiredIds(pay, new Map([["J1.S2", "M1.T1"]]))).toEqual(["I1", "J1.S2.c1", "J1.S2.c2"]);
  });

  it("lists steps that still rely on open questions", () => {
    expect(openQuestionRefs(pay, parseDecisions("| Q2 | Which chain? |"))).toEqual([
      "J1.S2 cites Q2",
    ]);
  });
});

describe("testCitations", () => {
  const index = parseDecisions(
    "| ID | Decision | Why | Rejected | Date | Supersedes |\n| D8 | a | | | | |\n| D21 | b | | | | D8 |",
  );
  const file = (text: string) => [{ path: "packages/x/a.test.ts", text }];

  it("accepts tests named after criteria, invariants or a live decision", () => {
    const text = [
      'it("J2.S4.c1: does not settle a short payment", () => {});',
      "test('D21: rejects a receipt above the safe block', () => {});",
      'it.each(cases)("J1.S2b.c1, J1.S2b.c2: retries %s", () => {});',
      'it("I1: never credits a transfer twice under any ordering", () => {});',
      'expect(/x/.test("not a test title")).toBe(true);',
    ].join("\n");
    const { problems, cited } = testCitations(file(text), index);
    expect(problems).toEqual([]);
    expect([...cited].sort()).toEqual(["I1", "J1.S2b.c1", "J1.S2b.c2", "J2.S4.c1"]);
  });

  it("rejects untraced, step-level, unknown and superseded titles", () => {
    const text = [
      'it("parses amounts", () => {});',
      'it("D99: something", () => {});',
      'it("D8: old rule", () => {});',
      'test("J2.S4.c1 missing colon", () => {});',
      'it("J2.S4: names the step, not the rule", () => {});',
      'it.each(rows)("untraced %s", () => {});',
    ].join("\n");
    const { problems } = testCitations(file(text), index);
    expect(problems).toHaveLength(6);
    expect(problems[0]).toContain('"parses amounts" must start with');
    expect(problems[1]).toContain("D99, which is not in docs/decisions.md");
    expect(problems[2]).toContain("D8, which was superseded");
    expect(problems[4]).toContain('"J2.S4: names the step, not the rule" must start with');
  });
});

describe("Settle Kit spec", () => {
  it("is valid against the decisions record and every step has one owner", async () => {
    const root = join(import.meta.dir, "..");
    const { spec: real, errors } = parseJourneys(
      await Bun.file(join(root, "docs/journeys/settle-kit.md")).text(),
    );
    expect(errors).toEqual([]);
    const decisions = parseDecisions(await Bun.file(join(root, "docs/decisions.md")).text());
    expect(validate(real, decisions).errors).toEqual([]);
    const tasks = [];
    for await (const name of new Bun.Glob("M*.md").scan(join(root, "docs/tasks")))
      tasks.push({ path: name, text: await Bun.file(join(root, "docs/tasks", name)).text() });
    const { owners, errors: ownership } = taskOwners(tasks, real);
    expect(ownership).toEqual([]);
    expect(owners.size).toBe(real.journeys.flatMap((j) => j.steps).length);
  });
});
