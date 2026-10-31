# F21 — uji kemudahan penggunaan sederhana

Status 1 November 2026: **persiapan dan peninjauan agen selesai; sesi peserta belum dijalankan**. Baseline main `0d89347d9761c1e881e519c013909ab0af741bb1` (F19 diterima pemilik). Ini studi kecil untuk menemukan hambatan, bukan bukti statistik bahwa seluruh pengguna dapat memakai aplikasi.

## Lingkungan dan batas tindakan

Gunakan Preview F4 `karturt-v1-1-f4-disposable-20261029`, deployment `dpl_DAhRWV9Rn9YQWDpbVATLGr3j6PrQ`, SHA `7493fa05e098261e9ab6db0ebd89879913d819e2`. Isi Git tree sama dengan main di atas: `6c34f44fb5a581ce40bdeab871e8bb2d40349c56`. URL [Preview](https://karturt-v1-1-f4-disposable-20261029-git-feat-v1-6dfa30-sekawan.vercel.app/). Jangan memakai domain Production untuk sesi ini.

Pendamping harus memastikan target dan akun/data sintetis sebelum peserta masuk. Kredensial diberikan pribadi oleh operator, tidak dicatat di lembar hasil. Jika akun/skenario sintetis belum tersedia, catat BELUM TERSEDIA; jangan membuat akun, menyalin data warga, membaca secrets atau menyiapkan transaksi otomatis.

Sesi awal baca saja: jangan menekan konfirmasi pengajuan, konfirmasi/penolakan pembayaran, pembatalan, perubahan jabatan, reset PIN/2FA, kirim WhatsApp atau transfer uang. Peserta cukup menjelaskan keputusan lalu kembali sebelum tindakan terakhir. Pengujian mutasi sintetis membutuhkan izin target/tindakan tersendiri dan bukan syarat sesi awal ini. File ekspor hanya dari dataset sintetis yang sudah dipastikan, tanpa mengunggahnya ke layanan lain.

## Cara menjalankan — sekitar 15 menit per peran

Mulai dengan satu orang per peran: Warga (W1), Bendahara (B1), Ketua (K1), serta operator System Admin (A1). Gunakan HP peserta untuk tiga peran harian; operator boleh memakai desktop. Catat perangkat/browser tanpa nama peserta. System Admin ditinjau sebagai alur operasional terbatas, bukan diberi akses keuangan.

1. Katakan: "Kami menguji aplikasinya. Coba tugas berikut dengan cara Anda sendiri; sebutkan bagian yang membingungkan. Jangan menyebutkan PIN atau data pribadi."
2. Bacakan tujuan tugas, jangan lebih dahulu menyebut nama tombol/jalur. Pendamping tidak mengarahkan sampai peserta meminta bantuan atau berhenti selama sekitar 2 menit.
3. Catat hasil MANDIRI / DIBANTU / GAGAL / BELUM DIJALANKAN, durasi nyata, jumlah bantuan dan hambatan. Jangan mengisi durasi perkiraan sebagai pengukuran.
4. Setelah tiap tugas: "Apa yang Anda harapkan terjadi?" dan nilai kemudahan 1 (sulit)–5 (mudah). Nilai hanya diisi peserta.
5. Akhiri dengan satu pertanyaan: "Bagian mana yang paling perlu diperjelas?" Tidak perlu rekaman video. Jika mengambil screenshot, hilangkan identitas, nominal nyata, PIN dan data akun.

## Tugas dan kriteria yang diamati

| ID / peran | Tujuan yang dibacakan | Kriteria observasi; batas tindakan |
|---|---|---|
| W1-1 Warga | Cari iuran bulan berjalan dan jelaskan statusnya. | Memilih akun Warga, masuk secara pribadi, menemukan bulan yang benar; membedakan Belum bayar, Menunggu konfirmasi dan Lunas. |
| W1-2 Warga | Temukan cara mengajukan pembayaran dan jelaskan kapan dianggap lunas. | Memilih bulan dan membaca ringkasan bila tersedia; berhenti sebelum Konfirmasi dan ajukan; tidak menyamakan pengajuan dengan lunas. |
| W1-3 Warga | Cari hasil pengajuan dan bukti pembayaran, lalu kembali ke kartu. | Menemukan pemberitahuan/kartu/riwayat; membedakan hasil penolakan atau reversal jika fixture tersedia; kembali tanpa bantuan. |
| B1-1 Bendahara | Cari pengajuan yang perlu diperiksa dan jelaskan apa yang harus dicocokkan. | Menemukan antrean/detail; memeriksa bulan/nominal sintetis dan kode; memahami transfer harus diterima sebelum konfirmasi. Jangan menekan Konfirmasi pembayaran. |
| B1-2 Bendahara | Jika pengajuan tidak cocok, tunjukkan cara menanganinya dan kembali ke antrean. | Menemukan alasan penolakan dan jalan kembali; berhenti sebelum Tolak permintaan; tidak mengubah pembayaran. |
| B1-3 Bendahara | Cari laporan bulan tertentu dan bedakan tagihan mendatang dari tunggakan. | Memilih periode, menjelaskan angka/status yang tampil; akses laporan tetap baca saja. |
| K1-1 Ketua | Cari laporan tahunan dan ekspor tunggakan sintetis. | Memilih tahun benar, menemukan ekspor yang dimaksud; unduhan hanya jika dataset sintetis dipastikan. Kembali ke ruang akun. |
| K1-2 Ketua | Cari pengurus yang sedang menjabat dan tunjukkan cara meninjau perubahan. | Menemukan Jabatan pengurus, memahami tanggal; berhenti sebelum Konfirmasi perubahan. |
| K1-3 Ketua | Cari riwayat aktivitas untuk menelusuri perubahan. | Menemukan filter/aktivitas dan kembali; tidak memerlukan raw context atau data rahasia. |
| A1-1 Admin | Temukan alat pemulihan dan jelaskan cara memilih akun dengan aman. | Masuk/MFA secara pribadi; mengenali akun/RT dan referensi; tidak mencari data nyata atau menjalankan pemulihan. Gunakan akun sintetis hanya jika tersedia. |
| A1-2 Admin | Tunjukkan cara memeriksa riwayat dan keluar dari alur pemulihan. | Menemukan jalan kembali/audit; memahami Admin bukan pencatat transaksi. Tidak mengubah PIN/2FA/jabatan. |

Skenario tambahan, jika aman pada perangkat peserta: pindahkan aplikasi ke latar belakang lalu kembali; matikan/sambungkan koneksi melalui kontrol perangkat sendiri saat hanya membaca. Peserta harus memahami bahwa status offline belum terkonfirmasi. Catat terpisah sebagai tugas tambahan; tidak mengirim ulang tindakan apa pun.

## Lembar hasil kosong

Salin satu baris per tugas; semua hasil awal **BELUM DIJALANKAN**. Tidak ada skor/waktu bawaan.

| ID tugas | Perangkat/browser | Hasil | Durasi nyata | Bantuan | Kutipan/hambatan tanpa data pribadi | Nilai peserta 1–5 |
|---|---|---|---|---|---|---|
| W1-1 / W1-2 / W1-3 — pisahkan per tugas | — | BELUM DIJALANKAN | — | — | — | — |
| B1-1 / B1-2 / B1-3 — pisahkan per tugas | — | BELUM DIJALANKAN | — | — | — | — |
| K1-1 / K1-2 / K1-3 — pisahkan per tugas | — | BELUM DIJALANKAN | — | — | — | — |
| A1-1 / A1-2 — pisahkan per tugas | — | BELUM DIJALANKAN | — | — | — | — |

## Peninjauan agen yang sudah dilakukan

Ini pemeriksaan antarmuka/kode, bukan hasil peserta:

- Preview: Beranda → Saya warga → masuk Warga → tautan masuk Pengurus berhasil dinavigasi tanpa kredensial. Halaman Warga dan Pengurus pada viewport 360 px tidak horizontal overflow. Input Warga sekitar 52 px, tombol masuk sekitar 50 px, tombol footer minimal 44 px. Tidak mengukur seluruh halaman/perangkat fisik.
- Form Pengurus: PIN bertipe password, keyboard numerik, panjang maksimum 6, tombol submit nonaktif saat kosong. Tidak mencoba login atau pengiriman kredensial.
- `src/components/resident-card.tsx:258`: pengajuan mempunyai pilihan bulan; `:299` tindakan akhir; `:334` riwayat permintaan; `:619` navigasi kartu/riwayat/profil.
- `src/components/treasurer-dashboard.tsx:85`: tautan detail; `src/components/treasurer-verification-button.tsx:73` konfirmasi; `src/components/treasurer-rejection-form.tsx:93` penolakan; kedua alur memiliki jalan kembali setelah selesai. Diperiksa dari sumber, bukan sesi peserta.
- `src/app/app/laporan/page.tsx:83`, `src/app/app/aktivitas/page.tsx:41`, `src/app/app/pengurus/page.tsx:24`: navigasi kembali ke ruang akun tersedia dalam sumber.

Hipotesis untuk diamati, belum merupakan bug terbukti: Warga mungkin sulit membedakan riwayat permintaan dan riwayat pembayaran; notifikasi di atas kartu mungkin menambah scroll; ringkasan tahunan mungkin disalahartikan sebagai tunggakan. Jangan mengubah UI hanya berdasarkan hipotesis ini.

## Keputusan dan penutupan

- Prioritas 1: salah memahami lunas/pending, risiko salah akun/RT, atau tidak bisa menyelesaikan tugas utama. Hentikan alur yang berisiko dan catat; perubahan data tidak dibenarkan untuk melanjutkan studi.
- Prioritas 2: tugas selesai dengan bantuan atau navigasi berulang. Prioritas 3: kosmetik; tunda kecuali mengganggu keterbacaan.
- F21 dapat ditutup setelah hasil nyata keempat peran tercatat, semua risiko Prioritas 1 diselesaikan/diverifikasi ulang dan pemilik menerima hasil. Temuan Prioritas 2 harus punya keputusan perbaiki/tunda beserta alasan; tidak ada target persentase dari sampel satu orang per peran.
- Perbaikan yang terbukti memakai branch → PR → tes sesuai perubahan → Preview → verifikasi ulang → izin rilis. Studi dokumen ini tidak membutuhkan deploy baru atau perubahan database.
- F23 dimulai dengan pengukuran sintetis; durasi tugas manusia di sini bukan latency server atau SLA Production.
