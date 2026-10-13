// SPIKE (2026-10-13): proves the Workflow SDK primitives the deposit pipeline needs,
// under Bun. Delete once processDeposit exists.
import { FatalError, getStepMetadata, sleep } from "workflow";

type Poll = { attempt: number; status: "waiting" | "processing" | "filled" };

/** Shaped like processDeposit: poll a router until terminal, sleeping between polls. */
export async function spikeDeposit(fillId: string) {
  "use workflow";

  const runtime = await whichRuntime();
  let poll: Poll = { attempt: 0, status: "waiting" };
  while (poll.status !== "filled") {
    poll = await pollRouter(fillId, poll.attempt + 1);
    if (poll.status !== "filled") await sleep("2s");
  }
  const flaky = await flakyStep(fillId);
  if (fillId === "fatal") await fatalStep();
  return { fillId, runtime, polls: poll.attempt, flaky };
}

async function whichRuntime() {
  "use step";
  return typeof Bun === "undefined" ? `node ${process.version}` : `bun ${Bun.version}`;
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

async function fatalStep(): Promise<never> {
  "use step";
  throw new FatalError("fatal: no retry");
}
