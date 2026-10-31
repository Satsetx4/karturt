# F16: jabatan pengurus

Baseline: main `74f4b26a87760ef527ea918934f4de9578502224`. Branch `feat/v1-official-lifecycle-20261031`.

## Alur dan lingkup

Ruang akun Ketua → Jabatan pengurus → pilih tindakan → periksa ringkasan → konfirmasi → daftar terbaru. Tampilan memakai komponen, warna terang/gelap, dan tombol KartuRT yang ada, agar tidak menambah pola navigasi baru. Tiga tindakan inti dan satu daftar: jadwalkan jabatan, akhiri masa jabatan Bendahara, pergantian pengurus secara atomik, dan riwayat aktif/terjadwal/selesai.

Hanya akun official yang sudah tersedia di RT sendiri dapat ditugaskan. Pembuatan akun atau pemulihan kredensial tetap di luar F16 (F17). Tidak ada perubahan permission, schema, migration, dependency, atau data Production. System Admin tidak memperoleh akses pengelolaan jabatan baru.

## Aturan operasional

- Tanggal mulai/akhir bersifat inklusif dalam WIB. Penjadwalan mulai hari ini atau setelahnya; masa jabatan tidak boleh bertumpang tindih untuk peran maupun akun dalam RT yang sama.
- Pengakhiran hanya memperpendek masa jabatan dan tidak boleh sebelum hari ini atau tanggal mulai. Pengurus tetap boleh masuk sampai akhir tanggal tersebut.
- Ketua tidak dapat diakhiri lewat tindakan pengakhiran tunggal. Gunakan pergantian yang menetapkan penerus sekaligus; mulai paling cepat besok. Jabatan lama diakhiri sehari sebelumnya dalam transaksi yang sama, sehingga tidak ada jeda Ketua akibat tindakan ini.
- Pergantian memakai akun berbeda, aktif, dan tanpa jabatan lain yang bertumpang tindih. Jika calon Ketua masih Bendahara, akhiri terlebih dahulu masa jabatan Bendahara paling lambat sehari sebelum pergantian.
- Riwayat tidak dihapus. Penugasan terjadwal dapat dipersingkat hanya sampai tanggal mulai atau sesudahnya; pembatalan sebelum mulai dan perubahan umum jadwal bukan lingkup slice ini.
- Sesi akun terkait dicabut saat perubahan disimpan. Bila akun masih menjabat pada hari tersebut, akun dapat masuk kembali; pengecekan principal setiap permintaan menghentikan akses setelah tanggal akhir. Tidak ada janji logout otomatis pada tampilan yang sudah terbuka tanpa permintaan baru.
- Pergantian Ketua juga mencabut sesi Ketua yang sedang mengoperasikan form. Form menunjukkan permintaan masuk kembali ketika penyegaran daftar mendapat 401; perubahan yang sudah tersimpan tidak dibatalkan.
- Alasan administratif wajib, dengan sanitasi audit yang ada. Konteks audit hanya berisi tanggal, peran, referensi akun, dan jumlah sesi; viewer audit tetap tidak menampilkan alasan/konteks mentah.
- Tidak ada penyimpanan draft pengurus di localStorage, queue offline, atau background replay. Draft hanya dipertahankan di memori halaman ketika kembali dari konfirmasi.
- Percobaan ulang yang identik menggunakan kecocokan assignment yang sudah ada sebagai no-op. Ini tidak membuat baris atau audit kedua; perubahan berbeda yang bentrok ditolak. Setelah respons hilang, muat ulang daftar dahulu.

## Batas dan transaksi

Daftar akun aktif dibatasi 100 dan gagal secara eksplisit jika terlampaui. Daftar jabatan maksimal 100, dengan aktif/terjadwal didahulukan; UI menyatakan jika riwayat dipotong. Ini alat Single-RT, bukan konsol administrasi umum.

Mutasi mengunci RT terlebih dahulu (sesuai trigger temporal), lalu akun yang dipilih dalam urutan ID dan assignment RT. Setelah penguncian, principal Ketua diperiksa kembali dari akun dan masa jabatan tersimpan. Akhir jabatan lama, assignment baru, pencabutan sesi, dan audit berada di transaksi yang sama. Error apa pun membatalkan semuanya. Trigger PostgreSQL temporal tetap menjadi pertahanan tambahan; tidak diganti validasi aplikasi saja.

Endpoint GET/POST `/api/chairman/officials` tidak menerima RT dari klien. Mutasi memerlukan Origin yang sama, sesi aktif, JSON dan input strict. Respons no-store; error internal tidak disalin ke respons. Halaman `/app/pengurus` menolak peran lain sebelum membaca daftar.

## Acceptance criteria

1. Ketua dapat menjadwalkan akun official aktif dalam RT sendiri; akun belum dapat masuk sebelum tanggal mulai.
2. Awal/akhir tanggal WIB inklusif; tanggal tidak valid, mundur, dan perpanjangan lewat tindakan pengakhiran ditolak.
3. Benturan peran atau akun ditolak; RT lain, akun nonaktif, principal palsu/nonaktif dan peran lain tidak dapat melakukan perubahan.
4. Pergantian Ketua menyimpan dua sisi perubahan secara atomik, mempertahankan ID riwayat lama, dan tidak menghapus ledger atau transaksi.
5. Sesi akun terkait dicabut; satu audit tercatat; retry identik tidak menggandakan assignment/audit. Audit gagal → semua perubahan dan penghapusan sesi rollback.
6. Form menampilkan nama, peran, tanggal dan alasan sebelum kirim; kembali mengedit mempertahankan isian. Gagal koneksi tidak menampilkan sukses atau mengirim otomatis setelah online.
7. Halaman tetap dapat dipakai pada 360/390/420/768/1440 px dalam tema terang/gelap dengan kontrol minimal 44 px dan tanpa overflow horizontal.

## Bukti dan gate tersisa

Tes domain memakai PGlite dengan migration resmi dan data sintetis. Tes route memeriksa Origin, autentikasi, schema strict, redaksi error dan no-store. Tes page memeriksa navigasi, kondisi kosong dan penolakan peran.

Browser lokal menjalankan komponen React asli di fixture HTTP sintetis terpisah: schedule/end/handover, konfirmasi, kembali mengedit, penyimpanan dan pemuatan daftar dicoba. Pemeriksaan DOM di 360/390/420/768/1440 px pada kedua tema menunjukkan tidak ada overflow atau kontrol di bawah 44 px; log browser fixture tidak memuat error. Ini bukan aplikasi Next penuh, bukan login akun nyata, dan bukan bukti Preview atau perangkat fisik.

`npm run test`: 753 tes pada 99 file lulus. Typecheck dan lint file terkait lulus. Fixture browser juga menyuntikkan kegagalan fetch dan respons 401: tidak muncul sukses semu, dan sesi berakhir menampilkan jalan masuk kembali. Ini simulasi fault pada komponen, bukan pemutusan jaringan perangkat nyata. Hasil build dan CI final dicatat pada PR setelah commit.

Sebelum rilis: CI final-SHA, Preview terisolasi yang disetujui, pengujian akun sintetis Ketua/Bendahara/Warga/Admin, session revocation nyata, dan penerimaan pengguna. PostgreSQL independen/concurrency dan recovery tidak dijalankan dalam slice lokal ini. Jangan mengubah Production berdasarkan bukti lokal saja.
