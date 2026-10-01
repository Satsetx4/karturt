# Laporan Penyelesaian KartuRT Fase 8 — Cash Payment

Tanggal: 1 Oktober 2026
Keputusan: **PASS Fase 8** · **GO untuk mulai perencanaan Fase 9**
Repo: Satsetx4/karturt
Branch: feat/phase-8-cash-payment
Baseline: fix/phase-7-1-post-resolution-lifecycle, 9f1549191a6f627e493f430ab44025771f8a6a67
F7.1 implementation ancestor: 80019e05c698a81e1b3f2718132f01e4f5cababd
Final implementation and test SHA: 45d78b631cb373a7cb6b0a3860fb7edd5ce40e08
Migration head: 0009_phase_8_cash_payment

Tidak ada merge ke default branch. Tidak ada koneksi atau migrasi ke Neon production. Fase 9 belum dikerjakan.

## Ringkasan keputusan

Bendahara aktif di RT yang sama dapat mencatat pembayaran tunai langsung untuk satu atau beberapa bulan. Server memilih tunggakan dari bulan paling tua sampai bulan target, menghitung nominal dari iuran terkunci di database, dan menyimpan satu payment, seluruh allocations, perubahan status iuran, dan satu audit dalam transaksi tunggal.

Permintaan warga yang masih pending memblokir seluruh operasi tanpa mengubah request atau claim. Request lama yang sudah rejected atau cancelled tetap berstatus terminal saat kewajiban yang sama kemudian dibayar tunai. Ledger transfer tetap terikat ke payment request dan snapshot item yang diverifikasi; cash tidak membuat payment request fiktif.

Tidak ada blocker Critical atau High pada gate yang diminta.

## Baseline dan scope

- Baseline branch dan SHA cocok dengan target yang diminta; working tree baseline bersih.
- CI baseline Fase 7.1 Gate A: run 36866948407, success, pada SHA baseline.
- Journal sebelum perubahan berisi migration 0000 sampai 0008. Migration yang sudah diterapkan tidak diubah.
- Branch implementasi dibuat sebagai feat/phase-8-cash-payment dan dipush untuk menjalankan GitHub Actions.
- Scope tetap Fase 8. Reversal, waiver/pemutihan, tariff/adjustment, laporan/export, notification/outbox, deployment, migrasi production, dan merge default branch tidak dilakukan.

## Aturan bisnis dan keputusan teknis

| Aturan sumber | Implementasi |
| --- | --- |
| Hanya Bendahara mencatat cash; System Admin bukan aktor finansial. | Service memeriksa role, permission, assignment Bendahara aktif pada tanggal bisnis Jakarta, dan RT dari principal terautentikasi. |
| Cash dapat melunasi beberapa bulan. | Satu payment cash mempunyai beberapa allocations; bulan dan jumlah bersumber dari due rows server. |
| Pembayaran mengikuti oldest UNPAID first. | Server mengambil raw unpaid lintas tahun hingga bulan target, mengunci dan memeriksa ulang due; PAID, WAIVED, dan NOT_DUE tidak diikutkan. |
| Identitas warga/rumah harus jelas. | Bendahara mencari rumah, melihat nomor rumah dan nama penghuni aktif, lalu mengonfirmasi rumah, bulan, total, dan Tunai. Household historis yang masih punya utang tetap bisa dipilih dan diberi penanda nonaktif. |
| Pending request yang konflik tidak boleh ditimpa. | Seluruh transaksi diblokir bila satu due terpilih mempunyai active claim dari request pending. Request dan claim tetap utuh untuk diselesaikan melalui flow transfer. |
| Histori finansial/audit harus utuh. | Ledger append-only dipertahankan. Cash mempunyai audit payment.cash_recorded dalam transaksi yang sama. Histori request terminal tidak ditulis ulang. |

### Generalisasi ledger

Migration 0009 memakai payment_request_id nullable sebagai discriminator sumber yang eksplisit:

- Transfer wajib mempunyai request ID dan allocation tetap cocok ke snapshot payment_request_items yang immutable.
- Cash wajib tidak mempunyai request ID dan tidak membuat payment request atau item sintetis.
- Kedua sumber memiliki FK scope payment/RT/household; cash allocation tidak mengandalkan composite FK yang dilewati ketika request ID null.
- Method payment hanya transfer atau cash. Cash wajib memiliki key UUIDv4 dan SHA-256 fingerprint; key unik menurut RT dan Bendahara.
- Validator deferred cash memeriksa aktor official, minimal satu allocation, scope household/RT/payment, amount allocation terhadap due paid, jumlah payment terhadap total allocations, key/fingerprint, dan tepat satu audit cash.
- Guard paid-due menerima allocation transfer terverifikasi atau ledger cash lengkap. Jalur transfer tetap menjalankan assertion request yang ketat.
- Tidak ditambahkan unique constraint global pada monthly_due_id; constraint itu akan menghalangi kemungkinan reversal dan bayar ulang di Fase 9.
- Aturan F7.1 mengizinkan kewajiban pada histori request rejected/cancelled menjadi paid oleh cash atau request transfer pengganti yang sah, tanpa menambahkan ledger/claim pada request terminal.

Rincian architecture freeze ada di [phase-8-cash-payment-design.md](phase-8-cash-payment-design.md).

## Transaksi cash kanonis

Service menerima householdId, target period, dan key idempotency. Service lalu:

1. Memastikan principal adalah Bendahara aktif dan permission sesuai; RT berasal dari principal.
2. Memastikan household berada di RT tersebut. Target lintas RT tidak dibedakan dari household yang tidak ditemukan.
3. Memeriksa key: input yang sama mengulang hasil yang sama; fingerprint berbeda menghasilkan konflik aman.
4. Mengambil semua raw unpaid sampai periode target dalam urutan tahun/bulan, lalu mengunci due secara stabil.
5. Memeriksa ulang status, jumlah, kewajiban tertua, serta claim aktif dari request pending.
6. Menghitung total hanya dari amount due yang terkunci.
7. Membuat satu payment cash tanpa request ID, satu allocation per due, mengubah due unpaid menjadi paid, lalu menulis satu audit.
8. Membiarkan PostgreSQL menjalankan deferred invariant. Error pada insert, invariant, atau audit menggagalkan transaksi seluruhnya.

Request creation menggunakan lock pada due yang sama. Bila request menang, cash melihat claim pending dan gagal; bila cash menang, request membaca due paid dan gagal. Cash tidak mengunci request row, sehingga lock order resolution/verification tetap terjaga.

## Idempotency, konflik, dan konkurensi

Hasil smoke HTTP nyata pada Neon development:

- Multi-month cash melewati tahun kalender: 2026-04, 2026-05, dan 2027-02; total Rp62.000; satu payment, tiga allocations, satu audit.
- Replay key sama mengembalikan hasil yang sama tanpa payment kedua.
- Key sama dengan fingerprint berbeda mendapat HTTP 409.
- Cash saat request pending mendapat HTTP 409; status request dan dua claims tetap pending/utuh. Setelah request ditolak, cash berhasil dan histori tetap rejected.
- Race request-create versus cash menghasilkan satu pemenang saja: HTTP [200, 409], cash menang dalam run tersebut; tidak ada claim dan pembayaran ganda.
- Race cash dengan verification atas request pending menghasilkan HTTP [409, 200]; cash terblokir dan verification tetap berhasil.
- Dua cash dengan key berbeda atas tunggakan sama menghasilkan HTTP [409, 200]; hanya satu ledger tercatat.
- Test integration mencakup kedua urutan hasil race request-create/cash, idempotency mismatch, pending conflict, dan cash setelah request ditolak serta dibatalkan.

## Authorization dan batas HTTP

- Bendahara aktif pada RT yang sama diizinkan; resident, Chairman, System Admin, Bendahara lintas RT, dan assignment yang sudah berakhir ditolak.
- Search, detail, dan preview hanya tersedia untuk Bendahara terautentikasi. Cross-RT household tidak bocor melalui hasil detail atau pencarian.
- POST menolak cross-origin, key non-UUIDv4, body invalid, dan mass assignment untuk amount, method, actorId, rtUnitId, dueIds, serta paymentRequestId.
- Respons publik tidak membocorkan payment ID, actor ID, atau RT ID. Service search memakai parameter ORM; integration test memastikan teks mirip SQL injection diperlakukan sebagai nilai pencarian dan rumah RT lain tidak tampil.
- Smoke memakai sesi Better Auth Bendahara dan warga yang normal, bukan principal injection/backdoor.

## Database, migration, dan audit

- Migration 0009 berjalan pada database Neon development yang ditentukan: project billowing-base-57949906, branch karturt-development (br-crimson-band-az6i637k), database neondb, direct development endpoint ep-quiet-cake-azrhjiyh.
- Sebelum migrasi, environment guards memastikan APP_ENV dan DATABASE_ENV development serta target database/branch/endpoint cocok. Neon mencatat migration 0009 dengan hash 1a2bacce06cedbbea3c2df755ae12d6f94cbef87d7fe340b5d9df35402ea2720.
- Neon read-only post-check menemukan kolom idempotency cash dan assert_cash_payment_ledger_v1(uuid). Semua migration 0000–0008 tetap utuh; hash historis cocok setelah normalisasi line ending.
- PGlite migration tests menjalankan clean path 0000–0009. Upgrade test dari 0008 membuktikan ledger transfer terverifikasi, allocation, request, dan histori audit tetap ada setelah 0009, lalu cash dapat dicatat.
- Constraint tests menolak campuran source request/cash, scope household/payment yang salah, due paid tanpa allocation yang sah, total cash mismatch, dan audit cash yang hilang.
- Injected audit failure membuktikan payment, allocations, perubahan due, dan audit semuanya rollback. Append-only ledger/audit tetap berlaku.

Production tidak disentuh dan tidak menerima migrasi.

## Browser dan Resident regression

Chrome smoke lulus pada 360x800, 390x844, 430x900, 768x1024, dan 1440x900.

- Cash entry terlihat terpisah dari antrean verifikasi transfer.
- Rumah dan penghuni tampil jelas; periode tunggakan lama otomatis masuk ke preview; konflik pending menjelaskan langkah yang harus dilakukan.
- Konfirmasi menampilkan bulan, total, serta Tunai. Target tombol konfirmasi 52 px.
- Double-click browser hanya mengirim satu POST. Tidak ada horizontal overflow atau UUID/SQL/enum internal di tampilan.
- Sesudah commit, endpoint data warga menunjukkan tiga due paid. Resident Card dan histori browser menampilkan status Sudah bayar.
- Screenshot smoke disimpan di [phase-8-evidence](phase-8-evidence). Regression UI Gate B/F7/F7.1 disimpan di folder evidence Fase 6 dan 7.

Gate B transfer request → WhatsApp → Bendahara verify, F7/F7.1 reject/cancel/re-request, histori terminal, dan race cancel-vs-verify, reject-vs-verify, serta cancel-vs-reject lulus pada development smoke. Output lama script Fase 7 memuat label migration head 0008 yang ditulis statis; label itu bukan sumber status migration. Head 0009 dikonfirmasi terpisah melalui Neon read-only catalog/journal.

## Quality gates

Gate A GitHub Actions final source run: [36889333493 — PASS](https://github.com/Satsetx4/karturt/actions/runs/36889333493) pada source/test SHA 45d78b6c. Semua job berikut lulus:

- lint dan typecheck;
- unit, integration/migration, database constraint, authorization, dan full test suite;
- Drizzle migration journal dan schema drift check;
- production build.

Local split test suites lulus: unit 29/29, integration 90/90, constraints 17/17, authorization 7/7. Local lint, typecheck, drizzle-kit check, schema drift check, dan build juga lulus. Build lokal memakai environment build-only terisolasi karena file environment lokal dengan guard development memang menolak optimized production build.

GitHub Actions memberi annotation lingkungan bahwa action checkout/setup-node menargetkan Node 20 yang kini deprecated tetapi runner memaksa Node 24, dan ubuntu-latest akan pindah ke Ubuntu 26. Job tetap PASS; ini bukan kegagalan kode Fase 8.

## Residual risks dan keputusan fase

- Fixture finansial sintetis smoke tetap menjadi histori development sesuai rencana; sesi sementara sudah dibersihkan. Production tidak dipakai sebagai pembanding.
- Migration head statis pada output smoke Fase 7 adalah debt dokumentasi kecil; Neon read-only check tetap menjadi bukti migration aktual.
- Tidak ada blocker Critical/High yang tersisa pada acceptance gates Fase 8.

**Fase 8: PASS. Fase 9: GO untuk memulai planning setelah permintaan scope Fase 9.** Branch masih terpisah dan belum di-merge. Fase 9 reversal tidak termasuk perubahan ini.