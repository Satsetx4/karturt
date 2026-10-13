export type DisposableContainerCommandResult = {
  status: number | null;
  stdout: string;
  error?: Error;
};

export type DisposableContainerCommand = (args: string[]) => DisposableContainerCommandResult;

type RunOwnedContainerOptions = {
  containerId: string | null;
  containerName?: string | null;
  labelName: string;
  runCommand: DisposableContainerCommand;
  runId: string;
  onFailure?: (message: string) => void;
};

function commandSucceeded(result: DisposableContainerCommandResult) {
  return result.status === 0 && result.error === undefined;
}

function containerIds(result: DisposableContainerCommandResult) {
  if (!commandSucceeded(result)) return null;
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function verifyRunOwnedContainer(options: RunOwnedContainerOptions) {
  const fail = (message: string) => {
    options.onFailure?.(message);
    return false;
  };

  const { containerId, labelName, runCommand, runId } = options;
  if (!containerId || !/^[a-f0-9]{12,64}$/i.test(containerId)) {
    return fail("Cleanup stopped: this run has no verifiable container ID.");
  }

  let idResult: DisposableContainerCommandResult;
  try {
    idResult = runCommand([
      "container", "inspect", "--format", "{{.Id}}", containerId,
    ]);
  } catch {
    return fail("Cleanup stopped: the container engine could not verify ownership.");
  }
  if (!commandSucceeded(idResult)) {
    return fail("Cleanup stopped: the container engine could not verify ownership.");
  }
  if (idResult.stdout.trim().toLowerCase() !== containerId.toLowerCase()) {
    return fail("Cleanup stopped: the inspected container ID did not match this run.");
  }

  let labelsResult: DisposableContainerCommandResult;
  try {
    labelsResult = runCommand([
      "container", "inspect", "--format", "{{json .Config.Labels}}", containerId,
    ]);
  } catch {
    return fail("Cleanup stopped: the container engine could not verify ownership.");
  }
  if (!commandSucceeded(labelsResult)) {
    return fail("Cleanup stopped: the container engine could not verify ownership.");
  }

  try {
    const labels = JSON.parse(labelsResult.stdout.trim()) as unknown;
    if (!labels || typeof labels !== "object" || Array.isArray(labels)) {
      return fail("Cleanup stopped: the container ownership label was unreadable.");
    }
    if ((labels as Record<string, unknown>)[labelName] !== runId) {
      return fail("Cleanup stopped: the container ownership label did not match this run.");
    }
  } catch {
    return fail("Cleanup stopped: the container ownership label was unreadable.");
  }

  return true;
}

export function cleanupRunOwnedContainer(options: RunOwnedContainerOptions) {
  const fail = (message: string) => {
    options.onFailure?.(message);
    return false;
  };

  const { runCommand, runId } = options;
  let containerId = options.containerId;
  if (typeof containerId !== "string" || !/^[a-f0-9]{12,64}$/i.test(containerId)) {
    const expectedName = `karturt-pg-${runId}`;
    if (options.containerName !== expectedName) {
      return fail("Cleanup stopped: this run has no verified container ID or exact run-owned name.");
    }

    let resolved: DisposableContainerCommandResult;
    try {
      resolved = runCommand(["container", "inspect", "--format", "{{.Id}}", expectedName]);
    } catch {
      return fail("Cleanup stopped: the container engine could not resolve the run-owned name.");
    }
    if (!commandSucceeded(resolved)) {
      return fail("Cleanup stopped: the container engine could not resolve the run-owned name.");
    }
    containerId = resolved.stdout.trim();
    if (!/^[a-f0-9]{12,64}$/i.test(containerId)) {
      return fail("Cleanup stopped: the run-owned name did not resolve to one full container ID.");
    }
  }

  const verifiedOptions = { ...options, containerId };
  if (!verifyRunOwnedContainer(verifiedOptions)) return false;

  const listExactContainer = () => {
    let listed: DisposableContainerCommandResult;
    try {
      listed = runCommand([
        "container", "ls", "--all", "--no-trunc", "--filter", `id=${containerId}`,
        "--format", "{{.ID}}",
      ]);
    } catch {
      return null;
    }
    return containerIds(listed);
  };

  let stopped: DisposableContainerCommandResult;
  try {
    stopped = runCommand(["container", "stop", "--time", "5", containerId]);
  } catch {
    return fail("Cleanup stopped: the container engine could not stop the run-owned container.");
  }
  if (!commandSucceeded(stopped)) {
    return fail("Cleanup stopped: the container engine could not stop the run-owned container.");
  }

  const afterStop = listExactContainer();
  if (afterStop === null) {
    return fail("Cleanup stopped: the container engine could not verify container absence after stop.");
  }
  if (afterStop.length === 0) return true;
  if (afterStop.length !== 1 || afterStop[0]?.toLowerCase() !== containerId.toLowerCase()) {
    return fail("Cleanup stopped: the container list did not match the exact run-owned container.");
  }

  if (!verifyRunOwnedContainer(verifiedOptions)) return false;

  let removed: DisposableContainerCommandResult;
  try {
    removed = runCommand(["container", "rm", "--force", containerId]);
  } catch {
    return fail("Cleanup stopped: the container engine could not remove the run-owned container.");
  }
  if (!commandSucceeded(removed)) {
    return fail("Cleanup stopped: the container engine could not remove the run-owned container.");
  }

  const afterRemove = listExactContainer();
  if (afterRemove === null) {
    return fail("Cleanup stopped: the container engine could not verify container absence after removal.");
  }
  if (afterRemove.length !== 0) {
    return fail("Cleanup stopped: the exact run-owned container is still present.");
  }

  return true;
}
