# F0 read-only baseline — 2026-10-24 (Asia/Jakarta)

**Evidence layer:** authenticated GitHub, Neon and Vercel connector readbacks; no SQL, file secrets, provider mutation, branch merge, production action, or other live test occurred. Snapshot can expire; always refresh before F2/F3/F4.

## GitHub

- Repository: `Satsetx4/karturt`, public, ID `1386907262`.
- Protected `main` full commit SHA: `96c84588ae0c13f68a17cffd997a3e583fb7da82`.
- Current principal planning branch `docs/fast-track-v1-f0-20261024` started from that SHA. Branch commits described in draft PR; none merged.
- Legacy security PRs: #74 OPEN/DRAFT head `377d2c17aba4460cd52c2f00c93ad0f84b74ef16` based on #73's `def8a9cc...`; #73 OPEN/DRAFT based on #67's `fdf97c...`; #67 OPEN/DRAFT based on `main`. #65 older Gate V1 DRAFT; #71 source audit DRAFT. These are **not** main.
- Financial changes potentially relevant and still unmerged/draft: #48 12-month dues/receipts; #55 future cash annual reports; #57 arrears positions; #18 future-month resident guard; #23 combined integration. **Per-file source diff audit remains TODO**, not implicitly ported or merged.
- Latest relevant historical Gate A for #74: run `39878766542`, SHA `377d2c17aba4460cd52c2f00c93ad0f84b74ef16`, attempt 2 SUCCESS; independent PostgreSQL concurrency **SKIPPED**.
- Actual current `package.json` exposes `test:postgres-concurrency`, lint, typecheck, unit, integration, constraints, authorization, security closure and build. The availability of a script is **not** execution proof.
- Existing `docs/delivery-readiness-report.md` dated 2026-10-05 records historic prior-source F3 PASS and backup/restore on Neon project `wispy-sky-99637283`, **not a current 2026-10-24 RC PASS**.
- Existing `docs/mvp-single-rt-scope-freeze.md` calls for one operational RT while preserving multi-tenant guards and `rt_unit_id` in schema.

## Neon read-only snapshot

- Project `super-band-12770762` currently exists with name `karturt-v1-solo-provenance-20261022`, region `aws-ap-southeast-1`, PostgreSQL version **18**, creation source `console`, and current connected principal has **effective project permission ADMIN**. This is only control-plane identity evidence; do not assert viewer.
- Branch listing returns primary/default `br-solitary-king-a1qdsiln`, name `karturt-solo-root-20261022`, current state `ready`, and `init_source=parent-data`; no verified independent root/empty-data provenance. Thus **staging isolated/synthetic-only = UNKNOWN**, **SQL catalog = UNKNOWN**, **TLS client proof = UNKNOWN**. Initial default branch or zero usage does not prove empty/synthetic-only content.
- Historic endpoint `ep-falling-mountain-a1hlzrdb` was previously named as candidate; **current endpoint binding NOT verified in this readback**. Do not migrate using historical endpoint ID alone.
- Neon subscription Free status requires an explicit reliable current plan readback; do not infer from project name. No DB connection, schema read, SQL or mutation executed.

## Vercel read-only snapshot

- Scoped Vercel project search `karturt` returned a single matching entry: `karturt-review-staging-20261012`, project ID `prj_Mv4rABJvDNAvSD78SVt5WbjFakEq`, account/team ID `team_tAhOeJANcBil7FonGHlzKwCs`. This is **not** proof that it is the approved F2/F4 target, its deployment history is clean, its plan is Hobby, or that no other accounts contain projects.
- Production domains, secret values and deployments were **not inspected**. No Vercel mutation.

## F0 actions and open issues

- Owner's one-shot Fast Track transition is recorded in `MASTER-PLAN.md` and decision/matrix file (proposed branch).
- Master issue [#78](https://github.com/Satsetx4/karturt/issues/78). Phase issues: [F0 #79](https://github.com/Satsetx4/karturt/issues/79), [F1 #80](https://github.com/Satsetx4/karturt/issues/80), [F2 #81](https://github.com/Satsetx4/karturt/issues/81), [F3 #82](https://github.com/Satsetx4/karturt/issues/82), [F4 #83](https://github.com/Satsetx4/karturt/issues/83).
- Need F0 Codex deep audit of integration graph/features and current file-level source to PR map before labeling F0 PASS; staging identity remains BLOCKED on real provenance. Do not use protected app `main` or staging migration before guards.

## Six original roadmap lanes at snapshot

1. Inventory/CI: PARTIAL (main/PR/CI inventory; code feature gap audit outstanding).
2. Old Solo Owner Gate: DEFERRED for V1 (historical ledger work not PASS).
3. Staging Identity & Isolation: UNKNOWN/BLOCKED (Neon branch lineage).
4. PostgreSQL 18 Readiness + Migration: PG18 control-plane reported; actual TLS/catalog and migrations BLOCKED.
5. Staging UAT + Release Candidate: NO-GO until live regression/concurrency.
6. Preview/Production: NO-GO until F4 evidence, production owner GO.

**No phase F0–F4 PASS is claimed in this initial snapshot.**
