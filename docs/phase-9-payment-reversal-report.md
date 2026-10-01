# KartuRT Fase 9 — Payment Reversal

Tanggal: 2026-10-02
Status: **PASS**
Branch: `feat/phase-9-payment-reversal`
Baseline: `feat/phase-8-cash-payment` — `d390f5384b1e50346943db08c7050850f9fa809a`
Fase 9 implementation SHA: `e184ccc052db65f4a4ae7145be7bfef97f157b0f`
Baseline migration head: `0009_phase_8_cash_payment`
Fase 9 migration head: `0010_phase_9_payment_reversal`

## Ringkasan keputusan

Fase 9 menambahkan reversal sebagai catatan append-only. Payment dan allocation asli tidak diubah atau dihapus. Keberadaan satu baris `payment_reversals` menentukan lifecycle turunan: tanpa reversal berarti `ACTIVE`, dengan reversal berarti `REVERSED`.

`active_due_settlements` menjadi proyeksi ownership operasional untuk settlement yang masih aktif. Primary key pada `monthly_due_id` memastikan paling banyak satu payment aktif menguasai suatu iuran. Histori allocation tidak diberi unique constraint global pada due, sehingga due dapat dibayar kembali melalui payment baru setelah reversal.

“Menghitung ulang allocation terdampak” ditafsirkan sebagai menghitung ulang efek settlement saat ini dari active ownership. Allocation lama tetap menjadi histori; reversal menghapus ownership aktif payment lama dan mengembalikan due terdampak ke `UNPAID`. Pembayaran berikutnya membuat payment, allocation, dan ownership aktif yang baru.

## Perubahan database dan lifecycle

- Migration forward-only `0010_phase_9_payment_reversal.sql`; migration `0000–0009` tidak diubah.
- `payment_reversals` menyimpan payment, RT/household scope, official Treasurer actor, reason wajib yang sudah dinormalisasi, dan timestamp server. Payment hanya dapat direverse sekali. UPDATE, DELETE, dan TRUNCATE histori reversal ditolak.
- `active_due_settlements` mengikat setiap due yang dibayar ke satu allocation dan payment aktif dengan scope serta amount yang cocok. Migration memeriksa kondisi awal dan gagal alih-alih menebak bila backfill ambigu.
- Deferred database assertions menegakkan: due `PAID` punya tepat satu ownership aktif; due non-PAID tidak punya ownership; payment aktif memiliki seluruh ownership allocation-nya; payment reversed memiliki nol ownership aktif dan histori sumber/audit yang utuh.
- `PAID → UNPAID` hanya diterima ketika ada reversal valid untuk payment yang sedang memiliki due tersebut. Scope, tahun/bulan, dan amount due yang sudah dibayar tetap terlindungi.
- Request transfer tetap berstatus historis `verified` setelah payment dibalik. Cash tetap berupa ledger cash dan tidak membuat payment request fiktif. Re-payment menggunakan payment baru.
- Hash SHA-256 migration yang diterapkan: `bc58acabf918fd359613d1b039b4e466c0137f32c7a19f5e79660b14499ae0da`.

Urutan lock reversal: validasi Treasurer aktif dan permission; lock payment; baca allocations immutable; lock seluruh due menurut ID stabil; lock ownership menurut urutan due yang sama; validasi status/scope/amount; insert reversal; ubah semua due menjadi unpaid; hapus hanya baris ownership operasional; tulis audit pada transaksi yang sama. Transfer verification dan cash recording juga membuat ownership aktif atomik dengan payment, allocation, due, dan audit.

## Authorization dan audit

`payment:reverse` hanya diberikan kepada Treasurer aktif di RT yang sama. Integration/authorization coverage menolak Resident, Chairman, System Admin, Treasurer nonaktif atau berakhir, dan request lintas RT. Payment lintas RT memberi respons not-found tanpa membocorkan data. Body API dibatasi ke reason; actor, RT, amount, status, source, allocation, dan due tidak dapat dipasok oleh klien. Reason wajib setelah trim, maksimal 500 karakter, dan kegagalan audit membatalkan seluruh transaksi.

Setiap reversal membuat satu audit `payment.reversed` dengan entity payment dan context flat `{ itemCount, method, totalAmount }`. Reason audit sama dengan reason reversal; tidak ada data pribadi atau secret di context. Tes integration memaksa insert audit gagal dan membuktikan rollback payment reversal, due, serta ownership. Concurrent reversal menghasilkan satu pemenang, satu reversal, dan satu audit; pengulangan mendapat konflik aman tanpa menulis ulang reason.

## Neon development dan HTTP smoke

Target yang diverifikasi: project `billowing-base-57949906`, branch `karturt-development` (`br-crimson-band-az6i637k`), database `neondb`, endpoint development `ep-quiet-cake-azrhjiyh`. Smoke memakai sesi Better Auth Treasurer/Resident normal dan guard environment development. **Neon production tidak dimigrasikan maupun dimutasi.**

HTTP smoke pada development mencakup:

- Cash multi-bulan → reversal → due unpaid → cash baru dengan idempotency key baru → due paid kembali. Payment lama tetap reversed dan allocation-nya tetap ada.
- Transfer multi-bulan → reversal → due unpaid → request transfer baru → verifikasi payment baru. Request/payment transfer lama tetap historis `verified`/`reversed`.
- Cancel request lalu cash, cash reversal, idempotency replay dan fingerprint berbeda, pending-request conflict, serta race cash-vs-verification.
- Dua sesi Treasurer mereverse payment sama secara bersamaan: satu sukses dan satu `409`; satu reversal dan satu audit.
- Race reversal dengan pembuatan request warga diuji melalui HTTP. Race cash baru dengan reversal juga diuji dalam integration suite.
- Dataset setelah smoke: **149 payments, 292 allocations, 32 reversals, 214 active ownership rows**. Fixture synthetic smoke sengaja dibiarkan di Neon development; tidak dibersihkan.

Pemeriksaan global pasca-smoke menemukan nol untuk masing-masing kondisi berikut: due PAID tanpa tepat satu owner; due non-PAID dengan owner; payment reversed dengan owner aktif; allocation payment aktif tanpa owner; audit/reversal mismatch; duplicate owner per due; dan mismatch total payment/allocation.

## UI dan browser smoke

History Treasurer menampilkan rumah/penghuni, metode, bulan, total, waktu transaksi, status lifecycle, dan reason/waktu reversal. Pembatalan mencakup seluruh payment dan mewajibkan reason. Konfirmasi menjelaskan bahwa histori tetap tersimpan dan bulan yang terdampak kembali menjadi belum dibayar. Riwayat warga menandai payment sebagai “Pembayaran dibatalkan”, sementara kartu/tagihan menghitung status unpaid saat ini.

Browser nyata diuji pada 360×800, 390×844, 430×900, 768×1024, dan 1440×900. Hasil: tidak ada horizontal overflow atau raw UUID/enum/SQL; tombol aksi setidaknya 50 px dan field reason/konfirmasi setidaknya 44 px; status aktif/reversed serta riwayat warga terbaca; double-click reversal mengirim satu request; browser page errors nol.

Screenshot hasil smoke 390×844:

- [Treasurer — payment aktif](phase-9-evidence/2026-10-01T19-08-52-359Z-treasurer-payment-active-390x844.png)
- [Treasurer — konfirmasi reversal](phase-9-evidence/2026-10-01T19-08-52-534Z-treasurer-payment-reversal-confirmation-390x844.png)
- [Treasurer — payment reversed](phase-9-evidence/2026-10-01T19-08-53-905Z-treasurer-payment-reversed-390x844.png)
- [Resident — tagihan kembali belum dibayar](phase-9-evidence/2026-10-01T19-08-54-718Z-resident-payment-reversed-card-390x844.png)
- [Resident — histori menjelaskan reversal](phase-9-evidence/2026-10-01T19-08-55-171Z-resident-payment-reversed-history-390x844.png)

## Regression dan quality gates

- Gate B transfer, F7 reject/cancel, F7.1 terminal request/history, dan F8 cash/idempotency/pending/race diperiksa melalui integration suites dan smoke yang relevan. Migration upgrade menguji jalur bersih `0000→0010` dan preservasi upgrade `0009→0010`.
- Seluruh 21 file integration suite lulus ketika dijalankan per file; suite reversal terbaru lulus 7 tes. Tiga file constraint suite lulus per file; suite cash-ledger yang diperluas lulus 3 tes. Unit suite 29 tes dan authorization suite 8 tes lulus.
- `npm run lint`, `npm run typecheck`, unit, integration/migration, constraints, authorization, `npx drizzle-kit check`, schema drift, dan `npm run build` lulus.
- GitHub Actions [run 36912561293](https://github.com/Satsetx4/karturt/actions/runs/36912561293) pada implementation SHA berstatus **PASS**, termasuk full test suite, Drizzle journal, schema drift, dan production build.
- Satu eksekusi gabungan full suite di mesin Windows lokal gagal karena Node native `Fatal process out of memory: Zone`; suite terkait lulus per file dan GitHub Actions full suite lulus. Ini dicatat sebagai keterbatasan runner lokal, bukan sebagai PASS lokal gabungan.

## Residual dan batas fase

- Synthetic financial rows dari smoke masih ada pada Neon development untuk menjaga bukti dan tidak dihapus. Angka keadaan data di atas adalah hasil setelah smoke, bukan jumlah produksi.
- GitHub Actions mengeluarkan peringatan masa depan tentang action Node 20 yang dipaksa ke Node 24 dan perpindahan runner `ubuntu-latest`; seluruh job tetap lulus.
- Tidak ada perubahan production, Fase 10 waiver, Fase 11 tariff/adjustment, report/export, notification/outbox, PR, atau merge default branch.

## Keputusan

- **Fase 9 Payment Reversal: PASS.** Seluruh invariant finansial, histori append-only, one-active-settlement, authorization, rollback audit, reversal/re-payment transfer dan cash, regresi, Neon development smoke, browser smoke, dan CI yang menjadi kriteria Fase 9 lulus. Critical/High blocker yang diketahui: 0.
- **Fase 10: GO untuk perencanaan terpisah.** Tidak ada implementasi Fase 10 pada branch ini.
