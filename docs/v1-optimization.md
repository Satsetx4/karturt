# F23 — pengukuran dan optimasi baca terbatas

Tanggal: 1 November 2026, Asia/Bangkok. Baseline aplikasi main `0d89347d9761c1e881e519c013909ab0af741bb1`; reader F19 berasal dari `7493fa05e098261e9ab6db0ebd89879913d819e2` (tree aplikasi identik). Branch `feat/v1-read-optimization-20261101` juga membawa dokumentasi PR #128, belum merged saat pekerjaan dimulai.

Pemilik menyatakan **"f21 sudah ok"** dan meminta F23. F21 ditutup berdasarkan penerimaan tersebut; tidak ada hasil peserta, durasi atau skor yang diisi oleh agen.

## Metode dan bukti

`scripts/v1-read-performance.ts` hanya membuat PGlite lokal sementara lewat helper tes dan migrasi resmi. Tidak memakai Neon atau DATABASE_URL. Dua RT sintetis independen: 50/500 rumah tangga, 600/6.000 tagihan, 50/500 pengajuan, separuh diverifikasi melalui layanan aplikasi. Dengan demikian ledger, snapshot, alokasi dan audit tervalidasi; tidak menyisipkan transaksi palsu langsung ke tabel finansial.

- Percobaan awal tanpa ANALYZE: satu warmup dan tiga pengukuran; hasil `v1-optimization-evidence/before.json`. Dataset baru belum memiliki statistik planner. Ini diagnosis fixture, bukan baseline Production.
- Profil satu laporan besar tanpa statistik: delapan query; query tagihan/join sekitar 11.943 ms dan query metode alokasi sekitar 6.839 ms, sedangkan saldo sekitar 165 ms. Ini waktu driver PGlite dari satu profil, bukan EXPLAIN atau waktu server Neon.
- Percobaan utama sesudah ANALYZE **hanya pada PGlite sintetis**: satu warmup dan tujuh pengukuran, hasil `v1-optimization-evidence/after.json`. Tidak mengubah query laporan, indeks atau schema.
- Notifikasi lama dan baru diukur berpasangan pada database/proses yang sama dengan urutan eksekusi bergantian. `scripts/v1-notifications-baseline.ts` menyimpan reader F19 lama khusus benchmark. Setiap pasangan harus menghasilkan respons identik setelah `checkedAt` dikecualikan; maksimal 20 pending dan `hasMore` harus sesuai.

Jalankan `npx tsx scripts/v1-read-performance.ts after` untuk mengulang pengukuran utama. Argumen `profile` menyediakan profil query setelah ANALYZE. Seeding di luar waktu baca. Hasil bergantung mesin, proses dan cache; tidak ada gate CI berbasis milidetik yang mudah fluktuatif.

## Hasil yang benar-benar diukur

| Jalur | 50 rumah tangga | 500 rumah tangga | Arti |
|---|---:|---:|---|
| Laporan sebelum statistik, kode laporan lama | 242,19 ms | 19.986,38 ms | Planner fixture baru bermasalah; jangan klaim perbaikan kode dari angka ini. |
| Laporan setelah statistik, kode laporan sama | 61,42 ms | 508,98 ms | Dataset 10×, median 8,29×; tidak perlu merombak perhitungan laporan pada slice ini. |
| Daftar rumah halaman pertama setelah statistik | 41,92 ms | 176,04 ms | Hasil masing-masing 50/250 baris; bukan ukuran daftar seluruh 500 rumah. |
| Notifikasi F19 lama setelah statistik | 4,44 ms | 4,28 ms | Pembanding dalam proses yang sama. |
| Notifikasi baru setelah statistik | 3,65 ms | 3,13 ms | Pengurangan median lokal sekitar 18%/27%, selisih absolut di bawah 1,2 ms. Bukan janji percepatan Production. |

Antrean Bendahara besar: satu smoke 17,37 ms/250 pengajuan; riwayat Bendahara 18,94 ms/50 hasil; riwayat Warga 4,65 ms/1 hasil. Angka satu sampel ini tidak diperlakukan sebagai median atau SLA. Detail sampel ada di JSON. Memori hanya satu sampel akhir, bukan peak profiling.

## Perubahan aplikasi yang dipilih

`src/lib/billing/payment-notifications.ts`: setelah pemeriksaan ulang principal/scope yang sama, Bendahara membaca pending langsung dari `payment_requests`, urut `createdAt` dan ID, limit 21 untuk mengembalikan 20 dan penanda lebih banyak. Dua LEFT JOIN ke payments/reversals dan pengurutan coalesce dihilangkan dari jalur Bendahara; pending belum merupakan pembayaran terverifikasi.

Jalur Warga tetap memakai join untuk hasil verified/rejected dan reversal. Tidak ada cache, perubahan polling, privasi respons, hak akses, perhitungan nominal, ledger, audit, dependency, indeks atau migrasi baru. Optimasi statistik fixture tidak diterapkan ke database provider.

## Acceptance dan status

1. Respons notifikasi lama/baru sama pada setiap pasangan benchmark; urutan, status, limit dan `hasMore` tetap benar.
2. Enam tes service/API F19 lulus, termasuk tenant/principal aktif, penolakan role, verifikasi/rejection/reversal, batas daftar dan private/no-store. Typecheck dan ESLint file berubah lulus.
3. Laporan/perhitungan keuangan tidak berubah; pemeriksaan regresi seluruh aplikasi, build dan CI exact-head dicatat pada PR F23 setelah dijalankan. Jangan menyimpulkan hasilnya dari dokumen ini.
4. Sebelum rilis: CI → Preview exact-SHA yang diizinkan → verifikasi → izin merge/Production. Slice F23 belum dirilis dan belum diterima pemilik.

Tidak dilakukan: pengukuran latency HTTP/TTFB, koneksi Neon, beban paralel, EXPLAIN Production, perubahan statistik Production, uji perangkat atau transaksi deployed. Statistik autovacuum/ANALYZE Neon tidak diperiksa. Angka lokal tidak membuktikan adanya masalah planner di Production; pengukuran provider diperlukan sebelum memutuskan indeks/tuning berikutnya.
