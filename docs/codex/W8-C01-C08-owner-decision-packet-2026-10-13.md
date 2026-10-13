# Wave 8 KartuRT V1 — Owner Decision Packet (C01–C08)

**Keputusan saat paket ini disusun: BLOCKED / NO-GO untuk Preview cloud, merge, deployment, staging Neon, dan publikasi Demo/F3/production.** Paket ini menggabungkan bukti Wave 7 dan bukti provider yang telah tersimpan. Paket ini bukan readback provider hari ini dan tidak mengubah status provider.

## Snapshot, ruang lingkup, dan keputusan sekarang

- Baseline lokal Wave 8: `34a2af3195a09220a6639bdcb2aff369a813d5c2`, branch `codex/w8-agent-c-20261013`; pohon kerja bersih saat pemeriksaan awal.
- Sumber checkpoint paling baru yang tersedia untuk lane ini: laporan Wave 7 pada [Issue #25, komentar 6139412087](https://github.com/Satsetx4/karturt/issues/25#issuecomment-6139412087), bertanggal 2026-10-13. Readback Issue #25 menunjukkan `updated_at=2026-10-13T06:08:50Z` (13:08:50 Asia/Bangkok). Laporan itu menyatakan keseluruhan Wave 7 `BLOCKED / NO-GO`.
- Detail Vercel dan Neon paling rinci yang tersimpan adalah [packet Wave 6](./W6-C-owner-decision-packet-2026-10-13.md), dikumpulkan 2026-10-13 05:06:45–05:10:19 UTC. Detail itu hanya snapshot historis; nilai, alias, usage, deployment, dan project state harus dibaca ulang oleh owner pada 2026-10-13 tepat sebelum keputusan apa pun.
- Lane C hanya mengonsolidasikan bukti tersebut. Tidak ada panggilan API/provider, pembukaan dashboard provider, koneksi/wake/query/migrasi Neon, build cloud, resource baru, perubahan provider, deployment, merge, push, perubahan DNS, update Issue, atau pengiriman WhatsApp.
- Rp0 berarti tidak ada biaya tambahan dan tidak ada paparan overage untuk aksi yang disetujui. Bila dashboard, kontrak, kuota, atau estimasi biaya tidak membuktikannya, berhenti.

| Item | Status lane C | Makna dan batas bukti |
|---|---|---|
| W8-C01 — Demo/F3 Vercel | **PASS untuk konsolidasi bukti bertanggal; BLOCKED untuk keselamatan saat ini** | Wave 7 mencatat kandidat Demo/F3 terakhir dibatalkan, alias `main` F3 menunjuk deployment production-target yang dibatalkan, dan trigger settings tidak terbaca. Owner harus membaca nilai saat ini dari dashboard sebelum keputusan. |
| W8-C02 — Rp0, headroom, overage | **BLOCKED / UNKNOWN** | `costs_not_found`, daftar commitment kosong, label Hobby/Free, dan usage counter tidak membuktikan biaya kandidat Rp0 atau headroom. |
| W8-C03 — isolasi Neon | **BLOCKED** | Metadata lama menunjukkan inherited `parent-data`, primary/default, tidak protected, koneksi publik, allowlist kosong, dan passwordless. Isi/lineage kosong tidak terbukti; jangan gunakan branch itu. |
| W8-C04 — opsi staging tanpa biaya tambahan | **PASS sebagai opsi operasional lokal; staging penerimaan tetap NOT READY** | Uji lokal sintetis dapat dilanjutkan setelah runner lokal W8-B lolos guard/cleanup. PGlite adalah cakupan code-level, bukan bukti PostgreSQL/provider/browser/device staging. |
| W8-C05 — controlled publication | **BLOCKED / NO-GO** | Jangan mulai Preview cloud atau merge sampai biaya, trigger/alias, DB isolasi, exact-SHA CI/build, runtime, dan rollback terbukti. PR #23 adalah satu-satunya jalur integrasi main yang dapat dipertimbangkan; PR #56 hanya pembanding. |
| W8-C06 — rollback | **PASS sebagai prosedur tertulis saja** | Wave 7 melaporkan rencana rollback tertulis; belum ada restore/rollback yang dieksekusi. Target deployment aktif yang sehat harus ditetapkan ulang oleh owner. |
| W8-C07 — keputusan owner | **BLOCKED menunggu bukti dan GO eksplisit** | Tidak ada GO untuk merge, publication, production, Demo/F3, atau DNS pada checkpoint Wave 7. Satu GO tidak mencakup aksi lain. |
| W8-C08 — packet/evidence handoff | **PASS** | Dokumen ini mencatat bukti bertanggal, celah, langkah owner, stop gates, dan keputusan terpisah. |

**Keputusan operasional sekarang:** lanjutkan hanya pengujian lokal sintetis dan pekerjaan dokumentasi. Jangan memulai build Preview Vercel, menggunakan Neon yang tercatat, merge PR #23, atau menerbitkan apa pun. W8 A/B dapat menutup bukti lokal; hasil tersebut tidak menutup gate provider, biaya, runtime, perangkat, atau owner.

## Bukti yang sudah ada

### Vercel Demo dan F3 — hanya snapshot lama

Laporan Wave 7 menyatakan kandidat deployment Demo/F3 terakhir berstatus `CANCELED`; alias `main` F3 tercatat terhubung ke deployment `main` yang dibatalkan dengan target `production`; dan setting trigger tidak dapat dibaca. Ini bukti risiko historis yang cukup untuk menghentikan merge, tetapi tidak menunjukkan konfigurasi maupun alias yang aktif sekarang.

Packet Wave 6 mengikat temuannya ke project yang dibaca saat itu:

| Proyek | Bukti historis yang tersimpan | Yang tidak terbukti |
|---|---|---|
| Demo `karturt-demo-20261006` (`prj_iI7jxoyFgnoNZNnQngj1vB6fRgAv`) | `live=false`; deployment terbaru yang dibaca `CANCELED`, `target=null`; record alias branch dan record production-target yang dibatalkan juga tercatat. | Production branch saat ini, nilai Ignore Build Step, konfigurasi auto-deploy, target alias/domain saat ini, dan dampak merge `main`. |
| F3 `karturt-f3-staging` (`prj_OgnBy1d7z2beP8wQHRowF0yJc3PU`) | `live=false`; deployment kandidat terakhir yang dibaca `CANCELED`, `target=null`; alias `main` pada snapshot mengarah ke deployment `main` SHA `96c84588ae0c13f68a17cffd997a3e583fb7da82` dengan target `production`, berstatus `CANCELED`. | Apakah alias tersebut masih ada/aktif, apakah ada deployment production sehat, production branch saat ini, Ignore Build Step/`ignoreCommand`, Git deployment toggle, dan efek merge sekarang. |

Deployment `CANCELED` atau record `target=null` tidak membuktikan proyek aman dari deploy berikutnya. Alias F3 yang pernah mengarah ke record production-target membuat efek merge ke `main` tidak boleh diasumsikan aman. Dokumentasi Vercel menyebut commit ke repository terhubung dapat memulai deployment kecuali build dilewati; Project Settings menyediakan Ignore Build Step dan konfigurasi statis dapat memengaruhi perilaku itu. Karena itu dashboard dan konfigurasi pada SHA kandidat harus dibaca bersama, bukan mengandalkan status deployment historis. ([Project Settings](https://vercel.com/docs/project-configuration/project-settings), [Git Configuration](https://vercel.com/docs/project-configuration/git-configuration), [vercel.json](https://vercel.com/docs/project-configuration/vercel-json))

### Rp0, quota, dan no-overage

- Wave 6 mengembalikan `404 costs_not_found` untuk billing charges; commitments kosong; team plan yang terbaca adalah Hobby. Wave 7 tetap menyatakan Hobby, `costs_not_found`, dan commitments kosong tidak membuktikan Rp0/headroom/no-overage.
- Snapshot Neon sebelumnya menunjukkan tier Free dan usage counters. Counter pemakaian bukan saldo kuota tersisa atau plafon biaya.
- Tidak ada kandidat build cloud yang dijalankan lane C. Itu membuktikan lane C tidak meminta workload cloud; itu **bukan** bukti bahwa build yang akan datang bebas biaya.
- Halaman resmi Vercel menempatkan usage/allotment dan proyeksi biaya di dashboard Usage. Plan, allotment, dan perilaku saat kuota habis perlu diperiksa untuk team/proyek aktual; snapshot lama tidak menjadi bukti untuk hari ini. ([Manage and optimize usage](https://vercel.com/docs/pricing/manage-and-optimize-usage), [Hobby Plan](https://vercel.com/docs/plans/hobby), [Account Plans](https://vercel.com/docs/plans))

### Neon — jangan pakai branch yang sudah teridentifikasi

Wave 7 merangkum metadata branch `init_source=parent-data`, `primary=true`, `default=true`, `protected=false`; endpoint idle/passwordless; koneksi publik diizinkan dan allowlist kosong. Isi parent dan lineage tidak terbukti, quota/headroom tidak terbukti, serta tidak ada koneksi, wake, query, atau migrasi.

Kesimpulan: nama `staging-empty`, nol byte yang ditulis, endpoint idle, atau status suspended **tidak** membuktikan dataset kosong maupun terisolasi. Jangan membuka/membangunkan endpoint, menjalankan `db:check`, menghubungkan aplikasi, atau memigrasikan branch tersebut. Jangan membuat resource Neon pengganti selama batas biaya Rp0 masih berlaku.

### Gate engineering yang masih relevan untuk publication

Checkpoint Wave 7 mencatat build belum mencapai kompilasi karena path/junction lokal; audit penuh menemukan lima HIGH pada dependency tooling `braces` sementara production-only audit nihil; concurrency PostgreSQL tidak dijalankan karena Docker/Podman tidak tersedia dan teardown fixture belum memadai; belum ada DB sintetis terisolasi, protected READY Preview, runtime, device acceptance, atau rollback yang dieksekusi. Tabel ini adalah status pada checkpoint Wave 7, bukan klaim hasil Wave 8. Coordinator harus menggantinya dengan hasil exact-final-SHA yang benar-benar dijalankan sebelum gate publication ditinjau.

## Langkah manual owner — readback 13 Oktober sebelum keputusan

Simpan bukti bertanggal (Asia/Bangkok dan UTC), nama team, project ID, exact SHA/branch bila relevan, serta screenshot/export yang menampilkan nilai. Jangan sertakan secret, token, DATABASE_URL, atau data warga.

### 1. Baca ulang Demo dan F3 di Vercel

Untuk setiap project, pilih team yang tepat lalu pastikan **Project ID** cocok dengan Demo/F3 di atas. Catat nilai yang terlihat sekarang:

1. **Settings → Git:** repository yang terhubung, production branch, dan status Git deployment/auto-deploy. Catat branch candidate dan apakah push/merge ke `main` membangun deployment production.
2. **Settings → Build and Deployment:** pilihan/teks persis **Ignored Build Step** dan hasil perilakunya untuk `main` serta candidate branch. Periksa konfigurasi pada exact SHA kandidat, termasuk `vercel.json`/`ignoreCommand` yang dapat override nilai dashboard. Simpan teks command tanpa secret.
3. **Deployments → Aliases/Domains:** petakan setiap alias domain, khususnya alias `main`, ke deployment ID, branch, SHA, dan target (`preview`/`production`). Buka detail record dan pastikan status serta apakah target benar-benar hidup. Jangan menyimpulkan dari record canceled.
4. Simpan deployment production terakhir yang sehat dan SHA-nya sebagai kandidat rollback hanya setelah owner memastikan ia masih melayani domain yang dimaksud. Jika tak ada target aktif yang terverifikasi, stop.
5. Tinjau protection/SSO dan environment scope untuk Preview. Pastikan tidak ada environment production, secret, atau data produksi yang diwariskan ke Preview.

**Stop:** production branch/trigger/Ignore Build Step tidak terbaca; ada ambiguity antara alias dan target; `main` dapat memicu production; atau Preview tidak terproteksi/terisolasi. Jangan “uji” konfigurasi dengan push atau redeploy.

### 2. Minta bukti biaya dari billing owner

Di Vercel team yang sama, buka Usage untuk siklus berjalan dan 30 hari terakhir; baca tiap project Demo/F3 dan metrik yang dipakai candidate build. Simpan included allotment, pemakaian saat ini, headroom tersisa, proyeksi, overage/spend setting yang benar-benar berlaku, serta semua biaya/commitment relevan. Minta billing owner mengonfirmasi secara tertulis bahwa **aksi yang diusulkan** (build Preview, durasi, fungsi, transfer, dan usage lain yang terkait) tidak menimbulkan biaya tambahan.

Lakukan readback biaya Neon melalui billing/usage view yang sudah tersedia tanpa membangunkan endpoint. Catat tier, usage, kuota yang termasuk, headroom, dan perilaku saat batas tercapai. Free/Hobby, usage nol, hasil API tidak tersedia, atau tabel kosong tidak cukup sendiri. Jika biaya aksi tidak dapat dipastikan Rp0/no-overage, **NO-GO** dan tidak ada Preview cloud.

### 3. Tetapkan database staging yang aman tanpa membuat resource

Jangan gunakan branch Neon `parent-data` di atas. Jangan konek untuk “memeriksa apakah kosong”. Opsi yang diizinkan untuk melanjutkan pekerjaan tanpa biaya layanan cloud:

- Runner PostgreSQL lokal yang disposable, berlabel dan memiliki positive identity guard, memakai hanya instance/port/database yang diverifikasi sebagai disposable. Pakai hanya setelah Agent B membuktikan setup, fixture cleanup, dan teardown scoped aman. Isi hanya data sintetis.
- PGlite/in-memory untuk unit dan integrasi yang memang sesuai. Laporkan bahwa ini bukan PostgreSQL race test atau provider runtime.
- Jalankan app dan browser secara lokal terhadap data sintetis untuk UX/runtime lokal. Laporkan bahwa ini tidak membuktikan alias, Vercel, Neon, atau device acceptance.

Jika runner lokal tidak aman/tersedia, berhenti pada bukti statis/PGlite. Jangan pakai PostgreSQL lokal existing tanpa guard identitas, jangan membuat Neon/Vercel resource, dan jangan menambah project/branch/database untuk memaksa staging tersedia. Dengan pilihan lokal, status **cloud staging tetap NOT READY**.

### 4. Bukti exact candidate

Coordinator mencatat exact final SHA dan hasil lint, typecheck, full test, build, Drizzle/schema checks, dependency audit, serta lima skenario race bila runner disposable lulus guard. Simpan exit code dan batas eksekusi. Hasil lokal tidak boleh disebut CI/Preview/provider/device PASS. Bila build, HIGH dependency, concurrency atau test suite tetap gagal/belum dijalankan, merge tetap NO-GO.

## Gate controlled publication dan siapa yang memberi GO

Semua syarat berikut harus lolos sebelum ada aksi publication:

1. **GitHub readback baru:** baca status/head/base/checks PR #23 dan #56 tepat sebelum keputusan. Wave 7 mencatat PR #23 OPEN/DRAFT/unmerged sebagai satu-satunya jalur integrasi main yang mungkin; PR #56 OPEN/DRAFT/unmerged comparison-only. Anggap itu snapshot, bukan status saat ini. Jangan menggabungkan komponen terpisah atau membuat jalur main alternatif.
2. **Vercel aman:** owner memahami production branch, trigger, Ignore Build Step/`ignoreCommand`, dan alias/domain Demo/F3 saat ini; merge `main` tidak menyebabkan production/demo/F3 side effect yang tidak disetujui. Jika tidak dapat dibuktikan, jangan merge.
3. **Rp0 terbukti:** billing owner mengonfirmasi kuota dan headroom untuk aksi persis yang diajukan, tidak ada biaya tambahan atau overage. Jika tidak ada hard evidence, jangan build cloud.
4. **DB aman:** target sintetis/terisolasi telah dibuktikan tanpa koneksi ke DB yang belum aman, tanpa PII/production credentials, dengan biaya Rp0. Branch Neon yang tercatat tidak memenuhi gate.
5. **Candidate siap:** seluruh blocker engineering terkait telah dinilai pada exact final SHA; exact-SHA CI selesai jika CI diperlukan; build nyata sukses; full regressions, dependency/security, dan concurrency lulus dengan teardown; browser/runtime dan device acceptance yang diwajibkan memiliki bukti masing-masing.
6. **Recovery siap:** deployment production terakhir yang sehat telah dibaca ulang dan dapat dipulihkan; alias saat ini dicatat; backup/restore tervalidasi sesuai data yang akan disentuh. Tidak boleh ada migration atau write yang rollback-nya belum terbukti aman atau akan menambah biaya.
7. **GO terpisah dan eksplisit oleh Ard sebagai owner:** (a) GO untuk Preview candidate tertentu; (b) GO untuk merge PR #23 pada exact SHA tertentu; dan (c) bila diperlukan, GO untuk production atau Demo/F3 publication. GO satu tahap bukan GO tahap lain. CI, agen, dan laporan ini tidak dapat memberikan persetujuan tersebut.

Saat meminta keputusan, lampirkan checksum/evidence link, exact SHA, project ID/alias yang terdampak, estimasi biaya Rp0, target environment, rollback deployment ID/SHA, dan daftar mutasi yang diminta. Jangan mengubah status ke READY atau mengeksekusi aksi lanjutan sebelum Ard memberikan GO yang sesuai.

## Rollback jika kelak ada publication berizin

Prosedur berikut hanya untuk owner/operator setelah authorization yang sesuai; tidak ada langkah yang dijalankan oleh lane C.

### Sebelum publication

- Rekam current alias/domain → active deployment ID → branch/SHA/target, setting Git/production branch/Ignore Build Step, dan deployment production terakhir yang sehat.
- Pastikan ada route kembali ke deployment sehat tersebut tanpa build baru atau biaya tambahan yang tidak disetujui.
- Pastikan artifact/database backup dan langkah restore sudah diverifikasi pada lingkungan sintetis yang aman. Jika database recovery perlu resource/biaya baru atau belum pernah dibuktikan, tidak ada GO untuk perubahan yang menulis ke database.
- Gunakan exact SHA yang telah lolos gate. Preview harus terproteksi, menggunakan data sintetis, dan tidak menerima alias production.

### Jika alias/deployment berperilaku salah

1. Hentikan promotion dan semua aktivitas build/deploy berikutnya; jangan menghapus atau membuat ulang project/database/alias.
2. Owner memulihkan alias yang terdampak ke deployment sehat yang direkam sebelumnya melalui jalur Vercel yang disetujui, lalu membaca ulang mapping alias → deployment/SHA dan melakukan smoke check aman. Jangan memakai record `CANCELED` sebagai target rollback.
3. Jika code sudah masuk main, siapkan revert melalui commit/PR baru pada jalur yang disetujui; jangan force-push atau merge PR terpisah. Verifikasi exact SHA dari artifact hasil revert sebelum lanjut.
4. Jika ada database write/migration, hentikan write lanjutan. Pulihkan hanya dengan prosedur backup yang sudah diuji dan terbukti Rp0, atau stop untuk keputusan owner bila restore memerlukan biaya/resource baru. Alias/code rollback saja tidak memulihkan data.
5. Catat waktu, SHA, deployment/alias lama dan baru, check yang dijalankan, hasil, serta persetujuan owner. Jangan kirim pesan WhatsApp nyata sebagai bagian pemulihan.

Wave 7 melaporkan rollback hanya sebagai rencana tertulis, bukan bukti drill berhasil. Selain itu, snapshot F3 menunjukkan target production yang dibatalkan; karena itu target rollback valid **belum terbukti** sampai owner membaca ulang dashboard.

## Sources

- [Issue #25 — latest available Wave 7 checkpoint, comment 6139412087](https://github.com/Satsetx4/karturt/issues/25#issuecomment-6139412087)
- [Issue #25 — V1 execution board](https://github.com/Satsetx4/karturt/issues/25)
- [Wave 6 Lane C packet](./W6-C-owner-decision-packet-2026-10-13.md) — underlying provider snapshot, 2026-10-13 05:06:45–05:10:19 UTC; historical only.
- [PR #23 — sole candidate integration path](https://github.com/Satsetx4/karturt/pull/23); status requires fresh GitHub readback.
- [PR #56 — comparison-only](https://github.com/Satsetx4/karturt/pull/56); status requires fresh GitHub readback.
- Vercel docs: [Project Settings](https://vercel.com/docs/project-configuration/project-settings), [Git Configuration](https://vercel.com/docs/project-configuration/git-configuration), [vercel.json](https://vercel.com/docs/project-configuration/vercel-json), [Manage and optimize usage](https://vercel.com/docs/pricing/manage-and-optimize-usage), [Hobby Plan](https://vercel.com/docs/plans/hobby), [Account Plans](https://vercel.com/docs/plans).
