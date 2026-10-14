import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import {
  checkJourneyCitations,
  citedStepIds,
  nextEdges,
  render,
  requiredStepIds,
  type Spine,
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
        steps: [{ id: "J1.S1", title: "a", criteria: ["the order gets paid"] }],
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
            criteria: [
              "WHEN a fill is verified THE SYSTEM SHALL settle once",
              "IF the amount differs THE SYSTEM SHALL NOT settle",
              "WHILE no payment is seen THE SYSTEM SHALL keep the order pending",
            ],
          },
        ],
      },
    ]);
    expect(warnings.filter((w) => !w.startsWith("surface"))).toEqual([]);
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
});

describe("citations", () => {
  const spine: Spine = {
    product: "t",
    journeys: [
      {
        id: "J1",
        title: "x",
        steps: [
          { id: "J1.S1", title: "a", criteria: ["THE SYSTEM SHALL a"] },
          { id: "J1.S2", title: "b" },
        ],
      },
    ],
    tasks: [{ id: "M1.T1", title: "t", serves: ["J1.S1", "J1.S2"] }],
  };

  it("requires only served steps with criteria", () => {
    expect(requiredStepIds(spine)).toEqual(["J1.S1"]);
  });

  it("finds unknown citations always and missing ones only when complete", () => {
    const cited = citedStepIds(['it("J1.S1: a")', 'it("J9.S1: stray")']);
    const base = { known: ["J1.S1", "J1.S2"], required: ["J1.S1", "J1.S2"], cited };
    expect(checkJourneyCitations({ ...base, complete: false })).toEqual({
      unknown: ["J9.S1"],
      missing: [],
    });
    expect(checkJourneyCitations({ ...base, complete: true }).missing).toEqual(["J1.S2"]);
  });
});

describe("example spine", () => {
  it("is valid with no warnings", async () => {
    const path = join(import.meta.dir, "../.agents/skills/journeys/example.yaml");
    const spine = Bun.YAML.parse(await Bun.file(path).text()) as Spine;
    expect(validateSpine(spine)).toEqual({ errors: [], warnings: [] });
  });
});
