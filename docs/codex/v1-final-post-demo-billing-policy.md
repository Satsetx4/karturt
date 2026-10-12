# KartuRT V1 — FINAL Post-Demo Billing & Receipt Policy

**Owner final decision:** 2026-10-12, Asia/Jakarta. **Status:** APPROVED / supersedes conflicting demo presentation rules, all other billing assumptions and Wave 1 notes that approved online prepayment of future months. **Product:** exactly ONE operational RT; multi-RT UX belongs to V2.

## D0. Demo sunset and source-of-truth
- Presentations and the `demo/socialization-2026-10-06` branch are **CLOSED for product development**. Do NOT port demo-only bootstrap/seed, credential bypass, login-burst exemption, sample socialization accounts, fake payments or demo numbers to main or combined PR #23.
- Do not delete or modify historical demo branch, demo/F3 databases, Vercel projects, domains or Git history automatically. Archive references and remove *active release/deployment dependencies* first; maintain security/audit evidence and immutable ledger histories. Demo cleanup PR must list each candidate path and why it is safe. No destructive changes without separate owner approval.
- The branch `main` already lacks the demo-only scripts `scripts/demo-bootstrap-socialization-final.ts`, `scripts/demo-create-g0-final.ts`, `scripts/demo-financial-showcase.ts`, `scripts/demo-seed-socialization-households.ts` and `tests/integration/staging-demo-login-burst.test.ts`. They exist on the historic demo branch. Thus **do not remove core main scripts or tests by name matching**.
- V1 remains **Single RT**; retain `rtUnitId` and negative cross-RT authorization/database tests.

## D1. Full 12-month card
For the selected annual billing year, always display **all 12 calendar months** in order when that billing year exists. Never hide November/December merely because business date is October. If a due row does not exist, show a truthful missing/not-generated state; never fabricate a paid or required obligation. Existing database `monthly_dues.status = 'not_due'` retains its **non-billable membership/rate semantics**, NOT 'future month'.

**Display status precedence** for each month:
1. If `status=paid` with canonical *active* ledger settlements, show **Lunas** (even if month lies in the future).
2. If `status=waived`, show **Dibebaskan**.
3. If `status=not_due`, show **Tidak perlu bayar** (e.g. outside membership period).
4. If `status=unpaid` and the period is **strictly after** the current Asia/Jakarta business month, show **Belum jatuh tempo** (not billed, no arrears, no due-now balance). No resident-initiated future payment request.
5. If `status=unpaid` for current/past period with a pending request, show **Menunggu konfirmasi**.
6. Otherwise unpaid period in past = **Menunggak**, current = **Belum bayar** (reflect app's existing wording as appropriate).

Date gating uses **year-month** in `Asia/Jakarta`; do **not** reinterpret the monthly due date (e.g., day 10) as a prohibition on paying for the current calendar month. Prior-year dues remain eligible for arrears; future-year rows must never inflate current due-now totals. Annual summary: aggregate payable/arrears/pending from **current and past** periods only; future unpaid contributes zero to **outstanding now** (even though raw ledger due rows may already exist). Future already-paid may contribute to a *separate paid/advance receipt aggregate*, but not overdue or due-now totals. Preserve immutable financial target/balance records for annual accounting—never spoof status or set due amount to zero just to hide a future obligation.

## D2. Resident online/transfer request
Resident may request transfer via KartuRT **only for current-month and older, unpaid/unsettled, positive-balance dues**. Server must reject target period strictly after current Asia/Jakarta business year/month even if a forged client calls API; UI must not offer future periods. The request remains `pending` until canonical Treasurer verification; `pending` never means paid. Standard existing idempotency, tenant/household scope, claim locking, ledger integrity, 0-balance protections remain. For target X, canonical online allocation includes eligible earlier unpaid months through X (excluding paid/waived/not_due/claimed), and never any future month.

## D3. Treasurer cash/offline advance payment — FINAL automatic allocation
An authorized **active Treasurer** may enter cash/offline payment with a **future month target**. The service MUST **automatically include every eligible unpaid/outstanding month from oldest period through that target** in chronological order, including future periods up to target. **No manual cherry-pick, skip-old-debt or flexible allocation option in V1.** If any included period is already under a pending resident request, fail closed with clear conflict rather than split/duplicate claims; resolve/cancel/reject pending request canonically first. Paid, waived or genuine not_due periods are skipped; only active outstanding amounts are allocated. Atomic payment/allocations/settlements/audit are required; a successfully saved cash entry may mark a future card **Lunas**. Preserve idempotency, official role and RT scope, immutable accounting and canonical reversal. An *unverified resident assertion* cannot mark a due paid.

## D4. Tappable per-month receipt
Every **Lunas** monthly card acts as an accessible touch-friendly button. Clicking opens a modal/drawer/small receipt (close/Esc, accessible focus semantics, mobile-first) with **this month's** allocated amount, payment method (cash/transfer), verification timestamp formatted in `Asia/Jakarta`, stable receipt reference and safe official role/reference as permitted. Do NOT display entire multi-month cash payment total in a per-month receipt. If multiple active allocations exist for that month, itemize them and reconcile their sum with canonical `activeReceived`; verify no excess balance. Receipt rows MUST come from `payments` + `payment_allocations` + `payment_reversals` / active-settlement ledger, scoped to the authenticated resident's `rtUnitId` and household, and exclude reversed settlements from current active receipt totals. Reversal: formerly Lunas month reverts according to active balance and business date; reversed receipt must not masquerade as active proof of settlement, but immutable historical records remain in history. All endpoints must be private `no-store`, role-limited; never leak credentials, resident names from other households, phone numbers, or full private transaction data across tenants. Prefer existing schema and timestamp: `payments.verifiedAt` exists. Add migration ONLY if exact invariant cannot be met with current tables.

## D5. Representative acceptance matrix (PINNED)
At `Asia/Jakarta` business date **2026-10-12**, synthetic RT with Jan–Dec 2026 dues Rp25,000 each:
- Oct unpaid, Sep unpaid, Nov unpaid: 12 cards shown; Sep **Menunggak** Rp25,000, Oct **Belum bayar** Rp25,000, Nov+Dec **Belum jatuh tempo**, total due-now = Rp50,000 (if Jan–Aug settled).
- Forged/resident request for Nov/Dec => rejected by API; Oct or Sep => allowed when eligible; pending doesn't turn paid.
- Treasurer manually records cash to Nov from an otherwise fully settled Jan–Oct baseline => Nov **Lunas**; Dec remains Belum jatuh tempo, Oct existing paid remains Lunas.
- Treasurer records cash with target Dec on a completely unpaid Jan–Dec household => 12 monthly allocations, 12 paid cards, total Rp300,000; each month's receipt shows **Rp25,000**, not Rp300,000, plus verified time and method.
- If September still unpaid and Treasurer chooses November, all eligible Sep, Oct, Nov are automatically included; **cannot** pay only November while leaving Sep unpaid.
- Pending Sep resident request conflicts with cash target Nov (no partial silent settlement); resolve via canonical flow first.
- Reverse a future month cash payment: affected months lose Lunas and appear **Belum jatuh tempo** if future, or overdue/current if past. Historical reversal retained, no ghost receipt.
- `not_due` for pre-membership rows remains **Tidak perlu bayar**, irrespective of calendar month; waived remains Dibebaskan.
- Multi-RT is not a V1 feature, but forged RT/household IDs MUST be denied by automated negative tests.
- Include year rollover, prepay near Jakarta midnight, multiple allocations, partial adjustment, WA pending-only, no offline caching of receipts, and authorized official/reversal history.
- Update Chairman/treasurer summaries and reports to distinguish annual accounting target from **due-now arrears** and **future-unpaid**; do not silently shift accounting totals.

## D6. Execution slices / delivery gates
- **B01** Freeze post-demo policy and invalidate outdated 'future transfer allowed' text/QA specs, update #25/#17 and PR #23/24.
- **B02** Stop demo branch in release flow and inventory active demo dependencies; do not delete history or historical external resources.
- **B03** Restore full 12-month read API and resident card, add year-month derived display state; include tests for all statuses and monthly rollovers.
- **B04** Keep server-side future target rejection on resident request, and UI options only current/past.
- **B05** Verify oldest-through-target Treasurer cash path on future months + pending conflicts, update regressions; do not add manual month selection.
- **B06** Add canonical scoped per-month receipt service/read model, route or augment existing private dues API, verifiedAt WIB and active reversal semantics.
- **B07** Add accessible clickable paid card and mobile detail modal/drawer; no cached financial information.
- **B08** Correct due-now/arrears vs future annual reports, run ledger balance, tenant security and PostgreSQL concurrency tests.
- **B09** Merge into combined candidate only after new SHA Gate A PASS, independent Postgres concurrency PASS, isolated staging+owner handset acceptance, legacy Vercel main→production side effects resolved; never auto-merge demo changes.

**Existing resources:** Only approved isolated staging Neon Free `ancient-smoke-51787007` branch `br-dry-block-b3fsqjo3`, Vercel Hobby `prj_Mv4rABJvDNAvSD78SVt5WbjFakEq` (SSO all, Git unlinked). 1/1 project caps consumed, incremental budget Rp0 hard stop, **no staging migration/READY Preview yet**. No prod/demo/F3/DNS changes, no real WhatsApp sends or secrets in GitHub. Owner performs real Android/iPhone later; production/pilot/rollout each require distinct owner GO.

## Technical source notes (PR #23 head 344952c, verify on re-entry)
- `src/lib/billing/resident-dues.ts` currently filters future rows; **change**.
- `src/lib/billing/resident-card.ts` `visibleYearMonths` currently slices to current month; **change**.
- `src/components/resident-card.tsx` current `ResidentMonthCard` only displays label/amount, no receipt click; **change**.
- `src/lib/billing/resident-payment-request.ts` already rejects future resident targets; **keep**.
- `src/lib/billing/treasurer-cash-payments.ts` already uses inclusive target and oldest→target; **regression-test and retain**, do not add arbitrary month selection.
- `src/db/schema.ts` has `paymentAllocations`, `payments.verifiedAt`, `paymentReversals`, `activeDueSettlements`; prefer ledger-based receipt **without schema migration**.
- Recheck Year-1 bootstrap and database-target identity guards from #28 before any canonical staging migrations. Repo main is still protected, docs PR #24 unmerged, combined PR #23 draft.
