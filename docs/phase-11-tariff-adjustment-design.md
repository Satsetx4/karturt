# Fase 11 — Kontrak Desain Tarif dan Penyesuaian

Status: kontrak dibekukan sebelum implementasi.

Repo: `Satsetx4/karturt`
Branch: `feat/phase-11-tariff-adjustment`
Baseline: `feat/phase-10-waiver`
Baseline HEAD: `0d52cfe5dd3cdd70a2d3471f68cc410df0757052`
Migration head: `0011_phase_10_waiver`
Baseline Gate A: run `36968826953`, sukses pada SHA baseline.

Kontrak produk dari permintaan F11 menjadi sumber kebenaran untuk implementasi.
File Master Context v2 yang dirujuk laporan Fase 4 tidak tersedia di checkout;
aturan F11 di atas dipakai bersama kontrak produk yang sudah dikunci pada
permintaan ini.

## 1. Model saldo canonical

Untuk setiap due yang mempunyai kewajiban (`paid` atau `unpaid`):

```text
originalAmount = monthly_dues.amount
adjustmentTotal = SUM(due_adjustments.amount_delta)
effectiveTarget = originalAmount + adjustmentTotal
activeReceived = SUM(payment_allocations.amount)
                 untuk payment yang tidak memiliki payment_reversals
outstanding = effectiveTarget - activeReceived
```

Semua nilai uang adalah bilangan bulat rupiah yang dihitung server/database.
Target efektif wajib lebih dari nol untuk due yang dapat disesuaikan. `activeReceived`
tidak boleh melampaui `effectiveTarget`; karena itu `outstanding` tidak pernah
negatif. Pembacaan server memakai satu model/view saldo untuk menampilkan
`originalAmount`, `adjustmentTotal`, `effectiveTarget`, `activeReceived`,
`outstanding`, dan apakah ada request aktif.

`monthly_dues.amount` dan `fee_rate_id` adalah snapshot kewajiban awal yang
immutable sejak due dibuat. Perubahan tarif tidak mengubah due lama. Status
`paid` berarti `outstanding = 0`; status `unpaid` berarti `outstanding > 0`.
Due `waived` dan `not_due` tetap sebagai status domain terpisah, dikecualikan
dari permintaan/pembayaran, dan tidak dapat diberi adjustment.

## 2. Tarif dan histori tarif

- `fee_rates` tetap menyimpan satu baris untuk satu billing year dan effective
  month. Baris yang sudah ada append-only: UPDATE, DELETE, dan TRUNCATE ditolak.
- Tarif baru hanya dapat ditambahkan Ketua RT aktif pada RT yang sama, untuk
  periode mendatang yang belum memiliki jadwal tarif, dalam billing year yang
  terbuka. Periode yang sudah terjadwal tidak dapat diam-diam direvisi; tarif
  yang sudah efektif pada due yang ada hanya dapat memengaruhi kewajiban melalui
  adjustment eksplisit. Periode effective tetap berupa tahun/bulan dan tervalidasi
  server.
- Baris tarif F11 mencatat actor official, idempotency key UUIDv4, fingerprint,
  dan waktu server. Kolom historis nullable untuk baris pra-F11 agar migrasi
  tidak mengarang actor, key, atau audit masa lalu.
- Pembuatan tarif dan audit `fee_rate.created` disimpan dalam transaksi yang
  sama. Audit memakai entity `fee_rate` dan context flat `{ period,
  monthlyAmount }`. Retry key dan fingerprint sama mengembalikan entri lama;
  key sama dengan fingerprint berbeda menghasilkan conflict.
- Generator tetap memilih tarif effective terakhir yang berlaku pada bulan
  terkait. Dues yang belum ada dapat memakai tarif baru; due yang sudah ada
  mempertahankan `fee_rate_id` dan nominal snapshot. Hari jatuh tempo tetap
  tanggal 10 dan lifecycle `not_due` tidak berubah.

## 3. Ledger adjustment

Tabel append-only `due_adjustments` menyimpan UUID, scope RT/household/due,
`amount_delta` bertanda (bukan nol), alasan wajib maksimal 500 karakter,
official actor, UUIDv4 idempotency key, SHA-256 request fingerprint, dan waktu
server. Foreign key gabungan menjaga seluruh target dan actor berada pada RT
yang sama. UNIQUE scope actor+key mencegah pengulangan mutasi.

Service adjustment menerima hanya `monthlyDueId`, `amountDelta`, `reason`, dan
key dari header. Service memeriksa Ketua RT aktif/tunggal pada tanggal bisnis
Jakarta serta permission; Treasurer, Resident, System Admin, assignment tidak
aktif/ambigu, dan target lintas RT ditolak. Alasan dicatat persis setelah trim.

Adjustment ditolak jika:

- due `waived` atau `not_due`;
- ada payment request berstatus pending/claim aktif untuk due yang sama;
- effective target hasil baru nol/negatif; atau
- adjustment negatif akan membuat `activeReceived > effectiveTarget`.

Adjustment positif atas due yang sudah lunas membuka outstanding baru tanpa
mengubah payment lama. Adjustment negatif boleh menutup saldo sampai tepat
`activeReceived`, tetapi tidak membuat credit/refund. Status due dihitung ulang
di transaksi dari saldo setelah adjustment. Audit `billing.adjustment_created`
ditulis dalam transaksi yang sama, dengan entity `due_adjustment`, reason wajib,
dan context allowlisted `{ amountDelta, effectiveTargetAfter, originalAmount }`.
Kegagalan audit membatalkan seluruh perubahan.

## 4. Payment, request, reversal, dan waiver

- Request Resident memilih due `unpaid` dengan `outstanding > 0` mengikuti aturan
  oldest-unpaid. `payment_request_items.amount` adalah snapshot tepat sebesar
  outstanding saat request dibuat. Client tidak mengirim nominal. Claim pending
  menjaga snapshot tersebut tetap berlaku; adjustment pada due itu ditolak.
- Verifikasi Bendahara membayar setiap item persis sesuai snapshot request.
  Request terverifikasi tetap histori immutable sekalipun adjustment berikutnya
  mengubah outstanding saat ini.
- Cash menghitung sendiri outstanding penuh setiap due eligible sampai periode
  pilihan dan menerapkan aturan oldest-unpaid; client tidak mengirim nominal.
- Pembayaran selalu melunasi seluruh outstanding per due. Tidak ada arbitrary
  partial payment. Sesudah adjustment positif atas due lunas, pembayaran baru
  boleh melunasi outstanding tambahan untuk due itu.
- `active_due_settlements` adalah projection satu baris per active allocation,
  bukan satu baris per due. Primary key dipindahkan dari `monthly_due_id` ke
  `allocation_id`; scope FKs dan unique satu allocation tetap ada. Unique
  payment+due mencegah alokasi ganda dalam satu payment. Jumlah semua alokasi
  aktif satu due harus tidak melebihi effective target.
- Sebelum mengganti primary key, migration memeriksa semua owner lama cocok tepat
  dengan allocation/payment aktif yang benar dan semua allocation aktif memiliki
  owner. Jika ada mismatch, migration gagal dan tidak menebak atau menulis ulang
  payment/allocation/reversal history.
- Reversal hanya menghapus active ownership payment yang direverse. Sesudahnya
  status/balance dihitung ulang dari alokasi lain yang masih aktif dan adjustment.
  Jika due memiliki request pending yang akan kehilangan snapshot balance,
  reversal diblokir. Histori payment, allocation, request, dan reversal tetap
  immutable.
- Waiver tetap aksi F10 dan bukan pembayaran. Waiver baru untuk due yang pernah
  disesuaikan mencatat effective target saat waiver dibuat; tidak mengubah
  adjustment atau riwayat waiver/payment sebelumnya. Waiver/not-due tidak dapat
  menerima adjustment.

## 5. Lock order dan race policy

Semua mutasi saldo mengunci row `monthly_dues` sebelum membaca saldo untuk
keputusan. Untuk request multi-due, row due dikunci berdasarkan ID stabil dan
klaim kemudian dikunci menurut due ID; urutan periode hanya dipakai untuk hasil
oldest-unpaid. Adjustment satu due menggunakan:

1. autentikasi principal dan pemeriksaan permission/assignment aktif;
2. advisory transaction lock untuk `(rt, actor, idempotency key)`;
3. replay/conflict key dan fingerprint;
4. lock due;
5. baca/lock pending claim lalu active allocation ownership;
6. hitung formula canonical, validasi adjustment, tulis adjustment, perbarui
   status current, tulis audit; commit checks memastikan keseluruhan konsisten.

Request, cash, verification, adjustment, dan waiver berbagi serialisasi pada due.
Reversal tetap mengunci payment dahulu seperti kontrak F9, lalu dues berurutan,
kemudian claims/ownership; reversal tidak mengambil lock payment setelah lock
due. Reversal terhadap due dengan claim aktif ditolak. Trigger database juga
mengunci due untuk allocation dan adjustment agar direct SQL tidak dapat
melewati pemeriksaan over-allocation atau mengalahkan transaksi aplikasi.

## 6. Migration strategy

Migration forward-only baru `0012_phase_11_tariff_adjustment.sql`. Tidak ada
edit migrasi `0000`–`0011` dan tidak ada rewrite historical due/payment/allocation/
reversal/waiver/request row. Migration menambahkan ledger adjustment dan audit
contracts, guard append-only fee/adjustment, projection owner per allocation,
formula/balance assertions, snapshot immutability guards, dan triggers yang
menjaga total active allocation terhadap effective target. F10 waiver checks
dan payment history tetap berjalan dengan semantics saldo baru.

CI migration tests mencakup clean chain `0000`–`0012`, upgrade `0011`–`0012`,
preflight owner mapping, dan byte/value equality histori terkait. Neon smoke
hanya boleh memakai project `billowing-base-57949906`, branch
`karturt-development` (`br-crimson-band-az6i637k`), database `neondb`. Production
branch `br-patient-band-azznfh28` tidak boleh diakses untuk mutasi.

## 7. UI dan validasi

API yang dipakai UI:

- `GET /api/chairman/fee-rates?billingYearId=...` mengembalikan `{ years: [{
  id, year, status }], rates: [{ id, billingYearId, effectiveMonth,
  monthlyAmount, createdAt }] }`; filter billing year boleh dikosongkan.
- `POST /api/chairman/fee-rates` menerima strict `{ billingYearId,
  effectiveMonth, monthlyAmount }`; idempotency key memakai header
  `Idempotency-Key`.
- `GET /api/chairman/adjustments/households?query=...` mengembalikan household
  yang cocok dan terscope RT.
- `GET /api/chairman/adjustments/households/{householdId}` mengembalikan
  household serta dues dengan original/adjustment/effective/received/outstanding,
  request-active, dan adjustment history.
- `POST /api/chairman/adjustments` menerima strict `{ monthlyDueId,
  amountDelta, reason }`; idempotency key memakai header `Idempotency-Key`.

Semua route Chairman menolak same-origin mismatch, melakukan auth/session/read
scope di route, dan service mengulang pemeriksaan assignment aktif serta
permission sebelum mutasi. Error lintas RT generik tanpa identitas internal.

Ketua RT mendapat dua area terpisah: **Tarif iuran** (tahun, effective month,
nominal, histori) dan **Penyesuaian kewajiban** (cari household, pilih due,
lihat original/adjustment/effective/received/outstanding, histori, alasan,
preview, dan hasil blok). Semua action utama minimum 44px, punya in-flight dan
idempotency guard, serta menampilkan pesan konflik yang dapat dipahami.

Resident melihat status: outstanding nol `Sudah bayar`; outstanding positif
dengan request aktif `Menunggu konfirmasi`; outstanding positif tanpa request
`Belum bayar`; waiver `Dibebaskan`; not-due `Tidak perlu bayar`. Bila due lama
yang lunas memperoleh adjustment positif, Resident diberi keterangan singkat
bahwa ada adjustment yang belum dibayar. Riwayat payment tetap nominal aslinya.

Validation F11 harus mencakup unit/integration/constraint/authorization,
migration clean+upgrade, race/idempotency/audit rollback, Neon development
smoke, browser smoke lima ukuran viewport, regresi F6–F10, drift/Drizzle,
build, dan GitHub Actions pada HEAD final. Produksi, merge default, F12/F13/F14,
refund/credit, dan arbitrary partial payment berada di luar scope.
