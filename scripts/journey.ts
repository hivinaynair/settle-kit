#!/usr/bin/env bun
/**
 * journey.ts: check Settle Kit's journey spec, task ownership and test citations.
 *
 *   bun scripts/journey.ts check [docs/journeys] [--complete] [--verbose]
 *
 * The journey format and its checker live in `.agents/skills/journeys`. This script adds
 * what is specific to Settle Kit:
 * - decisions come from the `docs/decisions.md` tables (no Status column; a row is replaced
 *   when a later row names it under Supersedes);
 * - each task file's "Primary journey ownership:" line assigns steps; a step has one owner;
 * - every test in apps/ and packages/ is named after the criterion (`J2.S4.c1: …`), invariant
 *   (`I1: …`) or money/security decision (`D21: …`) it proves. `--complete` (release gate)
 *   also fails when a criterion of an owned step, or any invariant, has no test, or a step
 *   still relies on an open question.
 */
import {
  type Decision,
  parseJourneys,
  parseDecisions as parseRecord,
  type Spec,
  validate,
} from "../.agents/skills/journeys/scripts/journeys.ts";

const TRACE_ID = /^(?:J\d+\.S\d+[a-z]?\.c\d+|I\d+|D\d+)$/;

/** Reads table rows that start with an ID (`| D7 | Decision | … | Supersedes |`). */
export function parseDecisions(markdown: string): Map<string, Decision> {
  const rows: { id: string; text: string; supersedes: string[] }[] = [];
  let supersedesColumn = -1;
  for (const line of markdown.split("\n")) {
    const cells = line
      .trim()
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells[0] === "ID") supersedesColumn = cells.indexOf("Supersedes");
    if (!/^[DXQ]\d+$/.test(cells[0] ?? "")) continue;
    const supersedes = supersedesColumn > 0 ? (cells[supersedesColumn] ?? "") : "";
    rows.push({ id: cells[0], text: cells[1] ?? "", supersedes: supersedes.match(/D\d+/g) ?? [] });
  }
  const replaced = new Set(rows.flatMap((r) => r.supersedes));
  const status = (id: string) =>
    id.startsWith("Q") ? "open" : replaced.has(id) ? "superseded" : "accepted";
  const record = rows.map(
    (r) =>
      `- ${r.id} ${status(r.id)} — ${r.text}${r.supersedes.length ? ` Supersedes: ${r.supersedes.join(", ")}` : ""}`,
  );
  return parseRecord(record.join("\n")).decisions;
}

/** Step → owning task, from each task file's "Primary journey ownership:" line. */
export function taskOwners(
  files: { path: string; text: string }[],
  spec: Spec,
): { owners: Map<string, string>; errors: string[] } {
  const steps = new Set(spec.journeys.flatMap((j) => j.steps.map((s) => s.id)));
  const owners = new Map<string, string>();
  const errors: string[] = [];
  for (const { path, text } of files) {
    const task = text.match(/^# (M\d+\.T\d+[a-z]?):/m)?.[1];
    const line = text.match(/^- Primary journey ownership:\s*(.+)$/m)?.[1];
    if (!task || !line) continue;
    for (const id of line.match(/J\d+\.S\d+[a-z]?/g) ?? []) {
      if (!steps.has(id)) errors.push(`${path}: owns unknown step ${id}`);
      else if (owners.has(id)) errors.push(`${id}: owned by both ${owners.get(id)} and ${task}`);
      else owners.set(id, task);
    }
  }
  return { owners, errors };
}

/** Criteria and invariants a test may cite. */
export function traceableIds(spec: Spec): string[] {
  return [
    ...spec.journeys.flatMap((j) =>
      j.steps.flatMap((s) => s.criteria.map(([key]) => `${s.id}.${key}`)),
    ),
    ...spec.invariants.map((i) => i.id),
  ];
}

/** At release, every criterion of an owned step, and every invariant, has a test. */
export function requiredIds(spec: Spec, owners: Map<string, string>): string[] {
  const ids = new Set(spec.invariants.map((i) => i.id));
  for (const j of spec.journeys)
    for (const s of j.steps)
      if (owners.has(s.id)) for (const [key] of s.criteria) ids.add(`${s.id}.${key}`);
  return [...ids].sort();
}

/** Steps and invariants that cite an open question. Allowed while drafting; they block --complete. */
export function openQuestionRefs(spec: Spec, decisions: Map<string, Decision>): string[] {
  const open = (refs: string[]) => refs.filter((id) => decisions.get(id)?.status === "open");
  return [
    ...spec.invariants.flatMap((i) => open(i.basis).map((q) => `${i.id} cites ${q}`)),
    ...spec.journeys.flatMap((j) =>
      j.steps.flatMap((s) => open([...j.basis, ...s.basis]).map((q) => `${s.id} cites ${q}`)),
    ),
  ];
}

type TestFile = { path: string; text: string };

/**
 * Every product test is traced. Its title starts with what it proves: a journey criterion
 * (`J2.S4.c1: …`), an invariant (`I1: …`) or, for a critical pure helper, the money or
 * security decision it enforces (`D21: …`). Several IDs are comma-separated
 * (`J2.S4.c1, J2.S4.c2: …`). Returns each problem as `<file>: <reason>` and the criterion and
 * invariant IDs cited.
 */
export function testCitations(
  files: TestFile[],
  decisions?: Map<string, Decision>,
): { problems: string[]; cited: Set<string> } {
  const problems: string[] = [];
  const cited = new Set<string>();
  // it("…"), test.skip("…"), it.each(rows)("…"); not regex.test("…").
  const title = /(?<![.\w])(?:it|test)(?:\.\w+)?(?:\([^()]*\))?\(\s*(["'`])((?:\\.|(?!\1).)*?)\1/g;
  for (const { path, text } of files) {
    for (const m of text.matchAll(title)) {
      const name = m[2];
      const ids = name.match(/^([^:]+):\s/)?.[1].split(/,\s*/) ?? [];
      if (!ids.length || !ids.every((id) => TRACE_ID.test(id))) {
        problems.push(
          `${path}: "${name}" must start with the criterion, invariant or decision it proves ("J2.S4.c1: …", "I1: …" or "D21: …")`,
        );
        continue;
      }
      for (const id of ids) {
        if (!id.startsWith("D")) cited.add(id);
        else if (decisions && !decisions.has(id))
          problems.push(`${path}: "${name}" cites ${id}, which is not in docs/decisions.md`);
        else if (decisions?.get(id)?.status === "superseded")
          problems.push(`${path}: "${name}" cites ${id}, which was superseded`);
      }
    }
  }
  return { problems, cited };
}

/** Product test sources. scripts/ is skipped: it tests our tooling, and its fixtures are not citations. */
async function testFiles(): Promise<TestFile[]> {
  const files: TestFile[] = [];
  for (const dir of ["apps", "packages"]) {
    try {
      for await (const path of new Bun.Glob("**/*.{test,spec}.{ts,tsx}").scan(dir)) {
        if (path.includes("node_modules")) continue;
        files.push({ path: `${dir}/${path}`, text: await Bun.file(`${dir}/${path}`).text() });
      }
    } catch {
      // the directory may not exist yet
    }
  }
  return files;
}

async function readAll(glob: string, dir: string): Promise<{ path: string; text: string }[]> {
  const files: { path: string; text: string }[] = [];
  try {
    for await (const name of new Bun.Glob(glob).scan(dir)) {
      const path = `${dir.replace(/\/$/, "")}/${name}`;
      files.push({ path, text: await Bun.file(path).text() });
    }
  } catch {
    // the directory may not exist yet
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function fail(title: string, lines: string[]): never {
  console.error(`ERROR ${title}`);
  for (const line of lines) console.error(`  ${line}`);
  process.exit(1);
}

if (import.meta.main) {
  const [cmd, target = "docs/journeys", ...rest] = process.argv.slice(2);
  if (cmd !== "check") {
    console.error("usage: bun scripts/journey.ts check [docs/journeys] [--complete] [--verbose]");
    process.exit(2);
  }
  const complete = rest.includes("--complete");
  const verbose = rest.includes("--verbose");
  const specs = await readAll("*.md", target);
  if (!specs.length) {
    console.error(`ok: no journey specs at ${target}; nothing to check.`);
    process.exit(0);
  }
  const decisions = parseDecisions(await Bun.file("docs/decisions.md").text());
  const tasks = await readAll("M*.md", "docs/tasks");
  const known = new Set<string>();
  const required = new Set<string>();
  const blocked: string[] = [];
  for (const { path, text } of specs) {
    const parsed = parseJourneys(text);
    if (parsed.errors.length) fail(`${path} cannot be read:`, parsed.errors);
    const { errors, warnings } = validate(parsed.spec, decisions);
    const { owners, errors: ownership } = taskOwners(tasks, parsed.spec);
    if (errors.length || ownership.length) fail(`${path}:`, [...errors, ...ownership]);
    const unowned = parsed.spec.journeys.flatMap((j) =>
      j.steps.filter((s) => !owners.has(s.id)).map((s) => s.id),
    );
    if (unowned.length) warnings.push(`steps no task owns: ${unowned.join(", ")}`);
    for (const w of verbose ? warnings : warnings.slice(0, 5)) console.error(`warn ${path}: ${w}`);
    if (!verbose && warnings.length > 5)
      console.error(`warn ${path}: ${warnings.length - 5} more; use --verbose for all.`);
    for (const id of traceableIds(parsed.spec)) known.add(id);
    for (const id of requiredIds(parsed.spec, owners)) required.add(id);
    blocked.push(...openQuestionRefs(parsed.spec, decisions));
  }

  const { problems, cited } = testCitations(await testFiles(), decisions);
  if (problems.length)
    fail(
      "product tests must prove a journey criterion, an invariant or a money/security decision:",
      problems,
    );
  const unknown = [...cited].filter((id) => !known.has(id)).sort();
  if (unknown.length)
    fail("tests cite criteria or invariants that are not in any journey:", unknown);
  if (complete && blocked.length)
    fail("steps or invariants still rely on open questions in docs/decisions.md:", blocked);
  const missing = complete ? [...required].filter((id) => !cited.has(id)).sort() : [];
  if (missing.length)
    fail("criteria of owned steps, or invariants, have no test:", [
      ...missing,
      'Name the test after what it proves, e.g. it("J2.S4.c1: reads at the safe block").',
    ]);
  console.error(
    `ok: ${specs.length} journey spec(s) valid; ${cited.size} cited criteria and invariants resolve.${complete ? " Release gate passed." : ""}`,
  );
}
