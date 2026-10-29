# PWA dasar KartuRT

PWA dasar menambahkan identitas aplikasi dan pemasangan ke layar utama. Manifest memiliki ID dan start URL `/`, sehingga peluncuran membuka pilihan Warga/Pengurus tanpa menyimpan akun atau mengunci jenis peran. Browser yang mendukung pemasangan memakai tampilan `standalone`.

Ikon PNG 192/512 px dan Apple 180 px berasal dari `public/icon.svg` yang sudah dipakai KartuRT. Ikon maskable 512 px menyediakan ruang aman tambahan untuk pemotongan ikon oleh sistem operasi. Metadata Apple dan warna tema dipasang pada layout bersama.

## Penggunaan

Buka **Pasang di HP** di footer. Bila browser mengirim event pemasangan, tombol **Pasang KartuRT** membuka dialog bawaan browser. Jika event tidak tersedia, panduan Android dan iPhone tetap dapat dibaca. Pembatalan atau penolakan browser tidak dianggap sebagai pemasangan berhasil. Panduan disembunyikan ketika aplikasi berjalan dalam mode standalone atau browser mengonfirmasi pemasangan.

- Android: menu browser → Pasang aplikasi / Tambahkan ke layar utama.
- iPhone/iPad: Safari → Bagikan → Tambahkan ke Layar Utama.
- Akses dan perilaku pemasangan bergantung browser/perangkat; lihat [persyaratan dan dukungan pemasangan MDN](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable).

## Batas data dan penerimaan

Aplikasi tetap membutuhkan internet. Tidak ada service worker, pre-cache, offline fallback ke data lama, push notification, atau penyimpanan tambahan untuk laporan, akun, PIN, sesi, maupun transaksi. Pemasangan tidak mengubah otorisasi, login, logout, atau pencatatan pembayaran.

Pengujian lokal/otomatis tidak menggantikan konfirmasi pemasangan nyata pada Android dan iPhone milik pengguna. Jangan mencatat pemasangan perangkat fisik sebagai lulus berdasarkan emulasi browser saja. Pemasangan dan peluncuran ulang, login/logout, serta unduhan CSV dari aplikasi terpasang perlu dikonfirmasi pada perangkat nyata setelah rilis yang diizinkan.

Pemeriksaan lokal pada server Next.js: manifest dan seluruh PNG tersedia; metadata Apple dan manifest tersisip di halaman; Chromium `Page.getInstallabilityErrors` mengembalikan daftar kosong. Lebar 360/390/420/768/1440 px pada tema terang/gelap tidak memiliki overflow horizontal. Simulasi event pemasangan mencakup pembatalan, kegagalan, penerimaan, dan penyembunyian panduan dalam standalone. Browser mencatat nol error halaman, nol permintaan API privat, nol service worker, dan nol CacheStorage. Ini bukti browser lokal, bukan pemasangan perangkat fisik.
