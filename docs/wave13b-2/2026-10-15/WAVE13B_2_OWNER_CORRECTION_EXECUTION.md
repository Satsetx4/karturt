# Wave 13B.2 — Latest Owner Correction Execution

Tanggal: 2026-10-15
Status: **FREE PROJECT CREATED; OPERATOR KIT REVIEWED AND PUBLISHED; DATABASE ACCESS AND MIGRATION STOPPED**

> Dokumen ini adalah catatan status terbaru dan menggantikan kesimpulan pra-provisioning di laporan, paket gerbang, dan bukti lineage sebelumnya pada direktori ini. Berkas lama dipertahankan sebagai snapshot historis; jangan jalankan ulang atau gunakan hasil gate pra-create tersebut untuk mengizinkan SQL.

## Keputusan dan ruang lingkup owner

Koreksi owner terbaru menetapkan fitur Free saja untuk Neon, Vercel, GitHub, dan layanan lain. Jangan upgrade, mengaktifkan fitur berbayar/overage, membeli add-on, atau mengandalkan IP Allow, Private Networking, password protection, atau Protected Branches yang tidak tersedia pada paket Free. Owner menerima endpoint Neon publik sebagai risiko sisa untuk staging data sintetis saja, dengan syarat password kuat, TLS `verify-full`, dan hak minimum dipenuhi sebelum akses client. Belum ada kredensial atau runtime role yang disiapkan maupun divalidasi. Owner menyetujui tepat satu project Free baru serta persiapan jalur operator. Koreksi ini membatalkan syarat audit invoice/konsumsi akun secara menyeluruh sebagai prasyarat, tetapi tidak membenarkan klaim pemakaian atau biaya akun Rp0.

Tidak ada tindakan pada production, project staging lama, DNS, deployment production, secret production, branch `main`, atau 15 blob migrasi yang dipatok. Tidak ada SQL, koneksi database, pembuatan role, DDL, atau migrasi yang dijalankan pada project baru.

## Hasil Neon yang telah dibuktikan

| Fakta | Bukti/status |
|---|---|
| Organisasi dan plan | `satset`, `org-ancient-boat-57106549`, Free (`free_v3`) |
| Project baru | `karturt-v1-synthetic-staging-20261015`, ID `broad-star-40451875` |
| Sebelum/sesudah | Jumlah project berubah dari 5 menjadi 6; batas Free yang dipublikasikan 100, jadi 94 slot jumlah project tersisa saat readback |
| Engine dan region | PostgreSQL 18, `aws-ap-southeast-1` (Singapore) |
| Branch dan endpoint | Branch `main`, ID `br-orange-recipe-azed9f78`; endpoint `ep-mute-firefly-azjcru4h`, `read_write`, `idle` pada readback 11:10:02Z, min/max 0.25 CU |
| Pemakaian resource project | Counter provider yang dibaca: written bytes, compute time, active time, dan transfer 0; logical size 31,686,656 bytes (~30.2 MiB). Dibanding limit 1 GB/project, ini sekitar 3.2% dari batas project; angka ini bukan bukti katalog kosong. |
| Operasi provider | Create project sukses pada `2026-10-15T11:04:56Z`; response tidak memberikan operation ID create-project. Timeline operation `f46e5430-e4cb-450d-ac9a-646ba3bc8b48` bertipe `create_timeline` selesai pada `2026-10-15T11:04:58Z`; ini bukan operation ID create-project. |
| Isi request | Request sukses berisi nama, org, region Singapore, PG18, dan compute min/max 0.25. Tidak menyertakan sumber project/branch, parent, clone, import, atau restore; tidak memanggil API get-connection-string. |
| Secret dan role | Tidak ada connection URI/password yang diambil, disimpan, atau dimasukkan ke laporan/repo. Readback role hanya menunjukkan `neondb_owner`; role runtime least-privilege belum dibuat. Endpoint metadata `passwordless_access=true` didokumentasikan Neon sebagai “not yet implemented”; role tetap melaporkan autentikasi password. |
| Endpoint publik | `allowed_ips=[]`, `block_public_connections=false`. Ini Free residual yang diterima owner hanya untuk target sintetik. Tidak ada paid network control yang digunakan. |
| Auto-suspend | Endpoint readback `suspend_timeout_seconds=0`; OpenAPI Neon menerangkan 0 menggunakan default plan. Dokumentasi endpoint memberi default 300 detik. Endpoint kemudian terbaca `idle` pada 11:10:02Z, konsisten dengan scale-to-zero. |

### Status lineage dan katalog

Request create yang disanitasi membuktikan bahwa tidak ada sumber clone/import/restore/parent yang dikirim. Neon `get_branch`/`list_branches` tidak mengembalikan `parent_id`; ia menunjukkan `init_source=parent-data`. Pembacaan metadata independen tambahan pada `2026-10-15T11:16:22Z` kembali memberi hasil yang sama. Karena field parent tidak terbukti bernilai eksplisit null dan informasi init itu ambigu, status **root lineage: UNVERIFIED**. Jangan menyebut branch sebagai terbukti `parent_id=null`.

Workstream ini tidak membuat client database connection, menjalankan SQL, atau menginspeksi katalog. Status katalog **UNKNOWN**, bukan empty/clean. Project yang baru dibuat bukan bukti katalog kosong. `stagingIsolationVerifiedEmpty=false` dan `PINNED_STAGING_MIGRATION_APPROVAL_PUBLIC_KEY_PEM=null` tetap fail-closed. Tidak ada migration key atau owner private key yang diminta/ditangani.

## Batas paket Free dan layanan lain

Neon mempublikasikan Free: 100 project, 1 GB Postgres storage/project (maksimum 20 GB lintas project), 100 CU-hours/project/bulan, compute sampai 2 CU, 10 branch/project, 5 GB public transfer/project/bulan, dan scale-to-zero setelah 5 menit idle. Pada batas compute 0.25 CU, allowance 100 CU-hours setara 400 jam compute aktif dalam sebulan. Batas project yang baru dibuat terukur cukup longgar untuk sampel sintetis kecil: kira-kira 97% dari batas storage project masih tersisa; endpoint idle setelah dibuat. Batas publik bukan bukti penggunaan akun lain atau invoice; total storage headroom akun tidak terekspos oleh metadata yang dibaca dalam review ini. Itu tidak menghalangi project create yang telah disetujui, tetapi workload harus tetap kecil dan dihentikan sebelum memerlukan limit di luar Free. Jangan ubah tier atau mengaktifkan overage.

Vercel staging project `karturt-review-staging-20261012` (`prj_Mv4rABJvDNAvSD78SVt5WbjFakEq`) tetap belum memiliki deployment. Plan untuk team pemilik proyek tidak terekspos oleh readback dan karena itu **UNVERIFIED**. Tidak ada deployment dibuat karena database belum dimigrasikan, katalog belum diverifikasi, dan plan Free belum dibuktikan. Tidak digunakan password protection atau fitur berbayar. Pertimbangkan Preview hanya setelah plan target terbukti Free/Hobby dan database prasyarat terpenuhi; jangan deploy ke production.

GitHub public-repository ruleset readback menunjukkan PR wajib, Gate A wajib, dan 0 required approvals. Ruleset ini berada dalam lingkup fitur repo publik Free; tidak ada paid protected-branch add-on yang digunakan. Branch `main` tetap pada `96c84588ae0c13f68a17cffd997a3e583fb7da82`. Belum ada perubahan aplikasi, jadi bukti CI RC yang ada tetap terikat hanya pada source SHA `0b1e3f525039496200b2bb5f698d312ded5cb3e3`.

## Operator path dan gerbang berikutnya

Paket operator Free-only lulus tinjauan statis independen dan dipublikasikan pada branch persiapan berbasis source RC `codex/karturt-free-stage-operator-20261015`, commit `63553f8e4b7f02cfdf78fc251006ffd39c34027f`. Paket berisi prosedur owner, query katalog read-only, target manifest dan expected-state template, verifier Ed25519 offline, serta ignore rules khusus Wave 13B.2. [Lihat packet operator](https://github.com/Satsetx4/karturt/blob/63553f8e4b7f02cfdf78fc251006ffd39c34027f/docs/codex/Wave-13B2-Free-Only-Staging-Operator-Packet-2026-10-15.md) atau [commit paket operator](https://github.com/Satsetx4/karturt/commit/63553f8e4b7f02cfdf78fc251006ffd39c34027f).

- Hash SQL: `987570baee76c2affef4a3f68c2ae114b3007174004d070232908c82f513751e`; hash verifier: `d079d385f98ad51bcaece7f12025241ea4841af5a747cbabc3b15b4e8acab5ec`.
- Tinjauan statis mengonfirmasi approval mengikat file query, source SHA, target provider, CA, dan expected-state; query memeriksa TLS `verify-full` dan menolak truncation. Tipe enum/domain/base/range/composite aplikasi yang tertinggal menggagalkan baseline kosong; tipe ekstensi, array otomatis, dan tipe baris relasi dibedakan untuk tinjauan manual.
- Validasi format JSON, sintaks Node/PowerShell, pinned hashes, dan `git diff --check` lulus. Perubahan source aplikasi dan `drizzle/` kosong. PostgreSQL 18 `psql` belum tersedia pada workstation ini.
- Tidak ada query/koneksi database yang dijalankan. Root lineage tetap UNVERIFIED, katalog UNKNOWN, dan approval owner belum ditandatangani.

Paket ini belum dapat dipakai sampai gerbang berikut terpenuhi:

1. PostgreSQL 18 `psql` resmi lokal, tanpa menyalakan server lokal; CA tepercaya; koneksi wajib `sslmode=verify-full`. Client tersebut belum terpasang pada workstation ini.
2. Owner menetapkan/merotasi password kuat secara privat pada Neon Console dan menyimpannya dalam file owner-only di luar repo/chat/log. Jangan memakai koneksi tanpa password atau menerbitkan connection string.
3. Tetapkan runtime role least-privilege secara terpisah hanya setelah ada izin target-spesifik yang mencakup operasi role tersebut. Jangan jalankan sebagai `neondb_owner` untuk operasi aplikasi.
4. Minta bukti provider yang secara eksplisit menunjukkan root branch tanpa parent, atau dokumentasikan bahwa provider tidak mengekspos bukti tersebut. Jangan menganggap project baru atau `init_source` cukup.
5. Sebelum query katalog, siapkan fixed query packet yang di-hash dan target manifest untuk project/branch/endpoint/database/role, expected-state baseline independen, serta persetujuan owner baru yang eksplisit dan terikat pada semua ID itu, query hash, dan source SHA. Persetujuan D1v2 lama untuk `falling-bread-33359184` tidak dapat dipakai ulang.
6. Jangan jalankan DDL/migrasi sampai root lineage dan katalog kosong dibuktikan independen, trust anchor publik Ed25519 ditinjau, dan owner menandatangani satu kali artefak approval di luar agent. Jangan mengisi public-key pin, membalik flag, atau memintas guard dalam pekerjaan ini.

Dengan API branch yang tidak mengembalikan `parent_id`, bukti root independen masih menjadi blocker aktual. Bila tak ada endpoint metadata Free yang bisa membuktikan nilai tersebut, berhenti dan minta owner menilai jalur Free alternatif yang dapat menunjukkan lineage sebelum SQL. Tidak ada downgrade ke fitur berbayar.

## Bukti source dan risiko yang diterima

- RC branch `codex/karturt-v1-rc-quality-wave13b1t-20261015`, [SHA `0b1e3f525039496200b2bb5f698d312ded5cb3e3`](https://github.com/Satsetx4/karturt/commit/0b1e3f525039496200b2bb5f698d312ded5cb3e3).
- [Gate A run `38699617335`](https://github.com/Satsetx4/karturt/actions/runs/38699617335) sukses pada SHA tersebut: 583 test / 80 file.
- [PG18 disposable migration rehearsal run `38699617221`](https://github.com/Satsetx4/karturt/actions/runs/38699617221) sukses pada SHA tersebut.
- [PG17 concurrency job `116307663761`](https://github.com/Satsetx4/karturt/actions/runs/38699617335/job/116307663761) sukses; ini ID job, bukan ID run.
- 15 blob (`drizzle/0000`–`0013` dan `drizzle/meta/_journal.json`) tetap immutable dibanding baseline yang diverifikasi.
- GHSA development-only tetap **temporarily accepted** sampai 2026-11-14; bukan fixed/clean. Lihat [penerimaan risiko dependency](WAVE13B_2_DEV_DEPENDENCY_RISK_ACCEPTANCE.md).

## Publikasi dan baseline

Branch dokumen kerja ini dibuat dari docs SHA `b5ecda64799e48b012a4cd6a1f782c433449f1f8`; branch publikasi yang disiapkan adalah `docs/karturt-free-stage-evidence-20261015`. `main` tetap tidak berubah. Source RC tidak berubah. Publikasi branch docs tidak berarti project database telah lolos migrasi atau siap menerima data.

Pekerjaan dijalankan pada worktree terpisah; checkout utama yang kotor tidak disentuh:

| Peran | Worktree | Branch / ref |
|---|---|---|
| Coordinator | `D:\!AGY\_worktrees\karturt-free13b2-coordinator-20261015` | `docs/karturt-free-stage-evidence-20261015` |
| Agent A — provisioning Free | `D:\!AGY\_worktrees\karturt-free13b2-agent-a-20261015` | detached pada source RC SHA |
| Agent B — operator packet | `D:\!AGY\_worktrees\karturt-free13b2-agent-b-20261015` | `codex/karturt-free-stage-operator-20261015` |
| Agent C — independent review | `D:\!AGY\_worktrees\karturt-free13b2-agent-c-20261015` | detached pada source RC SHA |

### Rujukan resmi

- [Neon Free plan limits](https://neon.com/blog/neon-free-plan-1-gb-per-project)
- [Neon endpoint management and autosuspend](https://neon.com/docs/manage/endpoints/)
- [Neon API v2 specification](https://neon.com/api_spec/release/v2.json)
- [PostgreSQL 18 TLS verification](https://www.postgresql.org/docs/18/libpq-ssl.html)
- [Vercel Preview deployments](https://vercel.com/docs/deployments/environments)
- [Vercel deployment protection availability](https://vercel.com/docs/deployment-protection/methods-to-protect-deployments)
