# F17: alat pemulihan akun sederhana

Status 1 November 2026: CLOSED dalam cakupan V1 ini. PR #126 dirilis pada main `9cdc58fe5937b2bebdb4a01329f5f98ff7fb645e`, deployment `dpl_HTrv745uWX26tKzw8dyaqtfKsQ59` READY. CI main `41215997210` lulus. Pemilik menyatakan "f17 sudah saya nyatakan OK". Ini penerimaan pemilik; tidak mengubah batas bukti pengujian agen di bawah.

Baseline aplikasi: main `91613aef6b5b72a956a38f17a0401b62bdb9d018`. Branch `feat/v1-admin-recovery-tools-20261031` juga membawa commit dokumentasi penutupan F14/F16 dari PR #125; tidak bergantung pada fitur aplikasi lain yang belum dirilis.

## Gap dan alur

Layanan reset PIN warga dan emergency recovery 2FA Admin sudah tersedia, dengan pemeriksaan sesi/MFA, alasan/referensi, pencabutan sesi, serta audit. Ketua sudah memiliki form reset PIN warga melalui pengelolaan rumah. Gap yang ditutup: System Admin belum punya pencarian identitas akun dan form operasional untuk memakai layanan tersebut.

Alur: ruang akun System Admin → Pemulihan akun → cari nomor rumah/username persis → periksa nama, jenis, status dan RT → isi data pemulihan → periksa ringkasan → konfirmasi → hasil dan tautan riwayat aktivitas. Tampilan memakai gaya terang/gelap dan form/tombol KartuRT yang ada, bukan konsol admin baru.

Empat kemampuan: pencarian akun terbatas, form pemulihan PIN warga, form pemulihan 2FA Admin lain, serta review/konfirmasi dan akses audit.

## Batas akses dan data

- `/system/akun` hanya untuk System Admin terautentikasi; MFA yang belum terverifikasi mengikuti alur setup yang ada. Ketua, Bendahara dan Warga ditolak.
- POST read-only `/api/system-admin/accounts/search` memakai Origin yang sama, sesi, JSON strict dan respons no-store. Identitas pencarian dikirim di body, bukan URL. Reader memeriksa kembali akun aktif, ID principal dan verified TOTP dari database.
- Hanya pencocokan case-insensitive persis pada login identifier, atau ID akun UUID; tidak ada daftar default semua akun, wildcard atau fuzzy search. Maksimal 10 hasil dengan penanda jika ada lebih banyak. RT ditampilkan untuk membedakan identifier yang sama; tidak menambah pemilih/pengelolaan tenant.
- Cakupan System Admin tetap global sesuai layanan structured recovery yang sudah ada; tampilan identitas RT membantu memilih target yang benar. Tidak memberi Admin hak mencatat atau mengonfirmasi pembayaran.
- Respons hanya ID, nama, identifier, jenis/status, identitas RT, dan jenis tindakan yang tersedia. Tidak memilih/menampilkan email, PIN/hash/password, token/sesi, secret TOTP/backup code, kontak atau data keuangan.
- Pemulihan PIN hanya ditawarkan untuk akun resident aktif dengan rumah tangga/orang yang masih aktif sesuai kondisi layanan lama. Akun locked/disabled tidak mendapat tombol; lockout login sementara pada akun berstatus active tetap mengikuti layanan reset lama.
- Recovery 2FA hanya ditawarkan untuk Admin aktif lain. Backend lama tetap melarang self-recovery. Akun pengurus tetap memakai self-recovery username/PIN dengan strong recovery password yang sudah ada; tidak ada reset password/PIN pengurus baru oleh Admin.

## Mutasi tetap memakai layanan lama

UI memanggil `/api/residents/[accountId]/reset-pin` atau `/api/system-admin/accounts/[accountId]/recover-two-factor`. Tidak ada endpoint mutasi, permission, schema, migration, dependency atau tindakan ledger baru. Pemeriksaan target/role, pencabutan sesi dan audit tetap otoritatif pada backend lama, bukan pada pilihan/eligibilitas yang ditampilkan browser.

PIN baru wajib enam digit dan diulang. Ringkasan tidak menampilkan PIN. Alasan dan referensi administratif tetap wajib untuk Admin. Form mengingatkan operator memverifikasi permintaan di luar aplikasi; nomor referensi bukan bukti identitas otomatis. PIN hanya di memori form, tidak disimpan di localStorage, URL, log aplikasi atau audit. State form dan hasil pencarian dibersihkan setelah setiap percobaan mutasi dan saat dibatalkan.

Double-submit dibatasi saat permintaan berlangsung. Tidak ada retry otomatis, queue offline atau idempotency baru pada endpoint pemulihan lama. Jika respons hilang, hasil bisa belum diketahui; operator diminta memeriksa audit dan mencari akun kembali, bukan menampilkan sukses semu atau mengirim ulang diam-diam. Setiap request backend memeriksa sesi yang berlaku saat itu.

Provisioning akun, promosi peran, pengeditan RT, bulk operations, menonaktifkan/menghapus akun, perubahan credential policy dan recovery password pengurus bukan lingkup slice F17 minimal ini. Pembuatan akun tetap melalui prosedur operator yang sudah ada. Tidak mengklaim semua kemungkinan admin tooling telah dibuat.

## Acceptance criteria

1. Admin dengan verified MFA dapat mencari akun persis; non-Admin, akun nonaktif, principal palsu dan MFA belum verified ditolak sebelum data dikembalikan.
2. Hasil membedakan RT, dibatasi 10, dan tidak mengirim data rahasia/kontak/keuangan atau mengubah data/audit.
3. PIN warga dapat dipulihkan lewat form dengan pengulangan PIN, alasan dan referensi; ringkasan menyembunyikan PIN dan backend lama mencabut sesi/mencatat audit.
4. 2FA hanya dipulihkan oleh Admin lain yang sah; self-recovery tetap ditolak backend. Target harus mendaftar MFA lagi sebelum menggunakan akses Admin.
5. Batalkan/pergantian target/selesai/gagal menghapus PIN dari state/form. Koneksi gagal tidak memberi sukses semu; 401 menyediakan login ulang dan tidak melanjutkan pemulihan.
6. Kondisi awal, kosong, proses, gagal dan selesai jelas, dengan jalan kembali serta tautan audit. Kontrol minimal 44px, tanpa overflow pada 360/390/420/768/1440 px, kedua tema.

## Bukti lokal dan batas

Tes baru mencakup reader PGlite (MFA/role/stale principal, batas hasil, isolasi pemilihan identitas dan proyeksi field), boundary route (Origin, JSON/schema, no-store, redaksi error), dan halaman (akses, enrollment, fresh start tanpa directory/credential fields). Tes layanan recovery lama tetap dijalankan untuk sesi, audit, rollback dan self-recovery.

Regresi utama: 780 tes lulus, satu tes CSRF gagal sebelum pengujiannya berjalan karena Windows mengunci berkas sementara `DevToolsActivePort` (EBUSY). Tes CSRF yang sama kemudian lulus saat dijalankan terpisah. Jadi 781 kasus lulus lintas run; jangan menyatakan run suite pertama seluruhnya hijau. Typecheck, lint terkait dan diff check lulus; build/CI final-SHA dicatat di PR.

Browser lokal memakai komponen React asli dengan respons HTTP sintetis, tanpa autentikasi, faktor keamanan, atau database nyata. Pencarian, form PIN dengan nilai sintetis sementara, review tanpa PIN, respons sukses mock dan pembersihan form diperiksa. Alur Admin lain, kembali mengedit, simulated fetch failure dan 401 juga diperiksa. Pesan sesi/audit pada fixture hanyalah respons UI; bukan bukti sesi nyata dicabut di deployment.

Form penuh diperiksa pada lima lebar/kedua tema, tanpa overflow atau kontrol di bawah 44px; tema gelap 390px dilihat langsung. Log browser fixture yang diperiksa tidak memuat error. Ini bukan pengujian perangkat fisik atau aplikasi Next penuh.

Belum dijalankan: login Admin/MFA, pencarian/aksi recovery berakun pada Preview, penerimaan pengguna, PostgreSQL concurrency independen dan recovery. Tidak ada akses kredensial atau data warga Production, perubahan password/faktor nyata, migrasi atau deployment dalam pekerjaan lokal ini. Preview dan release memerlukan persetujuan terikat SHA/target seperti tahap sebelumnya.
