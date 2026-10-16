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
    const quitPosition = queryText.indexOf("\\quit 3", stopPosition);
    const movedQuit = queryText.slice(0, quitPosition) +
      queryText.slice(quitPosition + "\\quit 3\n".length);
    const catalogPosition = movedQuit.indexOf("SELECT\n  current_database() AS observed_database_name");
    const lateGate = movedQuit.slice(0, catalogPosition) +
      "\\quit 3\n" +
      movedQuit.slice(catalogPosition);
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
    const quit = "\\quit 3\n";
    const quitPosition = queryText.indexOf(quit, queryText.indexOf("F2_FAIL " + gate.failCode));
    const nextReadPosition = queryText.indexOf(gate.nextSqlMarker, quitPosition);
    const movedQuit = queryText.slice(0, quitPosition) + queryText.slice(quitPosition + quit.length);
    const lateGate = movedQuit.slice(0, nextReadPosition) + quit + movedQuit.slice(nextReadPosition);
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
    const psqlPosition = runnerText.indexOf("& $psqlExecutable @psqlArgs");

    expect(runnerText).toContain("[IO.FileMode]::CreateNew");
    expect(runnerText).toContain("[IO.FileShare]::Read");
    expect(runnerText).toMatch(/'-f',\s*\$querySnapshotPath/);
    expect(runnerText).not.toMatch(/'-f',\s*\$queryPath/);
    expect(lockPosition).toBeGreaterThan(-1);
    expect(hashPosition).toBeGreaterThan(lockPosition);
    expect(hashGuardPosition).toBeGreaterThan(hashPosition);
    expect(psqlPosition).toBeGreaterThan(hashGuardPosition);
  });

  it("resolves and invokes absolute node and psql applications", () => {
    const nodePosition = runnerText.indexOf("& $nodeExecutable $preflightPath");
    expect(runnerText).toContain("Resolve-ApplicationPath 'node.exe'");
    expect(runnerText).toContain("Resolve-ApplicationPath 'psql.exe'");
    expect(nodePosition).toBeGreaterThan(-1);
    expect(runnerText).toContain("& $psqlExecutable @psqlArgs");
    expect(runnerText).toContain("--psql-path $psqlExecutable");
    expect(runnerText).toContain("--git-path $gitExecutable");
    expect(runnerText).not.toMatch(/&\s+node(?:\.exe)?\s/);
    expect(runnerText).not.toMatch(/&\s+psql(?:\.exe)?\s/);
    expect(preflightText).toContain("execFileSync(psqlPath, ['--version']");
    expect(preflightText).toContain("execFileSync(gitExecutable, args");
  });
});
