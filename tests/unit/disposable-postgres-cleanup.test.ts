import { describe, expect, it } from "vitest";
import {
  cleanupRunOwnedContainer,
  type DisposableContainerCommandResult,
} from "../../scripts/lib/disposable-postgres-cleanup";

const containerId = "a".repeat(64);
const runId = "20261013_1";
const labelName = "com.satsetx4.karturt.disposable-run";

function commandResult(status: number | null, stdout = "", error?: Error): DisposableContainerCommandResult {
  return { status, stdout, ...(error ? { error } : {}) };
}

function ownedInspectionResults() {
  return [
    commandResult(0, containerId),
    commandResult(0, JSON.stringify({ [labelName]: runId })),
  ];
}

function makeRunner(results: Array<DisposableContainerCommandResult | Error>) {
  const calls: string[][] = [];
  return {
    calls,
    runCommand: (args: string[]) => {
      calls.push(args);
      const next = results.shift();
      if (next instanceof Error) throw next;
      return next ?? commandResult(1);
    },
  };
}

function clean(options: {
  containerId?: string | null;
  runCommand: (args: string[]) => DisposableContainerCommandResult;
}) {
  return cleanupRunOwnedContainer({
    containerId: options.containerId === undefined ? containerId : options.containerId,
    labelName,
    runCommand: options.runCommand,
    runId,
    onFailure: () => undefined,
  });
}

describe("disposable PostgreSQL container cleanup", () => {
  it("accepts auto-remove only after a successful list proves the owned ID is absent", () => {
    const runner = makeRunner([
      ...ownedInspectionResults(),
      commandResult(0),
      commandResult(0, ""),
    ]);

    expect(clean({ runCommand: runner.runCommand })).toBe(true);
    expect(runner.calls.map((args) => args.slice(0, 2))).toEqual([
      ["container", "inspect"],
      ["container", "inspect"],
      ["container", "stop"],
      ["container", "ls"],
    ]);
  });

  it("removes a persistent owned container and verifies its exact ID is absent", () => {
    const runner = makeRunner([
      ...ownedInspectionResults(),
      commandResult(0),
      commandResult(0, containerId),
      ...ownedInspectionResults(),
      commandResult(0),
      commandResult(0, ""),
    ]);

    expect(clean({ runCommand: runner.runCommand })).toBe(true);
    expect(runner.calls.some((args) => args[0] === "container" && args[1] === "rm" && args.includes(containerId))).toBe(true);
    expect(runner.calls.filter((args) => args[0] === "container" && args[1] === "ls")).toHaveLength(2);
  });

  it("refuses an ownership mismatch before stop or remove", () => {
    const runner = makeRunner([
      commandResult(0, containerId),
      commandResult(0, JSON.stringify({ [labelName]: "another-run" })),
    ]);

    expect(clean({ runCommand: runner.runCommand })).toBe(false);
    expect(runner.calls).toHaveLength(2);
    expect(runner.calls.some((args) => args.includes("stop") || args.includes("rm"))).toBe(false);
  });

  it("rechecks ownership before removing a container that remains after stop", () => {
    const runner = makeRunner([
      ...ownedInspectionResults(),
      commandResult(0),
      commandResult(0, containerId),
      commandResult(0, containerId),
      commandResult(0, JSON.stringify({ [labelName]: "another-run" })),
    ]);

    expect(clean({ runCommand: runner.runCommand })).toBe(false);
    expect(runner.calls.some((args) => args[0] === "container" && args[1] === "rm")).toBe(false);
  });

  it("treats an inspect engine error as unverified and performs no mutation", () => {
    const runner = makeRunner([
      commandResult(null, "", new Error("synthetic engine unavailable")),
      commandResult(0, JSON.stringify({ [labelName]: runId })),
    ]);

    expect(clean({ runCommand: runner.runCommand })).toBe(false);
    expect(runner.calls).toHaveLength(1);
    expect(runner.calls.some((args) => args.includes("stop") || args.includes("rm"))).toBe(false);
  });

  it("treats list verification errors as failure and does not remove on ambiguity", () => {
    const runner = makeRunner([
      ...ownedInspectionResults(),
      commandResult(0),
      commandResult(1),
    ]);

    expect(clean({ runCommand: runner.runCommand })).toBe(false);
    expect(runner.calls.some((args) => args[0] === "container" && args[1] === "rm")).toBe(false);
  });

  it("treats stop command failure as cleanup failure without trying to remove", () => {
    const runner = makeRunner([
      ...ownedInspectionResults(),
      commandResult(1),
    ]);

    expect(clean({ runCommand: runner.runCommand })).toBe(false);
    expect(runner.calls.some((args) => args[0] === "container" && args[1] === "ls")).toBe(false);
    expect(runner.calls.some((args) => args[0] === "container" && args[1] === "rm")).toBe(false);
  });

  it("treats force-remove failure as cleanup failure", () => {
    const runner = makeRunner([
      ...ownedInspectionResults(),
      commandResult(0),
      commandResult(0, containerId),
      ...ownedInspectionResults(),
      commandResult(1),
    ]);

    expect(clean({ runCommand: runner.runCommand })).toBe(false);
    expect(runner.calls.some((args) => args[0] === "container" && args[1] === "rm")).toBe(true);
  });

  it("does not report success when a successful remove is followed by a listing that still contains the ID", () => {
    const runner = makeRunner([
      ...ownedInspectionResults(),
      commandResult(0),
      commandResult(0, containerId),
      ...ownedInspectionResults(),
      commandResult(0),
      commandResult(0, containerId),
    ]);

    expect(clean({ runCommand: runner.runCommand })).toBe(false);
    expect(runner.calls.filter((args) => args[0] === "container" && args[1] === "ls")).toHaveLength(2);
  });

  it("treats a thrown list adapter error as cleanup failure", () => {
    const runner = makeRunner([
      ...ownedInspectionResults(),
      commandResult(0),
      new Error("synthetic list adapter failure"),
    ]);

    expect(clean({ runCommand: runner.runCommand })).toBe(false);
    expect(runner.calls.some((args) => args[0] === "container" && args[1] === "rm")).toBe(false);
  });

  it("treats a thrown remove adapter error as cleanup failure", () => {
    const runner = makeRunner([
      ...ownedInspectionResults(),
      commandResult(0),
      commandResult(0, containerId),
      ...ownedInspectionResults(),
      new Error("synthetic remove adapter failure"),
    ]);

    expect(clean({ runCommand: runner.runCommand })).toBe(false);
    expect(runner.calls.some((args) => args[0] === "container" && args[1] === "rm")).toBe(true);
  });

  it("treats missing container identity as unverified cleanup", () => {
    const runner = makeRunner([]);

    expect(clean({ containerId: null, runCommand: runner.runCommand })).toBe(false);
    expect(runner.calls).toHaveLength(0);
  });
});
