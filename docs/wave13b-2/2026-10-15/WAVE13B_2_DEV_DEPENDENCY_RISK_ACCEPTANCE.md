# Wave 13B.2 — Penerimaan Sementara Risiko Advisory Development Tool

**Status:** `TEMPORARILY_ACCEPTED_EXPIRES_2026-11-14`

**Keputusan owner:** menerima satu advisory pada 2026-10-15 selama 30 hari saja.

**Cakupan:** source RC SHA `0b1e3f525039496200b2bb5f698d312ded5cb3e3`; hanya graph dependency development.

## Advisory dan bukti terkini

Item yang diterima adalah **satu** advisory High, [GHSA-vfj7-8cjw-p6xm / CVE-2026-93687](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), yang berdampak pada `braces <=3.0.3`. GitHub Advisory Database saat ini menyatakan belum ada versi yang diperbaiki dan menjelaskan stack exhaustion akibat pola brace bertingkat dalam. Halamannya berstatus High dan ditinjau/diperbarui pada 2026-10-02. Ini adalah risiko denial-of-service; tidak ada uji exploit yang dilakukan.

Manifest source persis diaudit dari source SHA `0b1e3f525039496200b2bb5f698d312ded5cb3e3` setelah identitas blob Git diverifikasi: `package.json` `80731d95d19e24bcebce7e989636cd5b84a56945`; `package-lock.json` `927c66aff7007e33381d786a4046f6437b6fe9d8`. Blob package-lock baseline docs berbeda dan bukan dasar hasil audit ini.

| Audit | Hasil | Interpretasi |
|---|---:|---|
| `npm audit --json` | Exit 1; 5 node dependency HIGH | Satu GHSA menjalar ke lima node; bukan lima advisory terpisah. |
| `npm audit --omit=dev --json` | Exit 0; 0 kerentanan | Tidak ada kerentanan dependency production yang dilaporkan untuk lockfile ini. |

Lima node development tersebut adalah `eslint-config-next@16.3.8`, `@next/eslint-plugin-next@16.3.8`, `fast-glob@3.3.1`, `micromatch@4.0.8`, dan `braces@3.0.3`. npm menyarankan downgrade ke `eslint-config-next@14.2.35` sebagai satu-satunya resolusi otomatis; itu downgrade mayor dan ditolak karena tidak kompatibel dengan baseline Next 16. Audit production-only yang bersih tidak menjadikan toolchain development bersih dan tidak menghapus risiko residual ini.

## Kontrol kompensasi selama periode penerimaan

- Pertahankan lockfile yang sudah direview dan gunakan `npm ci` untuk instalasi; jangan buat ulang atau mengedit lockfile secara manual untuk menyembunyikan temuan.
- Jalankan build, lint, dan tool developer lain yang memproses glob hanya pada konten repositori yang tepercaya dan sudah direview. Jangan berikan pola brace/glob yang dikendalikan penyerang atau file tree tak tepercaya kepada tool tersebut.
- Batasi eksekusi CI ke workflow tepercaya dan input yang sudah direview; jangan paparkan secret repository untuk write/deployment pada job yang memproses konten pull request tak tepercaya. Minimalkan permission yang dibutuhkan.
- Simpan temuan ini pada catatan rilis/keamanan dan laporkan sebagai advisory HIGH yang masih terbuka sampai dependency kompatibel yang telah diperbaiki diuji dan source SHA persis diaudit ulang.
- Jangan demonstrasikan exploit pada sistem bersama. Penerimaan ini tidak mengizinkan atau memerlukan validasi exploit.

Kontrol ini wajib selama penerimaan sementara. Catatan ini tidak menyatakan bahwa setiap kontrol workflow telah dikonfigurasi secara independen atau bahwa kerentanan mustahil dicapai dalam semua konteks development.

## Rencana pemeriksaan ulang dan masa berlaku

Pemeriksaan manual direncanakan pada **2026-10-22**, **2026-10-29**, **2026-11-05**, dan **2026-11-14**. Tanggal tersebut adalah rencana saja; pekerjaan ini tidak membuat reminder, automation terjadwal, atau monitor.

Jika perbaikan upstream yang kompatibel tersedia, perbarui melalui dependency chain yang didukung, jalankan `npm audit` dan pemeriksaan Gate A wajib pada SHA baru, lalu tutup penerimaan hanya jika ada buktinya. Penerimaan berakhir pada **2026-11-14**. Perpanjangan memerlukan keputusan owner baru. Sampai saat itu, jangan menyebut advisory ini sudah patched, fixed, clean, suppressed, atau closed.

Tindakan yang dilarang termasuk `npm audit fix --force`, downgrade mayor `eslint-config-next` ke versi 14, suppression advisory, atau menyebut lima node tersebut sebagai lima CVE terpisah. Tidak ada perubahan package, lockfile, atau source dalam review ini.
