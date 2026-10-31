import { createHash, randomUUID } from "node:crypto";
import { assertR3PreviewBusinessDateTarget } from "@/db/preview-target";

const processInstanceNonce = randomUUID();

export type R3WorkerIdentity = {
  releaseSha: string;
  runId: string;
  scenario: string;
  workerTag: "a" | "b";
  workerInstanceId: string;
};

export function getR3WorkerIdentity(
  requestedRunId: string | null,
  environment: NodeJS.ProcessEnv,
  compiledReleaseSha: string | undefined,
  processId: number,
): R3WorkerIdentity | null {
  const runId = environment.KARTURT_R3_RUN_ID;
  const scenario = environment.KARTURT_R3_SCENARIO;
  const workerTag = environment.KARTURT_R3_WORKER_TAG;
  // Ordinary Preview health checks are not R3 race-worker probes.
  if (!scenario && !workerTag) return null;
  const staging = environment.APP_ENV === "staging" && environment.DATABASE_ENV === "staging";
  const preview = environment.APP_ENV === "preview" && environment.DATABASE_ENV === "preview";
  if (preview) assertR3PreviewBusinessDateTarget(environment);
  const validScenario = [
    "R3-RACE-REQUEST",
    "R3-RACE-VERIFY",
    "R3-RACE-CASH",
    "R3-RACE-REVERSAL",
  ].includes(scenario ?? "");
  if (
    (!staging && !preview) ||
    !runId ||
    requestedRunId !== runId ||
    !/^[a-z0-9]{8,20}$/.test(runId) ||
    !validScenario ||
    !compiledReleaseSha ||
    !/^[0-9a-f]{40}$/.test(compiledReleaseSha) ||
    (workerTag !== "a" && workerTag !== "b") ||
    !Number.isSafeInteger(processId) ||
    processId < 1
  ) {
    return null;
  }

  const workerInstanceId = createHash("sha256")
    .update(`${runId}:${scenario}:${processId}:${processInstanceNonce}`)
    .digest("hex")
    .slice(0, 16);

  return { releaseSha: compiledReleaseSha, runId, scenario: scenario!, workerTag, workerInstanceId };
}
