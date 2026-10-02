# KartuRT Fase 11 — Laporan Tarif dan Penyesuaian

Tanggal validasi: 3 Oktober 2026 (Asia/Bangkok)
Repo: `Satsetx4/karturt`
Branch: `feat/phase-11-tariff-adjustment`
Baseline: `feat/phase-10-waiver` — `0d52cfe5dd3cdd70a2d3471f68cc410df0757052`
Final implementation SHA: `2ec4b87494b1d63d2c1adbc6f915317716867876`
Migration baseline: `0011_phase_10_waiver`
Migration final: `0012_phase_11_tariff_adjustment`

## Verdict

- **F11: PASS** untuk kontrak produk yang diberikan.
- **Gate C: GO untuk memulai tahap berikutnya.** Gate C belum dijalankan; dokumen ini hanya menyiapkan dataset dan bukti F11 sesuai instruksi.
- Critical/High blocker yang ditemukan: **0**.
- Neon production tidak diakses atau dimutasi. Default branch tidak di-merge.

## Kontrak saldo

Untuk setiap kewajiban `paid` atau `unpaid`, satu rumus digunakan oleh layanan, API, UI, trigger, dan tes:

```text
originalAmount   = monthly_dues.amount
adjustmentTotal  = SUM(due_adjustments.amount_delta)
effectiveTarget  = originalAmount + adjustmentTotal
activeReceived   = SUM(payment_allocations.amount untuk payment tanpa reversal)
outstanding      = effectiveTarget - activeReceived
```

`monthly_dues.amount` dan `fee_rate_id` tetap menjadi snapshot awal yang immutable. Target efektif harus positif, receipt aktif tidak boleh melebihi target, dan outstanding tidak boleh negatif. `paid` berarti outstanding nol; `unpaid` berarti outstanding positif. `waived` dan `not_due` dikecualikan dari saldo yang dapat ditagih dan tidak dapat menerima adjustment.

## Tarif dan histori

- Fee rate bersifat append-only dan unik per billing year/effective month. Migrasi tidak mengubah baris fee rate historis.
- Ketua RT aktif membuat tarif mendatang pada billing year terbuka melalui API; periode yang sudah dijadwalkan ditolak. Generator memilih tarif terakhir yang berlaku. Due yang telah dibuat tetap memakai tarif dan nominal snapshot-nya.
- Pembuatan tarif memakai idempotency key dan fingerprint serta menulis `fee_rate.created` dalam transaksi yang sama.
- Due day 10 dan status lifecycle `not_due` tetap berlaku.

Smoke development membuktikan tarif 2027-11 berubah menjadi Rp60.000 setelah due Nov lama dibuat: due Nov yang sudah dibayar dan item request pending tetap Rp40.000; household yang baru dibuat setelah perubahan memakai Rp60.000. Tarif Desember Rp70.000 yang dibuat kemudian juga tidak mengubah due Desember yang sudah memiliki snapshot Rp60.000.

## Ledger adjustment dan saldo aktif

`due_adjustments` mencatat perubahan signed, alasan, aktor official, UUIDv4 idempotency key, fingerprint SHA-256, dan waktu server. UPDATE/DELETE/TRUNCATE ditolak. Foreign key gabungan membatasi RT dan household. `billing.adjustment_created` wajib tercatat dalam transaksi yang sama. Dua uji integrasi memaksa insert audit tarif dan adjustment gagal; keduanya memastikan tidak ada row ledger parsial, dan uji adjustment juga memastikan status due tidak berubah.

Adjustment hanya dapat dibuat Ketua RT aktif. Treasurer, Resident, System Admin, assignment yang tidak aktif/ambigu, dan target lintas RT ditolak. Adjustment diblokir jika due `waived`, `not_due`, atau memiliki request/claim pending. Target nol/negatif dan adjustment negatif yang akan menciptakan credit juga ditolak.

`active_due_settlements` kini satu baris per allocation dengan primary key `allocation_id`. Banyak payment/allocation aktif boleh menutup due yang sama setelah adjustment, dengan syarat jumlah aktif tetap berada dalam `effectiveTarget`. Reversal menghapus ownership milik payment yang direverse saja; payment, allocation, request, dan reversal historis tetap utuh.

Request Resident menyimpan snapshot sebesar seluruh outstanding, dan verifikasi Bendahara mengalokasikan nominal snapshot itu. Cash menghitung full outstanding di server. Client tidak menentukan nominal pembayaran. Tidak ada arbitrary partial payment atau refund/credit balance.

## Bukti migrasi

Migrasi forward-only `0012_phase_11_tariff_adjustment.sql` diterapkan pada database F10 development dengan hash:

| Item | Hash |
|---|---|
| `0011_phase_10_waiver` | `e0a6cd44b8b80f0b5398f7ff43d5a6249d3e0378b40d552fd3b040ce0a78ea77` |
| `0012_phase_11_tariff_adjustment` | `cd5459a3497fd70444e1d51cafa2f8408e9db3fe2e70de53ecbeb702cf8ebe54` |

Pada eksekusi migrasi pertama, harness mengambil snapshot count dan digest tabel histori F10, menerapkan 0012, memverifikasi hash head F11, lalu membandingkan snapshot sebelum dan sesudah. Pemeriksaan equality lulus sebelum pembuatan fixture F11 dimulai. Eksekusi end-to-end berikutnya memakai mode `--resume-f11`; karena head telah berada di 0012, field perbandingan pada output eksekusi ulang bernilai `null`. Tidak ada downgrade atau pengulangan migrasi.

Tes integrasi mencakup clean chain `0000`–`0012`, upgrade `0011`–`0012`, owner-mapping preflight, dan preservasi snapshot historis.

## Bukti Neon development

Smoke berjalan pada target yang diizinkan saja: project `billowing-base-57949906`, branch `karturt-development` (`br-crimson-band-az6i637k`), direct endpoint `ep-quiet-cake-azrhjiyh`, database `neondb`. Guard branch/env/endpoint lulus dan diagnosis read-only mengonfirmasi head F11. Login menggunakan endpoint aplikasi dan sesi Better Auth normal.

Skenario nyata yang lulus:

- Rp40.000 unpaid + Rp10.000 adjustment → request/verifikasi Rp50.000 → outstanding Rp0.
- Due Rp40.000 lunas + adjustment positif → request/verifikasi tambahan sebesar outstanding; alokasi historis Rp40.000 tetap tersimpan. Tiga alokasi aktif pada satu due berjumlah Rp55.000 dan tidak melampaui target Rp55.000.
- Key dan fingerprint sama menghasilkan replay; key sama dengan fingerprint berbeda menghasilkan conflict dan tidak menambah ledger row.
- Request pending Rp40.000 memblokir adjustment; snapshot request dan claim tetap Rp40.000.
- Due Rp50.000 sebelum pembayaran mendapat adjustment −Rp10.000 → pembayaran penuh Rp40.000.
- Setelah receipt historis Rp50.000 dan target dinaikkan ke Rp60.000, adjustment −Rp5.000 menghasilkan target Rp55.000/outstanding Rp5.000, lalu pembayaran penuh Rp5.000 menutup saldo.
- Payment Rp40.000 direverse; history reversal tetap ada; adjustment setelah reversal menaikkan target menjadi Rp50.000 dan repayment Rp50.000 menutup saldo.
- Adjustment pada due WAIVED dan NOT_DUE ditolak tanpa baris adjustment.
- Transaksi direct DB yang mencoba menambah allocation pada due PAID ditolak constraint `payment_allocation_due_unpaid` dan seluruh transaksi rollback. Constraint tests juga menguji direct over-allocation setelah beberapa ownership aktif.
- Rate baru berlaku pada dues yang dibuat kemudian; due dan request historis tidak direprice.

### Dataset pra-Gate-C

Dataset ini dihitung manual dari enam due sintetis yang sama-sama dibaca oleh model saldo aplikasi. Due WAIVED dikeluarkan dari target payable; NOT_DUE bernilai nol. Semua angka rupiah.

| Ukuran | Manual | Aplikasi |
|---|---:|---:|
| Original/potential (termasuk due yang di-waive) | 240.000 | 240.000 |
| Original payable sesudah mengecualikan waived 50.000 | 190.000 | 190.000 |
| Adjustment positif | 31.000 | 31.000 |
| Adjustment negatif (nilai absolut) | 15.000 | 15.000 |
| Nilai waived yang dikecualikan | 50.000 | 50.000 |
| Effective target payable | 206.000 | 206.000 |
| Active received | 105.000 | 105.000 |
| Outstanding | 101.000 | 101.000 |

Pemeriksaan eksplisit di harness:

```text
190.000 + 31.000 - 15.000 = 206.000
206.000 - 105.000 = 101.000
```

## Browser smoke

Layar tarif dan konfirmasi adjustment Ketua RT diuji pada 360×800, 390×844, 430×900, 768×1024, dan 1440×900. Semua lebar bebas overflow; target sentuh berukuran 50–52px. Pending-request block dan negative-credit block terlihat. Double-tap menghasilkan tepat satu POST tarif dan satu POST adjustment; tidak ada exception atau console error.

Resident browser smoke menguji due lama yang menerima adjustment positif: pembayaran historis Rp40.000, adjustment Rp10.000, outstanding Rp10.000. Kartu menampilkan adjustment dan sisa kewajiban secara terpisah, saldo tetap setelah refresh, dan lima viewport bebas overflow dengan target sentuh minimal 44px.

Bukti gambar:

- `docs/phase-11-browser-evidence/` — layar tarif dan konfirmasi adjustment Ketua RT.
- `docs/phase-5-1-evidence/2026-10-02T17-43-17-797Z-mobile-summary-390x844.png` dan `docs/phase-5-1-evidence/2026-10-02T17-43-17-797Z-desktop-pending-1440x900.png` — kartu Resident.

## Quality gate

| Gate | Hasil |
|---|---|
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `npm run test:unit -- --maxWorkers=1` | PASS — 5 files, 33 tests |
| `npm run test:integration -- --maxWorkers=1` | PASS — 25 files, 125 tests, termasuk rollback audit F11 |
| `npm run test:constraints -- --maxWorkers=1` | PASS — 5 files, 32 tests |
| `npm run test:authorization -- --maxWorkers=1` | PASS — 6 files, 57 tests |
| `npm test -- --maxWorkers=1` | PASS — 41 files, 247 tests |
| `npm run build` | PASS |
| `npx drizzle-kit check` | PASS |
| `npm run db:generate -- --name gate_a_ci_drift` | PASS — no schema changes |
| Neon development smoke + Chairman browser | PASS |
| Resident browser smoke | PASS — five viewports |
| GitHub Actions Gate A pada implementation SHA `2ec4b87494b1d63d2c1adbc6f915317716867876` | PASS — run `37057434298`, 2m35s |

## Residual risks dan batas

- Master Context v2 yang dirujuk laporan Fase 4 tidak tersedia di checkout; implementasi mengikuti kontrak F11 eksplisit yang diberikan untuk pekerjaan ini.
- Gate C belum dijalankan. Dataset dan aritmetika sudah disiapkan agar Gate C bisa mengulang perbandingan manual-versus-aplikasi tanpa mengganti acceptance F11.
- Beberapa fixture uji dan hasil dari percobaan smoke terdahulu tetap berada di database development terverifikasi. Diagnosis read-only terakhir mencatat 12 RT units, 432 dues, 25 fee rates, 25 adjustments, 29 payments, dan 35 payment requests. Fixture tidak dihapus karena tidak ada instruksi pembersihan; database production tidak disentuh.
- Tidak ada F12, F13, F14, merge default, deployment, refund, credit balance, atau arbitrary partial payment.
