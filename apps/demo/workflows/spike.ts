// SPIKE (2026-10-13): proves the Workflow SDK primitives the deposit pipeline needs,
// under Bun and on Vercel. Delete once processDeposit exists.
import { FatalError, getStepMetadata, sleep } from "workflow";

type Poll = { attempt: number; status: "waiting" | "processing" | "filled" };
export type SpikeOptions = {
  /** Pause between polls in ms; 120_000 proves resume after the instance is gone. */
  pollEveryMs?: number;
  /** Kill the process inside a step on its first attempt. Vercel only — it kills a dev server. */
  crashOnce?: boolean;
  fatal?: boolean;
};

/** Shaped like processDeposit: poll a router until terminal, sleeping between polls. */
export async function spikeDeposit(fillId: string, options: SpikeOptions = {}) {
  "use workflow";

  const startedOn = await whereAmI();
  let poll: Poll = { attempt: 0, status: "waiting" };
  while (poll.status !== "filled") {
    poll = await pollRouter(fillId, poll.attempt + 1);
    if (poll.status !== "filled") await sleep(options.pollEveryMs ?? 2000);
  }
  const flaky = await flakyStep(fillId);
  const crash = options.crashOnce ? await crashOnceStep() : undefined;
  if (options.fatal) await fatalStep();
  const finishedOn = await whereAmI();
  return { fillId, startedOn, finishedOn, polls: poll.attempt, flaky, crash };
}

async function whereAmI() {
  "use step";
  const runtime = typeof Bun === "undefined" ? `node ${process.version}` : `bun ${Bun.version}`;
  return { runtime, deployment: process.env.VERCEL_DEPLOYMENT_ID ?? "local", pid: process.pid };
}

async function pollRouter(fillId: string, attempt: number): Promise<Poll> {
  "use step";
  console.log(`[spike] poll ${attempt} for ${fillId}`);
  return { attempt, status: attempt < 3 ? (attempt === 1 ? "waiting" : "processing") : "filled" };
}

/** Throws on the first attempt to prove automatic step retries. */
async function flakyStep(fillId: string) {
  "use step";
  const { attempt, stepId } = getStepMetadata();
  console.log(`[spike] flaky attempt ${attempt} (stepId ${stepId}) for ${fillId}`);
  if (attempt < 2) throw new Error("transient failure");
  return { attempt, stepId };
}

/** Dies mid-step on the first attempt — the closest thing to a crash on Vercel. */
async function crashOnceStep() {
  "use step";
  const { attempt } = getStepMetadata();
  console.log(`[spike] crashOnce attempt ${attempt} pid ${process.pid}`);
  if (attempt === 1) process.exit(1);
  return { attempt, pid: process.pid };
}

async function fatalStep(): Promise<never> {
  "use step";
  throw new FatalError("fatal: no retry");
}
