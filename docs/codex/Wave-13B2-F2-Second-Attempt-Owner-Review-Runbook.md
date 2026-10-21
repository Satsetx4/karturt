# Wave 13B.2 F2 — Second Attempt Owner Review Runbook

**Status: `BLOCKED — NOT AUTHORIZED`.** This runbook prepares an owner review only. It does not authorize a database connection, SQL, or F2 execution. A separate, fresh owner decision is required after the audit and offline checks below.

The candidate is based on parent source `86929ecab7d5c594ae145c2614eca25aec1c96d3`. That is not the final source binding. After review, use the exact final 40-character source commit SHA; any later source change requires a new review and fresh bindings.

## Roles and evidence boundary

- An agent may review checked-in code and non-secret documentation in the candidate repository. It must not access Neon, run F2, sign or create owner approval, access owner private keys, DPAPI material, `pgpass`, or private attempt evidence, or make provider changes.
- Only the owner may refresh provider metadata, inspect owner-only local material, prepare the fresh approval, and decide whether to authorize a later run.
- Keep manifests, approvals/signatures, fingerprints, CA bundles, credentials, raw output, and attempt evidence in the protected local folder only. Never add them to Git or copy them into this document.
- Preserve every first-attempt marker and evidence byte-for-byte. Do not open, reuse, copy, rename, move, clear, or overwrite first-attempt material. A second attempt starts from a new source-bound folder and fresh owner inputs.

## Owner review sequence

1. **Freeze and review the candidate.** Confirm the PR head and local reviewed commit are the same exact final SHA, the branch is based on the stated parent, the diff contains no SQL or migration changes, and applicable exact-head CI is green. Review the PowerShell 7 runner guard and require the offline PG18 regression and query-integrity checks to pass on that source. A skipped or branch-filtered check is `UNVERIFIED`, not a pass. Any code or source change restarts this review.

2. **Refresh target identity and lineage.** Through the owner's approved provider process, freshly verify the complete organization, project, branch, endpoint, database, role, region, PostgreSQL version, compute, and plan tuple. Verify the intended branch's direct ancestry/lineage independently. Prior metadata is only a comparison reference, not current evidence. `UNKNOWN`, mismatch, or unresolved lineage is a stop; a preparation-only exception cannot authorize execution. The target must still be on the Free plan and within the previously approved Free compute scope; do not upgrade, incur overage, or mutate provider state.

3. **Create a new protected local attempt directory.** Only after the final source SHA is fixed, the owner may prepare `%LOCALAPPDATA%\KarturtStageOperator\f2-attempt-<full-final-source-SHA>`. Verify that the destination is new, protected by the intended owner-only ACL, and has no reparse-point/junction redirection in the relevant path. If the directory or its source-bound attempt marker already exists, stop and preserve it; do not reuse it. Never derive this folder from the parent SHA or the first attempt.

4. **Rebind all owner inputs to the final source.** The owner must independently verify the raw query bytes and SHA-256 against the reviewed candidate, the migration snapshot/fingerprint, and the exact final source SHA. The 2026-10-20 decision record lists query SHA-256 `bd4a9c725268dc80e3eab10d28da585da3399e6f75db676c29e9e014c5127c49` and a 15-blob migration fingerprint `e4a95a0a841872752cbcfa9b46107a99fdb469994280e25fc9f479a54b0312b4`; these are comparison references only and must be freshly recomputed. Any difference requires review and a fresh binding. Prepare a fresh owner-local expected-state copy with `binding.finalSourceSha` set to that SHA and every `catalogObserved` value still `null`. Refresh the trusted CA source and digest, and confirm the trusted public-key fingerprint. Do not treat a checked-in template, stale digest, prior manifest, or prior signature as a final binding.

5. **Make a fresh owner approval and run offline preflight.** The owner alone creates and signs a new approval whose payload binds the exact final source, query, expected-state, CA digest, trusted key fingerprint, and the target identifiers defined by the approval contract. The owner must independently refresh and verify the remaining target tuple, Free-plan scope, migration snapshot, and lineage through the approved owner process, then record the refreshed evidence in the manifest. Offline preflight checks local source and manifest consistency; it does not refresh provider metadata or prove direct ancestry. Do not assume every manifest field is directly signed. The approval must be valid, unexpired, and have at least 120 seconds remaining at the required check. The owner then reviews the offline preflight result, including the expected-state binding, source/query identity, ACL, reparse checks, and CA/approval checks. Do not proceed on warnings, incomplete evidence, or any mismatch.

6. **Stop for a separate execution decision.** Passing preparation checks does not authorize F2. Keep catalog state `UNKNOWN` and F2 `BLOCKED` until the owner completes the audit and records a distinct, explicit decision for the exact reviewed source and target. This runbook gives agents no execution authority.

## Stop conditions

Stop, preserve local evidence, and report the unresolved gate if any source or target binding differs; lineage or Free-plan state is unknown; query or migration identity changes; expected-state observations are not all `null`; the fresh approval is absent, invalid, stale, or below the validity window; CA provenance/digest is uncertain; ACL or reparse checks fail; the destination or marker already exists; exact-source CI or offline PG18 regression is not green; or a separate owner execution decision is missing. Do not retry with old material.

## Prohibited actions

Agents must not access Neon or other provider consoles/APIs, execute F2 or SQL, use owner signatures/private keys/DPAPI/`pgpass`, alter SQL or migrations, mutate provider resources, deploy, change production, or merge. No such action is authorized by this document.

See [the owner decision record](Wave-13B2-F2-Owner-Decision-Record-2026-10-20.md), [the target manifest template](wave13b2-staging-target-manifest.template.json), and [the expected-state template](wave13b2-staging-expected-state.template.json) for review context. Templates are not approvals and must not be edited to pin the final source.
