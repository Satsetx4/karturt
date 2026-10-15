# Wave 13B.1S — Source Integration Matrix

Source dasar: Wave13A.2 security SHA `48b92abbe93fbd499448b6c885d3042cb49c2128`.
Source RC final: `193b25be6394db9196c22617e9b55b4427cf6f86`.

## Ancestry dan pemilihan delta

| Sumber | Posisi terhadap source security | Keputusan |
|---|---|---|
| PR #23 (`344952c0a41342dea77989d5b9aa6fdb503a78e6`) | Sudah ancestor | Tidak diterapkan ulang. |
| PR #48 (`12539d83b8537d845015a2b0030d47162dae0203`) | Sudah ancestor | Tidak diterapkan ulang. |
| PR #57 (`ddb9689b34ea3ee1373ee328952c279544758c15`) | Enam commit unik; divergen | Tinjau diff delapan file, integrasikan delta secara selektif. |

## Delta dan bukti

| Area | Integrasi | Berkas | Bukti final |
|---|---|---|---|
| Semantik tunggakan | PASS — hitung per `YYYY-MM`; bulan berjalan belum arrears dan lintas Desember/Januari tetap benar. | `src/lib/reports/aggregation.ts`; tes unit/integrasi | QA independen full suite final 80 file / 580 tes PASS; Gate A exact-SHA juga PASS. |
| Rekonsiliasi laporan | PASS — split `dueNowOutstanding`/`futureUnpaidOutstanding`, alias `yearlyOutstandingTiming`, dan rekonsiliasi total tahunan dipertahankan. | `src/lib/reports/aggregation.ts`, `src/lib/reports/rt-financial-report.ts` | QA independen dan Gate A full suite lulus pada SHA final. |
| UI laporan | PASS — posisi per tanggal, saldo tahunan akuntansi, periode kini/mendatang, no-data state. | `src/components/chairman-reports.tsx`, `src/app/globals.css` | Build dan test lulus; tidak ada klaim browser/device matrix. |
| Financial lifecycle | PASS — manual oracle, pembayaran 12 periode, receipts, pending request, reversal, lintas tahun. | Tes integrasi laporan/resident/cash dan tes unit terkait | Full suite final lulus; invariants pembayaran/reversal dan authorization/tenant security ditinjau independen. |
| Dokumentasi produk | PASS | `docs/phase-13-reports-design.md` | Periode arrears dan fixture kalender dikoreksi. |
| Workflow | PASS — alias RC memicu Gate A dan PG18. | `.github/workflows/gate-a.yml`, `.github/workflows/wave12-3-pg18-rehearsal.yml`, identity helpers dan guard tests | [Gate A 38678563048](https://github.com/Satsetx4/karturt/actions/runs/38678563048) PASS, concurrency job `116239687016` benar-benar dijalankan; [PG18 38678563005](https://github.com/Satsetx4/karturt/actions/runs/38678563005) PASS pada SHA yang sama. |

## Invarian wajib

- Current/prior/future month memakai zona bisnis Jakarta dan billing year-month.
- Uang muka dialokasikan ke iuran tertua yang memenuhi syarat sampai bulan terpilih; jumlah alokasi dan receipts harus rekonsiliasi.
- Pembayaran reversed tidak menambah penerimaan atau saldo lunas.
- Identitas utang tetap household-scoped; role/RT isolation, auth/session/CSRF, dan PWA cache exclusion tidak berubah.
- Semua 15 blob `drizzle/0000`–`0013` dan `drizzle/meta/_journal.json` sama dengan source security. Tabel hash lengkap ada di bawah.
- `stagingIsolationVerifiedEmpty=false` dan `PINNED_STAGING_MIGRATION_APPROVAL_PUBLIC_KEY_PEM=null` tetap sama.

## Migration blob manifest

Setiap Git blob SHA-1 di kolom RC juga sama dengan blob dari baseline `48b92abbe93fbd499448b6c885d3042cb49c2128`.

| Path | Git blob SHA-1 |
|---|---|
| `drizzle/0000_messy_menace.sql` | `b661e6e96ba73649e611c353996cf492306b866a` |
| `drizzle/0001_classy_ricochet.sql` | `61f4ba1e8ead8fea54696338a0d913132278c9a4` |
| `drizzle/0002_monthly_due_period_guard.sql` | `5815c32e1d7191ec2cc5805962a560b9c6c451a3` |
| `drizzle/0003_due_auth_audit_domain.sql` | `31b4e95c282b2052385022e6dab112b9c23b66a6` |
| `drizzle/0004_phase_5_payment_request.sql` | `e392072c31f89de240cc4f318fbd144538ddb377` |
| `drizzle/0005_phase_5_1_payment_request_items_immutable.sql` | `7b38555dbd804d8f9126b015245815a7f3872f05` |
| `drizzle/0006_phase_6_treasurer_payment_ledger.sql` | `4aacb91d0eee55dfe5e2621b7c1bb779acf0f067` |
| `drizzle/0007_phase_7_reject_cancel.sql` | `33ee755b82bafa7bd1730e51773e19a04c904fd5` |
| `drizzle/0008_phase_7_1_post_resolution_lifecycle.sql` | `04f279c23400ee93cf392b20c1de2b601f916d96` |
| `drizzle/0009_phase_8_cash_payment.sql` | `d638e58d8e9e299381c560b3a61bfc13c9a8ed7c` |
| `drizzle/0010_phase_9_payment_reversal.sql` | `0cce311c48ab625617c342c8d746f6709776080a` |
| `drizzle/0011_phase_10_waiver.sql` | `0c9fd2b3f0928aafa97c3a54674d8041be452203` |
| `drizzle/0012_phase_11_tariff_adjustment.sql` | `30261e868cf5163bdb8bb66f1eefeda603f763d1` |
| `drizzle/0013_phase_12_household_management.sql` | `04003fcc576b5bdc1047e23e9a25ab63432d856a` |
| `drizzle/meta/_journal.json` | `b77d370f32313dfac4f877407a086d3b5ca9d6d7` |

## Final diff

Diff dari base security `48b92abbe93fbd499448b6c885d3042cb49c2128` sampai RC mengubah 17 file: dua workflow, tiga helper identitas CI, docs laporan fase 13, dua file komponen/style laporan, modul agregasi dan export report, tujuh file tes unit/integrasi. `git diff --check` lulus; 15 migration/journal blob IDs sama dan dua source guard byte-identik.

Lint menghasilkan 0 error dan 2 warning lama pada `scripts/phase-12-household-browser-smoke.ts` dan `src/lib/billing/resident-card.ts`. Full `npm audit` mencatat 5 high yang seluruhnya hanya dependency dev; production-only audit bersih. npm hanya mengusulkan perbaikan lintas major dan tidak ada package manifest yang diubah.
