# Pemulihan mandiri 2FA System Admin

## Tujuan dan batas

Jalur ini hanya untuk pemilik akun System Admin yang kehilangan akses ke autentikator. Pengguna harus membuka halaman melalui alias deployment Vercel terlindungi `karturt-production-rt-6.vercel.app`, masuk dengan akun tim Vercel yang berhak melihat deployment, lalu memverifikasi nama akun dan kata sandi System Admin. Domain aplikasi publik dan alias proyek `karturt-production.vercel.app` tidak menerima operasi ini.

Pengiriman form adalah tindakan pemulihan yang disengaja. Sebelum form dikirim, aplikasi tidak mengubah akun. Saat berhasil, satu transaksi menghapus faktor TOTP lama, mempertahankan flag 2FA tetap aktif, mencabut seluruh sesi, menandai pemulihan yang belum selesai, dan menulis audit sebagai pemulihan mandiri pemilik beserta referensi yang dibuat server. Kegagalan audit membatalkan transaksi. Better Auth lalu menerbitkan sesi setup-only melalui endpoint yang sama-sama dibatasi ke host terlindungi.

## Pengaman

- Halaman hanya dirender pada host proyek Vercel yang ditetapkan. Endpoint juga memeriksa host, HTTPS, dan Origin yang sama, sehingga pemanggilan dari domain publik atau situs lain ditolak. Host recovery ditambahkan ke origin Better Auth hanya pada base URL Production KartuRT.
- Proyek Vercel harus tetap memakai Vercel Authentication untuk generated deployment URL. Jangan gunakan shareable bypass link untuk halaman pemulihan. Gunakan `karturt-production-rt-6.vercel.app`; alias proyek `karturt-production.vercel.app` adalah domain Production yang dapat diakses publik pada konfigurasi saat ini dan sengaja ditolak oleh pemeriksaan host aplikasi.
- Endpoint memakai rate limit email sign-in Better Auth per IP, ditambah lockout akun System Admin setelah lima kegagalan selama 15 menit. Nama akun dan kata sandi tidak dimasukkan ke URL, log aplikasi, atau data audit.
- Pemulihan hanya dapat berjalan jika database berisi tepat satu System Admin aktif, kredensial kata sandinya cocok, dan faktor TOTP lama tercatat aktif serta terverifikasi. Jika ada lebih dari satu Admin aktif atau keadaan faktor berbeda, proses gagal tertutup dan jalur dua orang yang sudah ada tetap menjadi opsi.
- Reason audit wajib diisi. Jangan memasukkan password, kode autentikator, nomor telepon, atau alamat email. Referensi audit tidak membuktikan identitas; pembuktian bergantung pada gerbang akses Vercel dan verifikasi kata sandi.
- Flag 2FA tidak pernah dimatikan. Login biasa tanpa faktor lama tetap hanya menghasilkan challenge tanpa metode TOTP dan tidak membuat sesi. Sesi recovery yang diterbitkan Better Auth hanya dapat mencapai halaman setup; pemeriksaan principal yang sudah ada menolak akses Admin sebelum TOTP baru terverifikasi.
- Marker pemulihan hanya dibersihkan setelah endpoint Better Auth berhasil memverifikasi TOTP baru dan audit verifikasinya tersimpan dalam transaksi yang sama.

## Gerbang sebelum penggunaan di Production

1. Tinjau PR dan pastikan target deployment adalah proyek RT05 yang benar.
2. Setelah deployment selesai, uji `karturt-production-rt-6.vercel.app/system/recovery` tanpa sesi Vercel dan pastikan Vercel mengarahkan pengunjung ke login. Pastikan `karturt-production.vercel.app/system/recovery` dan `karturt.vercel.app/system/recovery` menghasilkan 404, termasuk untuk POST pemulihan pada domain publik.
3. Hanya pemilik yang masuk ke Vercel team dan mengetahui kata sandi akun System Admin yang boleh mengirim form.
4. Setelah TOTP baru aktif, simpan backup codes di tempat aman di luar aplikasi dan catat referensi audit untuk keperluan pemeriksaan. Jika sesi setup gagal dibuat setelah pemulihan tercatat, kirim form lagi melalui host Vercel; marker pending memungkinkan sesi setup dibuat ulang tanpa menghapus faktor baru atau menulis audit pemulihan kedua.

PR ini tidak menjalankan pemulihan, mengubah akun produksi, mengubah `BETTER_AUTH_SECRET`, menjalankan migrasi, atau melakukan deployment.
