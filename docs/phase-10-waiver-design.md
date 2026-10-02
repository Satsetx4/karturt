# Fase 10 — Kontrak Desain Pemutihan

Status: kontrak implementasi dibekukan sebelum pembagian kerja. Baseline branch
`feat/phase-9-payment-reversal`, HEAD
`a6c0a2a7d526e01c28333cee51d1e7b928c54fbc`, migration
`0010_phase_9_payment_reversal`. Fase ini dikerjakan pada branch baru
`feat/phase-10-waiver`; tidak mencakup merge default branch, migration
production, reversal pemutihan, F11, atau F12.

## Batas domain

- Pemutihan adalah keputusan Ketua RT dan bukan pembayaran.
- Hanya due berstatus `unpaid`, bernilai positif, dan tanpa pemilik pembayaran
  aktif yang dapat dipilih.
- Due `paid`, `not_due`, `waived`, atau yang memiliki claim permintaan berstatus
  `pending` ditolak untuk seluruh batch.
- Bulan dipilih secara eksplisit. Tidak ada ekspansi oldest-unpaid-first.
- Satu permintaan untuk satu household dan satu atau beberapa periode membuat
  satu action, satu item per periode, dan satu audit event dalam transaksi yang
  sama.
- `monthly_dues.amount` tetap sebagai snapshot nilai awal. Status `waived`
  dikecualikan dari tagihan yang belum lunas; nilainya tidak menjadi pembayaran
  atau penerimaan.
- Tidak ada alur unwaive/reversal pada F10. Riwayat pembayaran dan request lama
  tetap append-only dan tidak diubah.

## Kontrak database

### `waiver_actions`

- `id uuid` primary key, `rt_unit_id`, `household_id`,
  `waived_by_account_id`, `waived_by_account_type='official'`, `reason
  varchar(500)`, `item_count positive integer`, `total_amount positive
  bigint`, `idempotency_key uuid`, `request_fingerprint char(64)` lowercase
  SHA-256, dan `created_at timestamptz default now()`.
- Foreign key gabungan membatasi household dan account actor ke RT yang sama;
  actor harus bertipe `official`. Otorisasi aktif Ketua RT tetap diverifikasi
  oleh service saat transaksi berjalan.
- Idempotency scope unik: `(rt_unit_id, waived_by_account_id,
  idempotency_key)`.
- Action wajib memiliki jumlah item yang sama dengan `item_count`, total nilai
  item sama dengan `total_amount`, satu audit `waiver.created` yang cocok, dan
  alasan yang sama dengan setiap due/item terkait.

### `waiver_items`

- Satu baris menyimpan `waiver_action_id`, RT, household, `monthly_due_id`,
  periode canonical `YYYY-MM`, nilai due saat keputusan, dan timestamp server.
- FK gabungan membatasi item ke action dan due dengan scope RT/household sama.
- `UNIQUE(monthly_due_id)` menutup pemutihan kedua selama F10 karena belum ada
  reversal/unwaive.
- Unique action+period dan action+due mencegah duplikasi bulan dalam batch.
- Constraint terdeferrable memeriksa snapshot periode/nilai/scope dan bahwa due
  menjadi `waived` hanya bersama satu item/action yang valid.

### Invarian dan proteksi

- `monthly_dues.waived_reason` dipertahankan untuk kompatibilitas/tampilan saat
  ini, tetapi harus persis sama dengan reason action saat status due `waived`.
- `unpaid -> waived` hanya sah bila item/action serta audit dibuat dalam commit
  yang sama. `paid -> waived`, `not_due -> waived`, dan transisi keluar dari
  `waived` ditolak.
- Due `waived` tidak boleh memiliki `active_due_settlements` atau
  `payment_request_claims` aktif. Claim terminal tidak boleh direkonstruksi atau
  dianggap kepemilikan aktif; histori request terminal tetap terpelihara.
- Ledger dan items waiver menolak UPDATE, DELETE, dan TRUNCATE. Audit tetap
  memakai penjagaan append-only yang ada.
- Migration baru `0011_phase_10_waiver.sql` forward-only. Migration memeriksa
  bahwa tidak ada legacy row `waived` yang belum punya histori terstruktur;
  jika ada, migration gagal tanpa menebak histori. Migration `0000`–`0010`
  tidak diubah.

## Kontrak service dan lock order

Service canonical: `createChairmanWaiver(database, principal, input)` dengan
input `{ householdId, periods, reason, idempotencyKey }`. Caller tidak
mengirim RT, actor, due ID, amount, status, total, atau data audit.

1. Validasi UUIDv4, 1–120 periode canonical unik, reason wajib yang di-trim,
   maksimal 500 karakter, dan aturan keamanan reason dari audit writer.
2. Dalam satu transaksi, verifikasi account aktif, assignment unik
   `rt_chairman` pada business date Jakarta, permission `waiver:manage`, dan
   RT principal yang sama. Lock household scoped RT untuk share.
3. Ambil advisory transaction lock berdasarkan RT+actor+idempotency key.
   Cari action untuk key tersebut: fingerprint sama mengembalikan hasil lama;
   fingerprint berbeda menghasilkan conflict.
4. Resolusi bulan yang diminta ke due dilakukan server-side. Lock semua due
   terpilih dalam urutan stabil `(billing year, month, due id)`.
5. Pastikan seluruh bulan ditemukan tepat satu kali, scope sama, raw status
   `unpaid`, amount integer positif dan jumlah aman. Setelah lock due, baca/
   lock claim dan active settlement dalam urutan due ID. Claim berstatus
   `pending` atau active settlement menggagalkan seluruh batch.
6. Hitung total dari due yang terkunci; insert satu action, seluruh items,
   update seluruh due `unpaid -> waived` dengan reason ternormalisasi, lalu
   tambahkan satu audit `waiver.created` dalam transaksi yang sama.
7. Constraint trigger deferred memeriksa ledger lengkap saat commit. Kegagalan
   apa pun membatalkan semua write termasuk audit.

Fingerprint adalah SHA-256 lowercase atas JSON canonical berversi berisi
household, daftar periode yang sudah diurutkan, dan reason ternormalisasi.
Advisory lock mencegah retry key berlomba; lock due menjadi titik serialisasi
bersama request, verifikasi transfer, tunai, reversal, dan waiver. Jalur waiver
tidak mengunci row request sebelum due.

Audit contract: action `waiver.created`, entity type `waiver_action`, entity ID
UUID action, `reason` wajib, context persis `{ itemCount, periods, totalAmount }`
dengan `periods` berupa string periode terurut dipisahkan koma.

## API dan hak akses

- Mutasi `POST /api/chairman/waivers`; body strict hanya
  `{ householdId, periods, reason }`, key di header `Idempotency-Key`.
- Read routes minimum: pencarian household/resident pada RT aktif, detail due
  satu household, dan histori waiver Ketua RT.
- Semua read membatasi data ke RT principal. Mutasi memerlukan same-origin,
  sesi aktif, permission, dan verifikasi ulang assignment aktif di service.
- Input selain allowlist ditolak. Error ke client berupa pesan aman tanpa SQL,
  UUID actor, atau detail lintas RT.

## UI F10

- Dashboard `/app` memberi entry `Pemutihan iuran` khusus Ketua RT; halaman
  `/app/pemutihan` punya judul tegas dan tombol kembali ke `/app`.
- Cari rumah/nama dalam RT sendiri, pilih household, lalu tampilkan periode dan
  status. Tampilkan penanda jelas bila household berstatus riwayat/nonaktif.
- Hanya `Belum bayar` yang dapat dipilih. Status `Sudah bayar`, `Menunggu
  konfirmasi`, `Tidak perlu bayar`, dan `Dibebaskan` nonaktif dengan penjelasan.
- Multi-select eksplisit, alasan wajib, ringkasan konfirmasi berisi rumah/
  household, periode persis, total pemutihan, dan alasan. CTA konfirmasi
  minimum 44px, guard double-click, dan key idempotensi dipertahankan untuk
  retry.
- Sukses dan histori menampilkan rumah, household/resident, periode, jumlah,
  alasan, waktu, dan status `Dibebaskan`. Tidak menampilkan UUID, enum mentah,
  SQL, atau detail waiver di riwayat pembayaran resident.

## Pembagian ownership dan checkpoint

- A — DB/invarian: schema, migration 0011/metadata, constraint tests, dan
  migration upgrade checks.
- B — service/API/audit/authz: service waiver, route create/read, audit
  allowlist, dan authorization tests.
- C — Chairman UI: entry dashboard, flow pemutihan, histori, dan CSS terkait.
- D — semantik resident: label `Dibebaskan`, total/tagihan, seleksi payment
  request, dan regression tests resident.
- E — integrasi/concurrency: transactional tests, race coverage, Neon dev smoke
  script dan invariant queries.
- F — review security adversarial: auth matrix, schema strictness, same-origin,
  tenant scoping, leaks, dan temuan blocker.

Agent hanya mengubah file dalam ownership yang disepakati; overlap diserahkan
ke coordinator. Setelah integrasi, coordinator menjalankan quality gate serial,
Neon development smoke pada project/branch yang ditentukan user saja, browser
smoke lima viewport, menulis report akhir, dan memastikan CI PASS pada HEAD
final branch. Tidak ada merge default branch atau perubahan Neon production.

## Acceptance cases utama

- Satu waiver 3 bulan menghasilkan 1 action, 3 item, 3 due waived, dan 1 audit.
- PAID/PENDING/NOT_DUE/already-WAIVED pada salah satu periode menggagalkan
  seluruh batch tanpa partial write.
- Same key + same input replay; same key + input berbeda conflict. Dua actor
  sesi untuk due sama hanya menghasilkan satu action.
- Audit insert failure me-rollback action, item, dan due.
- Request resident, verifikasi transfer, cash, reversal, dan waiver yang
  bersamaan tidak menghasilkan due `waived` bersama claim atau active
  settlement. Setelah reversal yang selesai, due `unpaid` boleh di-waive dan
  ledger pembayaran lama tetap ada.
- Terminal rejected/cancelled request tetap utuh dan tidak menghalangi waiver
  jika claim sudah dilepas.
- Auth: hanya Ketua RT aktif di RT yang sama; Treasurer, Resident, System
  Admin, assignment tidak aktif, dan household lintas RT ditolak.
- Resident melihat `Dibebaskan`, waiver tidak muncul sebagai payment history,
  tidak menambah unpaid/pending/paid totals, dan tidak dapat diminta untuk
  dibayar.
