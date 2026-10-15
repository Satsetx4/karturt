# Wave 13B.2 Free-only staging operator packet

Status: preparation only. No credential was created or handled, no role was created, and no SQL was run. The new target has been identified from sanitized provisioning metadata, but branch parent_id and catalog state remain UNVERIFIED / UNKNOWN. This packet does not authorize any database connection.

## Bound provider facts

| Field | Current value | State |
|---|---|---|
| Organization | org-ancient-boat-57106549 | Provisioning report |
| Project | broad-star-40451875 | Provisioning report |
| Project name | karturt-v1-synthetic-staging-20261015 | Provisioning report |
| Plan / compute | Neon Free / 0.25 CU | Provisioning report |
| Region / server | aws-ap-southeast-1 / PostgreSQL 18 | Provisioning report |
| Branch | br-orange-recipe-azed9f78 / main | Provisioning report |
| Branch parent_id | UNVERIFIED | Must be read back explicitly as null |
| Endpoint | ep-mute-firefly-azjcru4h | Provisioning report |
| Direct hostname | UNKNOWN | Must be read back; do not infer from endpoint ID |
| Database ID/name and owner role | UNKNOWN | Must be read back |
| Catalog state | UNKNOWN | No SQL run |

The provider's create/no-source response and the branch parent_id readback are separate evidence. At 2026-10-15T11:16:22Z, independent Neon metadata readbacks through both get_branch and list_branches omitted parent_id and reported init_source=parent-data. That response does not establish explicit null lineage, so parent_id and source lineage remain UNVERIFIED. Do not treat this branch as a verified root or connect until a later readback explicitly proves null parent/source IDs and independent review accepts that evidence.

## Source and hash binding

The current application-source commit is 0b1e3f525039496200b2bb5f698d312ded5cb3e3, with prior Gate A evidence tied to that exact SHA. The immutable migration-manifest fingerprint is e4a95a0a841872752cbcfa9b46107a99fdb469994280e25fc9f479a54b0312b4, computed from the 15 path/blob-hash pairs in src/db/migration-manifest.ts. A docs-only commit does not change the application-source SHA. Bind future SQL or migration approval to the final exact reviewed application-source commit governing the operation; use the current RC SHA only while application code remains unchanged. If application source changes, use its new reviewed exact SHA. Track the docs/operator commit separately. Run the verifier from the source-RC-descended preparation worktree at D:\!AGY\_worktrees\karturt-free13b2-agent-b-20261015; a separate docs-only checkout does not contain the required application-source history.

The fixed SQL packet SHA-256 is 987570baee76c2affef4a3f68c2ae114b3007174004d070232908c82f513751e. It is computed from the exact bytes of docs/codex/wave13b2-read-only-catalog-preflight.sql. Any query change requires a new hash and fresh owner approval. The 15 original migration SQL blobs and drizzle/meta/_journal.json remain immutable.

Current source still pins the old staging target, stagingIsolationVerifiedEmpty=false, and PINNED_STAGING_MIGRATION_APPROVAL_PUBLIC_KEY_PEM=null. This packet changes none of those. The old D1v2 approval for falling-bread-33359184 is not transferable. Migration remains disabled pending separate exact-target source review, positive root/empty-state evidence, and an owner-approved public trust anchor.

## Owner-local PostgreSQL 18 client and credentials

As of 2026-10-15, psql is not installed or resolvable in the current Windows environment (`Get-Command psql` returned unavailable). Install the official PostgreSQL 18 client on Ard's workstation before any future database access. PostgreSQL.org links to the EDB-certified Windows installer; select Command Line Tools only if component selection is offered. A local server is unnecessary. Confirm psql --version reports PostgreSQL 18. If unavailable, stop; do not substitute Neon MCP, an embedded client, or a shell wrapper.

Official download: https://www.postgresql.org/download/windows/

Use this owner-local path outside the repository:

    $secretDir = Join-Path $env:LOCALAPPDATA "KarturtStageOperator"
    New-Item -ItemType Directory -Force -Path $secretDir | Out-Null
    $operatorIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    icacls.exe $secretDir /inheritance:r /grant:r "$($operatorIdentity):(OI)(CI)(F)" "SYSTEM:(OI)(CI)(F)"

Only Ard's account and SYSTEM should have access. Ard must first set or rotate the database owner password privately through the provider, then store it in pgpass.conf in that directory with one exact direct hostname, port, database, role, and password entry. Type it locally. Never place a credential in a command, environment variable, repo, terminal transcript, or chat. Escape colon and backslash in the password field as PostgreSQL documents; apply and verify the protected ACL on the file. Do not sync this directory to cloud storage.

Password-file reference: https://www.postgresql.org/docs/current/libpq-pgpass.html

No credential is included here. If it cannot be placed directly into this owner-controlled file, stop before SQL. Never put the owner credential in Vercel. Runtime and migration roles are separate; neither is created by this work.

## CA provenance and connection settings

Download the Mozilla CA bundle distributed by curl from https://curl.se/ca/cacert.pem into the owner-only directory. Compare its local SHA-256 with the current hash on the official curl CA Extract page. Record retrieval time, source URL, and hash in the external target manifest.

Official provenance: https://curl.se/docs/caextract.html

Before invoking psql, complete these owner-only files after independently reading back the exact target: wave13b2-staging-target-manifest.local.json, wave13b2-staging-expected-state.local.json, wave13b2-read-only-query-approval.local.json, wave13b2-owner-signing-public.pem, cacert.pem, and pgpass.conf. Store only the Ed25519 public PEM in this directory; the verifier rejects anything that is not a SubjectPublicKeyInfo public-key PEM. The expected-state file must say ROOT_VERIFIED_CATALOG_UNKNOWN, record explicit null parent/source IDs, and leave every catalog observation null. Keep the detached approval separate from the expected-state file. The signing payload is compact UTF-8 JSON with no trailing newline and properties in this exact order: schemaVersion (integer 1), purpose, organizationId, projectId, branchId, endpointId, directHostname, databaseId, databaseName, ownerRole, parentId (JSON null), sourceProjectId (JSON null), applicationSourceSha, expectedStateSha256, queryPacketSha256, caBundleSha256, ownerPublicKeyFingerprint, issuedAtUtc, expiresAtUtc. The public-key fingerprint is SHA-256 over DER SubjectPublicKeyInfo bytes and must already be trusted through Ard's owner-controlled key record; do not trust a key merely because it accompanies the signature. Ard signs the exact JSON.stringify(payload) UTF-8 bytes with the existing owner-controlled Ed25519 private key and stores the detached standard-base64 signature in an artifact with exactly two properties: payload, signatureBase64. Do not create a key here. If the trusted key is unavailable, stop.

Use the offline verifier immediately before psql. It reads local files only, checks the Ed25519 signature and trust fingerprint, validates the fixed IDs and explicit null root/source lineage, confirms the application-source commit resolves and its source/migration tree is clean against that commit, checks the 15-minute approval window, and hashes the exact query, expected-state, and CA files. It emits only PASS or BLOCKED and never prints file contents or secret values. A docs-only commit does not become the application-source SHA. Supply the exact reviewed application-source commit; while source code remains unchanged, that is 0b1e3f525039496200b2bb5f698d312ded5cb3e3.

    $ErrorActionPreference = 'Stop'
    $repoRoot = 'D:\!AGY\_worktrees\karturt-free13b2-agent-b-20261015'
    $secretDir = Join-Path $env:LOCALAPPDATA 'KarturtStageOperator'
    $targetManifestPath = Join-Path $secretDir 'wave13b2-staging-target-manifest.local.json'
    $expectedStatePath = Join-Path $secretDir 'wave13b2-staging-expected-state.local.json'
    $approvalPath = Join-Path $secretDir 'wave13b2-read-only-query-approval.local.json'
    $publicKeyPath = Join-Path $secretDir 'wave13b2-owner-signing-public.pem'
    $credentialPath = Join-Path $secretDir 'pgpass.conf'
    $caPath = Join-Path $secretDir 'cacert.pem'
    $queryPath = Join-Path $repoRoot 'docs/codex/wave13b2-read-only-catalog-preflight.sql'
    $verifier = Join-Path $repoRoot 'scripts/verify-wave13b2-query-approval.mjs'
    $fixedQuerySha256 = '987570baee76c2affef4a3f68c2ae114b3007174004d070232908c82f513751e'
    $expectedIds = @{
      organizationId = 'org-ancient-boat-57106549'
      projectId = 'broad-star-40451875'
      branchId = 'br-orange-recipe-azed9f78'
      endpointId = 'ep-mute-firefly-azjcru4h'
    }

    foreach ($path in @($targetManifestPath, $expectedStatePath, $approvalPath, $publicKeyPath, $credentialPath, $caPath, $queryPath, $verifier)) {
      if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw 'A required owner-local or reviewed packet file is missing.' }
      if ((Get-Item -LiteralPath $path).Length -le 0) { throw 'A required preflight file is empty.' }
    }
    if (-not (Test-Path -LiteralPath $repoRoot -PathType Container)) { throw 'The reviewed repository path is unavailable.' }

    $targetManifest = Get-Content -LiteralPath $targetManifestPath -Raw | ConvertFrom-Json
    $expectedState = Get-Content -LiteralPath $expectedStatePath -Raw | ConvertFrom-Json
    $approvalDocument = Get-Content -LiteralPath $approvalPath -Raw | ConvertFrom-Json
    $approvedPayload = $approvalDocument.payload
    $applicationSourceSha = [string]$targetManifest.finalApprovalSourceSha
    $trustedPublicKeyFingerprint = (Read-Host 'Enter the SHA-256 fingerprint from the owner key record controlled by Ard').Trim().ToLowerInvariant()
    $provider = $targetManifest.provider
    $directHostname = [string]$provider.directHostname
    $databaseId = [string]$provider.databaseId
    $databaseName = [string]$provider.databaseName
    $ownerRole = [string]$provider.ownerRole
    $projectId = [string]$provider.projectId
    $branchId = [string]$provider.branchId
    $endpointId = [string]$provider.endpointId

    if ($targetManifest.state -ne 'ROOT_VERIFIED_CATALOG_UNKNOWN' -or $expectedState.state -ne 'ROOT_VERIFIED_CATALOG_UNKNOWN') { throw 'Independent root readback is incomplete.' }
    if ($provider.plan -ne 'Free' -or $provider.freeOnlyConfirmed -ne $true -or $provider.computeCU -ne 0.25 -or $provider.postgresMajor -ne 18 -or $provider.region -ne 'aws-ap-southeast-1') { throw 'The target no longer matches the reviewed Free staging envelope.' }
    if ($provider.creationMode -ne 'new-project-no-source-fields-reported' -or $null -ne $provider.parentId -or $null -ne $provider.parentProjectId -or $null -ne $provider.sourceProjectId) { throw 'Exact root/no-source lineage has not been read back.' }
    foreach ($field in $expectedIds.Keys) {
      if ([string]$provider.$field -ne $expectedIds[$field] -or [string]$approvedPayload.$field -ne $expectedIds[$field]) { throw 'The provider target does not match the signed target.' }
    }
    if ([string]::IsNullOrWhiteSpace($provider.lineageReadbackEvidenceReference)) { throw 'The independent root/no-source evidence reference is missing.' }
    if ([string]::IsNullOrWhiteSpace($directHostname) -or [string]::IsNullOrWhiteSpace($databaseId) -or [string]::IsNullOrWhiteSpace($databaseName) -or [string]::IsNullOrWhiteSpace($ownerRole) -or $applicationSourceSha -notmatch '^[a-f0-9]{40}$' -or $trustedPublicKeyFingerprint -notmatch '^[a-f0-9]{64}$') { throw 'A required target or trust binding is blank or malformed.' }
    if ($approvedPayload.directHostname -ne $directHostname -or $approvedPayload.databaseId -ne $databaseId -or $approvedPayload.databaseName -ne $databaseName -or $approvedPayload.ownerRole -ne $ownerRole -or $approvedPayload.applicationSourceSha -ne $applicationSourceSha) { throw 'The signed target settings do not match the connection settings.' }
    if ($targetManifest.tls.sslmode -ne 'verify-full' -or $targetManifest.tls.channelBinding -ne 'require' -or $targetManifest.tls.caBundleSource -ne 'https://curl.se/ca/cacert.pem') { throw 'The reviewed TLS settings are not present.' }
    if ($expectedState.providerObserved.parentId -ne $null -or $expectedState.providerObserved.parentProjectId -ne $null -or $expectedState.providerObserved.sourceProjectId -ne $null) { throw 'The expected-state baseline lacks explicit null lineage observations.' }
    if ($expectedState.providerObserved.directHostname -ne $directHostname -or $expectedState.providerObserved.databaseId -ne $databaseId -or $expectedState.providerObserved.databaseName -ne $databaseName -or $expectedState.providerObserved.ownerRole -ne $ownerRole) { throw 'The expected-state baseline is not bound to this target.' }

    $queryPacketSha256 = (Get-FileHash -LiteralPath $queryPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($queryPacketSha256 -ne $approvedPayload.queryPacketSha256 -or $queryPacketSha256 -ne $fixedQuerySha256) { throw 'The query file does not match the fixed reviewed and signed digest.' }
    if ((Get-FileHash -LiteralPath $expectedStatePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $approvedPayload.expectedStateSha256) { throw 'The expected-state file does not match the signed digest.' }
    if ((Get-FileHash -LiteralPath $caPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $approvedPayload.caBundleSha256) { throw 'The CA bundle does not match the signed digest.' }

    $preflightFiles = @($targetManifestPath, $expectedStatePath, $approvalPath, $publicKeyPath, $credentialPath, $caPath, $queryPath, $verifier)
    $preflightHashes = @{}
    foreach ($path in $preflightFiles) { $preflightHashes[$path] = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() }

    $psqlExe = (Get-Command psql -ErrorAction Stop).Source
    $psqlVersion = (& $psqlExe --version 2>$null | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $psqlVersion -notlike 'psql (PostgreSQL) 18.*') { throw 'Install and verify the official PostgreSQL 18 psql client before continuing.' }

    $verifierHash = $preflightHashes[$verifier]
    if ($verifierHash -ne 'd079d385f98ad51bcaece7f12025241ea4841af5a747cbabc3b15b4e8acab5ec') { throw 'The offline verifier differs from the separately reviewed file hash.' }
    & node $verifier --repo-root $repoRoot --secret-dir $secretDir --application-source-sha $applicationSourceSha --trusted-public-key-fingerprint $trustedPublicKeyFingerprint
    if ($LASTEXITCODE -ne 0) { throw 'Offline approval verification returned BLOCKED.' }
    foreach ($path in $preflightFiles) {
      if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $preflightHashes[$path]) { throw 'A preflight file changed during verification.' }
    }

    if (Test-Path Env:PGPASSWORD) { Remove-Item Env:PGPASSWORD }
    $env:PGHOST = $directHostname
    $env:PGPORT = '5432'
    $env:PGDATABASE = $databaseName
    $env:PGUSER = $ownerRole
    $env:PGSSLMODE = 'verify-full'
    $env:PGSSLROOTCERT = $caPath
    $env:PGCHANNELBINDING = 'require'
    $env:PGCONNECT_TIMEOUT = '8'
    $env:PGPASSFILE = $credentialPath
    $psqlArgs = @(
      '-X', '-w', '-P', 'pager=off', '-v', 'ON_ERROR_STOP=1',
      '-v', 'owner_signed_query_approval_verified=on',
      '-v', "target_project_id=$projectId",
      '-v', "target_branch_id=$branchId",
      '-v', "target_endpoint_id=$endpointId",
      '-v', "approved_source_sha=$applicationSourceSha",
      '-v', "query_packet_sha256=$queryPacketSha256",
      '-v', "expected_database=$databaseName",
      '-v', "expected_owner_role=$ownerRole",
      '-f', $queryPath
    )
    & $psqlExe @psqlArgs
    if ($LASTEXITCODE -ne 0) { throw 'Read-only catalog preflight failed; preserve output and do not retry blindly.' }

The verifier must print PASS immediately before this single psql invocation; any BLOCKED result or changed file means stop. The query itself rejects mismatched project/branch/endpoint IDs, database/role, PostgreSQL major, read-only transaction, or inactive TLS before catalog reads. It checks TLS activity on the actual backend; sslmode=verify-full checks the trusted CA and requested hostname in libpq. Never use a credential-bearing URL, PGPASSWORD, pooler, IP Allow, Private Networking, --single-transaction, or weaker TLS fallback. If hostname or CA verification fails, stop.

PostgreSQL documents verify-full as checking the trusted CA and the requested host name: https://www.postgresql.org/docs/current/libpq-connect.html. Neon describes psql SCRAM channel binding: https://neon.com/blog/postgres-needs-better-connection-security-defaults.

## Read-only query approval

The fixed bounded packet is docs/codex/wave13b2-read-only-catalog-preflight.sql; its SHA-256 is 987570baee76c2affef4a3f68c2ae114b3007174004d070232908c82f513751e. Missing psql variables or a false approval assertion exits with code 3. The packet enables psql's ON_ERROR_STOP behavior, so a server-side error stops the script. A successful script commits a read-only transaction; an error or disconnect before COMMIT rolls it back. The owner_signed_query_approval_verified=on value is set only after the offline verifier exits PASS.

Before any connection, prepare a separate, short-lived owner Ed25519 approval for purpose karturt-v1-staging-read-only-catalog. Ard must first independently verify the provider readback. Bind the signature to organization, exact project/branch/endpoint/direct hostname, database ID/name, owner role, explicit parent_id=null and no-source evidence, exact reviewed application-source SHA, completed expected-state file SHA-256, query packet SHA-256, CA bundle SHA-256, owner public-key fingerprint, and issue/expiry times no more than 15 minutes apart. Store the detached artifact separately from the completed expected-state file; compute and freeze expectedStateSha256 before signing to avoid a circular hash. The offline verifier checks the fixed payload order, Ed25519 signature, trusted key fingerprint, IDs, source SHA, all three file hashes, root lineage, and expiry. Keep key/approval files outside the repository; the local approval artifact is ignored by Git.

No signed query approval exists now, so the verifier returns BLOCKED and no database connection is authorized.

The packet's first server statement is BEGIN READ ONLY; it applies 5-second statement and 1-second lock timeouts, then reads only catalog metadata. It does not select application rows, write, migrate, create roles/extensions, or grant privileges. It reports database and role identity, server version, TLS, role flags/memberships, database/schema/relation/routine ACLs, extensions, default ACLs, and Drizzle-journal presence. It also counts and inventories every type in non-system schemas, including enums, domains, composites, ranges, multiranges, and generated array types. The inventory marks array companions, implicit relation row types, standalone composites, and extension-owned types, with associated relation, extension, owner, and ACL details for review. The full inventory has a 200-row count guard; if it exceeds the cap, the query aborts before listing so output cannot silently truncate. A separate empty-state guard expects zero non-extension standalone application types, while allowing extension-owned types, array companions, and implicit relation row types to remain visible for human review. This catches a partial migration that created enums but not its tables or Drizzle journal. Stop on truncation, timeout, mismatch, or unexpected objects; reconcile before any retry.

PostgreSQL cannot independently report Neon project, branch, or endpoint IDs. Compare the exact direct hostname and database/role readback to provider evidence and the signed target manifest. SQL output cannot prove root lineage.

## Independent expected-state baseline

docs/codex/wave13b2-staging-expected-state.template.json is the separate baseline. It expects zero application relations, `standaloneApplicationTypeCount: 0` for non-extension standalone application types, and no Drizzle journal. Complete provider observations from create metadata and a fresh readback. Catalog observations, including the full non-system type count, standalone application type count, and inventory, remain UNKNOWN until the owner-approved packet is run.

Before migration, require Free/0.25 CU, Singapore, PG18, exact project and branch IDs, explicit parent_id=null, no source project, and matching direct endpoint/database/role. The catalog expectation is zero application-owned relations, `standaloneApplicationTypeCount: 0` for non-extension standalone application types, and no Drizzle journal. Record and review built-in schemas, routines, extensions, owners, and ACLs; do not infer application data from platform-provided objects. Project creation alone is not proof of catalog emptiness.

## Free-only scope and role separation

Use only Neon Free features and one small direct catalog connection. The public endpoint is accepted for synthetic-only staging as a residual risk. No paid IP controls, private networking, premium add-ons, paid Vercel/GitHub features, upgrade, or billed overage. Record current Free limits and relevant project headroom; do not block only because private invoice history is unavailable.

Use the project owner role only for the separately approved read-only inspection. After future migration approval, use a distinct runtime role with only required application DML, and a distinct migration role with only reviewed schema-change permissions. Runtime must have no schema CREATE, CREATEROLE, CREATEDB, SUPERUSER, or BYPASSRLS. No role or grant mutation is part of this preparation.

## Future one-time migration signature gate

Read-only approval does not approve migration. Current migration code has no pinned public key. A future, separate source change must bind the new exact target, preserve stagingIsolationVerifiedEmpty=false until lineage and empty catalog are independently reviewed, and pin an owner-approved Ed25519 public key in reviewed source. The private key stays on Ard's device.

The migration artifact schema in src/db/migration-approval.ts requires purpose karturt-v1-staging-migration; random 64 lowercase hex authorizationId; exact 40-character source SHA; 64-character target and migration fingerprints; canonical UTC issuedAt/expiresAt no more than 15 minutes apart; and a standard-base64 Ed25519 signature over the serializer's exact ordered JSON payload. The final artifact must be stored in an owner-controlled local file and consumed once after the app displays its target/source challenge. Do not create a key or artifact now, and do not transfer private key or credential to an agent.

Current status: provider IDs are bound as reported; parent_id is UNVERIFIED; hostname, database ID/name, and owner role are UNKNOWN; catalog is UNKNOWN; read-only query approval is NOT SIGNED; migration key is null; SQL execution count is zero.
