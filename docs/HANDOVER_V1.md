# KartuRT — handover proyek

**Agen penerus: baca dokumen ini dan [panduan maintenance](AI_AGENT_MAINTENANCE_GUIDE.md) sebelum mengubah kode atau menjalankan operasi.** Jika sumber berbeda, utamakan bukti terbaru yang terikat pada SHA dan target, lalu cocokkan dengan kode. Jangan mengubah layanan Production untuk melengkapi handover.

**Snapshot:** 2026-10-30, Asia/Bangkok. Repo `Satsetx4/karturt`; `main` saat diperiksa: **69473a3f4fa5a097b8cd66b920c04169cee540f4**. Rilis V1 awal dimulai di `f48b5850f3669148536f850e2c9f687d433f154a`; sesudahnya fitur PR #117–#120 telah tergabung dan deployment Production terbaru yang diperiksa READY. Catatan ini merekam status, bukan izin baru untuk merge, deploy, akses akun, atau operasi database.

## Sumber kebenaran

- [Main saat snapshot](https://github.com/Satsetx4/karturt/commit/69473a3f4fa5a097b8cd66b920c04169cee540f4)
- [PR #117 — login resmi username + PIN](https://github.com/Satsetx4/karturt/pull/117), [PR #118 — laporan Bendahara dan cetak A4](https://github.com/Satsetx4/karturt/pull/118), [PR #119 — ekspor CSV](https://github.com/Satsetx4/karturt/pull/119), [PR #120 — PWA RT05](https://github.com/Satsetx4/karturt/pull/120)
- [Gate A untuk head PR #120](https://github.com/Satsetx4/karturt/actions/runs/40888073109) — lulus pada `2c13eea03f065768c2718cb15ea1bcc1ec42aad2`; concurrency Postgres dan recovery PG18 **SKIPPED**.
- [Roadmap #107 — catatan closeout awal](https://github.com/Satsetx4/karturt/issues/107#issuecomment-6473942195), [release execution #110 — catatan closeout awal](https://github.com/Satsetx4/karturt/issues/110#issuecomment-6473941681), [audit target Neon saat itu](https://github.com/Satsetx4/karturt/issues/110#issuecomment-6468497997)
- [PR #116 — dokumen handover ini](https://github.com/Satsetx4/karturt/pull/116) masih OPEN dan belum tergabung ke `main`.
- [Aplikasi Production](https://karturt-review-staging-20261012.vercel.app/)

Issue #107 dan #110 masih **OPEN** dan berisi catatan lama. Komentar closeout di atas berguna untuk rilis V1 awal, sedangkan bukti merge dan rilis PR #117–#120 ada di halaman PR masing-masing. Jangan menutup atau mengubah issue tersebut tanpa permintaan owner.

## Status repo dan Production

| Bagian | Status pada 2026-10-30 | Batas bukti |
|---|---|---|
| `main` | **69473a3f4fa5a097b8cd66b920c04169cee540f4**, hasil merge PR #120 | Tidak ada perubahan source lokal yang menjadi bagian dari SHA ini. |
| Fitur tergabung | PR #117 login resmi; #118 laporan iuran dan cetak PDF; #119 CSV bulanan; #120 install PWA RT05 | Lihat fitur dan batasnya di bawah serta detail tiap PR. |
| Vercel Production | Project `karturt-review-staging-20261012` (`prj_Mv4rABJvDNAvSD78SVt5WbjFakEq`); deployment **dpl_EWeS8aYU7bqa1mT58Mfpxqtq9Eo9** READY, target `production`, Git SHA `69473a3`; alias `https://karturt-review-staging-20261012.vercel.app/` | Status diperiksa read-only. Nama project memuat kata “staging”, tetapi deployment ini bertarget Production. Ini bukan izin untuk deploy SHA berikutnya. |
| Gate A | PASS pada head PR #120 `2c13eea03f065768c2718cb15ea1bcc1ec42aad2`, run #40888073109 | Concurrency Postgres dan recovery PG18 dilewati, bukan PASS. |
| Status check gabungan GitHub | Ada check `Vercel` berstatus failure pada main dan menunjuk [project disposable F4](https://vercel.com/sekawan/karturt-v1-1-f4-disposable-20261029/FV7gwk9SP8MJRaQUxxZkPX8CVHZH) | Jangan samakan check Vercel disposable itu dengan deployment Production yang READY; verifikasi ulang check dan target sebelum keputusan rilis. |
| Neon Production | Catatan closeout terakhir menyebut project `holy-term-22410117`, branch `br-jolly-bonus-azzd71cl`, endpoint `ep-empty-rain-azwe3eb3`, database `karturt_production`, PostgreSQL 18; migrasi sampai 0015 | Ini target yang terdokumentasi pada audit sebelumnya, **belum diverifikasi ulang dalam pembaruan handover ini**. Verifikasi ulang secara read-only sebelum operasi yang kelak diizinkan. |
| Akun resmi / PIN / TOTP Admin | Kesiapan akun nyata belum diverifikasi ulang setelah rilis PR #117–#120 | Rilis tidak melakukan login akun riil. Jangan menganggap username, PIN, assignment, atau MFA Production sudah diverifikasi. |

PR #117–#120 masing-masing mempunyai riwayat persetujuan dan deployment tersendiri. Itu tidak memberi izin untuk merge/deploy berikutnya, migrasi, perubahan secret, atau perubahan data. Vercel memakai Git dari `main`; konfigurasi Ignore Build Step belum diverifikasi. **Jangan merge PR #116 atau PR lain ke `main` tanpa kewenangan merge/deployment yang baru dan spesifik.**

## Produk, fitur rilis, dan batasnya

KartuRT adalah aplikasi administrasi iuran untuk **satu RT**, pada layanan Free, dengan verifikasi transfer manual oleh Bendahara dan pencatatan tunai. Tidak ada payment gateway. Isolasi multi-tenant tetap harus dipertahankan walaupun operasional saat ini hanya melayani satu RT.

| Fitur yang sudah tergabung di `main` | Perilaku yang perlu diketahui |
|---|---|
| Login pengurus (PR #117) | Ketua RT/Bendahara masuk dengan username dan PIN enam digit; warga tetap memakai nomor rumah dan PIN; System Admin tetap memakai password kuat dan TOTP. Tidak ada migrasi pada PR ini. |
| Laporan iuran bulanan dan cetak (PR #118) | Bendahara dan Ketua RT dapat membaca laporan sesuai RT aktif, memilih bulan/tahun, lalu cetak atau simpan PDF A4. Angka dikelompokkan menurut bulan iuran dan merupakan posisi data saat dibuka, bukan laporan kas atau snapshot historis akhir bulan. |
| Unduh CSV (PR #119) | Ketua RT dan Bendahara dapat mengunduh laporan bulan/tahun terpilih, termasuk ringkasan, saldo awal, transfer/tunai, waiver, tunggakan, dan status rumah. Ekspor memakai payload laporan yang sudah diotorisasi. |
| PWA RT05 (PR #120) | Aplikasi dapat ditambahkan ke layar utama dengan ikon RT05. Ini shell online-only: tidak ada service worker, cache data keuangan, notifikasi push, atau autentikasi offline. |

PWA belum diuji dengan pemasangan fisik di Android/iPhone. Rilis di atas tidak membuktikan kesiapan akun Production; laporan PR menyatakan login akun nyata tidak dilakukan.

Kebijakan finansial:

- Kartu iuran tahunan berisi periode bulanan; jatuh tempo tanggal 10.
- Bulan masa depan bukan tunggakan. Pengajuan transfer melalui aplikasi hanya untuk bulan berjalan dan tunggakan.
- Pembayaran di muka untuk bulan masa depan hanya dapat dicatat sebagai pembayaran tunai oleh Bendahara.
- Transfer diverifikasi Bendahara. Kwitansi menggunakan waktu verifikasi server, bukan waktu yang dikirim warga.
- Pembayaran tunai dialokasikan ke saldo belum lunas dari periode tertua terlebih dahulu.
- Saldo, penyesuaian, waiver, pembatalan, rejection, reversal, serta audit ledger harus dihitung dari ledger; jangan mengubah status iuran secara langsung.

### Data Production dan provenance

Angka di bawah adalah baseline dari audit setelah import pada 2026-10-28. PR #117–#120 tidak menambahkan migrasi atau mengubah data bisnis, tetapi angka terkini tetap harus dibaca ulang secara read-only sebelum dipakai untuk keputusan operasional.

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
| treasurer | Akses finansial satu RT: membaca kewajiban dan laporan, verifikasi/tolak transfer, catat tunai, dan reversal. Tidak mendapat akses tulis waiver. |
| rt_chairman | Manajemen RT: household/warga, pengurus, laporan, tarif, penyesuaian, waiver, generator iuran, audit dalam scope RT. Tidak memverifikasi pembayaran. |
| system_admin | Pemulihan/manajemen sistem dan audit; tidak punya izin finansial RT. |

Principal dan RT/household scope ditentukan di server dari account/assignment aktif; jangan percaya role, RT, atau household dari payload klien. System Admin memerlukan password 16–128 karakter dan faktor TOTP terverifikasi. Pemulihan MFA harus melalui admin terverifikasi lain, alasan, referensi, pencabutan session, dan audit sesuai implementasi. Jangan membuat jalur bypass.

## Pekerjaan aktif dan prioritas

### Matriks iuran bulanan/tahunan — masih WIP lokal

Pemilik meminta tampilan laporan berbentuk matriks yang bisa melihat keseluruhan iuran per bulan/tahun dan per rumah. Draft implementasi saat snapshot **belum ada di GitHub** dan belum masuk `main`:

- Worktree: `D:\!AGY\karturt-annual-dues-matrix-20261030`
- Branch lokal: `feat/annual-dues-matrix-20261030`, berbasis main `69473a3f4fa5a097b8cd66b920c04169cee540f4`
- File lokal berubah: `docs/treasurer-monthly-report.md`, `src/app/globals.css`, `src/components/chairman-reports.tsx`, `src/lib/reports/aggregation.ts`, `src/lib/reports/monthly-report-csv.ts`; file baru `src/lib/reports/household-matrix.ts`
- Belum ada commit, push, atau PR. Jangan menganggap diff ini sudah ada pada branch handover/GitHub. Jika agen penerus memakai checkout yang sama, periksa `git status` dan diff sebelum melanjutkan; jangan menimpa perubahan lokal.
- Pemeriksaan sebelumnya: ESLint pada file TypeScript yang berubah lulus; `npm run typecheck` terhambat karena instalasi dependency lokal tidak menemukan modul `pg` dan menampilkan error di file DB/script; tes tidak dijalankan. Ulangi pemeriksaan setelah dependency lokal beres dan tinjau hasil fungsional sebelum membuat PR.

### Risiko/pekerjaan lain yang masih terbuka

1. **P0 — rotasi kredensial runtime Neon yang pernah terekspos.** Handover lama menandai nilainya terekspos; catatan rilis PR #117–#120 tidak membuktikan rotasi selesai. Owner/operator perlu memverifikasi dan menangani rotasi, memperbarui consumer runtime/import privat yang relevan, lalu memeriksa health/TLS. Jangan cari, salin, atau kirim nilai rahasia. Ini tidak dilakukan dalam handover.
2. **P1 — bukti concurrency PostgreSQL dan recovery PG18.** Run terbaru Gate A menandai kedua job **SKIPPED**. Jalankan hanya dengan database disposable terisolasi dan catat hasil pada SHA yang tepat.
3. **P1 — bukti backup/restore Production.** `docs/backup-restore-drill.md` hanya mencatat drill staging historis; belum membuktikan backup/restore Production. Siapkan rehearsal disposable. Operasi Production tetap perlu otorisasi terpisah.
4. **P1 — audit dependency/keamanan untuk SHA main sekarang.** Laporan lama bukan bukti status terkini. Catat waktu, SHA, perintah, dan temuan sebelum menyatakan PASS.
5. **P1 — kesiapan akun Production.** Tidak ada login akun nyata pada rilis terakhir; status akun resmi, PIN, assignment, dan TOTP Admin belum diverifikasi ulang. Minta owner/operator yang berwenang meninjau alur akun secara aman; jangan melakukan login dengan kredensial riil dari pekerjaan handover.
6. **P2 — backlog produk:** laporan iuran, cetak A4, CSV, dan shell PWA dasar sudah ada. Matriks tahunan masih WIP di atas. Audit UI, lifecycle pengurus, cakupan penuh alat System Admin, notifikasi, studi UX lengkap, dan optimisasi lebih lanjut masih tertunda sesuai scope freeze.

## Checklist takeover dan Definition of Done

- [ ] Baca dokumen ini, [panduan maintenance agen](AI_AGENT_MAINTENANCE_GUIDE.md), dan dokumen domain yang relevan.
- [ ] Periksa ulang `main`, worktree, status Git, PR aktif, dan ruleset branch. Issue #107/#110 berisi checkpoint lama; cocokkan dengan PR #117–#120 serta status provider terkini. Jangan menghapus atau menimpa berkas kerja lokal.
- [ ] Jangan menaikkan SKIPPED menjadi PASS atau konfirmasi owner menjadi hasil tes agen. Cocokkan setiap klaim dengan SHA dan run yang tepat.
- [ ] Jika melanjutkan matriks tahunan, periksa lebih dahulu worktree/branch lokal yang dicatat di atas. Jika tidak tersedia, baca dokumen laporan dan implementasi saat ini sebelum merancang ulang.
- [ ] Untuk perubahan aplikasi, gunakan branch → PR → Gate A pada head SHA tepat → review → merge hanya setelah side effect Production diketahui dan diizinkan.
- [ ] Pertahankan scope satu RT, tenant guard, data finansial, session, dan role boundaries; jangan masukkan secret atau data warga ke repo.
- [ ] Tutup tugas dengan commit/PR dan bukti yang dapat ditelusuri. Nyatakan batas dan pekerjaan yang belum diuji.
- [ ] Definisi selesai: perubahan scope kecil, diff bersih, Gate A/checks pada SHA yang akan digabung lulus, review thread diselesaikan, dan tidak ada deployment/migrasi/import Production tanpa GO baru yang tepat.

## Dokumen proyek terkait

- [Scope MVP satu RT](mvp-single-rt-scope-freeze.md) — keputusan scope dan fitur tertunda.
- [Launch Safety](launch-safety-report.md) dan [Security Closure](launch-safety-security-closure-report.md) — bukti historis untuk fase pengembangan; bukan pengganti closeout Production terbaru.
- [Backup/restore drill](backup-restore-drill.md) — staging saja.
- [Laporan fase lama](phase-13-1-acceptance-closure-report.md) — historis, bukan status rilis saat ini.
