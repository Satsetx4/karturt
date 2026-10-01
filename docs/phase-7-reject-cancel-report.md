# KartuRT Fase 7 — Reject & Cancel

- **Tanggal:** 1 Oktober 2026
- **Branch:** `feat/phase-7-reject-cancel`
- **Baseline branch / HEAD:** `feat/phase-6-treasurer-verification` / `273a1e64fe042b76c5975a900cf119b3f8a66954`
- **Baseline migration:** `0006_phase_6_treasurer_payment_ledger`
- **Fase 7 code and smoke commit:** `20ee0aa7c0489f0ab3e97df54d6db96055e4e58f`
- **Final migration:** `0007_phase_7_reject_cancel`
- **Neon target:** project `billowing-base-57949906`, branch `karturt-development` (`br-crimson-band-az6i637k`), database `neondb`, direct endpoint `ep-quiet-cake-azrhjiyh`

## Keputusan

**Fase 7: PASS. GO ke Fase 8.** Resident dapat membatalkan request `pending` miliknya sendiri. Treasurer aktif pada RT yang sama dapat menolak request `pending` dengan alasan wajib. Keduanya melepas claims dalam transaksi yang sama, mempertahankan request dan item history, tidak membuat ledger, dan tidak mengubah due dari `unpaid`.

Fase 6 dan Test Gate B tetap lulus. Tidak ada perubahan ke default branch, merge, cash payment, reversal, waiver, tarif/adjustment, laporan/export, outbox/notifikasi, migrasi production, atau deploy production.

## State machine dan skema

| Status awal | Aksi | Syarat actor | Hasil |
|---|---|---|---|
| `pending` | `verified` | Treasurer aktif pada RT yang sama | Transisi Fase 6 yang sudah ada; payment, allocations, due paid, dan audit verify tetap authoritative. |
| `pending` | `rejected` | Treasurer aktif pada RT yang sama; alasan 1–500 karakter setelah trim | Claim dilepas, due tetap raw `unpaid`, satu audit reject; tanpa payment/allocation. |
| `pending` | `cancelled` | Resident pemilik request | Claim dilepas, due tetap raw `unpaid`, satu audit cancel; tanpa payment/allocation. |
| `verified`, `rejected`, `cancelled` | — | — | Terminal; tidak dapat dibuka kembali atau ditulis ulang. |

Migration `0007` menambah `resolved_at`, `resolved_by_account_id`, `resolved_by_account_type`, dan `resolution_reason`. `pending` menyimpan metadata resolution kosong. `verified` tetap memakai metadata Fase 6 dan tidak mengisi metadata reject/cancel. `rejected` memerlukan actor resmi, timestamp, dan alasan nonblank; `cancelled` memerlukan actor resident yang sama dengan pemilik request dan reason null. FK/check membatasi actor resolution ke RT dan account type yang sesuai. Item snapshots tetap immutable.

Deferred database validation memeriksa terminal status bersama claims, due, payment/allocation, dan audit: request pending harus punya claims lengkap serta tidak punya ledger; request verified tetap memenuhi invariant Fase 6; reject/cancel harus tidak memiliki claims atau ledger, dan due terkait tetap unpaid. Transisi terminal wajib mempunyai tepat satu audit yang cocok. Audit gagal atau kegagalan update request/claim membatalkan seluruh transaksi.

## Service, API, dan antarmuka

- `cancelResidentPaymentRequest` dan `rejectTreasurerPaymentRequest` mengunci row request lebih dahulu, memeriksa latest state, membaca item immutable, lalu mengunci claims dalam urutan stabil. Setelah validasi ownership dan due, service menyimpan resolusi, melepas claims, dan menulis audit sebelum commit.
- `POST /api/resident/payment-requests/[requestCode]/cancel` menerima body kosong strict dan same-origin; actor serta RT berasal dari principal.
- `POST /api/treasurer/payment-requests/[requestCode]/reject` menerima hanya `{ reason }` strict; reason di-trim dan dibatasi 500 karakter. Actor, RT, bulan, dan nominal tidak diterima dari client.
- Resident `GET /api/resident/payment-requests` memberi history yang ter-scope ke principal dengan kode request, status, waktu, periode/amount snapshot, total, dan reason milik resident tersebut. Response tidak mengekspos UUID tenant/actor atau data internal.
- Resident bisa melihat pending history dan membatalkan dengan konfirmasi bahwa bulan kembali Belum bayar dan bisa diajukan lagi. Treasurer melihat request pending saja; detail menyediakan alasan wajib, lalu menampilkan status/reason terminal tanpa action setelah diproses.
- Audit Core actions: `payment_request.cancelled` (reason null) dan `payment_request.rejected` (reason wajib). Context hanya `itemCount` dan `totalAmount`; tidak memuat PII, nomor telepon, isi pesan, sesi, atau kredensial.

## Matriks otorisasi dan atomicity

| Percobaan | Hasil |
|---|---|
| Resident membatalkan pending miliknya sendiri | Diizinkan. |
| Resident membatalkan request resident lain atau lintas RT/household | Ditolak tanpa membocorkan data request. |
| Resident membatalkan terminal request | Konflik aman `already_processed`; history tetap. |
| Treasurer aktif satu RT menolak pending request RT tersebut dengan reason valid | Diizinkan. |
| Resident, Chairman, System Admin, Treasurer nonaktif, atau Treasurer RT lain menolak | Ditolak. |
| Reason kosong, whitespace, >500 karakter, body mass assignment, atau origin lain | Ditolak validasi/otorisasi. |
| Failure paksa pada status/resolution update, claim removal, atau audit insert | Rollback mempertahankan pending + claims; due tetap unpaid; tidak ada audit terminal. |

Authorization, route, audit, terminal immutability, and atomicity cases pass in the integration/authorization suite. Pairwise concurrency checks use separate requests and connections; loser receives 409/already-processed and cannot append a second terminal audit.

## Bukti development Neon dan race

Smoke dijalankan melalui Next.js HTTP routes dengan sesi Better Auth resident dan Treasurer normal; tidak ada auth bypass. Guard memeriksa `APP_ENV=development`, `DATABASE_ENV=development`, project/branch/endpoint, database `neondb`, serta direct endpoint non-pooler. Migration `0007` terpasang pada branch development; SHA-256 SQL yang diverifikasi saat migrasi: `66401840229155F0CFE85E3D2EBAF4EFF93C10BF3C8C0D156AD782745FFB6D44`.

| Flow | Hasil pada smoke penuh |
|---|---|
| Cancel -> refresh -> re-request periode yang sama | Request pertama `cancelled`; claims 0, payments 0, allocations 0, satu audit; kode request baru berbeda. |
| Reject dengan reason -> resident refresh -> re-request | Request `rejected`; reason tercatat; claims 0, payments 0, allocations 0, satu audit; kode request baru berbeda dan history lama tetap terminal. |
| Cancel vs verify | Cancel menang pada run ini; status HTTP 200/409; final `cancelled`. |
| Reject vs verify | Reject menang pada run ini; status HTTP 200/409; final `rejected`, satu reject audit dengan reason. |
| Cancel vs reject | Reject menang pada run ini; status HTTP 200/409; final `rejected`. |
| Gate B verification regression | Verify race HTTP 200/409 menghasilkan tepat satu payment, tiga allocations, satu audit verify, claims 0, dan seluruh dues dibayar. Resident menampilkan Sudah bayar. |

Ketiga hasil race tersebut adalah hasil run aktual; winner untuk pasangan race tidak diasumsikan tetap sama pada setiap run. Semua hasil memenuhi aturan satu terminal winner.

## Browser smoke

Chrome headless memeriksa route dan layout pada `360×800`, `390×844`, `430×900`, `768×1024`, dan `1440×900`. Pemeriksaan mencakup horizontal overflow, tombol cancel minimal 44px, pending/cancelled/rejected history, unpaid setelah resolution, reason rejection, status processed tanpa action, dan re-request. Screenshot dari run lengkap:

- [Treasurer verified — Gate B](phase-6-evidence/2026-10-01T05-50-06-028Z-treasurer-detail-confirmed-by-browser-390x844.png)
- [Resident paid — Gate B](phase-6-evidence/2026-10-01T05-50-07-925Z-resident-paid-390x844.png)
- [Resident page with pending request](phase-7-evidence/2026-10-01T05-50-10-296Z-resident-request-history-pending-390x844.png)
- [Resident summary after cancellation](phase-7-evidence/2026-10-01T05-50-12-027Z-resident-request-cancelled-390x844.png)
- [Treasurer pending detail before rejection](phase-7-evidence/2026-10-01T05-50-14-179Z-treasurer-reject-required-390x844.png)
- [Treasurer rejected detail](phase-7-evidence/2026-10-01T05-50-15-731Z-treasurer-request-rejected-390x844.png)
- [Resident summary after rejection](phase-7-evidence/2026-10-01T05-50-17-010Z-resident-request-rejected-history-390x844.png)

Screenshot file captures show the 390×844 viewport top. The browser smoke also checks the history and rejection controls in the DOM where those sections appear below the fold.

## Quality gates

| Gate | Hasil |
|---|---|
| `npm run lint`, `npm run typecheck`, `git diff --check` | PASS |
| Unit, integration/migration, constraints, authorization, full suite | PASS di GitHub Actions; seluruh suite mencakup failure injection, race, history, dan constraint regression. |
| Drizzle migration journal consistency dan schema drift | PASS di GitHub Actions. |
| Production build | PASS di GitHub Actions. Percobaan build lokal memakai `.env.local` development dihentikan oleh guard aplikasi yang melarang `APP_ENV=development` pada optimized production build. |
| Neon `npm run db:check`, migration `0007`, Drizzle check, dan schema inspection | PASS pada Neon development saja. |
| Real HTTP + pairwise concurrency + Gate B + browser viewport smoke | PASS; dijalankan dengan `npm run smoke:phase-7-http`. |
| GitHub Actions | [Run 36831637533](https://github.com/Satsetx4/karturt/actions/runs/36831637533) PASS pada code/smoke SHA `20ee0aa7c0489f0ab3e97df54d6db96055e4e58f`; lint, typecheck, unit, integration/migration, constraints, authorization, full suite, Drizzle checks, dan production build semuanya sukses. |

Pada Windows, percobaan lokal PGlite sempat berhenti karena alokasi V8/wasm pada proses constraint suite. Hasil tersebut tidak dipakai sebagai PASS lokal; suite constraints dan migration lulus pada workflow GitHub. Smoke real PostgreSQL/Neon development dan route HTTP tetap lulus.

## Residual risks dan batas

- Smoke membuat beberapa RT/account/request/payment sintetis selama percobaan. History finansial sintetis dipertahankan pada branch Neon development; hanya sesi auth sementara dibersihkan. Tidak ada fixture pada production.
- Browser coverage adalah viewport emulation di Chrome headless, bukan uji perangkat fisik.
- Neon production tidak diakses atau diubah. Tidak ada production migration/deploy, PR, merge, atau perubahan default branch.
- Fase 8 belum dikerjakan; keputusan GO hanya membuka gate perencanaan/implementasi berikutnya sesuai instruksi pengguna.

## Hasil akhir

**Fase 7: PASS — 0 blocker Critical/High yang ditemukan — GO Fase 8.** Fase 6 dan Gate B tetap PASS. Branch `feat/phase-7-reject-cancel` tersedia untuk review; tidak ada merge ke default branch.
