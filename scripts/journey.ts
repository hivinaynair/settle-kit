#!/usr/bin/env bun
/**
 * journey.ts: validate, render and check Settle Kit journey spines.
 *
 *   bun scripts/journey.ts validate docs/journeys/settle-kit.yaml   (drafting; warnings are advice)
 *   bun scripts/journey.ts render   docs/journeys                     (writes <name>.md beside each .yaml)
 *   bun scripts/journey.ts check    docs/journeys [--complete]        (merge bar; warnings fail)
 *
 * The .yaml spine is the source of truth for behavior. The .md beside it is generated:
 * never hand-edit it. Each criterion has an ID (`J2.S4.c1`); invariants (`I1`) are rules
 * that hold across every journey. `check` fails when a spine is invalid, has warnings, its
 * .md is stale, or a test is untraced or cites an unknown ID. Once a spine exists, every
 * test in apps/ and packages/ is named after the criterion (`J2.S4.c1: …`), invariant
 * (`I1: …`) or money/security decision (`D21: …`) it proves. `--complete` (release gate)
 * also requires a test for every criterion of a served step and every invariant, and no
 * step or invariant to cite an open question. Decision IDs are read from docs/decisions.md
 * and must exist and not be superseded.
 *
 * Adapted from ViperNxt (github.com/hivinaynair/vipernxt, scripts/journey.ts, MIT):
 * buckets are script | human | external, "screens" are "surfaces" (a component, hook,
 * endpoint, webhook or page), "features" are "tasks", and `check` adds strictness and
 * generated-file freshness.
 */

import { dirname, relative } from "node:path";

type Actor = { id: string; name: string; type?: "person" | "system" | "external" | string };
type Surface = { id: string; kind?: string; states?: string[] };
type Exit = { id: string; title?: string };
export type NextEdge = { to: string; when?: string };
type NextRaw = string | NextEdge;
/** script: our code decides. human: a person acts. external: a party we don't control acts. */
const BUCKETS = new Set(["script", "human", "external"]);
type Step = {
  id: string;
  title: string;
  bucket?: string;
  surface?: string;
  state?: string;
  sees?: string;
  does?: string;
  next?: NextRaw | NextRaw[];
  uses?: string;
  exit?: string;
  /** Decision IDs from docs/decisions.md this step relies on: D (decided), X (out of scope), Q (open). */
  decisions?: string[];
  /** Invariant IDs (I1) this step could break if it were wrong. */
  invariants?: string[];
  /** EARS rules keyed by a permanent ID: `c1: WHEN … THE SYSTEM SHALL …`. Tests cite `J2.S4.c1`. */
  criteria?: Record<string, string>;
};
/** A rule that holds across every journey, every ordering and every crash point. */
type Invariant = { id: string; title?: string; rule: string; decisions?: string[] };
type Journey = {
  id: string;
  title: string;
  actor?: string;
  goal?: string;
  proves?: string;
  reusable?: boolean;
  entry?: string;
  exits?: Exit[];
  steps: Step[];
};
type Task = { id: string; title: string; serves?: string[] };
export type Spine = {
  product?: string;
  source?: string;
  actors?: Actor[];
  surfaces?: Surface[];
  invariants?: Invariant[];
  journeys?: Journey[];
  tasks?: Task[];
};

const STEP_ID = /^J\d+\.S\d+[a-z]?$/;
const DECISION_ID = /^[DXQ]\d+$/;
const INVARIANT_ID = /^I\d+$/;
const CRITERION_KEY = /^c\d+$/;
/** What a test title may cite: a criterion, an invariant or a decision. */
const TRACE_ID = /^(?:J\d+\.S\d+[a-z]?\.c\d+|I\d+|D\d+)$/;

/** IDs found in docs/decisions.md, the D IDs a later row superseded, and those under a "Money" heading. */
export type DecisionIndex = { ids: Set<string>; superseded: Set<string>; money: Set<string> };

/** Reads table rows that start with an ID (`| D7 | … | Supersedes |`). */
export function parseDecisions(markdown: string): DecisionIndex {
  const ids = new Set<string>();
  const superseded = new Set<string>();
  const money = new Set<string>();
  let inMoney = false;
  for (const line of markdown.split("\n")) {
    if (line.startsWith("## ")) inMoney = /money/i.test(line);
    const cells = line
      .trim()
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim());
    const id = cells[0];
    if (!id || !DECISION_ID.test(id)) continue;
    ids.add(id);
    if (inMoney) money.add(id);
    if (id.startsWith("D") && cells.length >= 6)
      for (const ref of cells[cells.length - 1].split(/[,\s]+/))
        if (/^D\d+$/.test(ref)) superseded.add(ref);
  }
  return { ids, superseded, money };
}

/** Steps and invariants that cite an open question (Q…). Allowed while drafting; they block --complete. */
export function openQuestionSteps(spine: Spine): string[] {
  return [...allSteps(spine), ...(spine.invariants ?? [])]
    .filter((s) => s.decisions?.some((d) => d.startsWith("Q")))
    .map((s) => `${s.id} (${s.decisions?.filter((d) => d.startsWith("Q")).join(", ")})`);
}

/** A step's criteria as [key, rule] pairs; anything but a key → rule map yields none. */
export function criteriaOf(s: Step): [string, string][] {
  const c = s.criteria;
  if (!c || typeof c !== "object" || Array.isArray(c)) return [];
  return Object.entries(c).map(([k, v]) => [k, String(v)]);
}

/** Words that make a rule untestable. Text in "double quotes" or `backticks` (UI copy) is ignored. */
const VAGUE =
  /\b(should|promptly|quickly|soon|timely|eventually|appropriate(?:ly)?|reasonabl[ey]|as needed|if possible|etc|and so on|properly|gracefully|seamless(?:ly)?|user-friendly|normally|usually|robust(?:ly)?)\b/gi;

export function vagueWords(rule: string): string[] {
  const text = rule.replace(/"[^"]*"|`[^`]*`/g, "");
  return [...new Set([...text.matchAll(VAGUE)].map((m) => m[1].toLowerCase()))];
}
const TASK_ID = /^M\d+\.T\d+[a-z]?$/;
/** EARS: optional trigger clause, then THE SYSTEM SHALL (or SHALL NOT). */
const EARS = /^((WHEN|IF|WHILE|WHERE)\b.+?\bTHE SYSTEM SHALL\b|THE SYSTEM SHALL\b)/;

export function nextEdges(s: Step): NextEdge[] {
  if (s.next == null) return [];
  const list = Array.isArray(s.next) ? s.next : [s.next];
  const out: NextEdge[] = [];
  for (const n of list) {
    if (typeof n === "string") {
      if (n) out.push({ to: n });
      continue;
    }
    if (n && typeof n === "object") out.push({ to: String(n.to ?? ""), when: n.when });
  }
  return out;
}

export function nexts(s: Step): string[] {
  return nextEdges(s).map((e) => e.to);
}

export function validateSpine(
  spine: Spine,
  decisions?: DecisionIndex,
): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const err = (m: string) => errors.push(m);
  const warn = (m: string) => warnings.push(m);

  if (!spine.product) err("top level: `product` is required");
  if (!spine.journeys?.length) {
    err("top level: at least one journey is required");
    return { errors, warnings };
  }

  const actorIds = new Set((spine.actors ?? []).map((a) => a.id));
  const surfaces = new Map((spine.surfaces ?? []).map((s) => [s.id, s]));
  const journeys = new Map(spine.journeys.map((j) => [j.id, j]));
  const journeyIds = new Set<string>();
  for (const j of spine.journeys) {
    if (journeyIds.has(j.id)) err(`${j.id}: duplicate journey id`);
    journeyIds.add(j.id);
  }
  const stepIds = new Set<string>();
  const usedSurfaces = new Set<string>();
  const usedInvariants = new Set<string>();

  const checkDecisionRefs = (owner: string, refs: string[] | undefined) => {
    for (const d of refs ?? []) {
      if (!DECISION_ID.test(d)) err(`${owner}: decision "${d}" must look like D7, X1 or Q2`);
      else if (decisions && !decisions.ids.has(d))
        err(`${owner}: decision ${d} is not in docs/decisions.md`);
      else if (decisions?.superseded.has(d))
        err(`${owner}: decision ${d} was superseded; cite the decision that replaced it`);
    }
  };
  const checkRule = (owner: string, rule: string) => {
    if (!EARS.test(rule))
      warn(
        `${owner}: criterion is not EARS ("WHEN <trigger> THE SYSTEM SHALL <behavior>"): ${rule.slice(0, 60)}`,
      );
    const vague = vagueWords(rule);
    if (vague.length)
      warn(`${owner}: vague words (${vague.join(", ")}); say exactly what, with a number and unit`);
  };

  const invariantIds = new Set<string>();
  for (const inv of spine.invariants ?? []) {
    if (!INVARIANT_ID.test(inv.id)) err(`${inv.id}: invariant id must look like I1`);
    if (invariantIds.has(inv.id)) err(`${inv.id}: duplicate invariant id`);
    invariantIds.add(inv.id);
    if (!inv.rule) err(`${inv.id}: invariant needs a rule`);
    else checkRule(inv.id, inv.rule);
    checkDecisionRefs(inv.id, inv.decisions);
  }

  for (const j of spine.journeys) {
    if (!/^J\d+$/.test(j.id)) err(`${j.id}: journey id must look like J1`);
    if (!j.steps?.length) {
      err(`${j.id}: has no steps`);
      continue;
    }
    if (!j.actor) warn(`${j.id}: no actor`);
    else if (!actorIds.has(j.actor)) err(`${j.id}: unknown actor "${j.actor}"`);
    if (!j.goal) warn(`${j.id}: no goal`);

    const local = new Set(j.steps.map((s) => s.id));
    const exitIds = new Set((j.exits ?? []).map((e) => e.id));
    for (const e of j.exits ?? []) if (!e.id) err(`${j.id}: exit is missing id`);
    if (j.entry && !local.has(j.entry)) err(`${j.id}: entry "${j.entry}" is not a step of ${j.id}`);

    for (const s of j.steps) {
      if (stepIds.has(s.id)) err(`${s.id}: duplicate step id`);
      stepIds.add(s.id);
      if (!s.id.startsWith(`${j.id}.`)) err(`${s.id}: step id must be prefixed with "${j.id}."`);
      if (!STEP_ID.test(s.id)) err(`${s.id}: step id must look like ${j.id}.S1 or ${j.id}.S2b`);
      if (!s.title) err(`${s.id}: missing title`);

      if (!s.bucket && !s.uses) warn(`${s.id}: no bucket (script, human or external)`);
      else if (s.bucket && !BUCKETS.has(s.bucket))
        err(`${s.id}: bucket must be script, human or external`);

      if (s.surface) {
        usedSurfaces.add(s.surface);
        const sf = surfaces.get(s.surface);
        if (!sf) err(`${s.id}: unknown surface "${s.surface}"`);
        else if (s.state && sf.states?.length && !sf.states.includes(s.state))
          err(
            `${s.id}: state "${s.state}" is not one of surface ${s.surface}'s states (${sf.states.join(", ")})`,
          );
      } else if (s.state) err(`${s.id}: state "${s.state}" needs a surface`);

      const edges = nextEdges(s);
      for (const e of edges) {
        if (!e.to) err(`${s.id}: next entry is missing to`);
        else if (e.to === s.id) err(`${s.id}: next points at itself`);
        else if (!local.has(e.to)) err(`${s.id}: next "${e.to}" is not a step of ${j.id}`);
      }
      if (edges.length > 1 && edges.some((e) => !e.when))
        err(`${s.id}: a step with several next steps must label each with when`);

      if (s.uses) {
        const child = journeys.get(s.uses);
        if (!child) err(`${s.id}: uses unknown journey "${s.uses}"`);
        else if (child.id === j.id) err(`${s.id}: uses itself`);
        else {
          if (!child.reusable)
            warn(`${s.id}: uses ${child.id}, which is not marked reusable: true`);
          const childExits = (child.exits ?? []).map((e) => e.id).filter(Boolean);
          if (!edges.length && !s.exit) {
            err(`${s.id}: uses ${child.id} but has no next mapping and no exit`);
          } else if (childExits.length && edges.length) {
            const unlabeled = edges.filter((e) => !e.when);
            if (!(unlabeled.length === 1 && edges.length === 1)) {
              const mapped = new Set(edges.map((e) => e.when).filter(Boolean));
              for (const ex of childExits)
                if (!mapped.has(ex))
                  err(`${s.id}: uses ${child.id} but exit "${ex}" is not mapped on next.when`);
            }
          }
        }
      }

      if (s.exit) {
        if (edges.length) err(`${s.id}: exit and next cannot both be set`);
        if (!j.exits?.length) err(`${s.id}: names exit "${s.exit}" but ${j.id} has no exits:`);
        else if (!exitIds.has(s.exit)) err(`${s.id}: unknown exit "${s.exit}"`);
      }

      checkDecisionRefs(s.id, s.decisions);
      for (const i of s.invariants ?? []) {
        if (!invariantIds.has(i)) err(`${s.id}: unknown invariant "${i}"`);
        usedInvariants.add(i);
      }

      if (s.criteria != null && (typeof s.criteria !== "object" || Array.isArray(s.criteria)))
        err(`${s.id}: criteria must map IDs to rules (c1: WHEN … THE SYSTEM SHALL …)`);
      const criteria = criteriaOf(s);
      for (const [key, rule] of criteria) {
        if (!CRITERION_KEY.test(key)) err(`${s.id}: criterion id "${key}" must look like c1`);
        checkRule(`${s.id}.${key}`, rule);
      }
      if (!criteria.length && !s.uses) warn(`${s.id}: no acceptance criteria`);

      // Money steps state the unwanted case: what must not happen when it goes wrong.
      const money = [
        ...(s.decisions ?? []).filter((d) => decisions?.money.has(d)),
        ...(s.invariants ?? []),
      ];
      if (money.length && !criteria.some(([, rule]) => /^IF\b/.test(rule)))
        warn(
          `${s.id}: touches money (${money.join(", ")}) but has no IF criterion; add "IF <what goes wrong> THE SYSTEM SHALL NOT …"`,
        );
    }

    if (!j.exits?.length) warn(`${j.id}: no exits declared; name how the journey can end`);
    else {
      for (const s of j.steps.filter((x) => nexts(x).length === 0))
        if (!s.exit) err(`${s.id}: ${j.id} declares exits; this terminal step must name one`);
      const hit = new Set(j.steps.map((s) => s.exit).filter(Boolean));
      for (const e of j.exits)
        if (e.id && !hit.has(e.id)) warn(`${j.id}: exit "${e.id}" is never named by a step`);
    }

    const start = j.entry && local.has(j.entry) ? j.entry : j.steps[0]?.id;
    for (const id of unreachableSteps(j, start)) err(`${id}: unreachable from ${start}`);
    if (!j.steps.some((s) => nexts(s).length === 0))
      err(`${j.id}: no terminal step (every step has a next)`);
    else
      for (const id of stuckSteps(j, start))
        err(`${id}: can never reach an end (it only leads into a loop)`);
  }

  const taskIds = new Set<string>();
  for (const t of spine.tasks ?? []) {
    if (!TASK_ID.test(t.id)) err(`${t.id}: task id must look like M1.T1`);
    if (taskIds.has(t.id)) err(`${t.id}: duplicate task id`);
    taskIds.add(t.id);
    if (!t.serves?.length) warn(`${t.id}: serves no journey step`);
    for (const ref of t.serves ?? [])
      if (!stepIds.has(ref)) err(`${t.id}: serves unknown step "${ref}"`);
  }

  // Once tasks exist, each step with criteria belongs to exactly one task.
  if (spine.tasks?.length) {
    const owners = new Map<string, string[]>();
    for (const t of spine.tasks)
      for (const ref of new Set(t.serves ?? []))
        owners.set(ref, [...(owners.get(ref) ?? []), t.id]);
    for (const step of spine.journeys.flatMap((j) => j.steps ?? [])) {
      const by = owners.get(step.id) ?? [];
      if (by.length > 1) err(`${step.id}: served by several tasks (${by.join(", ")}); pick one`);
      else if (!by.length && criteriaOf(step).length)
        warn(`${step.id}: has criteria but no task serves it`);
    }
  }

  for (const sf of spine.surfaces ?? [])
    if (!usedSurfaces.has(sf.id)) warn(`surface ${sf.id}: never used by any journey step`);
  for (const id of invariantIds)
    if (!usedInvariants.has(id))
      warn(`invariant ${id}: no step lists it; add it to the steps that could break it`);

  return { errors, warnings };
}

/** Steps not reachable from the journey's entry by following `next`. */
function unreachableSteps(j: Journey, start: string | undefined): string[] {
  const byId = new Map(j.steps.map((s) => [s.id, s]));
  const seen = new Set<string>();
  const queue = start ? [start] : [];
  while (queue.length) {
    const id = queue.pop() as string;
    if (seen.has(id) || !byId.has(id)) continue;
    seen.add(id);
    queue.push(...nexts(byId.get(id) as Step));
  }
  return j.steps.map((s) => s.id).filter((id) => !seen.has(id));
}

/** Reachable steps from which no path leads to a terminal step (trapped in a cycle). */
function stuckSteps(j: Journey, start: string | undefined): string[] {
  const canEnd = new Set(j.steps.filter((s) => nexts(s).length === 0).map((s) => s.id));
  let grew = true;
  while (grew) {
    grew = false;
    for (const s of j.steps)
      if (!canEnd.has(s.id) && nexts(s).some((n) => canEnd.has(n))) {
        canEnd.add(s.id);
        grew = true;
      }
  }
  const unreachable = new Set(unreachableSteps(j, start));
  return j.steps.map((s) => s.id).filter((id) => !canEnd.has(id) && !unreachable.has(id));
}

const esc = (t: string) => t.replace(/"/g, "'").replace(/\|/g, "\\|");
const cell = (t?: string) => (t ? esc(t) : "—");

function nextCell(s: Step): string {
  const parts: string[] = [];
  if (s.uses) parts.push(`uses \`${s.uses}\``);
  for (const e of nextEdges(s)) parts.push(e.when ? `\`${e.to}\` · ${esc(e.when)}` : `\`${e.to}\``);
  if (s.exit) parts.push(`exit \`${s.exit}\``);
  return parts.join("; ") || "—";
}

/** `mdFile` is where the output will live, so the design-doc link resolves from there. */
export function render(spine: Spine, mdFile?: string): string {
  const out: string[] = [];
  const actors = new Map((spine.actors ?? []).map((a) => [a.id, a]));

  out.push(`# ${spine.product ?? "Product"}: journey spine`, "");
  out.push("<!-- Generated by scripts/journey.ts. Edit the .yaml spine, not this file. -->", "");
  if (spine.source) {
    const href = mdFile ? relative(dirname(mdFile), spine.source) : spine.source;
    out.push(`Design doc: [${spine.source}](${href})`, "");
  }

  if (spine.actors?.length) {
    out.push("## Actors", "", "| ID | Actor | Type |", "|---|---|---|");
    for (const a of spine.actors)
      out.push(`| \`${a.id}\` | ${esc(a.name)} | ${a.type ?? "person"} |`);
    out.push("");
  }

  if (spine.invariants?.length) {
    out.push(
      "## Invariants",
      "",
      "Rules that hold across every journey, ordering and crash point. Tests cite `I1: …`.",
      "",
      "| ID | Invariant | Rule | Decisions | Steps that could break it |",
      "|---|---|---|---|---|",
    );
    for (const inv of spine.invariants) {
      const steps = allSteps(spine)
        .filter((s) => s.invariants?.includes(inv.id))
        .map((s) => `\`${s.id}\``);
      out.push(
        `| \`${inv.id}\` | ${cell(inv.title)} | ${esc(inv.rule ?? "")} | ${inv.decisions?.join(", ") || "—"} | ${steps.join(" ") || "—"} |`,
      );
    }
    out.push("");
  }

  for (const j of spine.journeys ?? []) {
    const who = j.actor ? (actors.get(j.actor)?.name ?? j.actor) : "—";
    out.push(`## ${j.id} · ${esc(j.title)}`, "");
    out.push(`**Actor:** ${esc(who)}  `);
    if (j.goal) out.push(`**Goal:** ${esc(j.goal)}  `);
    if (j.proves) out.push(`**Proves:** ${esc(j.proves)}  `);
    if (j.reusable) out.push("Reusable sub-journey: other journeys include it with `uses`.  ");
    if (j.entry) out.push(`**Entry:** \`${j.entry}\`  `);
    out.push("");
    if (j.exits?.length) {
      out.push("| Exit | Title | Named by |", "|---|---|---|");
      for (const e of j.exits) {
        const named = j.steps.filter((s) => s.exit === e.id).map((s) => `\`${s.id}\``);
        out.push(`| \`${e.id}\` | ${esc(e.title ?? "") || "—"} | ${named.join(" ") || "—"} |`);
      }
      out.push("");
    }

    out.push("```mermaid", "flowchart LR");
    for (const s of j.steps) {
      const where = s.surface ? `${s.surface}${s.state ? ` · ${s.state}` : ""}` : "";
      const small = [s.bucket, where, s.uses ? `uses ${s.uses}` : ""].filter(Boolean).join(" · ");
      const label = small ? `${esc(s.title)}<br/><small>${small}</small>` : esc(s.title);
      out.push(`  ${s.id.replace(".", "_")}["${label}"]`);
    }
    for (const s of j.steps) {
      for (const e of nextEdges(s)) {
        const from = s.id.replace(".", "_");
        const to = e.to.replace(".", "_");
        out.push(e.when ? `  ${from} -->|"${esc(e.when)}"| ${to}` : `  ${from} --> ${to}`);
      }
    }
    out.push("```", "");

    out.push(
      "| Step | Bucket | Surface · state | Sees | Does | Next | Criteria |",
      "|---|---|---|---|---|---|---|",
    );
    for (const s of j.steps) {
      const where = s.surface ? `\`${s.surface}\`${s.state ? ` · ${s.state}` : ""}` : "—";
      out.push(
        `| \`${s.id}\` ${esc(s.title)} | ${s.bucket ?? "—"} | ${where} | ${cell(s.sees)} | ${cell(s.does)} | ${nextCell(s)} | ${criteriaOf(s).length} |`,
      );
    }
    out.push("");

    const withCriteria = j.steps.filter((s) => criteriaOf(s).length);
    if (withCriteria.length) {
      out.push(`### ${j.id} acceptance criteria`, "");
      for (const s of withCriteria) {
        const refs = [
          s.decisions?.length ? `decisions ${s.decisions.join(", ")}` : "",
          s.invariants?.length ? `invariants ${s.invariants.join(", ")}` : "",
        ].filter(Boolean);
        out.push(
          `**\`${s.id}\`** ${esc(s.title)}${refs.length ? ` · ${refs.join(" · ")}` : ""}`,
          "",
        );
        for (const [key, rule] of criteriaOf(s)) out.push(`- \`${s.id}.${key}\` ${rule}`);
        out.push("");
      }
    }
  }

  if (spine.surfaces?.length) {
    out.push("## Surfaces", "", "| Surface | Kind | States | Used by |", "|---|---|---|---|");
    for (const sf of spine.surfaces) {
      const used = (spine.journeys ?? [])
        .flatMap((j) => j.steps)
        .filter((s) => s.surface === sf.id)
        .map((s) => `\`${s.id}\``);
      out.push(
        `| \`${sf.id}\` | ${sf.kind ?? "—"} | ${sf.states?.join(", ") ?? "—"} | ${used.join(" ") || "—"} |`,
      );
    }
    out.push("");
  }

  if (spine.tasks?.length) {
    out.push("## Tasks", "", "| Task | Serves | Journeys |", "|---|---|---|");
    for (const t of spine.tasks) {
      const js = [...new Set((t.serves ?? []).map((r) => r.split(".")[0]))].join(", ");
      out.push(
        `| \`${t.id}\` ${esc(t.title)} | ${(t.serves ?? []).map((r) => `\`${r}\``).join(" ") || "—"} | ${js || "—"} |`,
      );
    }
    out.push("");
    const served = new Set(spine.tasks.flatMap((t) => t.serves ?? []));
    const orphans = (spine.journeys ?? []).flatMap((j) => j.steps).filter((s) => !served.has(s.id));
    if (orphans.length)
      out.push(`**Steps no task serves yet:** ${orphans.map((s) => `\`${s.id}\``).join(" ")}`, "");
  }

  return `${out.join("\n").trimEnd()}\n`;
}

/** Every ID a test may cite from this spine: criteria (J2.S4.c1) and invariants (I1). */
export function traceableIds(spine: Spine): string[] {
  return [
    ...allSteps(spine).flatMap((s) => criteriaOf(s).map(([key]) => `${s.id}.${key}`)),
    ...(spine.invariants ?? []).map((i) => i.id),
  ];
}

/** At release, every criterion of a step a task serves, and every invariant, has a test. */
export function requiredIds(spine: Spine): string[] {
  const byId = new Map(allSteps(spine).map((s) => [s.id, s]));
  const ids = new Set<string>((spine.invariants ?? []).map((i) => i.id));
  for (const t of spine.tasks ?? [])
    for (const ref of t.serves ?? []) {
      const step = byId.get(ref);
      if (step) for (const [key] of criteriaOf(step)) ids.add(`${ref}.${key}`);
    }
  return [...ids].sort();
}

function allSteps(spine: Spine): Step[] {
  return (spine.journeys ?? []).flatMap((j) => j.steps ?? []);
}

export function missingIds(required: string[], cited: Set<string>): string[] {
  return required.filter((id) => !cited.has(id));
}

export function unknownCitedIds(cited: Iterable<string>, known: Iterable<string>): string[] {
  const knownSet = known instanceof Set ? known : new Set(known);
  return [...cited].filter((id) => !knownSet.has(id)).sort();
}

export function checkJourneyCitations(opts: {
  known: Iterable<string>;
  required: string[];
  cited: Set<string>;
  complete: boolean;
}): { unknown: string[]; missing: string[] } {
  return {
    unknown: unknownCitedIds(opts.cited, opts.known),
    missing: opts.complete ? missingIds(opts.required, opts.cited) : [],
  };
}

async function loadSpine(path: string): Promise<Spine> {
  try {
    return Bun.YAML.parse(await Bun.file(path).text()) as Spine;
  } catch (e) {
    throw new Error(`could not parse ${path}: ${(e as Error).message}`);
  }
}

/** A .yaml file, or every .yaml directly inside a directory. */
async function spinePaths(target: string): Promise<string[]> {
  const file = Bun.file(target);
  if ((await file.exists()) && (await file.stat()).isFile()) return [target];
  const paths: string[] = [];
  try {
    for await (const name of new Bun.Glob("*.yaml").scan(target))
      paths.push(`${target.replace(/\/$/, "")}/${name}`);
  } catch {
    return [];
  }
  return paths.sort();
}

const mdPath = (yamlPath: string) => yamlPath.replace(/\.yaml$/, ".md");

/** Product test sources. scripts/ is skipped: it tests our tooling, and its fixtures are not citations. */
type TestFile = { path: string; text: string };

/**
 * Every product test is traced. Its title starts with what it proves: a journey criterion
 * (`J2.S4.c1: …`), an invariant (`I1: …`) or, for a critical pure helper, the money or
 * security decision it enforces (`D21: …`). Several IDs are comma-separated
 * (`J2.S4.c1, J2.S4.c2: …`). Returns each problem as `<file>: <reason>` and the criterion and
 * invariant IDs cited; `decisions` checks D IDs when available.
 */
export function testCitations(
  files: TestFile[],
  decisions?: DecisionIndex,
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
        else if (decisions && !decisions.ids.has(id))
          problems.push(`${path}: "${name}" cites ${id}, which is not in docs/decisions.md`);
        else if (decisions?.superseded.has(id))
          problems.push(`${path}: "${name}" cites ${id}, which was superseded`);
      }
    }
  }
  return { problems, cited };
}

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

if (import.meta.main) {
  const [cmd, target = "docs/journeys", ...rest] = process.argv.slice(2);
  if (!cmd || !["validate", "render", "check"].includes(cmd)) {
    console.error(
      "usage: bun scripts/journey.ts <validate|render|check> [spine.yaml|dir] [--complete]",
    );
    process.exit(2);
  }
  const paths = await spinePaths(target);
  if (!paths.length) {
    console.error(`ok: no journey spines at ${target}; nothing to ${cmd}.`);
    process.exit(0);
  }

  const decisionsFile = Bun.file("docs/decisions.md");
  const decisions = (await decisionsFile.exists())
    ? parseDecisions(await decisionsFile.text())
    : undefined;
  let failed = false;
  const blocked: string[] = [];
  const known = new Set<string>();
  let required: string[] = [];
  for (const path of paths) {
    let spine: Spine;
    try {
      spine = await loadSpine(path);
    } catch (e) {
      console.error((e as Error).message);
      process.exit(1);
    }
    const { errors, warnings } = validateSpine(spine, decisions);
    for (const w of warnings) console.error(`${cmd === "check" ? "ERROR" : "warn "} ${path}: ${w}`);
    for (const e of errors) console.error(`ERROR ${path}: ${e}`);
    if (errors.length || (cmd === "check" && warnings.length)) {
      failed = true;
      continue;
    }

    if (cmd === "render") {
      await Bun.write(mdPath(path), render(spine, mdPath(path)));
      console.error(`wrote ${mdPath(path)}`);
    } else if (cmd === "check") {
      const md = Bun.file(mdPath(path));
      if (!(await md.exists()) || (await md.text()) !== render(spine, mdPath(path))) {
        console.error(`ERROR ${mdPath(path)} is stale; run: bun run journeys:render`);
        failed = true;
      }
      for (const id of traceableIds(spine)) known.add(id);
      required = required.concat(requiredIds(spine));
      blocked.push(...openQuestionSteps(spine));
    } else {
      console.error(`ok: ${path} is valid (${warnings.length} warning(s)).`);
    }
  }
  if (failed) process.exit(1);

  if (cmd === "check") {
    const files = await testFiles();
    const { problems, cited } = testCitations(files, decisions);
    if (problems.length) {
      console.error(
        "ERROR product tests must prove a journey criterion, an invariant or a money/security decision:",
      );
      for (const p of problems) console.error(`  ${p}`);
      process.exit(1);
    }
    const { unknown, missing } = checkJourneyCitations({
      known,
      required: [...new Set(required)].sort(),
      cited,
      complete: rest.includes("--complete"),
    });
    if (unknown.length) {
      console.error("ERROR tests cite criteria or invariants that are not on any spine:");
      for (const id of unknown) console.error(`  ${id}`);
      process.exit(1);
    }
    if (rest.includes("--complete") && blocked.length) {
      console.error("ERROR steps or invariants still rely on open questions in docs/decisions.md:");
      for (const b of blocked) console.error(`  ${b}`);
      process.exit(1);
    }
    if (missing.length) {
      console.error("ERROR criteria of served steps, or invariants, have no test:");
      for (const id of missing) console.error(`  ${id}`);
      console.error(
        'Name the test after what it proves, e.g. it("J2.S4.c1: reads at the safe block").',
      );
      process.exit(1);
    }
    console.error(`ok: ${paths.length} spine(s) valid and rendered; citations resolve.`);
  }
}
