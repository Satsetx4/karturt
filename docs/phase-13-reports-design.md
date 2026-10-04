# F13 — Reports Design and Contract Freeze

**Status:** Frozen before implementation
**Branch:** feat/phase-13-reports
**Base:** main at 322e439267cd4e5d5552f7816ed1d3a3eebf533c

## Verified baseline

- Exact main SHA: 322e439267cd4e5d5552f7816ed1d3a3eebf533c.
- Exact-SHA GitHub Actions run 37182687768 (Test Gate A): completed successfully.
- Local migration journal: 14 entries; latest tag is 0013_phase_12_household_management.
- Neon development only: project billowing-base-57949906, branch karturt-development / br-crimson-band-az6i637k, database neondb; 14 entries and latest hash 994bcc9376b207fdc0668312cc68cab3c2cec46bc6101edc4c2b5ef7f51c4a85 (0013).
- Fresh read-only Gate C audit: 32/32 anomaly categories zero.
- Fresh read-only F12 household lifecycle global checks: 11/11 zero. The retained F12 fixture checks are not rerun by this baseline survey because their smoke manifest is not present in the clean checkpoint.
- Full npm audit: five High package entries that all propagate from the single existing development-only braces@3.0.3 advisory, GHSA-vfj7-8cjw-p6xm / RA-2026-F12-001. No other High/Critical root finding is accepted. Production-only audit: zero vulnerabilities.
- Production was not queried or changed.

## F13 scope

Deliver Chairman-only read access for monthly and yearly reports, arrears, and transfer-versus-cash totals. No financial writes, audit writes, exports, or schema changes are part of F13.

Explicitly out of scope: F14 CSV/Excel/download/export and formula-injection handling; F15 audit viewer/search; F16 official lifecycle; System Admin reporting; materialized/cached reports; financial mutation paths.

Expected migration head remains 0013. Do not create 0014 or reporting tables/views/snapshots for performance.

## Frozen amount formulas

Calculate by monthly due and retain its household ID throughout:

- Target awal (target) = original monthly_dues.amount; zero for NOT_DUE.
- Target efektif (effectiveTarget) = original amount + all due_adjustments.amount_delta; zero for NOT_DUE.
- Diterima (received) = sum of payment_allocations.amount joined to its payment, excluding every payment present in payment_reversals.
- Transfer = active allocation amount joined to payments.method = transfer.
- Tunai = active allocation amount joined to payments.method = cash.
- Dibebaskan (waived) = waiver_items.amount only when the due status is WAIVED; zero otherwise.
- Belum diterima (outstanding) = effectiveTarget - received - waived.

All monetary values are integer Rupiah and must remain safe integers. Do not sum payments.amount by report month. The month belongs to the monthly_due reached through payment_allocations, even when payment was verified in another month.

Per-due checks fail closed with a dedicated ReportInvariantError when values are unsafe, negative, unsupported, or inconsistent. Required checks:

- Transfer + Tunai = Diterima.
- Target efektif = Diterima + Dibebaskan + Belum diterima.
- NOT_DUE has zero target, effective target, received, transfer, cash, waived, and outstanding. It increments notDueCount and does not increment obligationCount.
- A real WAIVED obligation remains in target/effective target and increments waivedCount; its waiver item is reported separately. It is never counted as NOT_DUE.
- A missing/duplicate/mismatched waiver ledger for a WAIVED row is an invariant failure. A non-WAIVED row must not silently absorb a waiver item.
- Do not reuse getDueFinancialBalances().outstanding for WAIVED rows as final reporting outstanding. Read the waiver ledger and apply the reporting formula.
- PENDING request claims are operational display state only and contribute zero to received. A pending request attached to overdue unpaid amount remains arrears.
- Payment state labels do not create receipts; only valid active allocations do.

Counts: obligationCount includes real unpaid, paid, and waived dues; waivedCount is a subset; notDueCount is separate. overdueCount counts due rows with outstanding > 0 and dueDate before the supplied Jakarta business date.

## Period, arrears, and lifecycle semantics

- Reports are grouped by billing year/month on monthly_dues, never by payment.created_at, verified_at, or request date.
- Transfer/cash is split at allocation amount, grouped by monthly_due_id and payment method, excluding reversed payments.
- Arrears means outstanding > 0 AND dueDate < Jakarta business date (strictly earlier). The database contract sets the due day to the 10th: a May due is not overdue on May 5 and is overdue on May 20.
- A pending request can show the “Menunggu konfirmasi” badge on an arrears period but never reduces outstanding.
- A reversed payment contributes zero to received, transfer, and cash.
- Every due and arrears group is keyed by household_id. Never group debt by house_id, house number, resident name, or current household. Replacement keeps old history with the old household; a new household at the same physical house starts its own history.
- Arrears household display includes house number/label, relevant resident name(s), lifecycle label (Aktif/Riwayat), household start/end dates, overdue periods, pending badge where relevant, and total outstanding. Multiple lifecycle entries at one house number remain separate.

## Authorization and request contract

Dedicated permission: report:read:rt.

- Grant only to rt_chairman and include it in the RT-scoped permission set.
- Resident, Treasurer, and System Admin are denied. This does not grant Chairman any payment verification or mutation permission.
- The authenticated principal supplies role and rtUnitId. Never accept client role or tenant parameters as authorization scope.
- Revalidate an active Chairman account and exactly one assignment active on the Jakarta business date in the report service, in addition to checking report:read:rt.
- GET /api/chairman/reports?year=2026 is the only report API route. Accept only a single year query parameter; reject unknown/repeated parameters (including rtUnitId and role). Validate the 2000–2200 range and return a safe 400 for invalid year input.
- When year is omitted, use the current Jakarta year if available for the principal RT, otherwise its newest available year, otherwise the current Jakarta year. Return RT-scoped availableYears. A valid year with no billing_year for that RT returns an empty year (12 zero monthly entries and no arrears), without disclosing other tenants.
- All reads are GET/read-only. Do not mutate due, payment, request, allocation, adjustment, waiver, or audit tables. Set cache-control: no-store. Map invariant failures to a generic safe error without SQL details or internal identifiers.

## Response and mobile UI

Response includes:

- year and availableYears;
- yearly amount and count totals;
- monthly entries Jan–Dec, including empty months as zero rows;
- arrears.totalOutstanding, arrears.count (overdue due rows), arrears.householdCount, and arrears.households with period details.

The normal UI uses these Indonesian labels: Target awal, Target efektif, Diterima, Transfer, Tunai, Dibebaskan, Belum diterima, Tidak ditagih, Tunggakan, Menunggu konfirmasi. WAIVED and NOT_DUE are visibly distinct. Currency uses integer Rupiah formatting. No raw status enums, SQL, or UUID text is rendered.

Mobile flow: Chairman dashboard → Laporan → year selector → yearly summary → Jan–Dec monthly cards → arrears grouped by household. Use stacked cards/rows, not a mandatory horizontal table. Touch targets are at least 44 px. Preserve the app's clear back link, breadcrumb, and Home route. Validate 360×800, 390×844, 430×900, 768×1024, and 1440×900 with no horizontal overflow.

F13 mobile MVP features:

1. A year selector with an annual reconciliation summary.
2. Twelve billing-period cards with target, effective target, received, transfer, cash, waived, outstanding, and not-due counts.
3. An arrears list grouped by household identity, showing resident names, lifecycle, periods, and pending confirmation badges.
4. Chairman-only, read-only access scoped to the authenticated RT.

## Query architecture

Use a bounded bulk-read flow; no per-household N+1 queries:

1. Resolve and authorize the active Chairman from the authenticated principal; derive RT scope only from that principal.
2. Read available billing years for that RT and selected-year dues, with due date, billing month, amount/status, household ID, house details, and relevant resident names.
3. Call getDueFinancialBalances once for the selected due IDs.
4. Read waiver_items in bulk for those due IDs and validate WAIVED/status correspondence.
5. Read active payment allocation sums in bulk, grouped by monthly_due_id and payments.method, joining exact RT/household ownership and excluding reversed payments.
6. Feed validated per-due inputs into a pure integer-safe reporting aggregator.
7. Build 12 month buckets, aggregate yearly as their sum, then independently aggregate all selected-year due inputs and cross-check yearly totals.
8. Build overdue household groups by household_id from the same selected-year inputs and the Jakarta business date.
Use the existing F11 helper for canonical due balances, but independently reconcile method splits and waiver values. Do not add a migration or cached read model.

## Manual oracle

The supplied oracle amounts are thousands of Rupiah; implementation fixtures use full Rupiah (for example, 40 means Rp40,000). The original H2 case said April remained unpaid while a May cash action paid only H2 May. F8's existing cash-payment service sweeps every unpaid due through the requested period, so a May action allocates Rp40,000 to April and Rp40,000 to May. On 2026-10-04, Ard selected updating the manual oracle to this valid F8 result. F13 formulas remain unchanged.

The revised Jan–May expectations are:

| Month | Target awal | Target efektif | Diterima | Transfer | Tunai | Dibebaskan | Belum diterima | NOT_DUE |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Jan | 80,000 | 80,000 | 80,000 | 80,000 | 0 | 0 | 0 | 2 |
| Feb | 80,000 | 90,000 | 50,000 | 0 | 50,000 | 0 | 40,000 | 2 |
| Mar | 120,000 | 115,000 | 80,000 | 40,000 | 40,000 | 0 | 35,000 | 1 |
| Apr | 120,000 | 120,000 | 40,000 | 0 | 40,000 | 40,000 | 40,000 | 1 |
| May | 120,000 | 120,000 | 40,000 | 0 | 40,000 | 0 | 80,000 | 1 |
| Jan–May subtotal | 520,000 | 525,000 | 290,000 | 120,000 | 170,000 | 40,000 | 195,000 | 7 |

Jan–May identity: 525,000 = 290,000 + 40,000 + 195,000.

Arrears on 2026-05-20: H3-old Feb 40,000; H1 Mar 35,000; H3-new Apr 40,000; H1 May pending 40,000; H3-new May reversed 40,000. Total 195,000 across 5 overdue due rows and 3 household identities. The pending H1 request covers its unpaid March and May dues, so both periods may carry the operational pending badge; neither amount counts as received.

Arrears on 2026-05-05: H3-old Feb 40,000; H1 Mar 35,000; H3-new Apr 40,000. Total 115,000 across 3 overdue due rows. May is not overdue before the 10th.

The manual dataset explicitly completes the calendar year as follows so yearly aggregation covers all 12 months: for Jun–Dec, H1, H2, and H3-new each have a 40,000 obligation; H3-old has a NOT_DUE row. There are no Jun–Dec adjustments, payments, or waivers. Each such month therefore adds target/effective/outstanding 120,000 and NOT_DUE 1. The resulting full-year totals are target 1,360,000; effective target 1,365,000; received 290,000 (transfer 120,000, cash 170,000); waived 40,000; outstanding 1,035,000; NOT_DUE 14. Identity: 1,365,000 = 290,000 + 40,000 + 1,035,000. June–December dues are not arrears on either May business date.

The original H3-new May cash settlement also sweeps April and May before reversal; both allocation rows are excluded from active receipts after reversal, leaving Rp40,000 outstanding in each billing period.

Household identities H3-old and H3-new share physical house A-03 but have distinct household IDs and remain separate in every aggregate and arrears row.

## Verification boundary

- The manual oracle is mandatory and its fixtures must retain the F8-reconciled Jan–May subtotals and the explicitly completed annual case above.
- Independent SQL must aggregate directly from dues, adjustments, waiver_items, allocations, payment method, and reversals; it must not call the report helper. Compare by billing period and household identity.
- Re-run relevant F5–F12 unit/integration/constraint/authorization regressions plus full user quality gates. Keep Neon verification read-only on the named development branch.
- Authenticated Chairman browser smoke must cover dashboard → report → year change → annual totals → monthly cards → arrears. Negative checks: Treasurer, Resident, System Admin, and cross-RT denied.
- Update the GitHub Actions branch filter only as minimally needed for feat/phase-13-reports.
- Do not merge to main or start F14.
