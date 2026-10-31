# F19: pemberitahuan pembayaran dalam aplikasi

Status terkini: CLOSED berdasarkan penerimaan pemilik "F19 ok." pada 1 November 2026. Rilis dan batas bukti ada pada [catatan penutupan](v1-f19-acceptance-closure.md). Bagian pemeriksaan di bawah merekam urutan implementasi historis.

Alur HP: masuk → ruang akun → pemberitahuan pembayaran → Bendahara membuka pengajuan yang sudah ada; Warga memeriksa hasil dan rincian pada kartu/riwayat iuran.

Empat kemampuan: antrean pending Bendahara, hasil verified/rejected Warga, penanda reversal, pembaruan otomatis/manual saat online. Memakai status transaksi yang sudah tersimpan; tidak menambah tabel, migrasi, outbox, push, email, antrean offline atau status dibaca/belum dibaca. Ini daftar status terkini, bukan arsip kejadian atau jaminan pemberitahuan saat aplikasi ditutup.

## Akses dan integritas

- GET `/api/notifications`, private/no-store dan tanpa parameter filter. Principal aktif dibaca ulang dari database; ID akun, role, RT dan rumah tangga harus sama. Masa jabatan Bendahara mengikuti resolver yang ada.
- Bendahara hanya melihat pending RT sendiri. Warga hanya hasil pengajuannya sendiri dalam rumah tangga/RT aktif. Ketua/Admin tidak diberi akses feed ini.
- Respons hanya kode pengajuan, status, waktu kejadian, identitas viewer untuk pemeriksaan sesi, waktu pemeriksaan dan penanda batas daftar. Tidak memuat nama warga, nominal, alasan penolakan, kredensial atau payload audit.
- Maksimal 20 terbaru, urut waktu lalu ID. Tidak ada hitungan unread. Reversal mengalahkan status verified sehingga pembatalan tidak ditampilkan sebagai pembayaran berhasil.
- Baca saja: tidak mengubah transaksi, ledger, audit, PIN atau sesi. Tidak ada data pembayaran di localStorage atau service worker.
- Poll 30 detik hanya ketika halaman terlihat dan online; muat ulang saat kembali/reconnect. Daftar dibersihkan saat offline, halaman disembunyikan, error, sesi kedaluwarsa atau identitas viewer berubah. Respons permintaan yang sudah dibatalkan diabaikan.

## Acceptance criteria

1. Pengajuan sintetis muncul hanya pada Bendahara RT yang sesuai; verifikasi/penolakan menghilangkannya dari antrean dan muncul hanya pada Warga pengaju.
2. Reversal sintetis menampilkan pembatalan, bukan sukses. Reader tidak menulis ledger/audit.
3. RT/akun/rumah tangga lain, principal palsu, akun nonaktif dan jabatan berakhir tidak mendapat data; Ketua/Admin ditolak.
4. Lebih dari 20 hasil dibatasi dengan pemberitahuan; urutan stabil dan tidak ada data sensitif dalam respons.
5. Saat offline/error/401/pergantian akun, status lama hilang. Ketika kembali online/terlihat, server dibaca ulang; tidak ada replay transaksi.
6. Tampilan terang/gelap pada 360–420 px, tablet dan desktop tidak meluber; tombol minimal 44 px. Uji perangkat fisik/akun terautentikasi Preview tetap diperlukan sebelum penerimaan pemilik.

## Status

Implementasi dalam branch `feat/v1-payment-notifications-20261101`. Hasil pemeriksaan lokal dicatat setelah dijalankan. Kemudian dirilis lewat PR #127 pada main `0d89347d9761c1e881e519c013909ab0af741bb1`, dengan izin Preview dan Production terpisah. Fixture browser hanya memakai respons sintetis, bukan bukti end-to-end deployment.

## Pemeriksaan lokal

- Enam tes service/API fitur lulus dengan PGlite sintetis: isolasi, principal aktif, status/reversal, tanpa kebocoran alasan, batas/urutan dan private no-store.
- Typecheck dan ESLint file perubahan lulus. Browser komponen asli + respons sintetis menunjukkan kegagalan fetch dan pergantian identitas membersihkan daftar. Sepuluh kombinasi lebar 360/390/420/768/1440 dan terang/gelap tidak meluber, tombol minimal 48 px. Ini bukan uji autentikasi/deployment.
- Run regresi awal: 781 lulus / 6 gagal dari 787 kasus, 105 file. Keenam kegagalan berasal dari fixture lama yang menganggap November 2026 masih mendatang. Tes pergantian penghuni diberi tanggal bisnis khusus; tiga file tarif memakai tahun fixture tahun WIB saat ini + 1 dan tanggal bisnis konsisten. Trigger PostgreSQL asli, aturan tarif masa depan dan kode aplikasi tetap utuh. Run ulang lengkap kemudian lulus: 787/787 tes dalam 105 file.
- Belum diuji: Preview terautentikasi, perangkat fisik, putus/sambung jaringan nyata, polling saat aplikasi dipindah ke latar belakang, timeout jaringan, concurrency PostgreSQL mandiri dan recovery PG18. Tidak ada akses/mutasi database Production.
