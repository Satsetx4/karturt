# KartuRT Fase 6 — Design Note

## Keputusan yang dikunci

Verifikasi Bendahara adalah pencatatan finansial yang membuat ledger pembayaran dan alokasi. Status request saja tidak cukup. Satu request verified memiliki tepat satu payment; payment itu memiliki satu allocation untuk setiap immutable request item. Nilai payment dan allocation harus sama dengan snapshot request, dan total allocation harus sama dengan total request.

Request item tidak diubah saat verify. Monthly due hanya dapat beralih ke `paid` setelah allocation valid tersedia dalam transaksi yang sama. Request serta item tetap menjadi histori. Claim hanya ditutup setelah kepemilikan request, item, dan due dikunci; penutupan claim dilakukan dalam transaksi verify yang sama.

## Model ledger

- `payments` menyimpan RT, household, request, amount, metode `transfer`, Bendahara pencatat, waktu verified dari database, dan waktu dibuat. `payment_request_id` unik mencegah payment kedua untuk request yang sama. Seluruh FK memakai `RESTRICT`.
- `payment_allocations` mengikat payment, request, household, RT, dan monthly due. Composite FK mengikat pasangan request/due/amount tepat ke immutable request item, serta mengikat allocation ke payment untuk request yang sama. Unique key melarang due ganda pada payment/request.
- Metadata `verified_at` dan `verified_by_account_id` pada request membantu state traceability; payment dan audit tetap menjadi bukti ledger/actor yang otoritatif.
- Satu audit event `payment_request.verified` dicatat di dalam transaksi. Context dibatasi ke `itemCount` dan `totalAmount`; tidak menyimpan nomor telepon, isi pesan, PII, atau detail sesi.

## Transaksi dan locking

Service memvalidasi principal Bendahara aktif dan scope RT, lalu di satu transaksi:

1. Revalidasi account dan assignment Bendahara aktif.
2. Lock request pending dengan `FOR UPDATE` berdasarkan kode publik dan RT principal.
3. Baca immutable items terurut, lock semua monthly due berdasarkan UUID secara stabil, lalu lock claims terkait.
4. Pastikan request total/count, item period/amount, seluruh due `unpaid`, dan setiap claim cocok persis; pastikan belum ada payment.
5. Insert satu payment dan satu allocation per item.
6. Ubah semua due ke `paid`, ubah request ke `verified` dengan actor/waktu database, lalu tutup seluruh claim.
7. Append audit `payment_request.verified`; kegagalan di titik mana pun membatalkan semua perubahan.

Request row lock menyerialisasi dua verify bersamaan. Pemanggil pertama dapat sukses; pemanggil berikutnya membaca status final dan mendapat konflik `already processed` yang aman. Unique request-payment dan due-allocation menjadi lapis perlindungan tambahan.

## Invariant database/service

Unique key dan composite FK mencegah payment ganda, alokasi due ganda, scope tenant campur, amount berbeda dari immutable snapshot, dan FK histori yang terhapus melalui cascade. Deferred constraint trigger memeriksa saat commit bahwa request verified memiliki satu payment, tepat satu allocation per request item dengan total cocok, tanpa claim tersisa. Trigger deferred pada transisi due ke `paid` mewajibkan allocation valid dari request verified. Service tetap memeriksa invariant sebelum menulis dan test integration menutup jalur rollback.

## Batas fase

Hanya queue/detail/verify transfer. Reject/cancel, cash, reversal, waiver, tariff, reporting, notification/outbox, deployment production, dan merge ke default branch tetap di luar scope.

## Baseline development yang dibaca

Project `billowing-base-57949906`, branch `karturt-development` (`br-crimson-band-az6i637k`), database `neondb`; branch terverifikasi bukan default. Sebelum Fase 6: 0 due berstatus `paid`, 6 pending requests, 7 immutable items, dan 7 claims. Fixture historis sintetis tetap dipertahankan.
