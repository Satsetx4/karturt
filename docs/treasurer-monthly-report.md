# Laporan iuran untuk rapat bulanan

Ketua RT dan Bendahara aktif dapat membuka `/app/laporan` untuk RT tempat mereka bertugas. Bendahara memiliki tautan Laporan iuran pada dashboard. Pembacaan tetap memakai API GET `/api/chairman/reports` yang sudah ada, dengan pemeriksaan akun, penugasan aktif, peran, dan RT pada server. Nama path API dipertahankan untuk kompatibilitas. Hak pengelolaan tarif, pemutihan, warga, dan transaksi tetap memakai izin masing-masing.

Pilih tahun dan bulan, lalu gunakan **Cetak / Simpan PDF**. Pilihan periode tercatat pada URL sehingga tetap tersedia setelah refresh. Cetakan A4 memuat identitas RT dari database, periode, posisi data, waktu cetak WIB, ringkasan, serta tunggakan periode terpilih. Header aplikasi, kontrol, laporan tahunan, dan footer tidak ikut dicetak. Daftar panjang dapat berlanjut ke halaman berikutnya.

## Arti angka

Tombol **Unduh CSV** mengunduh ringkasan dan rincian tunggakan untuk bulan/tahun yang dipilih, memakai data laporan yang sudah dimuat dan diotorisasi. CSV menggunakan UTF-8 dengan BOM, pemisah titik koma, dan nominal rupiah berupa angka utuh agar dapat diolah di Excel. Jika Excel tidak memisahkan kolom otomatis, gunakan menu impor CSV dengan delimiter titik koma. Teks yang berpotensi menjadi formula dinetralkan; tanda kutip, delimiter, dan baris baru di dalam nama ditangani sebagai isi sel. Berkas unduhan memuat data warga dan harus disimpan/dibagikan hanya kepada pihak yang berwenang.

Laporan mengelompokkan pembayaran menurut **bulan tagihan**, bukan tanggal penerimaan uang. Angka menunjukkan posisi data saat laporan dibaca, bukan snapshot penutupan bulan historis. Pembayaran di muka dapat masuk ke bulan tagihan mendatang. Laporan ini bukan buku kas dan tidak mencakup pengeluaran.

Saldo awal impor, pembayaran transfer/tunai terverifikasi, pemutihan, dan sisa kewajiban ditampilkan terpisah. Reversal mengikuti perhitungan laporan yang sudah ada. Tunggakan hanya memuat kewajiban yang melewati jatuh tempo pada periode terpilih; sisa kewajiban yang belum jatuh tempo tetap terlihat di ringkasan.

## Pemeriksaan

- Tes izin dan layanan mencakup kedua peran aktif, penugasan berakhir, akun nonaktif, peran yang tidak cocok, isolasi RT, serta pembacaan tanpa perubahan ledger/audit.
- Tes rendering mencakup pemilihan bulan, pemisahan saldo awal/pembayaran/pemutihan, dan kondisi tanpa tunggakan.
- Pemeriksaan Chromium lokal memakai data sintetis: lebar 360, 390, 420, 768, 1440 px, tema terang/gelap, pilihan bulan dan URL, serta PDF A4 tiga halaman dengan 40 baris tunggakan. Tidak ada akses provider atau akun riil dalam pemeriksaan ini.

Tidak ada perubahan skema atau migrasi database. Implementasi berdiri di atas `main` tanpa bergantung pada perubahan login PR #117.
