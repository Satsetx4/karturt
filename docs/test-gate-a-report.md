# KartuRT Test Gate A - Laporan verifikasi akhir

- **Tanggal:** 30 September 2026
- **Branch sumber:** `repair/phase-0-3`
- **Verification branch:** `verify/gate-a-neon-ci`
- **Code/config HEAD saat verifikasi penuh:** `78f38f6dbc405954e0b06fba53668b4204f70f81`
- **Baseline original:** `522447cbabfcfbd3a18e3cd50266fe91bf781cb1`
- **Repair implementation:** `d01f57cadb59511a67725b261906b5c1be41ec3c`
- **Repair report commit:** `9ed1ddd6544891b8a2e98fa8e175eef7ad3f8459`
- **Migration head:** `0003_due_auth_audit_domain`
- **Runtime:** Node.js `v24.18.0`, npm `11.17.0`

## Keputusan

**Test Gate A: PASS. GO ke Fase 4.**

Syarat gate yang wajib sudah diverifikasi: Neon development project/branch identity, migration nyata, live auth/billing smoke, dan concurrency pada koneksi PostgreSQL independen. Tidak ada blocker Critical/High yang tersisa untuk memulai Fase 4. Browser/device visual smoke belum ditutup karena belum ada deployment preview; ini tetap ditunda ke UX/UAT dan tidak mengubah hasil Gate A server/data.

Repair branch sudah dipush. Verification branch ini dipush setelah pembaruan laporan. Tidak ada merge atau perubahan pada default branch.

## Baseline dan Neon development

- Baseline branch `repair/phase-0-3` berada pada `9ed1ddd6544891b8a2e98fa8e175eef7ad3f8459`; verification branch dibuat darinya.
- Checkout verifikasi bersih sebelum perubahan laporan. Migrasi lokal berakhir pada `0003_due_auth_audit_domain`.
- Neon project **KartuRT**, project ID `billowing-base-57949906`, region `aws-ap-southeast-1`.
- Default branch Neon adalah `production`, ID `br-patient-band-azznfh28`. Branch yang diuji adalah `karturt-development`, ID `br-crimson-band-az6i637k`, bukan default dan bukan production.
- Development branch dibuat dari snapshot project yang baru dibuat. Preflight sebelum migration menemukan hanya tabel bawaan `neon_auth`, tidak ada tabel aplikasi, dan belum ada tabel `drizzle.__drizzle_migrations`. Branch memiliki 0 byte data tertulis pada saat dibuat; tidak ada existing development data yang ditimpa.
- Endpoint verifikasi `ep-quiet-cake-azrhjiyh` memakai koneksi langsung tanpa pooler. Koneksi dan migrasi hanya memakai development branch.
- `APP_ENV=development`, `DATABASE_ENV=development`, DATABASE_URL development langsung, app URL lokal, dan auth secret acak disimpan hanya pada `.env.local` yang diabaikan Git. Tidak ada URL/password/token/secret di repo, report, atau GitHub Actions.

## Hasil per tahap

| Tahap | Hasil | Bukti |
|---|---|---|
| 1 - Freeze verification baseline | PASS | Repair HEAD dan source commit dicatat; branch kerja `verify/gate-a-neon-ci`; runtime dan migration head tercatat di atas. |
| 2 - Neon development | PASS | Project KartuRT dan branch `karturt-development` teridentifikasi; branch development bukan default/production. `npm run db:check` terhubung dengan label development yang cocok. |
| 3 - Migration di Neon | PASS | Migration `0000-0003` diterapkan pada Neon development. SQL read-only mengonfirmasi migration journal berisi empat migration, enum `not_due/unpaid/paid/waived`, trigger audit append-only, trigger eksklusivitas official, kolom lockout, dan constraints due tanggal 10. Migration rerun dan `db:check` sesudahnya lulus. |
| 4 - Live Neon auth/billing smoke | PASS | Bootstrap RT retry idempotent; house/household/person dibuat; account resident diturunkan dari house.number dengan PIN enam digit; login, lockout lima PIN salah/15 menit, valid PIN ketika terkunci ditolak, reset oleh Chairman satu RT berhasil, cross-RT dan Treasurer ditolak, sesi dicabut, TOTP System Admin wajib, backup code hanya dapat dipakai sekali, billing menghasilkan 12 baris dengan status/periode yang benar, retry tidak menggandakan data, dan dues HTTP endpoint hanya mengembalikan household/RT principal. |
| 5 - PostgreSQL concurrency | PASS | Dua backend Neon dengan PID berbeda dipakai. Concurrent annual billing menghasilkan tepat 12 baris unik; dua assignment treasurer overlap menghasilkan satu pemenang; sepuluh increment login paralel tetap membatasi counter ke 5 dan mengunci akun. Transaksi mutation+audit yang dipaksa rollback tidak meninggalkan keduanya; trigger menolak update/delete audit. |
| 6 - GitHub Actions | PASS | `.github/workflows/gate-a.yml` berjalan tanpa Neon secret. Run [#3](https://github.com/Satsetx4/karturt/actions/runs/36706667404) pada commit `2acb404551891a3b94e0379f286e4933d8629a72` selesai dengan semua langkah sukses, termasuk install, lint, typecheck, seluruh test, migration/schema check, dan production build. |
| 7 - Preview/browser | DEFERRED | Belum ada deployment preview yang aman. Local Next dev HTTP route `/login/warga` merespons 200 dan smoke auth/billing HTTP lulus; pembacaan visual responsive 360-420 px melalui in-app browser tidak berhasil dimuat dan harus diulang pada UX/UAT preview. |
| 8 - Re-run Gate A | PASS | Seluruh perintah lokal, Neon check/migration rerun, PGlite clean/upgrade migration, dan GitHub Actions tercatat di bagian bukti di bawah. |
| 9 - Formal report | UPDATED | Hasil akhir dicatat di file ini. Verification branch dipush; tidak ada PR, merge, atau perubahan default branch. |

## Bukti pemeriksaan

| Pemeriksaan | Hasil |
|---|---|
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `npm run test:unit -- --maxWorkers=1` | PASS - 17 test, 4 file |
| `npm run test:integration -- --maxWorkers=1` | PASS - 27 test, 10 file; termasuk migration clean/upgrade PGlite |
| `npm run test:constraints -- --maxWorkers=1` | PASS - 14 test |
| `npm run test:authorization -- --maxWorkers=1` | PASS - 4 test |
| `npm test -- --maxWorkers=1` | PASS - 62 test, 16 file |
| `npm run build` | PASS - memakai nilai production build-only, bukan secret/URL Neon |
| `npx drizzle-kit check` | PASS - migration journal konsisten |
| `npm run db:generate -- --name gate_a_neon_drift_check` | PASS - tidak ada perubahan schema |
| `npm run db:check` | PASS sebelum dan sesudah migration |
| `npm run db:migrate` | PASS pada Neon development; rerun kedua juga PASS |
| Gate A GitHub Actions | PASS - [run #3](https://github.com/Satsetx4/karturt/actions/runs/36706667404) |

Vitest integration dan full suite dijalankan dengan satu worker. Percobaan parallel sebelumnya kehabisan memori runner lokal; rerun serial lulus, demikian juga workflow GitHub yang memakai setting serial.

## Perbaikan foundation yang diverifikasi

- Iuran sebelum household bergabung dan setelah bulan akhir menjadi `NOT_DUE`; bulan aktif menjadi `UNPAID`; setiap tahun menghasilkan 12 baris dengan tanggal jatuh tempo tanggal 10 dan retry aman.
- Resident provisioning mengambil identifier dari nomor rumah dan membatasi PIN tepat enam digit numerik.
- Lima PIN salah mengunci akun 15 menit. Reset PIN berwenang mengosongkan kegagalan, menulis audit, dan mencabut sesi lama.
- Reset oleh Chairman dibatasi satu RT; Treasurer dan Chairman RT lain ditolak.
- System Admin harus mendaftarkan dan memverifikasi TOTP. Login password meminta faktor kedua; backup code yang sudah dipakai ditolak saat replay.
- Official assignment memakai business date Jakarta dan trigger database menjaga exclusivity periode.
- Audit event append-only; domain mutation dan audit berjalan dalam transaksi yang sama.
- Authorization resident dues diambil dari authenticated household/RT, bukan ID yang dikirim pengguna.

## Risiko tersisa

- **Preview/responsive:** belum ada deployment preview. Browser visual dan perangkat fisik 360-420 px, tablet, desktop ditunda ke UX/UAT; Gate A tidak mengklaim verifikasi ini.
- **Trusted proxy:** deployment harus menimpa atau membatasi `x-forwarded-for` sebelum mengandalkan rate limit per IP.
- **Recovery satu-admin:** recovery TOTP darurat memerlukan System Admin lain yang telah memverifikasi faktornya.
- **Bulan parsial:** implementasi bulanan mengenakan bulan mulai dan bulan akhir sebagai bulan penuh; prorata tidak ditambahkan atau diubah dalam verifikasi ini. Pastikan aturan Master Context v2 sebelum membuat tagihan untuk tanggal mulai/akhir tengah bulan.
- **Data smoke development:** Neon development kini berisi fixture sintetis hasil live smoke, bukan data production. Branch dibiarkan ada; tidak ada penghapusan branch atau data Neon.
- **Neon CI:** workflow GitHub tidak memakai secret Neon. CI Neon live dapat ditambahkan setelah secret dev khusus disiapkan; verifikasi live pada turn ini dilakukan langsung pada project/branch yang teridentifikasi.

## Catatan operasional

- Tidak ada koneksi, migration, atau smoke test pada Neon production.
- Sebelum beralih ke project KartuRT, sesi dashboard sempat membuat branch kosong `karturt-development` (`br-solitary-recipe-b3seziuu`) dan endpoint `ep-autumn-rice-b3gpx31j` di project Agustusan. Tidak ada migration atau application data yang dijalankan di sana; compute endpoint tersebut sudah disuspend. Branch tidak dihapus.
- Tidak ada branch yang dimerge ke default.
