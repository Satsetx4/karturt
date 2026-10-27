# RELEASE FIRST V1 — R3 UAT fixture ledger

**Template only.** Freeze this ledger before authorized Preview or staging UAT. It does not authorize fixture creation or app access. Use synthetic aliases and expected aggregates only; do not record real names, addresses, phone numbers, emails, credentials, cookies, session IDs, or raw database rows.

## Run identity

| Field | Value / evidence reference |
|---|---|
| Candidate PR / branch / full SHA | |
| Exact-head Actions run ID and attempt | |
| R2 PASS evidence at the same SHA | |
| Target-bound R3 authorization reference | |
| Neon project / branch / endpoint / database | |
| PostgreSQL version, region, and plan readback | |
| App instance SHA / mode / origin | |
| Fixed business date and timezone | |
| Independent verifier | |

## Synthetic fixture ledger

Define each fixture by an opaque alias. Record no identity or credential values. Expected periods and amounts must come from the owner-approved fixture plan; leave values blank until then.

| Alias | App role | Tenant / household alias | Periods and states | Expected amount totals | Planned app flow | Expected result / negative check | Evidence reference |
|---|---|---|---|---|---|---|---|
| | Resident | | | | | | |
| | Treasurer | | | | | | |
| | Chairman | | | | | | |
| | System Admin | | | | | | |

## Independent financial oracle

Calculate these values from the frozen fixture and operation ledger, before comparing with application reports. Keep per-row financial details owner-only; record only sanitized aggregates here.

| Check | Expected value from fixture ledger | Observed app value | Independent persistence result | Verifier / evidence |
|---|---|---|---|---|
| Number of billing periods in the selected year | | | | |
| Current and overdue eligible periods | | | | |
| Future periods excluded from arrears and resident requests | | | | |
| Active payment total equals active allocation total | | | | |
| Reversed allocations excluded from active totals | | | | |
| Paid and waived periods excluded from cash allocation | | | | |
| Monthly, annual, arrears, and Treasurer report totals | | | | |
| Retry and duplicate operations produce no extra financial rows | | | | |
| Cross-account and cross-tenant denials leave business state unchanged | | | | |

## Scenario references

| Scenario | Run/scenario ID | Application action and timestamp reference | Observer reference if concurrent | Persisted outcome and negative checks | Verifier / evidence |
|---|---|---|---|---|---|
| R3-AUTH | | | | | |
| R3-DUES | | | | | |
| R3-TRANSFER | | | | | |
| R3-CASH | | | | | |
| R3-RETRY | | | | | |
| R3-REVERSAL | | | | | |
| R3-REPORT | | | | | |
| R3-RACE-REQUEST | | | | | |
| R3-RACE-VERIFY | | | | | |
| R3-RACE-CASH | | | | | |
| R3-RACE-REVERSAL | | | | | |

## Result

| Gate | Status | Exact-SHA evidence or stop reason |
|---|---|---|
| Frozen fixture ledger reviewed before actions | NOT RUN | |
| Required app role and negative authorization checks | NOT RUN | |
| Financial oracle reconciled independently | NOT RUN | |
| Each concurrent action correlated to its structural observer sample | NOT RUN | |
| All expected and observed results match | NOT RUN | |
| Overall R3 UAT | NOT RUN | |

Any stale SHA, incomplete R2 evidence, unapproved app origin, non-synthetic content, unexpected mutation, missing operation correlation, or unexplained aggregate mismatch keeps the affected row `FAIL`, `UNKNOWN`, or `UNVERIFIED`. Do not repeat a staging action or race without fresh target-bound authorization.
