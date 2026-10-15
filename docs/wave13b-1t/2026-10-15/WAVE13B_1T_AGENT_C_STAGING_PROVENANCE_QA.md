# Wave 13B.1T — Agent C Staging Provenance dan Independent QA

Tanggal: 2026-10-15
Verdict provenance: **ISOLATION_UNKNOWN — D3 NO_GO**
Verdict SQL: **NOT_EXECUTED_ACCESS_SAFETY_BLOCKED**

## Pemeriksaan Neon tanpa koneksi SQL

Agent C hanya membaca metadata control plane; tidak ada koneksi database atau SQL. Pada target baru `falling-bread-33359184` / `br-muddy-frost-azot13fb`:

| Field | Readback metadata | Batas bukti |
|---|---|---|
| Compute / database / role | `ep-silent-butterfly-azrflu40` / database `702718` (`karturt_staging`) / `karturt_staging_owner` | Identitas perlu dibaca ulang lagi sebelum koneksi yang kelak disetujui. |
| `init_source` | `parent-data` | Tidak membuktikan independensi lineage atau isi database. |
| Ukuran logical | `31,686,656` bytes | Tidak membuktikan data identik ataupun kosong secara fisik. |
| `written_data_bytes` | `0` | Bukan bukti bahwa data parent tidak diwariskan. |
| Provenance object / `parent_id` | Tidak tersedia pada readback ini | Asal-usul positif tidak terverifikasi. |
| Endpoint | Idle | Tidak dibangunkan. |
| `block_public_connections` / allowlist IP | `false` / allowlist kosong | Koneksi publik tidak dibatasi oleh allowlist pada metadata ini. |
| Branch protection | Tidak aktif (`protected=false`; project tidak membatasi operasi ke protected branches) | Tidak ada perlindungan branch/provider yang membuktikan isolasi. |
| `passwordless_access` | Metadata `true` | Metadata ini bukan bukti bahwa login SQL anonim berhasil. |

Branch target dan old staging `wild-art-99835126` sama-sama melaporkan `init_source=parent-data` dan ukuran logical `31,686,656` bytes. Kesamaan ukuran bukan bukti data sama, tetapi tidak menyediakan bukti positif bahwa target baru independen atau kosong. Kedua endpoint idle; old staging tetap suspended. Tidak ada operasi provider baru pada 15 Oktober: target baru memiliki lima operasi yang semuanya 14 Oktober; old staging sebelas operasi yang semuanya 13–14 Oktober.

Project production tidak berhasil diidentifikasi dari daftar organisasi yang terlihat. Karena itu status perubahan production provider **UNKNOWN**; kami tidak mengklaim bahwa remote production telah diaudit. Tidak ada operasi yang dilakukan pada production maupun old staging.

## Batas paket Neon Free dan pilihan Rp0

Dokumentasi Neon saat pemeriksaan menyebut **IP Allow** hanya pada Scale, [protected branches](https://neon.com/docs/guides/protected-branches) pada Launch/Scale, dan [Private Networking](https://neon.com/docs/guides/neon-private-networking) pada Scale. Dengan batas Rp0/no-overage, paket Free yang sekarang tidak menyediakan kontrol jaringan/branch tersebut. Lihat [Neon IP Allow](https://neon.com/docs/introduction/ip-allow) dan [batas paket Neon](https://neon.com/docs/introduction/plans).

Opsi tanpa biaya: tetap blokir D2/D3 dan jangan hubungkan target ini sampai ada bukti lineage/isolasi yang dapat diverifikasi dalam batas paket saat ini; atau owner secara terpisah meninjau arsitektur alternatif yang memenuhi kontrol tanpa menaikkan biaya. Tidak ada upgrade atau perubahan konfigurasi yang dilakukan.

## Independent source QA

Final source SHA: `0b1e3f525039496200b2bb5f698d312ded5cb3e3`, branch source `codex/karturt-v1-rc-quality-wave13b1t-20261015` dan alias `verify/karturt-v1-rc-quality-wave13b1t-20261015`.

- Branch source dan alias sama-sama menunjuk exact final SHA; remote `main` tetap `96c84588ae0c13f68a17cffd997a3e583fb7da82`.
- Source final hanya berbeda dari RC `193b25be6394db9196c22617e9b55b4427cf6f86` pada dua workflow, dua runtime allowlist PostgreSQL, dan dua unit test guard.
- Semua 14 migration SQL (`drizzle/0000`–`0013`) dan `drizzle/meta/_journal.json` tetap 15/15 byte-identik dengan security baseline `48b92abbe93fbd499448b6c885d3042cb49c2128`.
- `stagingIsolationVerifiedEmpty=false` dan `PINNED_STAGING_MIGRATION_APPROVAL_PUBLIC_KEY_PEM=null` tetap.
- Gate A push-run `38699617335`, job `116304347197`, pada final SHA: **PASS**. Semua langkah sukses, termasuk install, lint, typecheck, unit, integration/migration, constraints, authorization, security closure, full test suite, journal consistency, schema drift, dan build.
- PG17 independent concurrency job `116307663761` pada run Gate A yang sama: **PASS**; initialize run-scoped identity, concurrency proof, dan evidence upload sukses. Job tidak dilewati.
- PG18 run final `38699617221`, job `116304346369`: **PASS**, termasuk initialize run-scoped identity, apply dan verifikasi journal, serta rehearsal fixture sintetik.
- Gate A dan concurrency PG17 baseline sebelumnya sukses pada SHA lama `193b25be` (run `38678563048`, job PG17 `116239687016`), namun bukti itu tidak menggantikan run final.

Gate pertama workflow-only pada SHA `3509b1b7131227465f57431556c14b1ac620c53e` gagal tertutup pada allowlist runtime; langkah migrasi PG18 dilewati dan run tersebut tidak dihitung. Alias exact ditambahkan ke validator serta unit test, lalu seluruh gate final dijalankan pada SHA baru. Workflow-dispatch Gate A juga dibatalkan dan tidak dihitung karena runtime guard menerima hanya event `push`.
