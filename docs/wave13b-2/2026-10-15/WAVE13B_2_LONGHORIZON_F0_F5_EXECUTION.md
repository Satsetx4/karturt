# Wave 13B.2 — F0–F5 Long-Horizon Execution Record

Tanggal: 2026-10-15

Status: **F0 lineage PASS secara kontrak; F1 operator siap; F2–F5 belum GO**

Dokumen ini melanjutkan dan memperbarui catatan owner-correction sebelumnya. Bukti yang tidak berubah tetap di catatan historis; status pada dokumen ini menjadi status terbaru setelah review lineage independen. Lulus lineage hanya menjawab asal branch; itu bukan bukti katalog kosong, isolasi tenant, atau izin migrasi.

## Batas tindakan yang dikunci

- Fitur provider harus tetap pada Free. Tidak ada pembelian, upgrade, overage, add-on, atau fitur berbayar.
- Endpoint Neon publik diterima owner hanya untuk data sintetis, dengan password kuat yang ditangani privat, CA tepercaya, TLS `sslmode=verify-full`, dan role least-privilege.
- Dua staging lama `falling-bread-33359184` dan `wild-art-99835126` tidak disentuh.
- Tidak ada mutasi production, DNS, env production, deployment production, merge ke `main`, atau perubahan pada 15 blob migrasi.
- Persetujuan query read-only harus baru, eksplisit, dan terikat ke target, query bytes/hash, CA, expected-state, dan source SHA ini. Persetujuan D1v2 untuk project lama tidak berlaku.
- Private Ed25519 key tidak dibuat atau dipegang agent. Migrasi hanya dapat dijalankan setelah trust anchor dan artefak owner-signed yang asli diverifikasi oleh runner fail-closed.

## F0 — identitas target dan lineage

Readback provider mengikat target berikut:

| Field | Nilai yang dibaca |
|---|---|
| Neon Free project | `karturt-v1-synthetic-staging-20261015`, `broad-star-40451875` |
| Organization | `org-ancient-boat-57106549` |
| Engine / region | PostgreSQL 18 / `aws-ap-southeast-1` |
| Branch default/primary | `main`, `br-orange-recipe-azed9f78` |
| Endpoint | `ep-mute-firefly-azjcru4h` |
| Direct hostname | `ep-mute-firefly-azjcru4h.c-3.ap-southeast-1.aws.neon.tech` |
| Database | `neondb`, ID `708081` |
| Role yang tersedia | `neondb_owner` saja; runtime/migration role belum ada |
| Tanggal create project/branch | `2026-10-15T11:04:56Z` |

Metadata endpoint juga memuat `passwordless_access=true`, tetapi OpenAPI Neon menandai field create/update tersebut **NOT YET IMPLEMENTED**; field itu tidak dijadikan kontrol akses. Alur browser `pg.neon.tech` adalah fitur passwordless terpisah dan tidak dipakai operator. Akses langsung tetap memakai PGPASSFILE privat dan TLS `verify-full` ([Neon Passwordless auth](https://neon.com/docs/connect/passwordless-connect)).

Agent A melakukan review provider dan kontrak secara independen. Putusan: **PASS untuk lineage root/non-clone berdasarkan kontrak pembuatan proyek baru**, dengan bukti yang tersedia:

1. Request `POST /projects` yang disanitasi membuat project baru dan tidak mengirim source project/branch, parent, clone, import, atau restore.
2. Kontrak API Neon membuat initial branch bersama project. Dokumentasi branch Neon menyatakan setiap project dibuat dengan root branch yang sekaligus default; root dari API/CLI bernama `main`.
3. Branch `main` adalah primary/default dan memiliki timestamp create yang sama dengan project. Daftar termasuk deleted hanya menunjukkan branch tersebut.
4. Riwayat operasi sejak create menunjukkan pembuatan timeline dan pengelolaan compute/config; tidak ada operasi create-branch, import, atau restore.

`parent_id` tidak dikembalikan oleh API dan wajib direpresentasikan sebagai **OMITTED / NOT RETURNED**, bukan `null`. `init_source=parent-data` tetap disimpan sebagai observasi mentah yang maknanya untuk initial root tidak dijelaskan kontrak. Metadata `creation_source=console` tidak dipakai untuk menyimpulkan parent. Bukti langsung request create dan kontrak create-project menjadi dasar attestation `ROOT_BY_NEW_PROJECT_CREATE_CONTRACT`.

Rujukan kontrak resmi: [Neon branch model](https://neon.com/docs/manage/branches), [Create project API](https://neon.com/docs/reference/api/projects/create-project), [Get project branch API](https://neon.com/docs/reference/api/branches/get-project-branch), dan [Create project branch API](https://neon.com/docs/reference/api/branches/create-project-branch).

Metadata review F0: readback Agent A pada `2026-10-15 12:32:42 UTC`; reviewer `Codex Agent A (f0_neon_lineage)`; SHA-256 ringkasan bukti tersanitasi `dc97064182562fb2b86d7bb1d7bee9ba0c7f5d175f943f44fb4501fb9a557530`. Hash ini checksum ringkasan reviewer, **bukan** signature atau bukti yang diterbitkan Neon. Rujukan request-create/provisioning tersanitasi ada di [owner-correction report commit `f8cf71c251b87b8c37d141dc2f0e40e650797462`](https://github.com/Satsetx4/karturt/blob/f8cf71c251b87b8c37d141dc2f0e40e650797462/docs/wave13b-2/2026-10-15/WAVE13B_2_OWNER_CORRECTION_EXECUTION.md). Tidak diperlukan aksi owner tambahan untuk lineage; approval owner tetap diperlukan untuk query katalog dan migrasi.

**Batas putusan F0:** ini tidak menilai isi database. Katalog tetap **UNKNOWN** sampai query read-only target-specific dijalankan dan hasilnya ditinjau. Jangan mengubah `stagingIsolationVerifiedEmpty=false` hanya berdasarkan F0.

## F1 — persiapan operator

Paket operator offline dan guard source sudah disiapkan pada branch `codex/karturt-v1-staging-activation-20261015`, berbasis RC yang direview. Paket mematok project/branch/endpoint/hostname/database/role di atas, mempertahankan penolakan dua target staging lama, memakai direct hostname dengan `sslmode=verify-full`, dan tetap memblokir runtime. Preflight Windows memeriksa Git/source SHA, 15 blob migrasi, query/expected-state/target JSON, versi PostgreSQL 18 `psql`, CA hash, owner-only `PGPASSFILE`, reparse points, trust anchor, signature, dan masa berlaku. Runner tidak menghubungi database dan tidak menjalankan SQL.

Verifier menolak source/target/query/CA/expected-state yang berubah, key tidak tepercaya, signature salah, approval kedaluwarsa, atau artefak/path yang tidak aman. Trust root reviewer F0 tercatat eksplisit; ini bukan approval SQL. Private key owner tidak dibuat atau dipegang. Keempat belas migrasi SQL dan journal dibandingkan terhadap baseline dan tidak berubah; public key approval migrasi tetap `null` dan `stagingIsolationVerifiedEmpty=false`.

Hash SHA-256 hasil readback paket: query katalog `987570baee76c2affef4a3f68c2ae114b3007174004d070232908c82f513751e`; verifier approval `e723f6859f446f5a499b91f9b211b1a44715df329ecf8e0e7f02f4a8727d8784`; local preflight `99da86d874201e1eeb603649d61a5e8ae86de8948fb8d1f2201b8e125ea15ecc`. Sumber akhir adalah branch `codex/karturt-v1-staging-activation-20261015`, SHA `813ea44ffed4a025b49f51c3216ed6e7ea9eb2d0`. Pada SHA tersebut, `npm ci`, lint (0 error, 2 warning legacy), typecheck, full Vitest (81 file / 596 test), `npm run db:check:offline`, production build, dan `git diff --check` lulus. Gate A exact-SHA PASS: run `38741892245`, job `116445427672`; PG17 independent concurrency PASS pada job `116450032848`; PG18 disposable migration rehearsal PASS: run `38741891824`, job `116445425727`. Ketiganya menguji SHA `813ea44ffed4a025b49f51c3216ed6e7ea9eb2d0`. Percobaan awal pada SHA `76fc8d71d91a543147b9e0c3448068a691314135` gagal sebelum SQL disposable dijalankan karena ref branch belum diizinkan guard; commit final menambahkan ref terbatas tersebut dan ketiga workflow guard test lulus. Run awal `38741057580`/`38741057724` bukan bukti PASS dan digantikan run exact-SHA di atas.

Monitoring dependency tetap pada keputusan owner: `npm audit` saat ini menemukan advisory high `GHSA-vfj7-8cjw-p6xm` pada lima node dependency development. Statusnya tetap **temporary accepted sampai 2026-11-14**; advisory tidak disembunyikan, di-suppress, atau disebut patched. Tidak ada perubahan dependency/major downgrade dalam eksekusi ini.

Syarat operator lokal yang belum tersedia pada workstation saat pemeriksaan terakhir: PostgreSQL 18 `psql`, `PGPASSFILE` owner-only, `PGSSLROOTCERT` berisi CA tepercaya, serta approval query target-spesifik. Tidak ada koneksi atau SQL yang dijalankan. Jangan salin password, connection string, atau private key ke chat, repo, atau log.

## F2–F5 — keputusan saat ini

| Gate | Status | Alasan dan bukti yang diperlukan untuk maju |
|---|---|---|
| F2 read-only catalog | **BLOCKED sebelum SQL** | Belum ada `psql`/CA/PGPASSFILE lokal dan belum ada persetujuan owner baru yang ditandatangani untuk exact target/query/source SHA/expected-state. Status katalog tetap UNKNOWN. Setelah seluruh syarat tersedia, owner/operator menjalankan query yang sudah di-hash tepat sekali dan membandingkan hasil tersanitasi dengan baseline independen. |
| F3 migrations + roles | **BLOCKED** | Belum ada katalog CLEAN, runtime/migration role, trust anchor publik yang ditinjau, atau artefak Ed25519 owner-signed yang genuine dan one-time. `stagingIsolationVerifiedEmpty=false`; pinned public key tetap null. Tidak ada migrasi atau SQL role. |
| F4 protected Vercel preview | **NOT DEPLOYED** | Neon belum terverifikasi/migrasi, tidak ada credential runtime, dan deployment count staging masih nol. Tidak ada deployment. Konfigurasi yang boleh dipakai harus Vercel Authentication gratis pada project preview staging saja; password protection/add-on berbayar dilarang. Plan team belum dapat dibuktikan lewat readback. |
| F5 V1 acceptance | **NOT ACCEPTED** | Tidak ada preview/live synthetic DB untuk diuji. QA browser/device dan alur end-to-end yang butuh DB harus tetap NOT RUN/BLOCKED. Tes source dan rehearsal disposable pada exact SHA bukan acceptance atas aplikasi terdeploy atau catalog/role Neon. |

### Hasil QA independen pada RC sebelumnya

Agent C menyelesaikan review read-only pada source RC SHA `0b1e3f525039496200b2bb5f698d312ded5cb3e3`. Gate A run `38699617335` / job `116304347197` dan PG18 disposable rehearsal run `38699617221` / job `116304346369` sukses pada SHA itu. Tabel berikut merangkum cakupan dan batas review Agent C pada RC; Gate A, PG17, PG18 dan full test exact-SHA aktivasi terbaru tercatat terpisah pada F1 dan ledger. Tidak satu pun hasil tersebut membuktikan isi katalog Neon atau aplikasi yang terdeploy.

| Area | Bukti pada RC | Batas dan status penerimaan |
|---|---|---|
| Reversal dan rollback aplikasi | `tests/integration/payment-reversal.test.ts` menguji reversal transfer penuh, multi-bulan, serialisasi concurrent, rollback saat audit gagal, role/RT denial. | PASS di synthetic fixture CI; bukan Neon/preview. |
| Billing temporal, tunggakan, laporan | `tests/integration/billing-generator.test.ts`, `tests/integration/resident-payment-request.test.ts`, `tests/unit/reports-aggregation.test.ts`, dan `tests/authorization/chairman-reports.test.ts` mencakup batas bulan Asia/Jakarta, periode lalu/saat ini/depan, rollover, arrears, bulanan/tahunan/household, serta akses report lintas RT. | PASS di level service/route/test DB pada RC; belum ada preview/live DB. |
| Pembayaran parsial | Endpoint resident dan kasir memakai schema Zod `.strict()` dan menghitung/mengalokasikan seluruh outstanding terpilih; nominal bebas tidak diterima. | **Tidak didukung.** Jika pembayaran parsial tetap menjadi acceptance requirement V1, F5 BLOCKED sampai kontrak produk dan implementasinya berubah atau owner secara eksplisit menghapus syarat itu. |
| Isolasi dua RT, peran, session, auth | Permission/report/recovery route tests dan PG18 synthetic FK rehearsal menguji tenant boundary; auth tests mencakup TOTP, inactive/stale session, lockout, cookie/session fixation, dan role denial. PG17 concurrency job `116307663761` sukses. | PASS pada app/test harness dan DB disposable; bukan bukti ACL, role, atau catalog Neon. |
| Backup/restore dan migration failure | `scripts/pg18-migration-rehearsal.ts` menjalankan `pg_dump`/`pg_restore` atas fixture sintetis dan memeriksa ledger/katalog/row count; run PG18 mencatat `pgDumpRestore=PASS`, `restoreDatabaseCleanup=PASS`. Harness juga memeriksa rollback terinjeksi. | PASS pada disposable PG18; backup/recovery Neon belum dijalankan. |
| CSRF | `tests/integration/security-closure-csrf-browser.test.ts` menjalankan Chromium headless dua-origin dan membuktikan financial/system-admin POST ditolak 403 tanpa perubahan state. | PASS pada localhost CI harness; belum diuji pada URL preview atau perangkat. |
| Accessibility/responsif | Ada focus outline, reduced motion, ARIA/label, dan sebagian target 44px di source. | **NOT RUN** untuk axe/WCAG, 360–420 px, tablet, desktop, dan horizontal overflow; tidak ada preview/device bukti. |
| PWA offline | `tests/unit/pwa-manifest.test.ts` memverifikasi manifest installable dan sengaja memastikan tidak ada service worker/precache bagi halaman data resident sensitif. | Installability manifest PASS; **offline tidak didukung**. Jika F5 mewajibkan offline, blokir acceptance atau minta perubahan scope/produk. |

Readback Vercel terbaru: project `karturt-review-staging-20261012` belum memiliki domain atau deployment (`latestDeployment=null`, deployment list kosong). Vercel Authentication/SSO tercatat aktif dengan `deploymentType=all`; password protection dan trusted-IP protection nonaktif. Project dedicated staging ini belum dipakai untuk preview; scope `all` harus diperiksa pada deployment pertama. Plan team tidak terekspos oleh readback, jadi tetap **UNVERIFIED**. Dokumentasi Vercel menyatakan Vercel Authentication/Standard Protection tersedia tanpa biaya; Password Protection tidak termasuk gratis ([ketersediaan Deployment Protection](https://vercel.com/docs/deployment-protection), [pengumuman proteksi gratis](https://vercel.com/changelog/protect-production-deployments-for-free-on-every-plan)). Repository GitHub berstatus public dan workflow menggunakan standard `ubuntu-latest`; GitHub menyatakan standard hosted runners pada public repositories tidak dikenai biaya ([GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)). Tidak ada fitur berbayar yang diaktifkan atau dipakai.

## Aksi owner yang tepat untuk membuka gerbang berikutnya

1. Pada workstation owner, siapkan PostgreSQL 18 `psql`, CA bundle resmi dengan fingerprint tercatat, dan direktori privat dengan ACL owner-only untuk `PGPASSFILE`; jangan letakkan artefak ini dalam repo.
2. Secara privat tetapkan/rotasi password kuat untuk role `neondb_owner` yang digunakan hanya untuk inspeksi katalog read-only yang disetujui. Pertahankan koneksi direct hostname dan `sslmode=verify-full`; jangan kirim secret kepada agent.
3. Tinjau dan tandatangani approval query katalog read-only yang mengikat target project `broad-star-40451875`, branch `br-orange-recipe-azed9f78`, endpoint `ep-mute-firefly-azjcru4h`, hostname direct, database `708081`/`neondb`, role `neondb_owner`, query hash, CA fingerprint, expected-state, serta source SHA `813ea44ffed4a025b49f51c3216ed6e7ea9eb2d0`. Persetujuan lama tidak dapat dipakai ulang.
4. Jalankan hanya query read-only melalui runner psql yang sudah disiapkan. Kirim hasil tersanitasi untuk review object/type/ACL/journal. Jika hasil bukan persis expected empty baseline atau ada ketidakpastian, berhenti tanpa DDL.
5. Setelah F2 CLEAN dan review independen, owner menetapkan role runtime dan migration secara terpisah melalui izin eksplisit target-bound. Owner membuat trust anchor signing dan artefak migrasi Ed25519 one-time, berumur paling lama 15 menit, terikat exact source dan fingerprint 15 blob. Jangan pernah menyerahkan private key.
6. Hanya setelah artefak tersebut lulus verifier dan owner memberi go persis untuk migrasi target ini, operator dapat menerapkan migrasi sekali. Setelah itu, jalankan validasi constraints, tenant isolation, runtime privilege, dan rollback sebelum menyiapkan preview.
7. Vercel Preview dan QA browser/mobile baru dapat dimulai setelah role/env staging aman dan seluruh F2/F3 PASS. Jangan sentuh domain atau production.

Jika operator host belum dapat memenuhi langkah 1–3, status tetap berhenti **sebelum SQL**; lanjutkan hanya pekerjaan source/docs yang tidak membutuhkan akses tersebut.

## Evidence ledger final

- Source branch dan exact SHA: `codex/karturt-v1-staging-activation-20261015` / `813ea44ffed4a025b49f51c3216ed6e7ea9eb2d0`
- Local install/lint/typecheck/full suite/Drizzle check/build: **PASS** pada SHA `813ea44ffed4a025b49f51c3216ed6e7ea9eb2d0` (81 file / 596 test; lint 0 error dan 2 warning lama)
- Gate A exact-SHA: run `38741892245`, https://github.com/Satsetx4/karturt/actions/runs/38741892245 — **PASS** (job `116445427672`)
- PG17 concurrency exact-SHA: job `116450032848`, https://github.com/Satsetx4/karturt/actions/runs/38741892245/job/116450032848 — **PASS**
- PG18 rehearsal exact-SHA: run `38741891824`, https://github.com/Satsetx4/karturt/actions/runs/38741891824 — **PASS** (job `116445425727`)
- Catalog verdict/result hash: **UNKNOWN; SQL belum dijalankan**
- Migration and runtime role verdict: **BLOCKED; belum dijalankan**
- Vercel preview URL/status: **NOT DEPLOYED**
- Browser/device/E2E acceptance: **BLOCKED / NOT RUN**
- `origin/main`: harus tetap `96c84588ae0c13f68a17cffd997a3e583fb7da82`
