import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertWave13B2F2DiagnosticContract,
  getWave13B2F2ConnectionFailureCodes,
  getWave13B2F2OutputFailureCode,
  WAVE13B2_F2_CONNECTION_CHECKS,
  WAVE13B2_F2_OUTPUT_GATES,
} from "../../scripts/wave13b2-f2-diagnostics.mjs";

const queryText = readFileSync(
  resolve(process.cwd(), "docs/codex/wave13b2-read-only-catalog-preflight.sql"),
  "utf8",
);
const runnerText = readFileSync(
  resolve(process.cwd(), "scripts/run-wave13b2-f2-query.ps1"),
  "utf8",
);
const preflightText = readFileSync(
  resolve(process.cwd(), "scripts/preflight-wave13b2-local.mjs"),
  "utf8",
);
const runnerModuleText = readFileSync(
  resolve(process.cwd(), "scripts/lib/wave13b2-f2-runner.psm1"),
  "utf8",
);

describe("Wave 13B.2 F2 fail-closed diagnostics", () => {
  it("accepts the checked-in query diagnostic contract", () => {
    expect(assertWave13B2F2DiagnosticContract(queryText)).toBe(true);
  });

  it("reports each independent connection failure in a fixed order and fails closed on missing observations", () => {
    const passing = Object.fromEntries(WAVE13B2_F2_CONNECTION_CHECKS.map(({ flag }) => [flag, true]));
    expect(getWave13B2F2ConnectionFailureCodes(passing)).toEqual([]);

    for (const check of WAVE13B2_F2_CONNECTION_CHECKS) {
      expect(getWave13B2F2ConnectionFailureCodes({ ...passing, [check.flag]: false }))
        .toEqual([check.failCode]);
      expect(getWave13B2F2ConnectionFailureCodes({ ...passing, [check.flag]: null }))
        .toEqual([check.failCode]);
    }

    const first = WAVE13B2_F2_CONNECTION_CHECKS[0];
    const last = WAVE13B2_F2_CONNECTION_CHECKS.at(-1);
    if (first === undefined || last === undefined) {
      throw new Error("connection checks must not be empty");
    }
    expect(getWave13B2F2ConnectionFailureCodes({
      ...passing,
      [last.flag]: false,
      [first.flag]: false,
    })).toEqual([first.failCode, last.failCode]);
    expect(getWave13B2F2ConnectionFailureCodes({}))
      .toEqual(WAVE13B2_F2_CONNECTION_CHECKS.map(({ failCode }) => failCode));
  });

  it("accepts each output cap at its limit and reports the first over-limit count", () => {
    for (const gate of WAVE13B2_F2_OUTPUT_GATES) {
      expect(getWave13B2F2OutputFailureCode(gate.id, gate.limit)).toBeNull();
      expect(getWave13B2F2OutputFailureCode(gate.id, gate.limit + 1)).toBe(gate.failCode);
    }
    expect(getWave13B2F2OutputFailureCode("membership", null))
      .toBe("F2_OUTPUT_COUNT_UNAVAILABLE");
    expect(getWave13B2F2OutputFailureCode("membership", -1))
      .toBe("F2_OUTPUT_COUNT_UNAVAILABLE");
  });

  it("rejects missing failure codes and a connection stop moved after catalog reads", () => {
    const missingFailure = queryText.replace(
      "F2_FAIL TARGET_PROJECT_ID_MISMATCH",
      "F2_FAIL UNKNOWN",
    );
    expect(() => assertWave13B2F2DiagnosticContract(missingFailure)).toThrow();

    const stop = "F2_STOP CONNECTION_GUARD_FAILED CATALOG_QUERIES_SKIPPED";
    const stopPosition = queryText.indexOf(stop);
    const raise = "DO $f2_stop$ BEGIN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'F2_STOP CONNECTION_GUARD_FAILED'; END $f2_stop$;\n";
    const raisePosition = queryText.indexOf(raise, stopPosition);
    const movedRaise = queryText.slice(0, raisePosition) +
      queryText.slice(raisePosition + raise.length);
    const catalogPosition = movedRaise.indexOf("SELECT\n  current_database() AS observed_database_name");
    const lateGate = movedRaise.slice(0, catalogPosition) +
      raise +
      movedRaise.slice(catalogPosition);
    expect(() => assertWave13B2F2DiagnosticContract(lateGate)).toThrow();
  });

  it("rejects a connection predicate that no longer matches its named check", () => {
    const weakenedPredicate = queryText.replace(
      ":'target_project_id' = 'broad-star-40451875' AS target_project_id_matches",
      "true AS target_project_id_matches",
    );
    expect(() => assertWave13B2F2DiagnosticContract(weakenedPredicate)).toThrow();
  });

  it("preserves case-sensitive target identifiers inside SQL literals", () => {
    const changedIdentifier = queryText.replace(
      "'broad-star-40451875'",
      "'BROAD-STAR-40451875'",
    );
    expect(() => assertWave13B2F2DiagnosticContract(changedIdentifier)).toThrow();
  });

  it("rejects predicates swapped between connection-check aliases", () => {
    const projectPredicate = ":'target_project_id' = 'broad-star-40451875'";
    const branchPredicate = ":'target_branch_id' = 'br-orange-recipe-azed9f78'";
    const swappedPredicates = queryText
      .replace(projectPredicate, "__F2_PREDICATE_SWAP__")
      .replace(branchPredicate, projectPredicate)
      .replace("__F2_PREDICATE_SWAP__", branchPredicate);

    expect(() => assertWave13B2F2DiagnosticContract(swappedPredicates)).toThrow();
  });

  it("requires every catalog failure to stop before its next inventory query", () => {
    const gate = WAVE13B2_F2_OUTPUT_GATES[0];
    const raise = "DO $f2_stop$ BEGIN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'F2_STOP " + gate.failCode + "'; END $f2_stop$;\n";
    const failPosition = queryText.indexOf("F2_FAIL " + gate.failCode);
    const raisePosition = queryText.indexOf(raise, failPosition);
    const nextReadPosition = queryText.indexOf(gate.nextCatalogReadMarker, raisePosition);
    const movedRaise = queryText.slice(0, raisePosition) + queryText.slice(raisePosition + raise.length);
    const lateGate = movedRaise.slice(0, nextReadPosition) + raise + movedRaise.slice(nextReadPosition);
    expect(() => assertWave13B2F2DiagnosticContract(lateGate)).toThrow();
  });

  it("keeps the connection diagnostic block free of credentials and connection strings", () => {
    const start = queryText.indexOf("WITH f2_connection_checks AS");
    const end = queryText.indexOf("SELECT\n  current_database() AS observed_database_name");
    const diagnostics = queryText.slice(start, end);
    expect(diagnostics).not.toMatch(/PGPASSWORD|PGPASSFILE|PGSSLROOTCERT|PGHOST|postgres(?:ql)?:\/\//i);
  });

  it("locks and verifies the approved query snapshot before psql consumes it", () => {
    const lockPosition = runnerText.indexOf("$queryLock = [IO.File]::Open");
    const hashPosition = runnerText.indexOf("$lockedQueryHash = Get-StreamSha256Hex -Stream $queryLock");
    const hashGuardPosition = runnerText.indexOf("Require-Condition ($lockedQueryHash -eq $queryPacketSha256)");
    const psqlPosition = runnerText.indexOf("$runResult = Invoke-Wave13B2F2Psql");
    const finalPreflightPosition = runnerText.lastIndexOf("Invoke-OfflinePreflight");

    expect(runnerText).toContain("[IO.FileMode]::CreateNew");
    expect(runnerText).toContain("[IO.FileShare]::Read");
    expect(runnerText).toMatch(/'-f',\s*\$querySnapshotPath/);
    expect(runnerText).not.toMatch(/'-f',\s*\$queryPath/);
    expect(lockPosition).toBeGreaterThan(-1);
    expect(hashPosition).toBeGreaterThan(lockPosition);
    expect(hashGuardPosition).toBeGreaterThan(hashPosition);
    expect(finalPreflightPosition).toBeGreaterThan(hashGuardPosition);
    expect(psqlPosition).toBeGreaterThan(hashGuardPosition);
    expect(psqlPosition).toBeGreaterThan(finalPreflightPosition);
  });

  it("resolves and invokes absolute node and psql applications", () => {
    const nodePosition = runnerText.indexOf("& $nodeExecutable $preflightPath");
    expect(runnerText).toContain("Resolve-ApplicationPath 'node.exe'");
    expect(runnerText).toContain("Resolve-ApplicationPath 'psql.exe'");
    expect(nodePosition).toBeGreaterThan(-1);
    expect(runnerText).toMatch(/Invoke-Wave13B2F2Psql[\s\S]*?-EvidencePath\s+\$evidencePath[\s\S]*?-AclCheckerPath\s+\$aclCheckerPath/);
    expect(runnerModuleText).toContain("$startInfo.RedirectStandardOutput = $true");
    expect(runnerModuleText).toContain("$startInfo.RedirectStandardError = $true");
    expect(runnerModuleText).toContain("$process.WaitForExit()");
    expect(runnerModuleText).toContain("$exitCode = [int]$process.ExitCode");
    expect(runnerModuleText).toContain("New-Wave13B2F2OwnerEvidenceFile");
    expect(runnerModuleText).toContain("Get-Wave13B2F2OwnerEvidenceVerification");
    expect(runnerModuleText).toMatch(/StandardOutput\.BaseStream/);
    expect(runnerModuleText).not.toMatch(/OutputLines|StandardOutput\.ReadToEnd/);
    expect(runnerModuleText).toMatch(/F2_EVIDENCE_(?:MISSING|ACL_MISMATCH|LENGTH_MISMATCH|HASH_MISMATCH)/);
    expect(runnerModuleText).toContain("evidenceSha256=");
    expect(runnerText).toContain("--psql-path $psqlExecutable");
    expect(runnerText).toContain("--git-path $gitExecutable");
    expect(runnerText).not.toMatch(/&\s+node(?:\.exe)?\s/);
    expect(runnerText).not.toMatch(/&\s+psql(?:\.exe)?\s/);
    expect(preflightText).toContain("execFileSync(psqlPath, ['--version']");
    expect(preflightText).toContain("execFileSync(gitExecutable, args");
  });

  it("requires a direct owner confirmation and classifies only exact completion with verified evidence", () => {
    expect(runnerText).toContain("[Console]::IsInputRedirected");
    expect(runnerText).toContain("[Console]::ReadKey($true)");
    expect(runnerText).toContain("$Host.Name -eq 'ConsoleHost'");
    expect(runnerText).toContain("RUN WAVE13B2 F2 ");
    expect(runnerText).not.toMatch(/\[switch\]\s*\$Confirm|F2_CONFIRMATION\s*=/i);
    const confirmationPosition = runnerText.indexOf("Read-OwnerRunConfirmation -SourceSha");
    const markerPosition = runnerText.indexOf("$markerStream = [IO.File]::Open");
    const finalPreflightPosition = runnerText.lastIndexOf("Invoke-OfflinePreflight");
    const psqlPosition = runnerText.indexOf("$runResult = Invoke-Wave13B2F2Psql");
    expect(confirmationPosition).toBeGreaterThan(-1);
    expect(markerPosition).toBeGreaterThan(confirmationPosition);
    expect(finalPreflightPosition).toBeGreaterThan(markerPosition);
    expect(psqlPosition).toBeGreaterThan(finalPreflightPosition);
    expect(runnerText.slice(finalPreflightPosition + "Invoke-OfflinePreflight".length, psqlPosition).trim()).toBe("");
    expect(runnerModuleText).toContain("$EvidenceVerified");
    expect(runnerModuleText).toContain("$FailureCodes");
    expect(runnerModuleText).toMatch(/ExitCode\s+-eq\s+0|ExitCode\s+-ne\s+0/);
    expect(runnerModuleText).toMatch(/doneMatches|doneCount|exactDone/);
    expect(runnerModuleText).toMatch(/failureCodes\.Count\s+-eq\s+0/);
    expect(runnerModuleText).toMatch(/stopCount\s+-eq\s+0/);
    expect(runnerModuleText).toMatch(/EvidenceVerified\s+-and|\$EvidenceVerified/);
    expect(runnerText).toContain("wave13b2-f2-catalog-evidence-");
    expect(runnerText).toContain("$applicationSourceSha");
    expect(runnerText).toContain("$queryPacketSha256");
    expect(runnerText).toMatch(/Test-Path\s+-LiteralPath\s+\$attemptMarkerPath/);
    expect(runnerText).toContain("[IO.FileMode]::CreateNew");
    expect(runnerText).toContain("Add-Wave13B2F2AttemptResult");
  });
});
