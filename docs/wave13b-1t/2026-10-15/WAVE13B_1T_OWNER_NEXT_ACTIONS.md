# Wave 13B.1T — Owner Next Actions

Tanggal: 2026-10-15

## Untuk mempertimbangkan satu run D1v2 yang telah disetujui

Persetujuan owner sebelumnya mencakup satu transaksi baca-saja dengan tepat 26 SQL blocks, satu backend/transaksi, `psql -X --set=ON_ERROR_STOP=on --set=ON_ERROR_ROLLBACK=off --single-transaction`, dan TLS `verify-full`. Prasyarat berikut belum terpenuhi; tidak ada koneksi dimulai.

1. Sediakan `psql` PostgreSQL 18 lokal. Setelah terpasang, cukup berikan lokasi executable lokal dan hasil `psql --version`; jangan jalankan koneksi.
2. Verifikasi root CA melalui sumber tepercaya yang terpisah dan fingerprint-nya. Siapkan path lokal aman. Preflight memeriksa keberadaan/ACL saja; belum ada bukti chain, hostname, validitas sertifikat, atau TLS handshake.
3. Buat `PGPASSFILE` lokal yang terikat ke target persis dan ACL owner-only. Jangan kirim, tampilkan, atau commit password/file; laporkan hanya apakah ACL owner-only terpenuhi.
4. Isi salinan lokal dari [expected-state template](WAVE13B_1T_D1V2_EXPECTED_STATE_TEMPLATE.md) memakai sumber/revisi yang ditinjau independen, ikat ke target yang tepat, dan tandai setiap kategori secara eksplisit. Template dalam Git tetap NOT APPROVED dan kosong. Jangan kirim baseline privat ke chat atau repo.
5. Setelah itu, lakukan readback control-plane non-waking yang segar untuk memastikan identitas target sama. Berhenti bila metadata tidak tersedia tanpa wake atau ada field berbeda. Jalankan ulang offline preflight; status `OFFLINE_GATES_PRESENT_HUMAN_REVIEW_REQUIRED` sendiri tetap bukan izin untuk menjalankan query.

Tanpa seluruh prasyarat tersebut, pertahankan **D1V2 `NOT_EXECUTED_ACCESS_SAFETY_BLOCKED`**. Jangan mengganti TLS, menebak baseline, mencoba query pengganti, retry, atau menggunakan driver lain.

## Isolasi staging dan D2/D3

Target saat ini memiliki `init_source=parent-data`; metadata `written_data_bytes=0` tidak membuktikan database secara fisik kosong atau lineage independen. IP allowlist kosong, public connections tidak diblokir, dan branch protection tidak aktif. Dokumentasi Neon menyatakan IP Allow hanya pada Scale, protected branches hanya pada Launch/Scale, dan Private Networking pada Scale: [IP Allow](https://neon.com/docs/introduction/ip-allow), [protected branches](https://neon.com/docs/guides/protected-branches), [Private Networking](https://neon.com/docs/guides/neon-private-networking).

Dengan batas biaya Rp0/no-overage, jangan lanjutkan D2/D3 di target ini sampai tersedia bukti positif lineage/isolasi dan kontrol akses yang sesuai. Pilihan yang tidak menambah biaya adalah tetap berhenti; alternatif arsitektur atau perubahan paket memerlukan keputusan owner terpisah dan tidak dilakukan pada wave ini.

Pertahankan `stagingIsolationVerifiedEmpty=false` dan `PINNED_STAGING_MIGRATION_APPROVAL_PUBLIC_KEY_PEM=null`. Tidak ada key dibuat atau dipin.

## Dependency security

Satu advisory HIGH masih mengenai lima node dev dependency, dan belum ada versi `braces` patched yang kompatibel dengan Next 16. Tunggu perbaikan upstream, lalu jalankan ulang full audit serta Gate A pada exact SHA baru. Jangan menggunakan `npm audit fix --force`, downgrade ESLint config ke Next 14, atau suppress advisory. Production-only audit saat ini bersih; full dependency audit belum bersih.
