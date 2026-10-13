// SPIKE (2026-10-13): start and read runs of workflows/spike.ts. Delete with it.
import { getRun, start } from "workflow/api";
import { type SpikeOptions, spikeDeposit } from "@/workflows/spike";

export async function POST(request: Request) {
  const { fillId, ...options } = (await request.json()) as { fillId: string } & SpikeOptions;
  const run = await start(spikeDeposit, [fillId, options]);
  return Response.json({ runId: run.runId });
}

export async function GET(request: Request) {
  const runId = new URL(request.url).searchParams.get("runId");
  if (!runId) return Response.json({ error: "runId required" }, { status: 400 });
  const run = getRun(runId);
  const status = await run.status;
  const result = status === "completed" ? await run.returnValue : undefined;
  return Response.json({ runId, status, result });
}
