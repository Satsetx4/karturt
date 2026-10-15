# Wave 13B.2 — Next Gate Packet

Tanggal: 2026-10-15
Status: **NOT_PROVISIONED_SAFETY_COST_BLOCKED; OWNER INPUT / EVIDENCE REQUIRED TO REOPEN G1**

## Keputusan untuk wave ini

Jangan provision proyek Neon baru. Bukti biaya/kuota/no-overage yang nyata belum cukup dan kontrol keamanan jaringan/branch yang tersedia pada Free terbatas. Tidak ada alasan untuk mengubah paket, memesan resource, mengaktifkan overage, atau menyentuh target lain demi mengejar penyelesaian.

## Bukti yang membuka peninjauan ulang G1

Minta bukti bertanggal dari Neon Console atau sumber resmi account-level yang menunjukkan:

1. Konsumsi sekarang dan sisa quota untuk storage, compute, project count, serta resource lain yang berdampak.
2. Aturan billing Free dan keadaan ketika limit tercapai: apakah resource hanya berhenti/dijeda atau timbul biaya; tunjukkan bagaimana overage dinonaktifkan dan tidak ada upgrade otomatis.
3. Dampak penggunaan proyek baru yang direncanakan terhadap setiap limit, dengan headroom terukur dan cadangan agar tidak menyentuh ambang berbayar.
4. Sumber kontrol keamanan endpoint dan role: akses publik, TLS/CA, password lifecycle, owner/runtime separation, rotasi, backup/recovery, serta alasan residual risk cocok untuk synthetic-only staging.
5. Protokol operasi yang menghasilkan root project independen tanpa clone/import/restore/parent data, beserta bukti readback branch root dan identitas target yang saling konsisten.

Semua lima kelompok harus jelas dan bebas material UNKNOWN/BLOCKED untuk mempertimbangkan provisioning. Proyek dibuat hanya jika seluruh bukti biaya, lineage, dan keamanan lulus dan tindakan persisnya tetap dalam izin owner. Setelah create saja, status katalog tetap UNKNOWN sampai ada otorisasi target-specific yang terpisah.

## Jalur validasi tanpa Neon staging

Jalankan/ulang disposable PostgreSQL 18 rehearsal di lingkungan lokal atau CI terisolasi dengan data sintetis jika perlu membuktikan migrasi dan alur lintas-RT. Run `38699617221` pada source SHA `0b1e3f525039496200b2bb5f698d312ded5cb3e3` sudah lulus; hasilnya bukan staging Neon, tidak membuktikan account-level quota, lineage cloud, atau katalog target.

## D1v2 lama

Tetap **NOT_EXECUTED_ACCESS_SAFETY_BLOCKED**. Sebelum mempertimbangkan koneksi satu-kali yang telah disetujui ke target lama, owner harus secara lokal menyediakan psql PostgreSQL 18, CA tepercaya/fingerprint, PGPASSFILE owner-only, dan baseline expected-state yang independen serta disetujui. Setelah itu jalankan ulang hanya offline preflight. Coordinator harus melakukan identity readback control-plane non-waking yang segar tepat sebelum koneksi. Jika ada mismatch atau field tidak bisa dibuktikan, berhenti sebelum koneksi. Tidak ada prasyarat tersebut yang dipenuhi oleh Wave 13B.2.

Persetujuan D1v2 hanya untuk tuple target lama yang dipatok dan 26 statement yang difingerprint; jangan gunakan untuk target baru, query tambahan, driver lain, retry, DDL, atau migrasi.

## Risiko development dependency

Risiko satu advisory HIGH diterima sementara sampai **2026-11-14**. Catatan recheck 2026-10-22, 2026-10-29, 2026-11-05, dan 2026-11-14 adalah tanggal yang direncanakan, bukan automasi/notifikasi yang telah dijadwalkan. Tutup lebih awal bila upstream menyediakan versi kompatibel yang sudah diuji. Jangan mengklaim patched/clean sebelum audit ulang.

## Invariant dan stop conditions

- `stagingIsolationVerifiedEmpty=false`.
- `PINNED_STAGING_MIGRATION_APPROVAL_PUBLIC_KEY_PEM=null`.
- Tidak ada migration/DDL, Ed25519 signing/pinning, deployment production, mutasi pada dua staging lama, pembelian, perubahan tier, overage, Vercel env/domain, ataupun merge ke `main`.
- Status keseluruhan wave: **BLOCKED BEFORE PROVISIONING; D1v2 NOT EXECUTED; RC SOURCE VERIFIED WITH TEMPORARILY ACCEPTED DEV RISK**.
