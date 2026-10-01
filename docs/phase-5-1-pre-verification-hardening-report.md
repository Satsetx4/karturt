# KartuRT Fase 5.1 — Pre-verification hardening

## Keputusan

**Fase 5.1: PASS.** Snapshot request terlindungi di database, ringkasan warga memisahkan iuran yang menunggu konfirmasi, smoke memakai login dan API aplikasi dengan sesi resident biasa, dan Gate A GitHub Actions lulus.

**Fase 6: GO untuk desain dan persiapan.** Sebelum implementasi verifikasi, putuskan apakah konfirmasi Bendahara membuat catatan pembayaran/alokasi tersendiri atau memakai status request, status iuran, dan audit sebagai sumber pencatatan. Keputusan itu mengubah semantik keuangan dan tidak dibuat di Fase 5.1.

**Test Gate B: NOT COMPLETE.** Verifikasi Bendahara end-to-end belum dibuat atau diuji.

## Baseline dan hasil

| Item | Nilai |
|---|---|
| Baseline branch | `feat/phase-5-payment-request` |
| Baseline SHA | `b12e6761085d0fd621ba929788373161421d5bc3` |
| Parent implementasi Fase 5 | `996de7b0170177e313fad2ab1cd70e83f7155f33` |
| Branch Fase 5.1 | `fix/phase-5-1-pre-verification-hardening` |
| SHA implementasi yang diuji | `dd8000dd44b75d6e662ce4b688f20cd8faa28b73` |
| Migration head | `0005_phase_5_1_payment_request_items_immutable` |
| GitHub Actions Gate A | PASS — [run 36802366350](https://github.com/Satsetx4/karturt/actions/runs/36802366350) |

Branch tetap terpisah. Default branch `feat/milestone-1-foundation` tidak disentuh; tidak ada PR atau merge.

## Perlindungan snapshot item

Migration `0005` menambahkan function trigger `reject_payment_request_item_mutation_v1()` dan dua trigger pada `payment_request_items`:

- `BEFORE UPDATE OR DELETE`, per baris;
- `BEFORE TRUNCATE`, per statement.

Keduanya menolak perubahan dengan SQLSTATE `55000` dan constraint `payment_request_items_immutable`. INSERT tetap diizinkan. Tidak ada trigger atau perubahan semantik pada `payment_requests` maupun `payment_request_claims`.

Trigger melindungi snapshot `request_id`, scope RT/rumah tangga, `monthly_due_id`, periode, nominal, dan `created_at`. Pembuatan request melalui service dan HTTP sesudah migration berhasil memasukkan item baru.

Neon development menolak UPDATE dan DELETE dengan SQLSTATE `55000`. TRUNCATE biasa lebih dahulu ditolak oleh foreign key dari `payment_request_claims` dengan `0A000`; percobaan rollback-only `TRUNCATE ... CASCADE` mencapai trigger dan ditolak `55000`. Jumlah baris item sebelum dan sesudah probe tetap sama. Tes constraints lokal juga memeriksa TRUNCATE biasa dan CASCADE serta memastikan request, item, claim, audit, dan status due tetap utuh.

Migration diterapkan dan diperiksa hanya pada Neon development: project `billowing-base-57949906`, branch `karturt-development` (`br-crimson-band-az6i637k`), endpoint `ep-quiet-cake-azrhjiyh`. Head live mencatat `created_at=1790813764088` dan hash `b72bd0c4ad4384d300029bbdb8eab4d80ef603e70b5262c6c5396ec0c0a4db67`. Neon menampilkan kedua trigger dengan function dan definisi yang diharapkan. Tidak ada koneksi, migration, atau smoke ke Neon production.

## Ringkasan warga

Sebelumnya iuran dengan status database `unpaid` tetap menambah `Tunggakan` dan `Total belum dibayar` walaupun sudah diklaim request aktif. Sekarang pending tetap derived dari active request dan `monthly_dues.status` tetap `unpaid`, tetapi totalnya dipisah:

- `Belum bayar`: hanya due `unpaid` tanpa request pending;
- `Menunggu konfirmasi`: nominal due `unpaid` dengan request pending;
- `Sudah bayar`: due `paid`;
- `waived` dan `not_due`: tidak masuk ketiga total.

Kartu warga hanya menampilkan tiga label tersebut. `Tunggakan`, total lama, due date, dan tanggal 10 tidak tampil. Status kartu memakai ikon dan teks; ringkasan dua kolom berlaku pada ponsel, tiga kolom mulai 600 px.

Unit test mencakup unpaid, pending, paid, waived, not_due, campuran bulan lintas tahun, status raw yang tetap unpaid, dan tampilan history/kartu pending.

## HTTP dan browser smoke

### HTTP dengan aplikasi dan Neon development

`npm run smoke:phase-5-1-http` menjalankan Next lokal pada Neon development dengan guard project, branch, endpoint, database, dan environment. Smoke membuat fixture sintetis, login melalui `/api/login/resident`, memakai cookie Better Auth normal, lalu melakukan:

1. GET `/api/resident/monthly-dues`;
2. POST `/api/resident/payment-requests`;
3. replay dengan idempotency key yang sama;
4. dua POST serentak dengan key berbeda untuk periode yang sama;
5. GET ulang untuk memastikan pending terlihat sementara raw due tetap `unpaid`;
6. percobaan UPDATE, DELETE, TRUNCATE, dan TRUNCATE CASCADE dengan pemeriksaan data setelahnya.

Hasil: login dan request pertama `200`, replay menghasilkan request yang sama, persaingan key berbeda menghasilkan satu `200` dan satu `409`, dan refresh menunjukkan pending. WhatsApp memakai kontak Bendahara dari RT fixture yang sama. Tidak ada auth bypass, route tersembunyi, atau principal yang disuntikkan.

Smoke memakai fixture finansial sintetis yang tersimpan pada development. Audit sesudah smoke mencatat 6 request, 7 item, dan 7 claim; data tidak dihapus karena sejarah keuangan tidak boleh di-hard-delete. Sesi smoke dibersihkan.

### Browser UI

Playwright memeriksa komponen resident card dan payment request yang dipakai aplikasi dengan API fixture lokal. Pemeriksaan mencakup total lintas tahun, status pending setelah refresh, payload periode publik, satu POST saat klik ganda, ikon dan teks status, target sentuh minimal 44 px, kolom ringkasan, due date/token teknis yang tidak tampil, dan overflow pada 360×800, 390×844, 430×900, 768×1024, serta 1440×900.

Di fixture, ringkasan awal adalah Belum bayar Rp110.000, Menunggu konfirmasi Rp30.000, Sudah bayar Rp40.000. Sesudah pengajuan Desember 2025, Maret, dan April 2026 dengan total Rp110.000, pending menjadi Rp140.000 karena Februari sudah menunggu sejak awal; unpaid menjadi Rp0 dan paid tetap Rp40.000. Ekspektasi browser diperbaiki untuk menghitung Desember 2025 dan pending Februari lintas tahun dengan benar.

Screenshot dari run yang lulus:

- [Ringkasan ponsel 390×844](phase-5-1-evidence/2026-10-01T01-35-13-397Z-mobile-summary-390x844.png)
- [Kartu pending desktop 1440×900](phase-5-1-evidence/2026-10-01T01-35-13-397Z-desktop-pending-1440x900.png)

HTTP smoke adalah jalur real aplikasi + database development; browser UI smoke masih menggunakan API fixture. Belum ada UAT perangkat fisik.

## Fase 6 — readiness notes

- Request dan immutable items sudah menyediakan data untuk queue/detail: RT, rumah tangga, pemohon, status, waktu pengajuan, total, periode, nominal, dan due yang terkait. Item snapshot tidak perlu dimutasi saat verifikasi.
- Enum status request sudah memiliki `pending`, `verified`, `rejected`, dan `cancelled`. Claim memakai `monthly_due_id` sebagai primary key, sehingga satu due hanya punya satu claim aktif.
- Fase 6/7 perlu mengubah status request, due/payment state, claim, dan audit secara atomik dengan row lock dan role Bendahara. Reject/cancel harus melepas claim tanpa menghapus request atau item. Verify harus menutup claim sambil menjaga request dan snapshot sebagai sejarah.
- Belum ada kolom `verified_at`/`verified_by` khusus atau tabel payment/payment allocations. `audit_events` sudah menyimpan actor, waktu, entity, action, dan context; tentukan apakah itu cukup atau apakah ledger pembayaran/alokasi menjadi sumber finansial resmi. Jangan membuat keduanya diam-diam.

## Verifikasi

| Pemeriksaan | Hasil |
|---|---|
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `npm run test:unit -- --maxWorkers=1` | PASS — 29 test |
| `npm run test:integration -- --maxWorkers=1` | PASS — 49 test |
| `npm run test:constraints -- --maxWorkers=1` | PASS — 15 test |
| `npm run test:authorization -- --maxWorkers=1` | PASS — 5 test |
| `npm test -- --maxWorkers=1` | PASS — 98 test |
| `npm run build` | PASS — build-only configuration; tidak memakai URL Neon |
| `npx drizzle-kit check` | PASS |
| Drizzle schema drift | PASS — `No schema changes, nothing to migrate` |
| Jalur migration 0000–0005 | PASS — seeded request sebelum 0005 dan INSERT request sesudah 0005 |
| Neon development trigger + HTTP smoke | PASS — hasil tercatat di atas |
| Browser regression | PASS — lima ukuran layar dan screenshot tersimpan |
| GitHub Actions Gate A | PASS — [run 36802366350](https://github.com/Satsetx4/karturt/actions/runs/36802366350) |

## Sisa risiko dan status gate

- Treasurer queue/verification, payment ledger, alokasi, reject, cancel, dan perubahan due menjadi paid tidak dibuat di Fase 5.1.
- UAT dengan perangkat fisik dan pengguna warga belum dilakukan.
- Neon development berisi fixture sintetis di atas; production tetap tidak tersentuh.
- **Fase 5.1: PASS. Fase 6: GO untuk desain; implementasi menunggu keputusan sumber pencatatan pembayaran. Test Gate B tetap NOT COMPLETE sampai Treasurer verification end-to-end selesai.**
