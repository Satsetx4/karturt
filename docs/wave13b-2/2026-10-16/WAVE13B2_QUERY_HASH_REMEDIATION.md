# Wave 13B.2 query hash integrity remediation

Date: 2026-10-16
Repository: Satsetx4/karturt
Activation branch: codex/karturt-v1-staging-activation-20261015
Remediation commit: 8abfd871cef2b95aae09079f6fb8e9fea85f5d03
Baseline: 813ea44ffed4a025b49f51c3216ed6e7ea9eb2d0

## Finding and audited digest

The old expected SHA-256, 987570baee76c2affef4a3f68c2ae114b3007174004d070232908c82f513751e, did not match the SQL packet. This was not only a Windows CRLF checkout issue: the committed Git blob itself had a different digest. An independent raw-blob read and a separate review found:

- File: docs/codex/wave13b2-read-only-catalog-preflight.sql
- Raw Git blob SHA-256: d7abf6b7592c53f9d480823d42c6d9ebbd9550fd4f5c276095a7e1892842c6fb
- Git blob object SHA-1: f4cffcc65925752202b67909940af95b6080d5d0
- Length: 11,763 bytes; LF-only
- The old pin was wrong before this checkout. SQL content is unchanged by this fix.

The reviewed SQL is a bounded catalog-metadata inspection: it starts a read-only transaction, uses a 5-second statement timeout, 1-second lock timeout, and 15-second idle-transaction timeout, checks the exact staging target/role/PostgreSQL/TLS conditions, and limits reads to PostgreSQL catalog metadata. It has no DDL/DML, application-row reads, or embedded credentials. Approval and signature verification remain an offline verifier responsibility; the SQL's psql variable is a caller-supplied guard, not cryptographic proof.

## Source changes and integrity controls

Commit 8abfd871cef2b95aae09079f6fb8e9fea85f5d03 updates the raw digest pin in the local preflight, target/expected-state templates, and owner packet; makes the signature verifier reuse the shared preflight pin; adds a raw Git blob plus worktree-byte integrity verifier; adds positive and negative tests (wrong pin and CRLF bytes reject without normalization); pins the query file to LF in .gitattributes; and adds a Windows CI job that enables core.autocrlf=true before checkout and verifies both byte sequences.

The immutable migration inventory remains exactly 14 SQL files plus drizzle/meta/_journal.json. Baseline and final fingerprint: e4a95a0a841872752cbcfa9b46107a99fdb469994280e25fc9f479a54b0312b4. No migration file or journal changed.

## Verification

Exact source SHA for all listed runs: 8abfd871cef2b95aae09079f6fb8e9fea85f5d03.

- Gate A full workflow: [run 38830127843](https://github.com/Satsetx4/karturt/actions/runs/38830127843) — PASS, conclusion success at exact SHA. Gate A local verification [job 116746753160](https://github.com/Satsetx4/karturt/actions/runs/38830127843/job/116746753160) PASS, including full suite, Drizzle checks, and production build. PG17 independent concurrency [job 116749482896](https://github.com/Satsetx4/karturt/actions/runs/38830127843/job/116749482896) PASS.
- Windows autocrlf/raw-blob/LF checkout integrity job: [job 116746753320](https://github.com/Satsetx4/karturt/actions/runs/38830127843/job/116746753320) — PASS.
- Disposable PostgreSQL 18 migration rehearsal: [run 38830127813](https://github.com/Satsetx4/karturt/actions/runs/38830127813) — PASS.
- Local npm ci, lint, typecheck, focused integrity/preflight tests, full Vitest suite, offline Drizzle checks, and production build: PASS. Full suite: 82 files, 598 tests. Lint emitted two existing warnings outside this change; npm ci reported five high-severity dependency advisories.
- git diff --check: PASS.

These are source and CI results only. They do not prove the live staging catalog is empty or authorize database access.

## Owner Windows handoff: fast-forward and update unsigned local metadata

Run the following in Windows PowerShell on the owner workstation. It only fast-forwards the existing clean owner clone and updates two existing owner-local JSON files in place. It does not open or print credentials, key material, or CA contents; create a signature; connect to PostgreSQL; execute SQL; apply a migration; change a provider; or deploy. Stop on any failed precondition. The source clone is expected at %USERPROFILE%\karturt-owner-gate-a, and the local directory at %LOCALAPPDATA%\KarturtStageOperator.

~~~powershell
$ErrorActionPreference = 'Stop'
$repoRoot = Join-Path $env:USERPROFILE 'karturt-owner-gate-a'
$secretDir = Join-Path $env:LOCALAPPDATA 'KarturtStageOperator'
$sourceBranch = 'codex/karturt-v1-staging-activation-20261015'
$baselineSha = '813ea44ffed4a025b49f51c3216ed6e7ea9eb2d0'
$fixedSourceSha = '8abfd871cef2b95aae09079f6fb8e9fea85f5d03'
$querySha256 = 'd7abf6b7592c53f9d480823d42c6d9ebbd9550fd4f5c276095a7e1892842c6fb'

if (!(Test-Path -LiteralPath $repoRoot -PathType Container)) { throw 'Owner clone not found; stop.' }
if (!(Test-Path -LiteralPath $secretDir -PathType Container)) { throw 'Owner-local directory not found; stop.' }
$originUrl = (& git -C $repoRoot remote get-url origin).Trim()
if ($LASTEXITCODE -ne 0 -or $originUrl -notmatch '(?i)github\.com[:/]Satsetx4/karturt(?:\.git)?$') { throw 'Unexpected origin; stop.' }
$branch = (& git -C $repoRoot branch --show-current).Trim()
if ($LASTEXITCODE -ne 0 -or $branch -ne $sourceBranch) { throw 'Owner clone is not on the expected activation branch; stop.' }
$head = (& git -C $repoRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $head -ne $baselineSha) { throw 'Owner clone is not at the confirmed clean baseline; inspect before continuing.' }
$dirty = @(& git -C $repoRoot status --porcelain)
if ($LASTEXITCODE -ne 0 -or $dirty.Count -ne 0) { throw 'Owner clone is not clean; stop without changing it.' }

$refspec = 'refs/heads/' + $sourceBranch + ':refs/remotes/origin/' + $sourceBranch
& git -C $repoRoot fetch --no-tags origin $refspec
if ($LASTEXITCODE -ne 0) { throw 'Fetch failed; stop.' }
$remoteSha = (& git -C $repoRoot rev-parse ('refs/remotes/origin/' + $sourceBranch)).Trim()
if ($LASTEXITCODE -ne 0 -or $remoteSha -ne $fixedSourceSha) { throw 'Remote branch is not the reviewed fixed SHA; stop.' }
& git -C $repoRoot merge --ff-only $fixedSourceSha
if ($LASTEXITCODE -ne 0) { throw 'Fast-forward failed; stop.' }
$head = (& git -C $repoRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $head -ne $fixedSourceSha) { throw 'Owner clone did not reach the reviewed SHA; stop.' }
$dirty = @(& git -C $repoRoot status --porcelain)
if ($LASTEXITCODE -ne 0 -or $dirty.Count -ne 0) { throw 'Owner clone is not clean after fast-forward; stop.' }

$queryPath = Join-Path $repoRoot 'docs\codex\wave13b2-read-only-catalog-preflight.sql'
$queryBytes = [System.IO.File]::ReadAllBytes($queryPath)
$queryHash = (Get-FileHash -LiteralPath $queryPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($queryHash -ne $querySha256 -or [Array]::IndexOf($queryBytes, [byte]13) -ge 0) { throw 'Query bytes/hash are not the approved LF-only bytes; stop.' }
$integrityOutput = & node (Join-Path $repoRoot 'scripts\verify-wave13b2-query-integrity.mjs') $repoRoot
if ($LASTEXITCODE -ne 0 -or $integrityOutput -notmatch 'WAVE13B2_QUERY_INTEGRITY_PASS') { throw 'Raw Git blob and working-tree integrity check failed; stop.' }

$manifestPath = Join-Path $secretDir 'wave13b2-staging-target-manifest.local.json'
$expectedStatePath = Join-Path $secretDir 'wave13b2-staging-expected-state.local.json'
if (!(Test-Path -LiteralPath $manifestPath -PathType Leaf) -or !(Test-Path -LiteralPath $expectedStatePath -PathType Leaf)) { throw 'Expected owner-local JSON files are missing; stop.' }
$manifestSddl = (Get-Acl -LiteralPath $manifestPath).Sddl
$stateSddl = (Get-Acl -LiteralPath $expectedStatePath).Sddl
$directorySddl = (Get-Acl -LiteralPath $secretDir).Sddl
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$expectedState = Get-Content -LiteralPath $expectedStatePath -Raw | ConvertFrom-Json
if ($manifest.readOnlyQueryApproval.status -ne 'NOT_SIGNED') { throw 'Manifest is not unsigned; do not rewrite it.' }
if ($manifest.provider.projectId -ne 'broad-star-40451875' -or $manifest.provider.branchId -ne 'br-orange-recipe-azed9f78' -or $manifest.provider.endpointId -ne 'ep-mute-firefly-azjcru4h' -or $manifest.provider.databaseId -ne '708081' -or $manifest.provider.databaseName -ne 'neondb' -or $manifest.provider.ownerRole -ne 'neondb_owner') { throw 'Manifest target identity is not the approved project/branch/endpoint/database/role; stop.' }
if ($expectedState.binding.projectId -ne 'broad-star-40451875' -or $expectedState.binding.branchId -ne 'br-orange-recipe-azed9f78' -or $expectedState.binding.endpointId -ne 'ep-mute-firefly-azjcru4h' -or $expectedState.binding.databaseId -ne '708081' -or $expectedState.binding.databaseName -ne 'neondb' -or $expectedState.binding.ownerRole -ne 'neondb_owner') { throw 'Expected-state target identity does not match; stop.' }
if ($manifest.migrationManifestFingerprint -ne 'e4a95a0a841872752cbcfa9b46107a99fdb469994280e25fc9f479a54b0312b4' -or $manifest.readOnlyQueryApproval.rootLineageAttestationSha256 -ne 'e5e2793cb2323f4c00bcb0ad83fcced2dc9ca5a9a68a8489014c6f469046780b' -or $expectedState.binding.rootLineageAttestationSha256 -ne 'e5e2793cb2323f4c00bcb0ad83fcced2dc9ca5a9a68a8489014c6f469046780b') { throw 'Migration or root-lineage binding does not match reviewed evidence; stop.' }
$caHashBefore = [string]$manifest.tls.caBundleSha256
$caTimeBefore = [string]$manifest.tls.caBundleObservedAtUtc
$fingerprintBefore = [string]$manifest.readOnlyQueryApproval.ownerPublicKeyFingerprint
if ($caHashBefore -notmatch '^[a-fA-F0-9]{64}$' -or [string]::IsNullOrWhiteSpace($caTimeBefore) -or $fingerprintBefore -notmatch '^[a-fA-F0-9]{64}$') { throw 'Existing CA digest/time or owner key fingerprint is absent/invalid; stop.' }

$expectedState.binding.finalSourceSha = $fixedSourceSha
$expectedState.binding.queryPacketSha256 = $querySha256
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$stateText = ($expectedState | ConvertTo-Json -Depth 100) + [Environment]::NewLine
$stateBytes = $utf8NoBom.GetBytes($stateText)
$sha = [System.Security.Cryptography.SHA256]::Create()
try { $expectedStateSha256 = [BitConverter]::ToString($sha.ComputeHash($stateBytes)).Replace('-', '').ToLowerInvariant() } finally { $sha.Dispose() }

$manifest.finalApprovalSourceSha = $fixedSourceSha
$manifest.readOnlyQueryApproval.sourceSha = $fixedSourceSha
$manifest.readOnlyQueryApproval.queryPacketSha256 = $querySha256
$manifest.readOnlyQueryApproval.expectedStateSha256 = $expectedStateSha256
$manifestText = ($manifest | ConvertTo-Json -Depth 100) + [Environment]::NewLine
[System.IO.File]::WriteAllText($expectedStatePath, $stateText, $utf8NoBom)
[System.IO.File]::WriteAllText($manifestPath, $manifestText, $utf8NoBom)

$stateHashReadback = (Get-FileHash -LiteralPath $expectedStatePath -Algorithm SHA256).Hash.ToLowerInvariant()
$manifestReadback = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$stateReadback = Get-Content -LiteralPath $expectedStatePath -Raw | ConvertFrom-Json
if ($stateHashReadback -ne $expectedStateSha256 -or $manifestReadback.readOnlyQueryApproval.expectedStateSha256 -ne $expectedStateSha256) { throw 'Expected-state hash binding readback failed.' }
if ($manifestReadback.finalApprovalSourceSha -ne $fixedSourceSha -or $manifestReadback.readOnlyQueryApproval.sourceSha -ne $fixedSourceSha -or $manifestReadback.readOnlyQueryApproval.queryPacketSha256 -ne $querySha256 -or $stateReadback.binding.finalSourceSha -ne $fixedSourceSha -or $stateReadback.binding.queryPacketSha256 -ne $querySha256) { throw 'Source/query binding readback failed.' }
if ($manifestReadback.readOnlyQueryApproval.status -ne 'NOT_SIGNED' -or $manifestReadback.tls.caBundleSha256 -ne $caHashBefore -or $manifestReadback.tls.caBundleObservedAtUtc -ne $caTimeBefore -or $manifestReadback.readOnlyQueryApproval.ownerPublicKeyFingerprint -ne $fingerprintBefore) { throw 'Unsigned status or protected metadata changed unexpectedly.' }
if ((Get-Acl -LiteralPath $manifestPath).Sddl -ne $manifestSddl -or (Get-Acl -LiteralPath $expectedStatePath).Sddl -ne $stateSddl -or (Get-Acl -LiteralPath $secretDir).Sddl -ne $directorySddl) { throw 'An ACL changed; stop and inspect.' }

"OWNER_METADATA_UPDATE=PASS"
"SOURCE_SHA=$fixedSourceSha"
"QUERY_SHA256=$queryHash"
"EXPECTED_STATE_SHA256=$stateHashReadback"
"APPROVAL_STATUS=NOT_SIGNED"
"DATABASE_CONNECTION=NOT_RUN"
~~~

On success, keep the manifest unsigned. The next action is owner review of the updated files and their hashes, then a separate owner-controlled signing ceremony. This handoff does not perform or authorize that signature.

## Gate state

- Query byte identity and exact digest pin: fixed and independently reviewed.
- Source checks and exact-SHA CI: PASS on the same reviewed source SHA; Gate A, PG17 concurrency, Windows raw-blob/LF checkout, and PG18 disposable rehearsal all passed.
- Live staging catalog: UNKNOWN; no SQL or database connection was performed by this remediation.
- stagingIsolationVerifiedEmpty: false.
- Migration trust anchor: still null; no migration, role creation, provider mutation, or deployment was performed.
- Main/default branch was not modified or merged.
