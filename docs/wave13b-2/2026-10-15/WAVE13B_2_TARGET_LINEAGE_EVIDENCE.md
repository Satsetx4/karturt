# Wave 13B.2 — Target Lineage Evidence

> **Snapshot sebelum pembuatan project; sudah superseded.** Project `broad-star-40451875` telah dibuat. Bukti terbaru menyatakan request tidak memakai source/clone/import/restore, tetapi Neon tidak mengirim field `parent_id`; lineage root tetap UNVERIFIED dan katalog UNKNOWN. Lihat [eksekusi koreksi owner terbaru](WAVE13B_2_OWNER_CORRECTION_EXECUTION.md).

Tanggal: 2026-10-15
Verdict: **NOT_PROVISIONED_SAFETY_COST_BLOCKED; NO NEW TARGET CREATED; LINEAGE NOT ESTABLISHED**

## Keputusan operasi

Tidak ada proyek Neon baru yang dibuat. Tidak ada `create project`, branch clone, import, restore, SQL, compute wake, role/credential creation, atau perubahan jaringan. Karena target baru tidak ada, tidak ada project/branch/endpoint/database/role ID baru yang dapat dilaporkan. Status lineage target usulan adalah **NOT APPLICABLE / UNKNOWN**, bukan independen dan bukan kosong.

G1 berhenti sebelum provisioning karena bukti saldo usage/kuota dan perilaku billing/overage aktual tidak tersedia untuk organisasi Free yang terlihat. Batas plan dan penggunaan sumber daya adalah klaim yang berbeda. Tidak ada bukti positif tentang saldo storage/compute saat provisioning hipotetis.

## Metadata control-plane yang diamati

| Objek | Identitas | Batas pembuktian |
|---|---|---|
| Neon org yang dipilih | `satset` / `org-ancient-boat-57106549`, plan Free | Nama plan tidak membuktikan usage, kapasitas tersisa, atau no-overage untuk proyek baru. |
| Region | `aws-ap-southeast-1` tersedia dalam daftar region untuk akun | Region tersedia tidak membuktikan biaya/kuota atau isolasi data. |
| Existing staging target | `falling-bread-33359184` | Dibiarkan tanpa mutasi; metadata lama bukan target Wave 13B.2. |
| Existing staging legacy | `wild-art-99835126` | Dibiarkan tanpa mutasi; tidak dipakai sebagai fallback. |
| Production | Tidak dituju | Tidak dilakukan tindakan provider terhadap production. |

Metadata proyek staging yang dibaca sebelumnya memperlihatkan endpoint publik tanpa allowlist IP (`allowed_ips.ips=[]`, `block_public_connections=false`) dan tidak mensyaratkan protected branches. Informasi itu menerangkan batas kontrol konfigurasi yang tersedia pada target yang diperiksa; ia bukan bukti keamanan target baru atau pernyataan bahwa data target baru kosong.

## Bukti yang harus tersedia sebelum gate provisioning dapat dibuka

Jika owner ingin menilai ulang, paket bukti harus memuat secara bersamaan:

1. Snapshot console/API yang berwenang dan bertanggal tentang penggunaan organisasi yang sebenarnya, kuota setiap metrik relevan, reset window, proyeksi konsumsi tambahan, dan aturan billing/overage Free. Field deprecated atau tidak berdefinisi bukan pengganti.
2. Bukti operasi create yang secara eksplisit membuat root project baru tanpa clone, parent data, import, restore, atau source project; ikat request dan response ke ID project serta root branch. Tidak cukup hanya melihat label `main` atau project baru pada daftar.
3. Readback branch dengan `parent_id=null` dan provenance operasi provider; readback identitas project/branch/endpoint/database/role harus saling cocok. Catat bahwa metadata lineage saja tidak membuktikan isi katalog kosong.
4. Jika akan mengklaim database/katalog kosong, otorisasi baru yang terikat pada target baru untuk inspeksi katalog yang tepat. Otorisasi D1v2 lama tidak dapat dialihkan dan tidak boleh ada SQL sampai disetujui secara terpisah.
5. Keputusan threat model tertulis untuk endpoint publik: akun owner terpisah, autentikasi kuat, TLS `verify-full` dengan CA terpercaya, least privilege dan rotasi kredensial, tidak ada koneksi production, hanya data sintetis, dan residual risk/response yang diterima. Jangan simpan kredensial di repo atau laporan.
6. Bukti setelah operasi bahwa penggunaan dan biaya tidak bertambah ke tier berbayar/overage. Tanpa cara memverifikasi itu sebelum operasi, syarat Rp0 tidak dapat dibuktikan.

## Lineage dan data yang tidak diklaim

- Tidak ada branch baru untuk dibandingkan dengan root project.
- Tidak ada `parent_id`, `init_source`, atau event create baru untuk ditafsirkan.
- Tidak ada catalog query sehingga tidak ada klaim `empty`, `clean`, atau `stagingIsolationVerifiedEmpty=true`.
- Tidak ada data pengguna yang disalin atau dimasukkan. Tidak ada operasi copy yang dilakukan.
- Fallback yang telah terverifikasi adalah rehearsal PostgreSQL 18 disposable dengan data sintetis pada run `38699617221`; itu adalah bukti pengujian lokal/CI, **bukan** staging Neon yang dideploy.

## Rujukan internal

- [Neon pricing](https://neon.com/pricing)
- [Neon project consumption history API](https://api-docs.neon.tech/reference/getconsumptionhistoryperprojectv2)
- [Neon project creation API](https://api-docs.neon.tech/reference/createproject)
- [Neon branches API](https://api-docs.neon.tech/reference/listprojectbranches)
- [Neon IP Allow](https://neon.com/docs/introduction/ip-allow)
- [Neon protected branches](https://neon.com/docs/guides/protected-branches)
- [Neon Private Networking](https://neon.com/docs/guides/neon-private-networking)
