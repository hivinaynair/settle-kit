import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import {
  checkJourneyCitations,
  nextEdges,
  openQuestionSteps,
  parseDecisions,
  render,
  requiredIds,
  type Spine,
  testCitations,
  traceableIds,
  vagueWords,
  validateSpine,
} from "./journey.ts";

const base = {
  product: "test",
  actors: [{ id: "buyer", name: "Buyer" }],
  surfaces: [{ id: "checkout", kind: "component", states: ["pay", "paid"] }],
};

const ok = (steps: Spine["journeys"]) => validateSpine({ ...base, journeys: steps });

describe("nextEdges", () => {
  it("keeps a bare id and labeled edges", () => {
    expect(nextEdges({ id: "J1.S1", title: "a", next: "J1.S2" })).toEqual([{ to: "J1.S2" }]);
    expect(
      nextEdges({ id: "J1.S1", title: "a", next: [{ to: "J1.S2", when: "verified" }] }),
    ).toEqual([{ to: "J1.S2", when: "verified" }]);
  });
});

describe("validateSpine", () => {
  it("accepts script, human and external buckets and rejects others", () => {
    const { errors } = ok([
      {
        id: "J1",
        title: "Pay",
        actor: "buyer",
        goal: "Pay",
        exits: [{ id: "paid" }],
        steps: [
          { id: "J1.S1", title: "Send", bucket: "human", next: "J1.S2" },
          { id: "J1.S2", title: "Fill", bucket: "external", next: "J1.S3" },
          {
            id: "J1.S3",
            title: "Paid",
            bucket: "script",
            surface: "checkout",
            state: "paid",
            exit: "paid",
          },
        ],
      },
    ]);
    expect(errors).toEqual([]);
    const bad = ok([
      { id: "J1", title: "x", steps: [{ id: "J1.S1", title: "x", bucket: "judgment" }] },
    ]);
    expect(bad.errors.some((e) => e.includes("bucket must be"))).toBe(true);
  });

  it("requires labels when a step branches", () => {
    const { errors } = ok([
      {
        id: "J1",
        title: "x",
        steps: [
          { id: "J1.S1", title: "a", next: ["J1.S2", "J1.S3"] },
          { id: "J1.S2", title: "b" },
          { id: "J1.S3", title: "c" },
        ],
      },
    ]);
    expect(errors.some((e) => e.includes("label each"))).toBe(true);
  });

  it("rejects unknown surfaces, bad states and a state without a surface", () => {
    const { errors } = ok([
      {
        id: "J1",
        title: "x",
        steps: [
          { id: "J1.S1", title: "a", surface: "nope", next: "J1.S2" },
          { id: "J1.S2", title: "b", surface: "checkout", state: "gone", next: "J1.S3" },
          { id: "J1.S3", title: "c", state: "paid" },
        ],
      },
    ]);
    expect(errors.some((e) => e.includes('unknown surface "nope"'))).toBe(true);
    expect(errors.some((e) => e.includes('state "gone"'))).toBe(true);
    expect(errors.some((e) => e.includes("needs a surface"))).toBe(true);
  });

  it("requires a named exit on each terminal and flags unreachable steps", () => {
    const { errors } = ok([
      {
        id: "J1",
        title: "x",
        exits: [{ id: "done" }],
        steps: [
          { id: "J1.S1", title: "a" },
          { id: "J1.S2", title: "orphan", exit: "done" },
        ],
      },
    ]);
    expect(errors.some((e) => e.includes("must name one"))).toBe(true);
    expect(errors.some((e) => e.includes("unreachable"))).toBe(true);
  });

  it("warns on missing bucket, criteria, exits and non-EARS criteria", () => {
    const { warnings } = ok([
      {
        id: "J1",
        title: "x",
        actor: "buyer",
        goal: "g",
        steps: [{ id: "J1.S1", title: "a", criteria: { c1: "the order gets paid" } }],
      },
    ]);
    expect(warnings.some((w) => w.includes("no bucket"))).toBe(true);
    expect(warnings.some((w) => w.includes("not EARS"))).toBe(true);
    expect(warnings.some((w) => w.includes("no exits"))).toBe(true);
  });

  it("accepts EARS with WHEN, IF, WHILE and SHALL NOT", () => {
    const { warnings } = ok([
      {
        id: "J1",
        title: "x",
        actor: "buyer",
        goal: "g",
        exits: [{ id: "e" }],
        steps: [
          {
            id: "J1.S1",
            title: "a",
            bucket: "script",
            exit: "e",
            criteria: {
              c1: "WHEN a fill is verified THE SYSTEM SHALL settle once",
              c2: "IF the amount differs THE SYSTEM SHALL NOT settle",
              c3: "WHILE no payment is seen THE SYSTEM SHALL keep the order pending",
            },
          },
        ],
      },
    ]);
    expect(warnings.filter((w) => !w.startsWith("surface"))).toEqual([]);
  });

  it("rejects a branch that loops forever while another branch exits", () => {
    const { errors } = ok([
      {
        id: "J1",
        title: "x",
        exits: [{ id: "done" }],
        steps: [
          {
            id: "J1.S1",
            title: "a",
            next: [
              { to: "J1.S2", when: "ok" },
              { to: "J1.S3", when: "retry" },
            ],
          },
          { id: "J1.S2", title: "b", exit: "done" },
          { id: "J1.S3", title: "c", next: "J1.S4" },
          { id: "J1.S4", title: "d", next: "J1.S3" },
        ],
      },
    ]);
    expect(errors.filter((e) => e.includes("never reach an end")).sort()).toEqual([
      "J1.S3: can never reach an end (it only leads into a loop)",
      "J1.S4: can never reach an end (it only leads into a loop)",
    ]);
  });

  it("flags a cycle that nothing reaches from the entry", () => {
    const { errors } = ok([
      {
        id: "J1",
        title: "x",
        steps: [
          { id: "J1.S1", title: "a" },
          { id: "J1.S2", title: "b", next: "J1.S3" },
          { id: "J1.S3", title: "c", next: "J1.S2" },
        ],
      },
    ]);
    expect(errors).toContain("J1.S2: unreachable from J1.S1");
    expect(errors).toContain("J1.S3: unreachable from J1.S1");
  });

  it("rejects duplicate journey ids", () => {
    const { errors } = ok([
      { id: "J1", title: "a", steps: [{ id: "J1.S1", title: "a" }] },
      { id: "J1", title: "b", steps: [{ id: "J1.S2", title: "b" }] },
    ]);
    expect(errors).toContain("J1: duplicate journey id");
  });

  it("once tasks exist, each step with criteria has exactly one task", () => {
    const { errors, warnings } = validateSpine({
      ...base,
      journeys: [
        {
          id: "J1",
          title: "x",
          steps: [
            { id: "J1.S1", title: "a", criteria: { c1: "THE SYSTEM SHALL a" }, next: "J1.S2" },
            { id: "J1.S2", title: "b", criteria: { c1: "THE SYSTEM SHALL b" }, next: "J1.S3" },
            { id: "J1.S3", title: "c" },
          ],
        },
      ],
      tasks: [
        { id: "M1.T1", title: "one", serves: ["J1.S1"] },
        { id: "M1.T2", title: "two", serves: ["J1.S1"] },
      ],
    });
    expect(errors).toContain("J1.S1: served by several tasks (M1.T1, M1.T2); pick one");
    expect(warnings).toContain("J1.S2: has criteria but no task serves it");
    expect(warnings.some((w) => w.startsWith("J1.S3: has criteria"))).toBe(false);
  });

  it("checks task ids and served steps", () => {
    const { errors } = validateSpine({
      ...base,
      journeys: [{ id: "J1", title: "x", steps: [{ id: "J1.S1", title: "a" }] }],
      tasks: [
        { id: "F1", title: "old style", serves: ["J1.S1"] },
        { id: "M1.T1", title: "t", serves: ["J9.S1"] },
      ],
    });
    expect(errors.some((e) => e.includes("must look like M1.T1"))).toBe(true);
    expect(errors.some((e) => e.includes('unknown step "J9.S1"'))).toBe(true);
  });

  it("requires criteria as an ID map with c1-style keys", () => {
    const asList = ok([
      {
        id: "J1",
        title: "x",
        steps: [{ id: "J1.S1", title: "a", criteria: ["THE SYSTEM SHALL a"] as never }],
      },
    ]);
    expect(asList.errors.some((e) => e.includes("criteria must map IDs to rules"))).toBe(true);
    const badKey = ok([
      {
        id: "J1",
        title: "x",
        steps: [{ id: "J1.S1", title: "a", criteria: { first: "THE SYSTEM SHALL a" } }],
      },
    ]);
    expect(badKey.errors).toContain('J1.S1: criterion id "first" must look like c1');
  });

  it("warns on vague words in criteria, ignoring quoted UI copy", () => {
    expect(vagueWords("WHEN paid THE SYSTEM SHALL notify the merchant promptly, etc.")).toEqual([
      "promptly",
      "etc",
    ]);
    expect(vagueWords('WHEN paid THE SYSTEM SHALL show "Should arrive soon"')).toEqual([]);
    const { warnings } = ok([
      {
        id: "J1",
        title: "x",
        steps: [
          {
            id: "J1.S1",
            title: "a",
            criteria: { c1: "WHEN paid THE SYSTEM SHALL respond quickly" },
          },
        ],
      },
    ]);
    expect(warnings.some((w) => w.startsWith("J1.S1.c1: vague words (quickly)"))).toBe(true);
  });

  it("checks invariants: format, rule, citations by steps and unused ones", () => {
    const { errors, warnings } = validateSpine({
      ...base,
      invariants: [
        { id: "I1", title: "once", rule: "THE SYSTEM SHALL NOT credit a transfer twice" },
        { id: "I2", title: "unused", rule: "THE SYSTEM SHALL NOT credit more than arrived" },
        { id: "INV3", title: "bad", rule: "" },
      ],
      journeys: [
        {
          id: "J1",
          title: "x",
          steps: [{ id: "J1.S1", title: "a", invariants: ["I1", "I9"] }],
        },
      ],
    });
    expect(errors).toContain("INV3: invariant id must look like I1");
    expect(errors).toContain("INV3: invariant needs a rule");
    expect(errors).toContain('J1.S1: unknown invariant "I9"');
    expect(warnings).toContain(
      "invariant I2: no step lists it; add it to the steps that could break it",
    );
  });

  it("requires an IF criterion on a step that touches money", () => {
    const index = parseDecisions(
      "## Money rules (D20–D29)\n| D21 | Credit at safe | | | | |\n## Architecture\n| D31 | Tick | | | | |",
    );
    const step = (decisions: string[], criteria: Record<string, string>) =>
      validateSpine(
        {
          ...base,
          journeys: [
            { id: "J1", title: "x", steps: [{ id: "J1.S1", title: "a", decisions, criteria }] },
          ],
        },
        index,
      ).warnings.filter((w) => w.includes("touches money"));
    const when = { c1: "WHEN a fill arrives THE SYSTEM SHALL verify it" };
    expect(step(["D21"], when)).toHaveLength(1);
    expect(step(["D31"], when)).toEqual([]);
    expect(
      step(["D21"], { ...when, c2: "IF the amount differs THE SYSTEM SHALL NOT settle" }),
    ).toEqual([]);
  });
});

describe("render", () => {
  it("labels branches, lists exits and surfaces", () => {
    const md = render({
      ...base,
      journeys: [
        {
          id: "J1",
          title: "Pay",
          exits: [{ id: "paid", title: "Paid" }],
          steps: [
            {
              id: "J1.S1",
              title: "Verify",
              bucket: "script",
              next: [{ to: "J1.S2", when: "verified" }],
            },
            { id: "J1.S2", title: "Paid", surface: "checkout", state: "paid", exit: "paid" },
          ],
        },
      ],
    });
    expect(md).toContain('|"verified"|');
    expect(md).toContain("| `paid` |");
    expect(md).toContain("## Surfaces");
    expect(md.endsWith("\n")).toBe(true);
  });

  it("shows criterion IDs, invariants and what each step cites", () => {
    const md = render({
      ...base,
      invariants: [{ id: "I1", title: "Once", rule: "THE SYSTEM SHALL NOT credit twice" }],
      journeys: [
        {
          id: "J1",
          title: "Pay",
          steps: [
            {
              id: "J1.S1",
              title: "Settle",
              decisions: ["D21"],
              invariants: ["I1"],
              criteria: { c1: "IF seen twice THE SYSTEM SHALL NOT settle again" },
            },
          ],
        },
      ],
    });
    expect(md).toContain("| `I1` | Once | THE SYSTEM SHALL NOT credit twice | — | `J1.S1` |");
    expect(md).toContain("**`J1.S1`** Settle · decisions D21 · invariants I1");
    expect(md).toContain("- `J1.S1.c1` IF seen twice THE SYSTEM SHALL NOT settle again");
  });

  it("links the design doc relative to the generated file", () => {
    const spine = { ...base, source: "docs/plans/2026-10-15-settle-kit-design.md", journeys: [] };
    expect(render(spine, "docs/journeys/settle-kit.md")).toContain(
      "Design doc: [docs/plans/2026-10-15-settle-kit-design.md](../plans/2026-10-15-settle-kit-design.md)",
    );
  });
});

describe("citations", () => {
  const spine: Spine = {
    product: "t",
    invariants: [{ id: "I1", rule: "THE SYSTEM SHALL NOT credit twice" }],
    journeys: [
      {
        id: "J1",
        title: "x",
        steps: [
          {
            id: "J1.S1",
            title: "a",
            criteria: { c1: "THE SYSTEM SHALL a", c2: "THE SYSTEM SHALL b" },
          },
          { id: "J1.S2", title: "b", criteria: { c1: "THE SYSTEM SHALL c" } },
        ],
      },
    ],
    tasks: [{ id: "M1.T1", title: "t", serves: ["J1.S1"] }],
  };

  it("knows every criterion and invariant; requires served criteria and all invariants", () => {
    expect(traceableIds(spine)).toEqual(["J1.S1.c1", "J1.S1.c2", "J1.S2.c1", "I1"]);
    expect(requiredIds(spine)).toEqual(["I1", "J1.S1.c1", "J1.S1.c2"]);
  });

  it("finds unknown citations always and missing ones only when complete", () => {
    const { cited } = testCitations([
      {
        path: "a.test.ts",
        text: 'it("J1.S1.c1, I1: a", () => {}); it("J9.S1.c1: stray", () => {});',
      },
    ]);
    const args = { known: traceableIds(spine), required: requiredIds(spine), cited };
    expect(checkJourneyCitations({ ...args, complete: false })).toEqual({
      unknown: ["J9.S1.c1"],
      missing: [],
    });
    expect(checkJourneyCitations({ ...args, complete: true }).missing).toEqual(["J1.S1.c2"]);
  });
});

describe("decisions", () => {
  const md = [
    "| ID | Decision | Why | Rejected | Date | Supersedes |",
    "|---|---|---|---|---|---|",
    "| D8 | Use Workflow SDK | x | | 2026-10-13 | |",
    "| D31 | DB-driven tick | y | | 2026-10-14 | D8 |",
    "| X1 | Card onramps | KYC |",
    "| Q2 | Switch route? | Yes | J2.S2 | Vinay |",
  ].join("\n");
  const index = parseDecisions(md);

  it("reads IDs and superseded rows from markdown tables", () => {
    expect([...index.ids].sort()).toEqual(["D31", "D8", "Q2", "X1"]);
    expect([...index.superseded]).toEqual(["D8"]);
  });

  it("marks rows under a Money heading as money decisions", () => {
    const money = parseDecisions(
      "## Money rules\n| D21 | a | | | | |\n## SDK\n| D41 | b | | | | |",
    );
    expect([...money.money]).toEqual(["D21"]);
  });

  it("rejects unknown, superseded and malformed citations", () => {
    const step = (decisions: string[]) => ({
      ...base,
      journeys: [{ id: "J1", title: "x", steps: [{ id: "J1.S1", title: "a", decisions }] }],
    });
    expect(validateSpine(step(["D31", "X1", "Q2"]), index).errors).toEqual([]);
    const { errors } = validateSpine(step(["D99", "D8", "decision-1"]), index);
    expect(errors.some((e) => e.includes("D99 is not in docs/decisions.md"))).toBe(true);
    expect(errors.some((e) => e.includes("D8 was superseded"))).toBe(true);
    expect(errors.some((e) => e.includes("must look like"))).toBe(true);
  });

  it("lists steps that still rely on open questions", () => {
    const spine: Spine = {
      product: "t",
      journeys: [
        {
          id: "J1",
          title: "x",
          steps: [
            { id: "J1.S1", title: "a", decisions: ["D31"], next: "J1.S2" },
            { id: "J1.S2", title: "b", decisions: ["Q2"] },
          ],
        },
      ],
    };
    expect(openQuestionSteps(spine)).toEqual(["J1.S2 (Q2)"]);
  });
});

describe("example spine", () => {
  it("is valid with no warnings", async () => {
    const path = join(import.meta.dir, "../.agents/skills/journeys/example.yaml");
    const spine = Bun.YAML.parse(await Bun.file(path).text()) as Spine;
    expect(validateSpine(spine)).toEqual({ errors: [], warnings: [] });
  });
});

describe("testCitations", () => {
  const index = parseDecisions("| D8 | a | | | | |\n| D21 | b | | | | D8 |");
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
