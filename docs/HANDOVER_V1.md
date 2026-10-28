# KartuRT V1 — handover

**Agen penerus: baca dokumen ini dan panduan maintenance sebelum mengubah kode atau menjalankan operasi.** Jika informasi tampak bertentangan, gunakan bukti terbaru yang terikat pada SHA/target dan periksa sumber kode terkait. Jangan mengubah layanan Production untuk melengkapi handover ini.

**Snapshot dokumentasi:** 2026-10-29, Asia/Bangkok. Bukti RELEASE GO bertanggal 2026-10-28; SHA main, status issue, dan deployment terbaru diperiksa ulang pada 2026-10-29. Baseline rilis: **f48b5850f3669148536f850e2c9f687d433f154a**. Dokumen ini merangkum bukti rilis dan batas operasional, bukan izin baru untuk operasi Production.

## Sumber kebenaran

- [Roadmap #107 — final release closeout #6473942195](https://github.com/Satsetx4/karturt/issues/107#issuecomment-6473942195)
- [Release execution #110 — final read-only closeout #6473941681](https://github.com/Satsetx4/karturt/issues/110#issuecomment-6473941681)
- [Neon Production target and runtime-role audit #6468497997](https://github.com/Satsetx4/karturt/issues/110#issuecomment-6468497997)
- [Gate A run #40702901680](https://github.com/Satsetx4/karturt/actions/runs/40702901680)
- [Aplikasi Production](https://karturt-review-staging-20261012.vercel.app/)

Issue #107 dan #110 masih **OPEN secara administratif**. Isi awal issue menyimpan status lama; komentar final yang ditautkan di atas adalah catatan rilis yang lebih baru. Jangan menutup atau mengubah issue tersebut tanpa permintaan owner.

## Status rilis V1

| Bagian | Status yang tercatat | Batas bukti |
|---|---|---|
| Source main | SHA **f48b5850f3669148536f850e2c9f687d433f154a** | Ini SHA rilis yang disetujui pada closeout. |
| Vercel Production | Deployment **dpl_6gsSBK7CpN2HM3B3Ywe7sXARNCr2**, READY; alias mengarah ke deployment; health HTTPS 200 | Hasil read-only pada closeout, bukan bukti bahwa deployment lain diizinkan. |
| Neon Production | Project **holy-term-22410117**, branch **br-jolly-bonus-azzd71cl**, endpoint **ep-empty-rain-azwe3eb3**, database **karturt_production**, PostgreSQL 18 | Runtime TLS diverifikasi oleh Node (TLS 1.3); role runtime bukan superuser dan tidak memiliki CREATE pada database/schema publik. |
| Migrasi | 0000–0015; migrasi 0015 sudah ada | Jangan menjalankan migrasi ulang untuk menyelesaikan handover. |
| Gate A | SUCCESS pada SHA rilis, run #40702901680 | Lint, typecheck, suite tes, konsistensi jurnal migrasi, pemeriksaan drift schema, dan build Production lulus. |
| PostgreSQL concurrency | **SKIPPED** pada run rilis | Bukan PASS. |
| PostgreSQL 18 recovery | **SKIPPED** pada run rilis | Bukan PASS. |
| Smoke | Resident, Chairman, Treasurer, isolasi lintas rumah, batas otorisasi, dan layout responsif PASS | Admin TOTP dan dashboard PASS berdasarkan konfirmasi owner; agen tidak membaca sesi/cookie owner. |

Vercel project menggunakan Git source dari branch main. Vercel menjelaskan bahwa commit pada branch Git terhubung biasanya membuat deployment, kecuali build dilewati melalui Ignore Build Step ([dokumentasi Vercel](https://vercel.com/docs/builds)). Karena konfigurasi Ignore Build Step Production tidak tersedia dalam audit ini, **jangan merge perubahan ke main jika itu dapat memicu deployment**. Release GO untuk SHA di atas tidak mengizinkan deploy SHA baru, migrasi, atau import baru.

## Produk dan batas V1

KartuRT adalah aplikasi administrasi iuran untuk **satu RT**, pada layanan Free, dengan verifikasi transfer manual oleh Bendahara dan pencatatan tunai. Tidak ada payment gateway. Isolasi multi-tenant tetap harus dipertahankan walaupun operasional V1 hanya melayani satu RT.

Kebijakan finansial:

- Kartu iuran tahunan berisi periode bulanan; jatuh tempo tanggal 10.
- Bulan masa depan bukan tunggakan. Pengajuan transfer melalui aplikasi hanya untuk bulan berjalan dan tunggakan.
- Pembayaran di muka untuk bulan masa depan hanya dapat dicatat sebagai pembayaran tunai oleh Bendahara.
- Transfer diverifikasi Bendahara. Kwitansi menggunakan waktu verifikasi server, bukan waktu yang dikirim warga.
- Pembayaran tunai dialokasikan ke saldo belum lunas dari periode tertua terlebih dahulu.
- Saldo, penyesuaian, waiver, pembatalan, rejection, reversal, serta audit ledger harus dihitung dari ledger; jangan mengubah status iuran secara langsung.

### Data Production dan provenance

Satu batch import Sheet2 telah selesai dan diaudit read-only:

| Ukuran | Hasil |
|---|---:|
| Household baru | 73 |
| Akun warga baru | 73 |
| Akun pengurus baru | 2 |
| Akun baru | 75 |
| System Admin MFA yang digunakan ulang | 1 |
| Baris iuran dalam batch | 876 |
| Opening balance historis berstatus lunas | 626 |
| Tunggakan belum lunas | 138 |
| Periode masa depan belum lunas | 112 |

Total Production sesudah import: 75 rumah, 75 household, 77 orang, 81 akun aplikasi, dan 900 baris iuran. Baseline sebelumnya (2 rumah, 2 household, 4 orang, 6 akun, 24 iuran) tetap ada. Tabel permintaan pembayaran, pembayaran, alokasi, dan reversal tetap kosong; tidak ada transaksi atau kwitansi fiktif.

**Jangan jalankan ulang importer atau replay batch tersebut.** Importer memang memiliki transaksi, advisory lock, identitas batch, dan pemeriksaan idempotensi, tetapi guard tersebut bukan izin untuk menulis ulang data Production. Nilai historis yang lunas adalah opening balance, bukan rekaman pembayaran/kwitansi.

DATA RT.xlsx adalah data warga nyata dan sensitif. Jangan menyalin nama, alamat, PIN, kredensial, nilai per rumah, atau screenshot berisi PII ke dokumentasi, fixture, log, PR, maupun issue. Tes lokal harus memakai fixture sintetis.

## Peta repo

- **src/app/** — Next.js App Router: halaman, API route, login, health, error boundary, dan 404.
- **src/components/** — UI warga, pengurus, Bendahara, keamanan, serta navigasi.
- **src/lib/auth/** — principal server, MFA, session, lockout, recovery, dan permission matrix.
- **src/lib/billing/** — kartu iuran, permintaan/verifikasi pembayaran, tunai, reversal, waiver, penyesuaian, tarif, dan saldo ledger.
- **src/lib/reports/** — agregasi dan laporan finansial.
- **src/db/schema.ts**, **src/db/migrate.ts**, **src/db/production-target.ts** — schema Drizzle, migrator bergated, serta pemisahan target.
- **drizzle/0000–drizzle/0015** — migrasi SQL berurutan; **drizzle/meta/_journal.json** adalah jurnal.
- **src/lib/imports/sheet2-import.ts**, **scripts/import-sheet2-private.ts** — import privat Sheet2; jangan jalankan untuk batch Production yang sudah selesai.
- **tests/unit/**, **tests/integration/**, **tests/constraints/**, **tests/authorization/** — tes aturan domain, Postgres-compatible, constraint, dan akses.
- **tests/fixtures/workbook-account-roster.ts**, **tests/fixtures/workbook-financial-settlement.ts**, **tests/integration/sheet2-import.test.ts** — fixture sintetis/kontrak import; jangan menggantinya dengan workbook warga.
- **.github/workflows/gate-a.yml** — Gate A dan job concurrency/recovery bersyarat.

Stack: Next.js App Router, React, TypeScript, Tailwind CSS, Neon PostgreSQL, Drizzle ORM, Better Auth, dan Vitest dengan PGlite untuk tes lokal.

## Setup lokal aman

Gunakan Node.js 22.12 atau lebih baru (workflow Gate A menggunakan Node 24), dependency lockfile, dan database pengembangan **terisolasi**. Salin .env.example ke .env.local yang diabaikan Git; jangan membuka/menyalin .env.local atau berkas env import ke output atau Git.

Nama variabel utama (nama saja): **APP_ENV**, **DATABASE_ENV**, **DATABASE_URL**, **BETTER_AUTH_SECRET**, **NEXT_PUBLIC_APP_URL**. Label APP_ENV dan DATABASE_ENV harus sama. Bootstrap RT lokal memakai **KARTUR_RT_CODE**, **KARTUR_RW_CODE**, **KARTUR_RT_NAME**, **KARTUR_VILLAGE** (opsional: **KARTUR_DISTRICT**, **KARTUR_CITY**, **KARTUR_PROVINCE**). Simpan semua nilainya hanya pada berkas env lokal yang diabaikan Git.

Perintah yang tersedia di package.json:

~~~sh
npm ci
npm run dev
npm run lint
npm run typecheck
npm run test:unit -- --maxWorkers=1
npm run test:integration -- --maxWorkers=1
npm run test:constraints -- --maxWorkers=1
npm run test:authorization -- --maxWorkers=1
npm run test:security-closure -- --maxWorkers=1
npm test -- --maxWorkers=1
npx drizzle-kit check
npm run build
~~~

Perintah npm run db:check dan npm run db:migrate hanya untuk database pengembangan/disposable yang targetnya sudah diverifikasi. npm run db:generate menghasilkan file migrasi dan harus ditinjau. Jangan arahkan perintah lokal ke target Production.

## Keamanan akun dan otorisasi

| Peran kode | Batas utama |
|---|---|
| resident | Hanya iuran, pengajuan, riwayat, dan pembatalan milik household yang melekat pada principal server. |
| treasurer | Akses finansial satu RT: membaca kewajiban, verifikasi/tolak transfer, catat tunai, dan reversal. |
| rt_chairman | Manajemen RT: household/warga, pengurus, laporan, tarif, penyesuaian, waiver, generator iuran, audit dalam scope RT. |
| system_admin | Pemulihan/manajemen sistem dan audit; tidak punya izin finansial RT. |

Principal dan RT/household scope ditentukan di server dari account/assignment aktif; jangan percaya role, RT, atau household dari payload klien. System Admin memerlukan password 16–128 karakter dan faktor TOTP terverifikasi. Pemulihan MFA harus melalui admin terverifikasi lain, alasan, referensi, pencabutan session, dan audit sesuai implementasi. Jangan membuat jalur bypass.

## Prioritas dan backlog

1. **P0 — rotasi kredensial runtime Neon yang pernah terekspos.** Perlakukan nilai sebagai bocor; owner/operator harus merotasi dengan aman, memperbarui konfigurasi runtime Vercel dan konfigurasi importer privat yang relevan, lalu memverifikasi health/TLS. Nilai rahasia tidak boleh dicatat atau dikirim lewat chat/PR. **Rotasi tidak dilakukan sebagai bagian handover ini.**
2. **P1 — buktikan job PostgreSQL concurrency dan recovery PG18 secara independen.** Run rilis menandai keduanya SKIPPED; jalankan hanya terhadap database disposable terisolasi dan catat hasil pada SHA yang diuji.
3. **P1 — tutup celah bukti pemulihan Production.** docs/backup-restore-drill.md adalah drill staging historis, bukan bukti backup/restore Production. Siapkan prosedur dan rehearsal pada target disposable; operasi Production memerlukan otorisasi baru.
4. **P1 — audit dependency dan isu keamanan pada main terkini.** Laporan lama bukan bukti kondisi dependency pada SHA sekarang; rekam perintah, waktu, SHA, dan hasil sebelum menyebut PASS.
5. **P2 — backlog produk tertunda dari scope freeze:** F14 Export, F15 Audit UI, F16 lifecycle pengurus, full F17 admin tools, F19 notifikasi, F20 PWA, full F21 studi UX, dan full F23 optimisasi. Item ini ditunda, bukan otomatis terbuka untuk implementasi.

## Checklist takeover dan Definition of Done

- [ ] Baca dokumen ini, [panduan maintenance agen](AI_AGENT_MAINTENANCE_GUIDE.md), dan dokumen domain yang relevan.
- [ ] Periksa ulang main, worktree, status Git, PR aktif, ruleset branch, dan issue #107/#110. Jangan menghapus atau menimpa berkas kerja lokal.
- [ ] Perlakukan komentar final #107/#110 sebagai bukti rilis; jangan menaikkan SKIPPED menjadi PASS atau konfirmasi owner menjadi hasil tes agen.
- [ ] Untuk perubahan aplikasi, gunakan branch → PR → Gate A pada head SHA tepat → review → merge hanya setelah side effect Production diketahui dan diizinkan.
- [ ] Pertahankan scope satu RT, tenant guard, data finansial, session, dan role boundaries; jangan masukkan secret atau data warga ke repo.
- [ ] Tutup tugas dengan commit/PR dan bukti yang dapat ditelusuri. Nyatakan batas dan pekerjaan yang belum diuji.
- [ ] Definisi selesai: perubahan scope kecil, diff bersih, Gate A/checks pada SHA yang akan digabung lulus, review thread diselesaikan, dan tidak ada deployment/migrasi/import Production tanpa GO baru yang tepat.

## Dokumen proyek terkait

- [Scope MVP satu RT](mvp-single-rt-scope-freeze.md) — keputusan scope dan fitur tertunda.
- [Launch Safety](launch-safety-report.md) dan [Security Closure](launch-safety-security-closure-report.md) — bukti historis untuk fase pengembangan; bukan pengganti closeout Production terbaru.
- [Backup/restore drill](backup-restore-drill.md) — staging saja.
- [Laporan fase lama](phase-13-1-acceptance-closure-report.md) — historis, bukan status rilis saat ini.
