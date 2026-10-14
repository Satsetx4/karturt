# Wave 13A.1 Owner Next Gate

Wave 13A.1 is complete with verdict **REMEDIATION PARTIAL**. Stop here. No Wave 13B action is included in this report or branch.

## Current state

- Source branch codex/wave13a-1-focused-remediation-20261014 is published at bb566ee432b5abf1905699c01ed70e9ed34624c0.
- The development migration command is restored and restricted to the exact local development database target.
- The operator timeout path is bounded and fail-closed at the JavaScript helper level. Process exit after a timed-out live transport remains unverified.
- The staging runtime isolation flag is false.
- The pinned owner Ed25519 approval key is null. Staging migration execution remains disabled.
- The 14 migrations and Drizzle journal are unchanged.
- No Neon SQL, connection, mutation, migration, or Vercel deployment occurred.
- No CI run or status check exists for the source SHA.

## Required gates before a separate Wave 13B authorization

1. Review staging provider identity, public-network exposure, and role grants from current provider state. This report contains no current provider security attestation.
2. Obtain separate authorization for a server-enforced read-only SQL preflight with a fixed target scope. Do not connect or query as part of this Wave 13A.1 report.
3. Review the source and approval protocol, then pin an owner public key only under a separately reviewed and authorized source change. The key is currently null and must stay null until that gate is completed.
4. Obtain a real external Ed25519-signed, short-lived, one-shot approval bound to the exact reviewed source SHA, target manifest, and migration manifest. Do not synthesize an owner signature or use a shortcut approval.
5. Only after the prior gates are independently satisfied, consider a one-shot migration and separate read-only post-migration checks. Treat migration, application runtime enablement, and Vercel deployment as separate decisions.
6. Before accepting timeout behavior as runtime-verified, use an explicitly disposable PostgreSQL facility to observe a timed-out active client and natural CLI exit. Record the database outcome as unknown until separate read-only reconciliation. Do not retry automatically.

No gate above was executed here. The old staging project and endpoint remain excluded and must never be used as a fallback.
