# KartuRT V1 — Sesi 4 A4-01/A4-02

Tanggal keputusan: 2026-10-22 (Asia/Jakarta). Status dokumen ini adalah proposal implementasi offline; tidak ada bukti keamanan live.

## Ringkasan

A4-01 menetapkan rancangan konsumsi persetujuan satu kali menggunakan tag ledger pada repository publik terpisah. A4-02 menyediakan prototype TypeScript dengan transport yang diinjeksi dan tes mock offline. Hasil yang berhasil dari prototype sengaja diberi status CREATE_AND_READBACK_MATCHED_UNATTESTED; atomicityProven, replayProof, liveRulesetBehaviorVerified, dan runtimeEnableAllowed tetap false.

Proposal ini tidak membuat repository ledger, ruleset, credential, tag object, tag ref, Environment, atau secret. Tidak ada workflow yang memanggil prototype. Workflow phase-0 tetap memiliki permissions contents: read dan keluar dengan exit 78. PR #73 tetap draft.

## Audit baseline saat Sesi 4 dimulai

- Repo Satsetx4/karturt publik; main berada pada 96c84588ae0c13f68a17cffd997a3e583fb7da82.
- PR #67 terbuka dan draft pada fdf97c9dc8414c31e3075610d7bc7642f9e9ac35, dengan base main.
- PR #73 terbuka dan draft pada def8a9cc4e6816ec8414013083505c7548902a5b, bertumpuk di atas PR #67.
- Gate A pada SHA PR #73: PASS, run 39773388950. PG17 concurrency job: SKIPPED.
- Ruleset #25623088 aktif tetapi target-nya branch refs/heads/audit/solo-owner-approval-ledger; aturan hanya deletion dan non_fast_forward; bypass_actors kosong. Ini bukan ruleset tag dan tidak mencegah commit fast-forward biasa mengubah isi branch.
- Issue #69 dan komentar rencana 6340448237 menyatakan tag ledger repo publik terpisah sebagai proposal; issue #72 mensyaratkan cloud-only, writer sempit, dan semua ketidakpastian tetap fail-closed.

## A4-01 — ADR/proposal

### Keputusan yang dievaluasi

Pilihan utama adalah repository publik GitHub terpisah, dengan nama usulan Satsetx4/karturt-solo-owner-ledger (ketersediaan nama belum diperiksa). Repository tidak berisi aplikasi, data penghuni, data Neon, token, atau rahasia. Status tetap PROPOSAL sampai persetujuan untuk setup berikutnya.

Ruleset yang diusulkan menargetkan refs/tags/karturt-solo/used/v1/* dan aktif, dengan aturan update dan deletion, serta tanpa bypass. Aturan creation harus tidak ada supaya writer yang dibatasi tetap dapat membuat ref baru. Jika creation dibatasi sementara bypass kosong, writer juga tidak dapat membuat claim; menambahkan writer sebagai bypass akan melemahkan tujuan larangan bypass. Perubahan ruleset dan administrasi repo tetap berada pada pemilik repo, jadi administrator tetap trust boundary dan dapat mengubah atau menonaktifkan kontrol.

GitHub Free mendukung rulesets untuk repository publik. GitHub REST API memisahkan pembuatan annotated-tag object dari pembuatan tag ref. Tag object saja bukan klaim konsumsi. Create ref mendokumentasikan respons 201, 409, dan 422, tetapi dokumentasi tidak menetapkan kode mana yang selalu berarti nama duplikat dan tidak menjanjikan single-winner concurrency linearizability. Karena itu prototype menuntut 201 persis, readback ref serta object yang cocok, dan tetap tidak mengklaim atomicity atau replay-proof sebelum live test.

Repository harus sudah memiliki setidaknya satu branch karena API GitHub menolak pembuatan ref pada repository kosong. Public ledger membuat nama ref, digest, tag message, run ID, dan SHA yang direkam dapat dibaca publik; hanya metadata nonrahasia boleh dimasukkan.

Dokumentasi resmi:
- https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets
- https://docs.github.com/en/rest/git/tags
- https://docs.github.com/en/rest/git/refs
- https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation
- https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app

### Perbandingan pilihan ledger

| Pilihan | Penilaian |
|---|---|
| Branch ledger di Satsetx4/karturt dengan Contents create-only | Ditolak. Contents write bersifat repo-wide; ruleset branch saat ini tidak menahan fast-forward edit biasa. Helper lama tetap inert. |
| Tag ledger pada repo publik terpisah | Opsi utama untuk diuji. Ref key deterministik dapat menjadi titik arbitrasi; tag ruleset membatasi update/delete; token terpilih hanya untuk repo ledger. Perilaku race, ruleset, dan token tetap perlu uji live. |
| PostgreSQL dengan unique constraint dan transaksi | Dapat menawarkan batas keunikan transaksional jika role dan endpoint writer benar-benar sempit. Membutuhkan service/credential, data store, audit, dan akses DB terpisah; tidak diaktifkan atau dipilih untuk sesi ini. |
| CI artifact, cache, atau file workflow | Tidak dipilih untuk single-use global. Belum ada kontrak create-only bersama yang durable, berumur tepat, dan mempunyai batas credential yang lebih sempit daripada repo ledger. |

### Threat model dan trust boundaries

Aset yang dilindungi adalah kemampuan memakai satu persetujuan owner untuk satu pasangan source/launcher yang telah disetujui. Ancaman meliputi replay ticket pada run/SHA berbeda; actor, owner, repository, source SHA atau launcher SHA palsu; duplicate/racing ref creation; response API timeout atau ambigu; ruleset salah, hilang, tidak aktif, dikecualikan, atau bypassable; writer token terlalu luas; serta receipt berisi raw ticket atau secret.

Batas kepercayaan yang diwajibkan:
1. Workflow protected main menghasilkan context yang valid, tetapi belum membuka secret atau mengubah DB.
2. Token issuer tepercaya mengeluarkan GitHub App installation token dengan repository selection tepat satu repo ledger serta hanya Contents write dan Metadata read.
3. Repository ledger publik mempertahankan tag ruleset aktif; pemilik/admin yang bisa mengubah ruleset tetap privileged.
4. GitHub API mengembalikan status dan readback yang dapat diautentikasi; transport harus gagal tertutup pada kehilangan koneksi, status tak dikenal, respons malformed, atau pagination ruleset tidak lengkap.
5. A4-02 fake transport hanya menguji kontrak kode. Ia tidak membuktikan identitas API, perilaku ruleset, race GitHub, permission token aktual, atau ketahanan replay.

### Digest dan receipt

Digest ticket dihitung persis sebagai lowercase hex SHA-256 atas UTF-8 string karturt-solo-owner-ticket/v1: disambung ticket lowercase 32-hex. Ref menjadi refs/tags/karturt-solo/used/v1/<digest>. Run ID dan source SHA tidak ikut dalam nama ref agar penggunaan ticket yang sama menuju ref yang sama.

Annotated-tag message berisi JSON dengan urutan field tetap: version, ticketDigest, repository, repositoryId, ownerId, actor, actorId, triggeringActor, eventName, workflowRef, ref, runId, runAttempt, candidateSha, launcherSha, issuedAtUtc, expiresAtUtc, consumedAtUtc. Tidak ada raw ticket, token, secret, connection string, payload database, atau data penghuni. Digest bukan enkripsi; ticket harus memiliki 128-bit entropy acak dan tidak boleh dicatat di log.

### Protokol reserve dan stop states

1. Validasi repository/owner/actor, workflow dispatch pada protected main, attempt pertama, workflow ref, source SHA dan launcher SHA terhadap context dan approval, format ticket, serta jendela UTC maksimum 15 menit.
2. Verifikasi scope descriptor writer dan ruleset lengkap sebelum write. Tolak akses repo aplikasi, permission tambahan, aturan tag salah, missing bypass metadata, bypass actor, atau aturan creation.
3. Buat annotated-tag object untuk commit source; object orphan boleh tertinggal jika langkah ref gagal.
4. Kirim satu kali POST create-ref ke nama digest. Hanya HTTP 201 yang boleh melanjutkan. 409/422 berhenti sebagai duplicate/conflict; 401/403 berhenti karena scope/authorization; HTTP 408/425/429, status 2xx selain 201, 3xx, 5xx, status malformed, atau koneksi hilang berhenti INDETERMINATE dan tidak dicoba ulang.
5. Baca ulang ref dan annotated object dengan GET terautentikasi; harus cocok persis dengan object SHA, name, source commit, message receipt dan digest.
6. Baca ulang scope dan ruleset. Jika berbeda atau tidak terbaca, tiket dianggap mungkin telah terbakar dan workflow tetap berhenti.
7. Hasil prototipe bukan izin menjalankan kerja sensitif. Hanya exact ref create plus readback menghasilkan CREATE_AND_READBACK_MATCHED_UNATTESTED.

### Kriteria keamanan dan dependensi

A4-02 dapat lulus hanya sebagai kontrak prototype ketika lint, typecheck, unit, integration mock, dan Gate A exact-head lulus; workflow tidak berubah; semua tes negatif lulus; dan tidak ada credential/network adapter nyata. Ini bukan A4 security pass.

A4-03 berikutnya perlu persetujuan baru sebelum pemilik membuat repo publik, ruleset tag, branch awal, atau token. Aturan harus diuji secara live; token issuer harus membatasi repo dan permission. A4-04 memerlukan uji duplicate dan race live, replay run/SHA berbeda, update/delete ditolak, unauthorized writer ditolak, serta outage/ambiguous outcome. A4-05 adalah review keamanan terpisah sebelum integrasi workflow. Tidak ada A4-03/04/05 dikerjakan pada sesi ini.

## A4-02 — Prototype dan cakupan tes

Modul scripts/lib/solo-owner-tag-ledger.ts hanya menerima transport yang diinjeksi; tidak ada HTTP client, pembacaan env, pemuatan token, CLI runner, atau workflow wiring. Tes unit memeriksa digest/ref dan format invalid. Tes integration hanya menggunakan fake in-memory transport, termasuk duplicate, racing create-ref, scope/ruleset mismatch, stale/forged context, annotated-object invalid, unauthorized writer, outage, dan readback mismatch. Mock race satu pemenang adalah uji kontrak mock saja dan bukan bukti atomicity GitHub.

Workflow .github/workflows/staging-readiness-capture.yml dan helper branch-ledger tidak disentuh. Tidak ada perubahan pada contents permission, Environment, secrets, Neon, Vercel, database, migration, F2, staging, atau production.

## Roadmap enam tahap

| Tahap | Status setelah sesi ini | Syarat berikutnya |
|---|---|---|
| 1. Inventaris sumber dan CI | Partial | Review dan CI terikat SHA PR #73 serta perubahan sesi 4. |
| 2. Solo Owner A1-A4 | Partial | A1-A3 ada pada PR #73; A4-01/02 proposal dan prototype offline. A4 live writer/ruleset/race masih belum ada. |
| 3. Trusted Neon Viewer | Blocked | Provenance target dan identity Viewer efektif harus diverifikasi melalui gate terpisah. |
| 4. PG18 readiness | Blocked | Bukti cloud yang diotorisasi untuk koneksi TLS/channel binding/katalog read-only masih diperlukan. |
| 5. Staging migration dan UAT | Blocked / NO-GO | Readiness PASS, signed migration approval, restore rehearsal, dan UAT terisolasi. |
| 6. Vercel dan production | Blocked / NO-GO | Target Vercel terverifikasi, preview/UAT selesai, dan GO production terpisah. |

F2 tetap BLOCKED. Staging tetap NO-GO. Production tetap NO-GO. Tidak ada approval yang dibawa dari hasil CI atau mock test.
