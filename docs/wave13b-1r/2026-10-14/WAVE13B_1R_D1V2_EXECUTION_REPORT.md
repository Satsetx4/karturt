# Wave 13B.1v2 — D1v2 Execution and Evidence Report

Date: 2026-10-14

Status: **NOT EXECUTED — ACCESS/SAFETY BLOCKED**

## Owner authorization and exact scope

On 2026-10-14 the owner stated: “ok. saya menyetujui penggunaan metode `psql` dan 26 statement baru. saya memberikan semua izin kepada kamu agar proyek ini segera selesai”. This records approval for one D1v2 run using the exact frozen 26-statement artifact, the reviewed one-process `psql` single-transaction method, the fixed staging target, and one possible compute wake. The broader direction authorizes safe product progress; it does not authorize D2/D3, migrations, production work, a changed target or method, additional SQL, or bypassing the source guards.

No connection, SQL, endpoint wake, migration, provider mutation, deployment, merge, paid action, or secret retrieval occurred in this pass.

## Verified source and artifact references

- Source evidence branch: `codex/wave13a-2-pg18-evidence-20261014` at `48b92abbe93fbd499448b6c885d3042cb49c2128`.
- Documentation base: `docs/wave13b-1r-preflight-remediation-20261014` at `c1692d3e474afba05489e79d2963169222b871e2`.
- Historical `main`: `96c84588ae0c13f68a17cffd997a3e583fb7da82`.
- The frozen fixed SQL reference remains Git blob SHA-1 `e011f0e843d42d53c7c4c76ba479854644137fc9`.
- Independent verification found exactly 26 ordered SQL blocks and matching per-statement fingerprints; ordered manifest SHA-256 is `ab7193d72520482a50081fdb65edc098fdac1cc9530d161430ddc6b9a0759db0`.
- No SQL block, fingerprint, manifest, or prior 29-statement artifact was changed or substituted.

## Non-waking target identity readback

A control-plane readback during this pass matched the owner-approved tuple:

| Resource | Readback |
|---|---|
| Organization | `satset` / `org-ancient-boat-57106549` |
| Project | `karturt-v1-staging-clean` / `falling-bread-33359184`, Free, PostgreSQL 18, Singapore |
| Branch | `staging` / `br-muddy-frost-azot13fb`, primary/default, unprotected, `init_source=parent-data` |
| Compute / endpoint | `ep-silent-butterfly-azrflu40`, idle/suspended, read-write endpoint |
| Direct host | `ep-silent-butterfly-azrflu40.c-3.ap-southeast-1.aws.neon.tech` |
| Database | `karturt_staging` / ID `702718` |
| Login role | `karturt_staging_owner`; provider metadata reports password authentication |

Metadata also reported a 31,686,656-byte logical size, zero tracked writes, `passwordless_access=true`, public connections not blocked, VPC not blocked, and an empty IP allowlist. These fields do **not** prove independent lineage, physical emptiness, unauthenticated SQL access, least-privilege grants, or zero cost. The provider's branch `updated_at` had no matching later operation in returned history; this discrepancy remains unresolved. Five returned provider operations were finished, with no reported failure. No endpoint operation was initiated here.

The Vercel staging project `karturt-review-staging-20261012` (ID `prj_Mv4rABJvDNAvSD78SVt5WbjFakEq`) remained SSO-protected; the readback found no latest deployment and zero deployments.

## Local prerequisites checked

Only presence/absence checks were made; no credential value or file content was read:

- `psql` executable available: **no**.
- Default PostgreSQL root certificate at `%APPDATA%\postgresql\root.crt`: **no**.
- Default `%APPDATA%\postgresql\pgpass.conf`: **no**.
- `PGPASSFILE` configured: **no**.
- Database connection environment variables present: **0**.
- No owner-provided secure credential path was available to this process.

Without a PostgreSQL client, verified CA, and owner-controlled credential path, the exact TLS-validated connection could not be guaranteed. `sslmode=verify-full` must verify the certificate chain and endpoint hostname; `prefer` is not an acceptable substitute. See the [PostgreSQL 18 psql documentation](https://www.postgresql.org/docs/18/app-psql.html) and [libpq SSL documentation](https://www.postgresql.org/docs/18/libpq-ssl.html).

The disposable PostgreSQL 18.6 workflow run `38586768128` passed the frozen script probes at separate SHA `1bdf371bb3d18265af2bb82602882b8ad93a5139`. It verifies psql behavior only; it is not Neon execution evidence.

## Classification and interpretation

Outcome: **NOT EXECUTED — ACCESS/SAFETY BLOCKED**. This is not `CLEAN_CATALOG_PREFLIGHT`, `UNCLEAN`, or a database `UNKNOWN` result because no SQL was run and no database response exists.

Even a successful 26-statement result would be a bounded catalog preflight only. It cannot establish independent branch lineage or physical emptiness. No expected-state privilege/object baseline is yet approved, so the result could not be classified clean until that baseline and any raw-ACL/effective-access discrepancies are reconciled. Query outputs include object and role names and raw ACLs; no raw output was created or retained in this pass.

Source safeguards remain closed: `stagingIsolationVerifiedEmpty=false` and `PINNED_STAGING_MIGRATION_APPROVAL_PUBLIC_KEY_PEM=null`. The approved target's parent-data lineage and open public-network posture still block staging migration/readiness. No DDL is authorized.

## Separate product evidence observed

PR #48 is still OPEN/DRAFT at `12539d83b8537d845015a2b0030d47162dae0203`, stacked on PR #23; neither is merged. Exact-SHA run `38225424975` passed Gate A and the independent PostgreSQL concurrency job for PR #48. The Wave 13A.2 source SHA `48b92abbe93fbd499448b6c885d3042cb49c2128` has Gate A run `38538027707` success, while its concurrency job was skipped. These do not satisfy staging, authenticated browser, owner-device, production-safety, or release gates.

## Work performed and non-events

- Fresh repository refs and the exact document/blob/manifest/count were verified.
- Non-waking target control-plane metadata was read.
- Local prerequisite presence was checked without revealing secrets.
- The fixed script and scope were not changed.
- No Neon SQL tool was used; no database connection, wake, SQL, migration, grant edit, branch edit, or retry was attempted.
- No merge, Vercel deployment, production action, additional resource, purchase, or paid-tier change occurred. Incremental spend: **Rp0**.
