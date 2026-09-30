# Fase 4 — Resident Card UI handoff

Date: 30 September 2026, Asia/Jakarta.
Decision: **GO for Fase 4**, with the final implementation CI PASS recorded below. This is not a production launch or authorization to begin Fase 5.

## Frozen baseline and context

- Repository: https://github.com/Satsetx4/karturt
- Verified baseline: `verify/gate-a-neon-ci`, `a396fd7626a4061bf0ec497261597caaacbb69fa`.
- Work branch: `feat/phase-4-resident-card`, created directly from that baseline with a clean checkout.
- Implementation commit under final verification: `7fa56e0af236259777532cd645529c2f4139087e`.
- Runtime: Node `v24.18.0`, npm `11.17.0`; existing Next.js/React/Drizzle/Better Auth stack retained.
- Migration head: `0003_due_auth_audit_domain`. No schema or migration change in Fase 4.
- Master Context v2 supplied by the user: `KartuRT_Master_Context_v2_2026-09-30.md`, SHA256 `9324e1fcecf3dcac72df3db405483e24db8296a1d54bf889dfb038b3cdf8799d`.
- Its historical Gate A NO-GO snapshot is superseded by the user's verified Gate A baseline and the existing Gate A report. Fase 0–3 were not reopened.
- Remote default branch remains `feat/milestone-1-foundation` at `522447cbabfcfbd3a18e3cd50266fe91bf781cb1`; no merge performed.

## UI/API audit and implemented scope

The existing `/app` was a protected account placeholder. The existing `/api/resident/monthly-dues` already enforces resident role and derives both RT and household scope from the authenticated principal. It returns the resident's own ordered dues with no tenant IDs and uses `no-store`.

Mobile flow: resident login → Kartu Iuran → Riwayat or Profil; Logout stays in the header. Four capabilities: annual card, derived summary, honest dues-status history, safe profile. Existing theme and device-preference reset are retained.

- Reused the dues endpoint unchanged; no client tenant scope was added.
- `/app` resolves the principal on the server before rendering the resident shell. Authentication failures redirect to resident login; unexpected failures reach the existing error boundary.
- Profile is read server-side through tenant/person/household joins. Only name, house number, RT display name, and household start date are passed to the browser. No new profile/history HTTP endpoint was necessary.
- Year selector includes available billing years and the current year. Each selection presents January–December in chronological order. A missing record displays `Data belum tersedia`, never a fabricated due, payment, waiver, or NOT_DUE.
- PAID, UNPAID, WAIVED, NOT_DUE have distinct labels/icons and domain tokens; status borders supplement the text. WAIVED and NOT_DUE remain separate.
- **PENDING is reserved for verification derived from a valid active payment request in a future phase.** There is no such request source in Fase 4, so no pending badge is emitted. Future unpaid months remain UNPAID, exactly as Master Context v2 requires.
- Selected-year summary derives paid-status amount, total unpaid obligation, and overdue unpaid amount from the authenticated resident's dues. Overdue means `dueDate < Jakarta business date`; a due is not overdue on the 10th itself. WAIVED/NOT_DUE contribute no outstanding or arrears. Paid-status amount is not presented as a cash-receipts ledger.
- Riwayat explicitly presents current dues-status records, not invented transaction history, verification timestamps, transfer references, or receipts.
- Loading, no-data, missing-month, load failure/retry, and expired/denied-session states are explicit. Dues are revalidated on window focus and every 60 seconds; 401/403 clears loaded dues and offers login.
- Only active navigation preference is persisted, with defensive storage handling and the existing `karturt:` namespace. Financial records, identity, credentials, and scope are not stored in localStorage.
- Logout now reports a failed server/network response and permits retry rather than navigating away as if logout succeeded. Successful logout refreshes routing state.

## Files changed

| File | Purpose |
|---|---|
| `src/app/app/page.tsx` | Server-protected resident entry, safe profile loading, accurate authentication/error behavior |
| `src/components/resident-card.tsx` | Resident navigation, year selector, cards, summary, status history, profile, session/load states |
| `src/lib/billing/resident-card.ts` | Pure status mapping, January–December projection, summary derivation |
| `src/lib/billing/resident-profile.ts` | Principal-scoped safe profile projection |
| `src/components/sign-out-button.tsx` | Honest failed-logout behavior and successful navigation refresh |
| `src/app/globals.css` | Responsive grid, readable cards, status accents, focus-compatible navigation |
| `tests/unit/resident-card.test.ts` | Five status/summary/order/missing-data cases |
| `tests/integration/resident-profile.test.ts` | Own profile whitelist and mixed-person/cross-RT/non-resident rejection |
| `tests/integration/resident-dues-route.test.ts` | Principal-only API authority, no scope parameter, session expiry and role denial |
| `.github/workflows/gate-a.yml` | Runs existing full gate on the Fase 4 branch |
| `AGENTS.md`, `CLAUDE.md` | Standard guidance automatically generated by this Next.js version during local preview |
| `docs/phase-4-resident-card-report.md` | This handoff |

## Automated verification

Final CI: [Fase 4 gate](https://github.com/Satsetx4/karturt/actions/runs/36717893712), commit `7fa56e0af236259777532cd645529c2f4139087e` — **PASS / success, all gate steps**.
Earlier implementation CI also passed: [run 36717117565](https://github.com/Satsetx4/karturt/actions/runs/36717117565), commit `25e785d7056bd1c04c90804cb50df711526648f6`.

| Gate | Verified result |
|---|---|
| Lint | PASS locally and CI |
| Typecheck | PASS locally and CI |
| Unit | PASS, 22 tests |
| Integration/migrations | PASS, 31 tests |
| Constraints | PASS, 14 tests |
| Authorization | PASS, 4 tests |
| Full suite | PASS, 71 tests in 19 files; local serial rerun also passed |
| Drizzle journal | PASS locally and CI |
| Schema drift | PASS in CI; no migration generated |
| Production build | PASS locally with explicit non-deployment production/build-only environment and in CI |

The local machine exhausted memory when build, browser and tests overlapped. A serial full-suite rerun passed; this is recorded as a runner/resource issue, not hidden as a passing attempt. An initial build with development environment labels was correctly rejected by existing environment guards; the explicit production/build-only configuration passed. No local secrets were replaced or committed.

## Browser and responsive evidence

Chromium/Playwright exercised the real local Next.js application with a provisioned synthetic development resident and generated dues. Actual login (house number + six-digit PIN), protected `/app`, API loading, all navigation views, safe profile, logout and post-logout redirect passed. A request carrying alternate `rtUnitId`/`householdId` query values returned only the authenticated resident's 12 dues and no tenant IDs.

| Viewport | Monthly grid | Result |
|---|---|---|
| 360×800 | 2 columns × 6 rows | 12 months, no horizontal overflow, readable labels, navigation and visible keyboard focus PASS |
| 390×844 | 2 columns × 6 rows | Same checks PASS |
| 768×1024 | 3 columns × 4 rows | Same checks PASS |
| 1440×900 | 3 columns × 4 rows | Same checks PASS |

Three columns were rejected for small phones after visual inspection showed awkward label wrapping. The 3×4 target is retained from 600px upward; the mobile fallback preserves readability. All four live screenshots were visually inspected. No browser page errors were observed.

Additional real browser checks: dark theme survives reload, active Riwayat navigation survives reload, server logout failure shows a retryable error without falsely leaving `/app`, and removing the session cookie followed by focus produces a real API 401, clears cards and displays login recovery. An isolated rendering smoke of the actual ResidentCard component also covered PAID/WAIVED/NOT_DUE, error retry and blocked localStorage using intercepted synthetic responses; it was not misrepresented as live payment data.

No High/Critical blocker was found in this scope. Status uses text and icons, navigation buttons are at least 44px high, `aria-current` marks the selected view, focus outline is visible, loading announces status and errors use alert regions. This is responsive browser smoke, not a complete screen-reader audit or physical-device UAT.

## Development data and security boundary

Live smoke used only the existing Gate A development endpoint `ep-quiet-cake-azrhjiyh`, checked against `.env.local` development labels before any fixture insert. Gate A identifies this endpoint with KartuRT project `billowing-base-57949906`, development branch `br-crimson-band-az6i637k`. No production connection, migration, payment mutation, or existing-record deletion occurred.

One synthetic RT/house/household/person/resident account, annual billing year/rate and generated 12-month dues were added for browser testing. These fixtures are retained on development; they are not production residents. Random test credentials remain only in a local `.env` fixture outside the repository. Existing local configuration was preserved.

Financial authority remains on the server. Existing login/provisioning/lockout and cross-RT/household tests continue to pass. The profile service rejects non-residents; System Admin receives no resident financial view or new permission. Rate snapshots and household billing semantics are unchanged.

## Residual risks and handoff

- Production/deployed-preview UAT and physical-device/screen-reader coverage remain separate release tasks. This phase verifies local Next.js plus Chromium viewport emulation and GitHub CI.
- Browser state can show the previously loaded view until its next focus/60-second revalidation. Server/API access is reauthorized on every request; there is no offline financial authority.
- Jakarta business date is supplied by the server when the page loads; reload a page held open across midnight for the new overdue calculation.
- Existing Gate A deployment risks (trusted proxy, operational recovery, deployment secrets) still apply; no production-readiness claim is made.
- The frontend history is intentionally not a payment ledger. Payment details and derived verification-pending state must wait for their real authoritative engine.

**Fase 4 decision: GO. Final implementation CI PASS.** Branch is pushed for review; no PR merge or default-branch modification is authorized/performed. The final documentation commit may follow the tested implementation SHA and must change only this report.

**Fase 5 Payment Request BELUM DIMULAI.** No payment request, verify/reject/cancel, cash payment, waiver mutation, tariff adjustment/reversal, WhatsApp mutation, upload, or new financial engine was implemented. Existing Audit Core must be reviewed and tested against each future mutation's actual atomicity/audit requirements; its current presence is not blanket coverage of future financial operations.
