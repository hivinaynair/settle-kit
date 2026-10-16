import { createHash } from "node:crypto";
import { resolve } from "node:path";

// This review adapter checks links into Settle Kit's existing format. It does not
// convert policy, validate the native graph, or prove that a mapping is sufficient.
const root = resolve(import.meta.dir, "../..");
type Coverage = {
  id: string;
  actor: string;
  status: string;
  reason?: string;
  policy?: string[];
  refs?: string[];
  observations?: string[];
  journeys?: string[];
  exclusions?: string[];
};
type Review = {
  reviewed_revision: string;
  observations: {
    id: string;
    sources: { ref: string; locator: string; sha256?: string }[];
  }[];
  coverage: Coverage[];
};
type Spine = {
  actors: { id: string }[];
  invariants: { id: string }[];
  journeys: { id: string; steps: { id: string; criteria?: Record<string, string> }[] }[];
};

export function checkLinks(review: Review, spine: Spine, decisions: string) {
  const errors: string[] = [];
  const unresolved: string[] = [];
  const policy = new Set([...decisions.matchAll(/^\| ([DX]\d+) \|/gm)].map((m) => m[1]));
  const actors = new Set(spine.actors.map((a) => a.id));
  const journeys = new Set(spine.journeys.map((j) => j.id));
  const refs = new Set<string>(spine.invariants.map((i) => i.id));
  for (const j of spine.journeys) {
    refs.add(j.id);
    for (const s of j.steps) {
      refs.add(s.id);
      for (const key of Object.keys(s.criteria ?? {})) refs.add(`${s.id}.${key}`);
    }
  }
  const observations = new Set(review.observations.map((o) => o.id));
  const seen = new Set<string>();
  const mapped = new Set<string>();
  for (const c of review.coverage) {
    if (seen.has(c.id)) errors.push(`Duplicate coverage ID ${c.id}`);
    seen.add(c.id);
    if (!actors.has(c.actor)) errors.push(`${c.id}: unknown actor ${c.actor}`);
    for (const id of c.policy ?? [])
      if (!policy.has(id)) errors.push(`${c.id}: unknown policy ${id}`);
    for (const id of c.refs ?? [])
      if (!refs.has(id)) errors.push(`${c.id}: missing reference ${id}`);
    for (const id of c.observations ?? [])
      if (!observations.has(id)) errors.push(`${c.id}: missing observation ${id}`);
    if (c.status === "mapped") {
      if (!c.journeys?.length) errors.push(`${c.id}: missing journey mapping`);
      for (const id of c.journeys ?? []) {
        if (!journeys.has(id)) errors.push(`${c.id}: missing journey ${id}`);
        mapped.add(id);
      }
    } else if (c.status === "excluded") {
      if (!c.reason || !c.exclusions?.length) errors.push(`${c.id}: missing exclusion basis`);
      for (const id of c.exclusions ?? [])
        if (!/^X\d+$/.test(id) || !policy.has(id)) errors.push(`${c.id}: unknown exclusion ${id}`);
    } else if (c.status === "unresolved") {
      if (!c.reason) errors.push(`${c.id}: missing unresolved reason`);
      unresolved.push(c.id);
    } else errors.push(`${c.id}: invalid coverage status`);
  }
  // Partially mapped goals retain precise refs without pretending to be resolved.
  for (const id of journeys)
    if (
      !mapped.has(id) &&
      !review.coverage.some((c) => (c.refs ?? []).some((r: string) => r.startsWith(`${id}.`)))
    )
      errors.push(`${id}: absent from inventory`);
  return { errors, unresolved };
}

if (import.meta.main) {
  const reviewArg = process.argv.indexOf("--review");
  const reviewPath = reviewArg < 0 ? "docs/spec/coverage-review.yaml" : process.argv[reviewArg + 1];
  if (!reviewPath || reviewPath.startsWith("--")) throw new Error("--review requires a file path");
  const review = Bun.YAML.parse(await Bun.file(resolve(root, reviewPath)).text()) as Review;
  const spine = Bun.YAML.parse(
    await Bun.file(resolve(root, "docs/journeys/settle-kit.yaml")).text(),
  ) as Spine;
  const result = checkLinks(
    review,
    spine,
    await Bun.file(resolve(root, "docs/decisions.md")).text(),
  );
  for (const observation of review.observations)
    for (const source of observation.sources) {
      const file = Bun.file(resolve(root, source.ref));
      if (!(await file.exists())) {
        result.errors.push(`${observation.id}: reviewed source unavailable: ${source.ref}`);
        continue;
      }
      const current = await file.text();
      if (!current.includes(source.locator))
        result.errors.push(`${observation.id}: source locator missing in ${source.ref}`);
      if (source.sha256 !== undefined) {
        if (
          !/^[a-f0-9]{64}$/.test(source.sha256) ||
          createHash("sha256").update(current).digest("hex") !== source.sha256
        )
          result.errors.push(
            `${observation.id}: source changed since worktree review: ${source.ref}`,
          );
        continue;
      }
      const pinned = Bun.spawnSync(["git", "show", `${review.reviewed_revision}:${source.ref}`], {
        cwd: root,
      });
      if (pinned.exitCode !== 0 || pinned.stdout.toString() !== current)
        result.errors.push(`${observation.id}: source changed since review: ${source.ref}`);
    }
  console.log(
    JSON.stringify(
      {
        ...result,
        inventoryEntries: review.coverage.length,
        observations: review.observations.length,
        journeyCount: spine.journeys.length,
        complete: !result.errors.length && !result.unresolved.length,
      },
      null,
      2,
    ),
  );
  process.exitCode =
    result.errors.length || (process.argv.includes("--complete") && result.unresolved.length)
      ? 1
      : 0;
}
