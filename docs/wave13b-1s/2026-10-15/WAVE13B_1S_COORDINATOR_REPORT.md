# KartuRT V1 Wave 13B.1S — Coordinator Report

Tanggal: 2026-10-15
Status RC: **RC_PARTIAL — EXACT-SHA GATES PASS; DEV TOOLCHAIN AUDIT OPEN**
Status D1v2: **NOT_EXECUTED_ACCESS_SAFETY_BLOCKED**

## Tujuan dan batas

Wave ini mengintegrasikan delta laporan PR #57 secara selektif ke source Wave13A.2 yang diterima, menjalankan pemeriksaan independen pada satu source SHA final, menyiapkan kesiapan operator D1v2 secara offline, dan menerbitkan bukti pada branch dokumentasi terpisah. Tidak ada merge ke `main`, DDL/migrasi staging, mutasi produksi, atau aktivasi runtime.

Tiga agen paralel memakai worktree terisolasi: Agent A integrasi source, Agent B kesiapan D1v2 offline, dan Agent C QA independen. Coordinator melakukan integrasi, pemeriksaan remote, dan penyusunan tujuh dokumen.

## Referensi dan ancestry

| Referensi | SHA |
|---|---|
| `main` baseline, dibaca ulang sebelum publikasi | `96c84588ae0c13f68a17cffd997a3e583fb7da82` |
| Wave13A.2 security source | `48b92abbe93fbd499448b6c885d3042cb49c2128` |
| PR #23 — head/base saat audit | `344952c0a41342dea77989d5b9aa6fdb503a78e6` / `main` |
| PR #48 — head/base saat audit | `12539d83b8537d845015a2b0030d47162dae0203` / PR #23 |
| PR #57 — head/base saat audit | `ddb9689b34ea3ee1373ee328952c279544758c15` / PR #48 |
| Commit integrasi PR #57 terpilih | `5fbe3dbc2c60659d6be711013a824024ae81c55` |
| Commit koreksi validator branch PG18 | `44e8c65ced38fc4b31cb492908e603efe2e8d2f3` |
| Commit pemisahan validator PG17/PG18 | `9cad8f899ca5178622f5858854b60572c94ac729` |
| Commit allowlist dua ref eksplisit dan tes | `193b25be6394db9196c22617e9b55b4427cf6f86` |
| Docs base yang dipatok | `512e95d7be1722194cc8540debdbcf11691c2fd9` |
| Final source RC | `193b25be6394db9196c22617e9b55b4427cf6f86` |

PR #23 dan #48 sudah menjadi ancestor source keamanan. PR #57 memiliki enam commit unik dan divergen; delta delapan file ditinjau lalu digabungkan dengan commit dua-parent yang mempertahankan source security sebagai parent pertama dan head PR #57 sebagai parent kedua. Koreksi CI setelahnya menjaga validator PG18 khusus dan memakai validator PG17 tersendiri untuk concurrency Gate A.

## Hasil verifikasi

| Gate | Status | Bukti |
|---|---|---|
| Integrasi PR #57 pada source Wave13A.2 | PASS | Commit `5fbe3db`; security SHA first parent, PR #57 second parent. Tidak ada cherry-pick seluruh sejarah PR. |
| QA independen pada SHA final | PASS | 80 file / 580 tes; lint 0 error dan 2 warning lama; typecheck, `db:check:offline`, drift generation tanpa perubahan, build 18 static routes, dan `git diff --check` lulus. |
| Gate A dan concurrency PG17 pada SHA final | PASS | [Run 38678563048](https://github.com/Satsetx4/karturt/actions/runs/38678563048); seluruh suite lulus. Job concurrency `116239687016` menjalankan initializer dan proof serta berstatus success, bukan skipped. |
| PostgreSQL 18 rehearsal pada SHA final | PASS | [Run 38678563005](https://github.com/Satsetx4/karturt/actions/runs/38678563005); identitas run, journal apply/verify, dan fixture migrasi sintetis lulus di container disposable. |
| Audit dependensi penuh | PARTIAL | 5 advisory high hanya pada dependency dev; `npm audit --omit=dev` bersih. npm hanya menawarkan perubahan lintas major ke `eslint-config-next@14.2.35` dari versi saat ini `16.3.8`; manifest tidak diubah. Rincian dan next action ada di laporan Agent C. |
| Preservasi 15 blob migrasi/journal dan guard | PASS | 15/15 blob SHA-1 sama dengan security baseline; `stagingIsolationVerifiedEmpty=false` dan `PINNED_STAGING_MIGRATION_APPROVAL_PUBLIC_KEY_PEM=null` tidak berubah. Hash per berkas ada di matriks integrasi. |
| D1v2 | NOT EXECUTED — ACCESS/SAFETY BLOCKED | Tidak ada koneksi, SQL, wake, atau perubahan provider. `psql`, CA `verify-full`, PGPASSFILE owner-only yang dapat diverifikasi, dan baseline expected-state belum tersedia. |
| Neon / Vercel / main | Tidak dimutasi | Tidak ada operasi Neon baru sejak operasi historis pada 14 Oktober; kedua endpoint tetap idle. Proyek Vercel staging `live=false`, `latestDeployment=null`, nol deployment, dan tidak tertaut ke repo KartuRT. `main` tetap pada baseline. |

Gate A run `38677367101` pada parent `44e8c65` sebelumnya gagal tertutup karena initializer concurrency PG17 memakai validator identitas khusus rehearsal PG18; proof concurrency menjadi skipped. Perbaikan memisahkan validator dan tesnya. Run pengganti `38678563048` pada SHA final sukses pada semua langkah.

## Branch dan publikasi

- Source: `codex/karturt-v1-rc-wave13b1s-20261015` — remote readback `193b25be6394db9196c22617e9b55b4427cf6f86`.
- Verification: `verify/karturt-v1-rc-wave13b1s-20261015` — remote readback menunjuk SHA source yang sama.
- Docs: `docs/wave13b-1s-rc-operator-readiness-20261015`, dibuat dari base `512e95d7be1722194cc8540debdbcf11691c2fd9`; tujuh laporan dan preflight offline dipush setelah review.
- `main` tidak menerima merge; PR #23/#48/#57 tetap terbuka dan draft pada head yang dipatok.

## Batas hasil dan owner action

D1v2 tidak dijalankan karena prasyarat keselamatan belum lengkap; status tersebut bukan hasil bersih, kotor, atau tidak diketahui dari katalog. Owner perlu menyediakan baseline expected-state yang disetujui, memasang PostgreSQL 18 `psql` dan CA tepercaya, serta menyiapkan PGPASSFILE owner-only secara lokal. Coordinator harus membaca ulang target tanpa wake tepat sebelum satu transaksi yang telah disetujui; jika identitas atau prasyarat berbeda, berhenti.

Lima advisory high dev-only belum memiliki perbaikan non-major yang dilaporkan oleh npm. Owner perlu menyetujui arah upgrade toolchain yang kompatibel sebelum klaim audit dependency penuh bersih; tidak ada upgrade otomatis atau downgrade yang dilakukan. Karena itu verdict wave adalah `RC_PARTIAL` walaupun semua test/build/concurrency/PG18 gates yang diminta lulus.

Guard `stagingIsolationVerifiedEmpty=false` dan pinned approval key `null` tetap dipertahankan. Hasil D1v2 pun tidak akan membuktikan lineage independen atau pengosongan fisik; D3 tetap NO-GO sampai lineage/isolation positif, role/network aman, SHA dan migration hash final disetujui, serta artefak Ed25519 one-time owner-signed diverifikasi.

## Riwayat rehearsal yang superseded

Pada SHA `5fbe3dbc2c60659d6be711013a824024ae81c55`, rehearsal PG18 `38676750668` gagal tertutup pada validasi branch sebelum penerapan journal dan fixture; keduanya skipped. Pada SHA `193b25be`, [run pengganti PG18 38678563005](https://github.com/Satsetx4/karturt/actions/runs/38678563005) lulus lengkap. Tidak ada run tersebut yang menyentuh Neon.
