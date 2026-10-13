# KartuRT V1 Wave 12 — Agent C Evidence

Tanggal: 13 Oktober 2026 (Asia/Bangkok)
Ruang lingkup: W12-C01–C08, runbook dan Owner Approval Packet. Persiapan dan inspeksi source lokal saja.

## Hasil

- **Paket keputusan disiapkan; pekerjaan cloud tidak dimulai.** Tidak ada Neon/provider tool, koneksi/wake, SQL, migrasi, fixture, secret/env-file, GitHub, atau Vercel yang diakses.
- **C01 PARTIAL:** identitas target dicatat dari metadata yang diberikan owner; belum dibaca ulang live. Project/branch/database kosong belum dibuktikan lewat pemeriksaan isi database.
- **C02 PASS sebagai prosedur saja:** preflight metadata-only fail-closed dirumuskan; tidak dijalankan.
- **C03 PASS sebagai runbook saja:** urutan source migration 0000–0013 terikat pada journal; tidak dijalankan.
- **C04 PASS sebagai kebijakan saja:** pengelolaan role/secret dan pemblokiran `.env` dijelaskan; tidak ada kredensial dibaca/dibuat.
- **C05 BLOCKED untuk eksekusi:** source allowlist masih menunjuk resource lama dan isolasi tetap `false`; endpoint ID/hostname dan database ID target baru tidak tersedia dalam metadata yang boleh digunakan.
- **C06 PARTIAL:** fixture/teardown diusulkan sebagai tahap terpisah; tidak dibuat/dijalankan. Validasi tenant harus memakai sedikitnya dua RT sintetis.
- **C07 PARTIAL:** GitHub/CI dan Vercel Preview tetap tahap persetujuan terpisah; tidak disentuh.
- **C08 PASS:** paket persetujuan terpisah siap; semua persetujuan di bawah masih belum diberikan.

**Disposisi Agent C: OWNER PACKET PREPARED; MIGRATION EXECUTION BLOCKED. Bukan STAGING READY dan bukan release GO.**

## Baseline dan batas bukti

Worktree `D:\!AGY\karturt-wave11-c` diperiksa dalam keadaan bersih, detached pada commit `355c5804df9767e7ce8456edde4439a4a7eaedc9`, tree `df520d59d675e46f43c4b224798fe4b237e36360`. `AGENTS.md` berisi instruksi umum Next.js; tidak ada source yang diedit. Laporan Wave 11 yang diberikan dibaca sebagai catatan historis: pernyataannya bahwa project belum ada sudah digantikan oleh metadata baru yang diberikan owner. Wave 11 tidak membuktikan isi database Wave 12.

Metadata target berikut disalin dari instruksi owner dan **tidak diverifikasi ulang dalam tugas ini**:

| Properti | Nilai yang diberikan owner |
|---|---|
| Organisasi | `satset` / `org-ancient-boat-57106549`; plan Free |
| Project | `karturt-v1-staging` / `wild-art-99835126` |
| Region / PostgreSQL | `aws-ap-southeast-1` (Singapore) / PostgreSQL 18 |
| Branch | `staging` / `br-hidden-cake-a1ge5xqp`, primary/default |
| Database / owner | `karturt_staging` / `karturt_staging_owner` |
| Compute | min/max 0.25 CU |
| Suspend timeout | `suspend_timeout_seconds=0`; custom timeout pernah ditolak HTTP 412. Jangan coba ubah atau ulangi. |

Owner menyatakan project dibuat kosong, tanpa clone dari project lama. Tidak ada pemeriksaan isi/catalog database; karena itu belum ada bukti read-only bahwa database tidak berisi objek atau data tak terduga. Database ID, endpoint ID, dan hostname target baru tidak tersedia dalam metadata yang diizinkan. Jangan menebak atau mengambilnya dari credential/connection string.

Owner telah mengesampingkan MFA organisasi dan audit penggunaan/Rp0 sebagai blocker Wave 12 V1. Keduanya bukan alasan untuk menahan paket ini; status Free/biaya aktual juga tidak diverifikasi ulang dan tidak diklaim Rp0. Tetap wajib berhenti bila langkah yang diusulkan membutuhkan upgrade, fitur berbayar, atau pengeluaran. Jangan ubah MFA atau plan. Keamanan kredensial dan larangan data warga asli tetap berlaku.

## Bukti source dan migration inventory

| Bukti | Hasil inspeksi |
|---|---|
| `drizzle/meta/_journal.json:1-101` | 14 entri berurutan indeks 0–13, tag `0000_messy_menace` sampai `0013_phase_12_household_management`. |
| `drizzle/*.sql`, `drizzle/meta/*_snapshot.json` | 14 file SQL, 14 snapshot, seluruh 14 tag journal memiliki file SQL. Hasil hitung lokal: `sql_files=14 journal_entries=14 snapshots=14 missing_journal_sql=0`. |
| `package.json:37` | `db:migrate` memanggil `tsx src/db/migrate.ts`; `db:check:offline`/`db:generate:offline` memakai konfigurasi offline. |
| `src/db/migrate.ts:1-11` | `loadProjectEnvConfig` dijalankan, lalu `requireDatabaseEnvironment`, kemudian migrator menjalankan folder `./drizzle`. Bukan perintah yang boleh dijalankan tanpa persetujuan dan target guard yang benar. |
| `src/lib/env.ts:19-27,52-60` | Operasi DB mensyaratkan `APP_ENV` dan `DATABASE_ENV` eksplisit, label harus cocok, URL harus ada dan lulus target guard. |
| `src/lib/env-file-preflight.ts:4,27-53` | Pemuatan file `.env*` memerlukan opt-in dan hanya diizinkan untuk label development. Pada tahap staging, sediakan env melalui mekanisme secret yang disetujui; jangan mengandalkan file `.env` lokal atau mencetak URL. |
| `src/lib/staging-database-target.ts:1-14,56-94` | Allowlist saat ini mematok project lama `ancient-smoke-51787007`, branch `br-dry-block-b3fsqjo3`, database ID `604003`/`karturt_stage`, endpoint lama; `stagingIsolationVerifiedEmpty=false`. Guard ini menolak target baru dan tetap memblokir akses. Jangan melemahkan atau melewati guard. |
| `docs/staging-uat-plan.md:10-11` | Dokumen historis mensyaratkan migrations 0000–0013 dan menyatakan belum ada 0014. UAT di dokumen itu single-RT; itu bukan bukti tes isolasi lintas RT. |
| `drizzle/0003_due_auth_audit_domain.sql`, `0009_phase_8_cash_payment.sql`, `0012_phase_11_tariff_adjustment.sql`, `0013_phase_12_household_management.sql` | Ada operasi `DROP`/perubahan constraint dan migrasi DDL; file tidak boleh diasumsikan aman untuk rerun setelah kegagalan. Jangan jalankan ulang otomatis atau menganggap hasil parsial atomik. |

Tidak ada `db:migrate`, `db:check`, build, test, atau koneksi yang dijalankan oleh Agent C. Bukti runtime PostgreSQL 18, empty database, grants, owner/role login, backup/restore, deployment, dan CI tidak dibuat di sini.

## W12-C02 — metadata-only identity preflight (proposal, belum dijalankan)

Dalam tahap yang kelak disetujui, hanya baca metadata provider tanpa koneksi database terlebih dahulu. Cocokkan semuanya persis: org ID/nama; plan tetap Free; project ID/nama; region dan versi PostgreSQL; branch ID/nama serta primary/default status dan lineage tanpa parent/clone data; database ID/nama/owner; endpoint ID/hostname; min/max compute 0.25 CU; suspend timeout tetap 0; serta status tidak ada resource/tambahan berbayar. Simpan waktu readback dan hasil cocok/tidak cocok, tanpa secret. Jangan membuka project Neon lain atau organisasi lain.

Nilai kosong, berbeda, stale, atau tidak dapat dibuktikan berarti **STOP**. Metadata provider saja tidak membuktikan database benar-benar kosong atau `current_user` dan server pada sesi DB. Karena itu preflight metadata yang lolos hanya boleh mengantar ke pemeriksaan read-only setelah izin tahap #1 di bawah; belum mengizinkan DDL.

## W12-C03/C05 — urutan runbook migrasi (proposal, belum dijalankan)

Tahap ini hanya boleh dimulai setelah satu persetujuan owner yang secara eksplisit mencakup perubahan allowlist lokal, metadata readback, satu wake/koneksi awal, pemeriksaan read-only, dan DDL persis seperti cakupan persetujuan #1.

1. Bekukan source yang akan digunakan: catat SHA/tree exact, pastikan worktree bersih, baca ulang journal serta hash file SQL; pastikan tetap 14 migrasi 0000–0013 dan tidak ada perubahan di luar persetujuan. Perubahan SHA setelah review membatalkan packet ini sampai direview ulang.
2. Jalankan preflight metadata-only di atas. Lengkapi database ID, endpoint ID, dan hostname hanya dari provider metadata yang disetujui; verifikasi target, jangan memakai connection string sebagai sumber kebenaran.
3. Perbarui dan review `src/lib/staging-database-target.ts` secara lokal agar allowlist mengikat project/branch/database/endpoint baru secara tepat dan tetap fail-closed. Ubah `stagingIsolationVerifiedEmpty` hanya setelah bukti empty yang disyaratkan didapat dan disetujui. Source pada SHA yang diperiksa sekarang belum aman untuk target baru. Jangan bypass guard.
4. Gunakan credential/role migrator yang disetujui dan hak minimum untuk DDL pada target staging saja; database owner yang diberikan owner adalah `karturt_staging_owner`, namun login, privilege, dan secret belum diverifikasi. Jangan gunakan role runtime untuk migrasi dan jangan masukkan credential ke repo, file bukti, log, chat, atau `.env`.
5. Hanya jika koneksi awal itu termasuk eksplisit dalam izin: lakukan satu wake/connect lalu pemeriksaan **read-only**. Cocokkan database, current role, server PostgreSQL 18, dan endpoint dengan allowlist lokal serta metadata. Periksa katalog/schema dan ledger migrasi untuk memastikan tak ada objek/data aplikasi atau riwayat Drizzle tak terduga. Jika ada objek, tabel, baris, ledger, role, versi, database, endpoint, atau izin yang berbeda/tidak pasti: putus, simpan bukti tersanitasi, **STOP tanpa DDL**.
6. Sebelum DDL, arsipkan source/hash journal dan bukti empty state. Pastikan recovery path tersedia pada plan Free saat itu dan tidak memerlukan paid feature/spend. Jika backup/restore yang dapat diterima tidak tersedia tanpa biaya tambahan, berhenti. Tidak ada branch/database/project yang boleh dihapus atau dibuat ulang dalam runbook ini.
7. Terapkan hanya file migration dari journal, dalam urutan indeks 0–13, satu kali, pada database allowlist. Jangan mengedit SQL, melewati entry, menambah migration, meneruskan ke fixture, atau otomatis mengulang setelah error. Simpan log yang sudah disanitasi dan hash/hasil tiap entry; jangan log URL.
8. Setelah selesai, tutup koneksi migrator. Verifikasi secara read-only seluruh 14 migration hash/entry tercatat, tidak ada pending/extra migration, schema/catalog sesuai snapshot final/expectations yang direview (tabel, constraint, index, enum, trigger/function), database tetap tanpa data bisnis/fixture, dan tidak ada drift. Catat hasil serta source SHA. Jangan nyatakan PostgreSQL 18 runtime atau UI siap hanya dari DDL sukses.
9. Jika ada error/ketidaksesuaian kapan pun, berhenti dan jangan rerun, drop, restore, truncate, atau menghapus resource. Pertahankan source hash, ledger/schema evidence, dan log tersanitasi untuk owner. Rekonsiliasi/restore/rollback memerlukan keputusan dan izin eksplisit berikutnya; rollback bukan bagian izin DDL awal.

Validasi SQL/katalog dalam langkah 5 dan 8 hanya proposal masa depan, **NOT EXECUTED**. Langkah-langkah ini tidak memberikan otorisasi saat ini.

## W12-C06 — fixture dan teardown (izin terpisah)

Setelah migrasi diverifikasi, fixture perlu dijalankan sebagai tahap tersendiri dan hanya dengan persetujuan #2. Buat manifest deterministik dengan `runId`, source SHA, project/branch/database identity, jumlah expected inserts, dan daftar ID sintetis. Sedikitnya dua `rtUnitId` sintetis yang berbeda diperlukan untuk uji negatif lintas-RT; akun, rumah tangga, alamat, kontak, pembayaran, dan nama harus buatan, tidak menyerupai data warga asli. Validasi tenant gagal-closed saat ID dari RT lain dipakai.

Teardown hanya boleh menyentuh record dengan `runId` milik eksekusi tersebut, dengan hitung row/ID diverifikasi sebelum dan sesudah, urutan hapus mengikuti foreign key, dan pencatatan hasil tersanitasi. Jangan `TRUNCATE`, hapus project/database, menyentuh data tanpa run marker, atau mengubah fixture run lain. Kegagalan hitungan/target berarti STOP; teardown ulang atau recovery memerlukan keputusan owner. Tidak ada fixture atau teardown dalam tahap migrasi #1.

## W12-C07 — GitHub/CI dan Vercel Preview

GitHub branch/source publication dan CI memerlukan persetujuan #3 tersendiri; tidak termasuk izin database. Jangan push, merge, tulis issue/comment, atau publish commit sekarang. Merge/default branch tetap memerlukan otorisasi khusus.

Vercel Preview memerlukan persetujuan #4 tersendiri. Metadata yang diberikan owner menyebut project retained `karturt-review-staging-20261012` / `prj_Mv4rABJvDNAvSD78SVt5WbjFakEq`, proteksi SSO aktif, nol deployment, dan GitHub link belum dibuat. Fakta ini tidak diverifikasi ulang. Jika kelak disetujui, cakupannya Preview saja tanpa Production env/domain/DNS, tanpa organisasi Vercel lain. Tidak ada deployment saat ini.

## W12-C08 — Owner Approval Packet

Semua keputusan berikut **belum disetujui**. Persiapan Wave 12 tidak menyiratkan persetujuan.

1. **[BELUM DISETUJUI] Inisialisasi schema staging, satu tahap terbatas.** Izinkan: (a) readback metadata provider untuk melengkapi dan mengonfirmasi identitas target; (b) review dan perubahan source allowlist lokal pada `src/lib/staging-database-target.ts`; (c) satu wake/koneksi awal, dengan pemeriksaan DB identity/role/version dan empty/drift read-only terlebih dahulu; lalu (d) bila semua cocok, menjalankan tepat 14 migrations `0000`–`0013` dari source SHA yang disebut pada persetujuan. Target hanya org `satset` / `org-ancient-boat-57106549`, project `wild-art-99835126`, branch `br-hidden-cake-a1ge5xqp`, database `karturt_staging` dengan owner `karturt_staging_owner`, dan endpoint/database ID yang kelak dibaca ulang serta disahkan owner. Berhenti sebelum DDL bila metadata, guard, empty check, role, backup/recovery, atau Free/no-added-spend constraint tidak cocok. Tidak termasuk fixture, app connection/deploy, role/credential creation, rollback/restore, atau resource delete/recreate.
2. **[BELUM DISETUJUI] Fixture sintetis dan teardown.** Izin terpisah sesudah schema verified, untuk manifest runId dan sedikitnya dua RT sintetis serta teardown hanya atas row milik run.
3. **[BELUM DISETUJUI] GitHub/CI/source publication.** Tentukan branch/commit/CI yang dicakup; tidak termasuk merge ke branch default kecuali owner memberi izin tambahan.
4. **[BELUM DISETUJUI] Vercel Preview.** Hanya target Preview yang dinyatakan dan diverifikasi ulang, SSO/proteksi tetap, tanpa Production env/domain/DNS atau organisasi lain.

### Gate akhir Agent C

**BLOCKED untuk eksekusi migrasi pada source saat ini.** Paket keputusan sudah siap ditinjau owner, tetapi source guard menunjuk target lama dan metadata target yang diizinkan tidak memiliki database ID/endpoint baru. Gate dapat dibuka hanya setelah owner memberi izin eksplisit #1, identitas metadata lengkap dibuktikan, perubahan allowlist direview di source, dan pemeriksaan read-only menunjukkan target yang benar-benar kosong. Tahap berikut tetap berhenti setelah DDL terverifikasi; staging app, fixture, CI, Vercel Preview, dan release masing-masing belum GO.
