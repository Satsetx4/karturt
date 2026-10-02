# Laporan Fase 10 — Waiver / Pemutihan

## Status

Fase 10 **PASS**. Implementasi dan smoke Neon development selesai; Gate A
GitHub Actions untuk commit implementasi
`f41c88a37822aad49abb80aed9aa185204257985` PASS pada
[run 36968483734](https://github.com/Satsetx4/karturt/actions/runs/36968483734).
Commit laporan ini hanya menambahkan bukti dan status; hasil Gate A untuk HEAD
branch setelah commit laporan dilaporkan terpisah.

## Baseline dan hasil

- Repo: `Satsetx4/karturt`
- Branch: `feat/phase-10-waiver`
- Baseline: `feat/phase-9-payment-reversal`
- Baseline HEAD: `a6c0a2a7d526e01c28333cee51d1e7b928c54fbc`
- Baseline migration: `0010_phase_9_payment_reversal`
- Implementasi F10: `f41c88a37822aad49abb80aed9aa185204257985`
- Migration baru: `0011_phase_10_waiver`
- Hash migration: `e0a6cd44b8b80f0b5398f7ff43d5a6249d3e0378b40d552fd3b040ce0a78ea77`
- Tidak ada perubahan atau merge ke default branch. Tidak ada akses tulis ke
  Neon production.

## Model dan invariants

`waiver_actions` menyimpan keputusan satu household: Ketua RT, reason wajib,
jumlah periode, total snapshot, kunci idempotensi, fingerprint, dan waktu
server. `waiver_items` menyimpan satu snapshot periode/nilai untuk setiap due.
Foreign key membatasi actor, household, action, dan due pada RT yang sama.
Ledger append-only; setiap due hanya dapat memiliki satu waiver item.

Waiver bukan payment: waiver mengurangi kewajiban tertagih, tetapi tidak
menambah payment, allocation, atau nilai diterima. `NOT_DUE` tetap di luar
lifecycle kewajiban dan tidak diubah menjadi waiver. `WAIVED` dikeluarkan dari
total unpaid/pending/paid resident, tidak dapat diajukan sebagai payment, dan
tidak membuat baris payment history palsu.

Migration forward-only `0011` menolak legacy due `waived` tanpa histori yang
terstruktur, sehingga tidak menebak alasan atau actor lama. Migration `0000`–
`0010` tidak diubah. Deferred database constraints memastikan saat commit
bahwa action, seluruh item, update due, snapshot periode/nilai, dan satu audit
`waiver.created` lengkap dan cocok. Trigger juga menolak `paid` atau `not_due`
menjadi `waived`, perpindahan keluar dari `waived`, mutation ledger, active
settlement pada due `waived`, serta active pending claim pada due `waived`.

## Otorisasi

| Principal/kondisi | Hasil |
| --- | --- |
| Ketua RT aktif dengan assignment pada tanggal bisnis Jakarta, RT sama | Diizinkan |
| Ketua RT disabled, assignment belum mulai/sudah berakhir, atau assignment ambigu | Ditolak |
| Bendahara, Resident, atau System Admin | Ditolak |
| Household lintas RT | Ditolak dengan respons generik tanpa membocorkan data |
| Body mass assignment, periode/reason/key malformed, atau mutasi lintas origin | Ditolak |

Route memakai schema strict. Client hanya mengirim `householdId`, periode,
reason, dan header `Idempotency-Key`; RT, actor, due ID, status, jumlah, serta
audit ditentukan server. Security review tidak menemukan bypass yang
terkonfirmasi; 28 authorization tests PASS.

## Atomicity, idempotensi, dan concurrency

Service memverifikasi principal/permission, household scoped, dan key dalam
satu transaksi. Fingerprint SHA-256 atas household, periode terurut, dan reason
ternormalisasi membuat replay dengan input sama aman; key sama dengan input
berbeda menghasilkan conflict. Due dikunci kronologis dan stabil sebelum
claim/active ownership dibaca. Seluruh item, action, perubahan `unpaid ->
waived`, dan audit ditulis dalam transaksi yang sama.

Integration tests meliputi tiga bulan sebagai satu action, batch yang gagal
karena satu periode tidak eligible, pending claim, `NOT_DUE`, sudah `WAIVED`,
audit insert failure/rollback, replay dan conflict idempotensi, dua Chairman
bersamaan, serta races resident request, cash payment, transfer verification,
dan waiver. Payment request, allocation, reversal, dan terminal request lama
tetap immutable. Payment history dari transaksi yang direverse dipertahankan;
due kembali `unpaid` dan baru dapat di-waive setelah reversal selesai.

## Neon development dan browser

Target diperiksa sebelum migration dan sebelum menulis fixture: project
`billowing-base-57949906`, branch `karturt-development`
(`br-crimson-band-az6i637k`), database `neondb`, endpoint development direct
`ep-quiet-cake-azrhjiyh`. Endpoint default/production tidak dipakai. Sebelum
migration tidak ada legacy due `WAIVED`; setelahnya migration head/hash cocok
dengan `0011_phase_10_waiver`.

`db:test-waiver-neon` PASS menggunakan login normal Chairman, Bendahara, dan
Resident. Bukti transaksi:

- Tiga bulan `2026-01`–`2026-03`: satu action, total Rp60.000, Resident melihat
  `Dibebaskan`, Chairman melihat histori, dan audit cocok.
- Pending request memblokir waiver (HTTP 409) tanpa melepas request/claim.
- Request versus waiver: request menang, waiver 409, satu active claim dan due
  tetap `unpaid`.
- Cash versus waiver: pembayaran menang, waiver 409, due `paid` dengan satu
  active owner.
- Verifikasi transfer versus waiver: verifikasi menang, waiver 409.
- Reversal transfer dan cash masing-masing diikuti waiver; reversal dan
  payment allocations sebelumnya tetap ada.
- Global anomaly queries: waived tanpa satu item `0`, active owner pada waived
  `0`, pending claim pada waived `0`, action tidak lengkap `0`.

Browser smoke lulus di 360×800, 390×844, 430×900, 768×1024, dan 1440×900.
Entry Chairman ditemukan; alasan wajib; status tidak eligible nonaktif dengan
penjelasan; tombol konfirmasi 52px; klik ganda mengirim tepat satu mutasi;
sukses jelas. Resident menampilkan `Dibebaskan`. Tidak ada horizontal overflow,
raw enum, UUID, reason internal ke resident, atau error halaman.

Fixture smoke sengaja tetap berada hanya pada Neon development, sesuai ruang
lingkup yang diizinkan. Pada pemeriksaan akhir fixture harness mencakup 13 unit
sintetis, 108 rumah/household, 104 dues, 22 waiver actions, 22 payments, 24
payment requests, dan 12 reversals. Login sessions sementara dibersihkan.

## Pre-Gate-C manual calculation dataset

Dataset ilustrasi: 4 due × Rp45.000 = potensi kewajiban awal Rp180.000. Dua
bulan di-waive = Rp90.000. Kewajiban efektif setelah waiver dan sebelum
adjustment = Rp90.000. Satu payment diterima = Rp45.000. Outstanding =
Rp90.000 − Rp45.000 = Rp45.000. Nilai waiver mengurangi kewajiban; tidak
dihitung sebagai payment/received. Tidak ada adjustment dalam dataset ini.

## Validasi

- Unit: 31/31 PASS.
- Integration: 109/109 PASS (`--pool=threads`), termasuk seluruh regresi
  payment request, F7/F7.1, cash, reversal, dan waiver.
- Constraint: 25/25 PASS.
- Authorization: 28/28 PASS.
- Migration upgrade/waiver constraint focused tests: 10/10 PASS.
- `npm run lint`, `npm run typecheck`, `npx drizzle-kit check`, schema drift
  (`db:generate` tanpa perubahan), dan `npm run build`: PASS.
- Gate A GitHub Actions di source/test HEAD `f41c88a37822aad49abb80aed9aa185204257985`:
  seluruh 14 langkah PASS pada [run 36968483734](https://github.com/Satsetx4/karturt/actions/runs/36968483734),
  termasuk full test suite, journal consistency, schema drift, dan production
  build.

Pada runner Windows lokal, `npm test -- --maxWorkers=1` sempat kehabisan memori
V8. Test unit, integration, constraint, dan authorization masing-masing lulus
secara serial; Gate A menjalankan full suite pada Ubuntu sebagai bukti agregat.

## Risiko tersisa dan keputusan fase

- F10 tidak menyediakan reversal/unwaive. Jika diperlukan, harus dirancang
  sebagai fase terpisah tanpa menghapus histori.
- Fixture pembayaran/waiver sintetis tetap ada pada branch development; tidak
  ada fixture atau migration F10 yang dijalankan pada production.
- Implementasi tarif/adjustment F11 dan Gate C belum dikerjakan.

**Fase 10: PASS. GO Fase 11.** Gate C tetap dijalankan setelah F11, sesuai
roadmap. Commit laporan tidak mengubah source, schema, ataupun test; Gate A
akan tetap dijalankan pada HEAD branch yang memuat laporan ini.
