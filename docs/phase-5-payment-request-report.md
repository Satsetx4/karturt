# Fase 5 — Payment Request

## Keputusan

**Fase 5: PASS.** Gate A GitHub Actions lulus pada implementation SHA di bawah.

**Gate B: NOT COMPLETE.** Fase 6 (verifikasi Bendahara) belum dibuat dan tetap di luar scope pekerjaan ini.

## Baseline dan hasil

| Item | Nilai |
|---|---|
| Baseline branch | `feat/phase-4-5-audit-core-readiness` |
| Baseline SHA | `72910489bae59d6a2a9b57ef3ddd5fce0ea986b8` |
| Branch Fase 5 | `feat/phase-5-payment-request` |
| Final implementation SHA | `996de7b0170177e313fad2ab1cd70e83f7155f33` |
| Migration head | `0004_phase_5_payment_request` |
| Gate A GitHub Actions | PASS — [run 36758296850](https://github.com/Satsetx4/karturt/actions/runs/36758296850) |

Branch tetap terpisah. Tidak ada PR, merge, atau perubahan ke default branch.

## Model dan alur

`payment_requests` menyimpan permintaan beserta warga, rumah tangga, RT, total resmi, kode publik, kunci idempotency, fingerprint, dan status. `payment_request_items` menyimpan periode serta jumlah yang dihitung per iuran. `payment_request_claims` memberi satu klaim aktif untuk satu `monthly_due`; primary key pada `monthly_due_id` membuat dua permintaan tidak bisa mengklaim iuran yang sama secara bersamaan.

Warga memilih bulan dalam format publik `YYYY-MM`. Server mengambil principal dari sesi, mengunci iuran rumah tangga itu sampai bulan yang dipilih, memeriksa ulang status, lalu menyertakan seluruh iuran `Belum bayar` yang lebih lama dan belum memiliki klaim aktif. Total dihitung dari baris iuran di server. Status “Menunggu konfirmasi” berasal dari request pending dan claim; `monthly_dues.status` tetap `unpaid`.

Pembuatan request, items, claims, serta `payment_request.created` berada dalam transaksi yang sama. Jika insert audit atau domain gagal, seluruh perubahan request ikut rollback.

## Idempotency dan keamanan

- Kunci per percobaan memakai UUID v4 acak. Kunci dan pilihan periode yang sama mengembalikan request yang sama; kunci yang sama dengan periode berbeda menghasilkan konflik.
- Baris due dikunci di dalam transaksi. Unique claim membuat kunci berbeda yang berlomba atas due yang sama hanya menghasilkan satu request aktif.
- API hanya menerima `{ "period": "YYYY-MM" }`, memeriksa sesi, role resident, same-origin, dan format kunci. ID due, RT, rumah tangga, maupun jumlah tidak diterima sebagai authority.
- Respons hanya mengembalikan kode publik, periode, total, waktu, status, dan tautan WhatsApp. UUID internal dan kunci idempotency tidak dikirim.
- Uji mencakup unauthenticated, role denial, cross-household/RT, mass assignment, periode malformed, due paid/waived/not-due, konflik active request, idempotency, dan rollback tanpa request/item/claim/audit tersisa.

## WhatsApp dan UX

Tautan `wa.me` dibuat dari nomor Bendahara aktif pada RT yang sama; nomor dicari server-side. Pesan berisi nama warga, nomor rumah, bulan, total, waktu Jakarta, dan kode request. Tidak ada WhatsApp API, Twilio, Meta, upload, atau penyimpanan bukti. Jika kontak tidak tersedia atau tidak tunggal, request tetap tersimpan dan UI menyatakan nomor WhatsApp belum tersedia.

UI memakai istilah “Sudah bayar”, “Belum bayar”, “Dibebaskan”, “Tidak perlu bayar”, dan “Menunggu konfirmasi” dengan ikon dan teks. Tanggal jatuh tempo tidak tampil pada kartu; kontrol yang diuji memiliki touch target sedikitnya 44 px. UI memiliki langkah konfirmasi, loading, error, sesi berakhir, konflik 409, klik ganda aman, dan tidak mengantrekan mutasi offline.

## Migration dan Neon development

Migration diterapkan hanya ke project KartuRT `billowing-base-57949906`, branch development `br-crimson-band-az6i637k` (`karturt-development`), endpoint langsung `ep-quiet-cake-azrhjiyh`. Branch development terverifikasi bukan default; default `production` (`br-patient-band-azznfh28`) tidak dipakai.

Neon mencatat migration head `0004` setelah `0003`. Pemeriksaan live menemukan enum `pending/verified/rejected/cancelled`, foreign key request ke household dan resident account dalam RT yang sama, foreign key item ke due dan request, primary claim key, unique idempotency index, unique item index, serta indeks household/status.

Smoke live membuat fixture sintetis development dan membiarkannya di branch development. Dua kunci berbeda untuk periode sama menghasilkan satu request dan satu konflik; dua panggilan bersamaan dengan kunci sama kembali ke request yang sama. Request pertama memilih `2024-11` dan `2025-02`, total Rp77.000. Tiga due mendapat klaim, dua event audit tercatat, status bulanan tetap `unpaid`, dan read model menampilkan pending. Tautan memakai nomor Bendahara sintetis pada RT yang sama. Tidak ada koneksi, migrasi, atau smoke ke Neon production.

## Verifikasi

| Pemeriksaan | Hasil |
|---|---|
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `npm run test:unit -- --maxWorkers=1` | PASS — 25 test |
| `npm run test:authorization -- --maxWorkers=1` | PASS — 5 test |
| `tests/integration/resident-payment-request-route.test.ts` | PASS — 4 test |
| `npm run build` | PASS — menggunakan nilai build-only lokal, bukan URL/secret Neon |
| `npx drizzle-kit check` | PASS |
| Drizzle schema drift | PASS — tidak ada perubahan tambahan |
| `npm run db:check` | PASS — endpoint development |
| Migration + live Neon payment-request smoke | PASS — hasil terinci di atas |
| Browser smoke | PASS — 360×800, 390×844, 430×900, 768×1024, 1440×900 |
| PGlite service/constraint tests di Windows | Runner lokal mengalami native out-of-memory. Integrasi, constraints, dan full suite lulus di GitHub Actions Ubuntu. |
| Gate A GitHub Actions | PASS — [run 36758296850](https://github.com/Satsetx4/karturt/actions/runs/36758296850), seluruh langkah termasuk full suite dan build |

Browser smoke memakai `ResidentPaymentRequestPanel` dan kartu warga yang sebenarnya dengan API fixture lokal yang mempertahankan state selama refresh. Yang diperiksa: tunggakan lama terpilih otomatis tanpa due yang sudah pending, total konfirmasi Rp110.000, double-click hanya satu POST, payload hanya periode publik, status kuning dengan ikon dan teks setelah refresh, tautan WhatsApp berisi detail request, tanpa due date/tanggal 10, token teknis, atau horizontal overflow.

## Batas dan risiko tersisa

- Verifikasi, pembayaran, alokasi, perubahan due menjadi paid, penolakan, dan pembatalan tidak dibuat pada Fase 5. Fase 6/7 harus mengelola status dan pelepasan/penutupan claim dalam transaksi yang sama.
- Browser smoke merupakan verifikasi UI lokal dengan API fixture; belum ada deployment preview atau UAT perangkat fisik.
- Data fixture sintetis smoke sengaja tersimpan pada Neon development.

## Status akhir gate

**Fase 5: PASS. Gate B keseluruhan: NOT COMPLETE karena Fase 6 belum dibuat.**
