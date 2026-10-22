# KartuRT V1 — Sesi 5 A4-02.1 Prototype Hardening

Tanggal: 2026-10-22 (Asia/Bangkok). Cakupan sesi ini hanya hardening prototype offline pada PR #74. Dokumen ini tidak menyetujui setup ledger live atau pekerjaan A4-03/04/05.

## Baseline GitHub yang diverifikasi

- Repository `Satsetx4/karturt` tetap memakai `main` pada `96c84588ae0c13f68a17cffd997a3e583fb7da82`.
- PR #74 masih OPEN/DRAFT pada awal sesi, branch `codex/karturt-solo-owner-a4-session4-20261022`, head `f11523e80472f88e55535d7d8ac44d68cb96dc43`, bertumpuk di atas PR #73 pada `def8a9cc4e6816ec8414013083505c7548902a5b`.
- PR #65, #67, #71, dan #73 juga OPEN/DRAFT. Issue #69 dan #72 masih OPEN.
- Gate A untuk head awal PR #74, run [39781983397](https://github.com/Satsetx4/karturt/actions/runs/39781983397), PASS. Check terpisah “Launch Safety independent PostgreSQL concurrency” SKIPPED. Hasil tersebut tidak diwariskan ke commit koreksi; Gate A wajib dibaca lagi untuk head koreksi yang persis sama.
- Issue #69 mempertahankan tag ledger di repository publik terpisah sebagai proposal; issue #72 menetapkan jalur cloud-only dan melarang menganggap mock/CI sebagai bukti staging atau ledger live.

## Verifikasi semantik GitHub API

Dokumentasi resmi menjelaskan bahwa **Create a tag object** membuat annotated-tag object saja. Pembuatan annotated tag memerlukan langkah kedua: membuat ref `refs/tags/<name>` yang menunjuk ke SHA tag object. Field `object` pada tag object adalah SHA Git object yang ditandai; untuk sesi ini targetnya harus commit yang dapat dibaca dari repository ledger yang sama.

- [GitHub REST API — Git tags](https://docs.github.com/en/rest/git/tags)
- [GitHub REST API — Git references](https://docs.github.com/en/rest/git/refs)

Karena repository ledger masih proposal dan belum dibuat, prototype menambah `ledgerCommitSha` terpisah pada policy serta pembacaan GET commit yang diinjeksi. GET harus mengonfirmasi SHA yang sama pada repository ledger sebelum operasi tulis. SHA `candidateSha` milik aplikasi tetap menjadi metadata receipt yang disanitasi; ia bukan target tag object.

## Koreksi A4-02.1

- Validasi format `ledgerCommitSha` dipisah dari validasi claim/source aplikasi.
- Transport offline meminta commit ledger berdasarkan repository dan SHA. Status bukan 200, respons tanpa SHA valid, atau SHA berbeda berhenti fail-closed sebelum tag object/ref dibuat.
- Annotated tag dibuat dengan `object = ledgerCommitSha`; create-ref tetap menunjuk ke SHA annotated-tag object.
- Receipt dan pesan annotated tag tetap mencatat `candidateSha` aplikasi sebagai metadata.
- Tidak ada HTTP adapter nyata, env/credential read, workflow wiring, atau target SHA ledger live.

## Tes kontrak offline

Tes mock memeriksa happy path dengan target commit ledger terpisah, malformed SHA, commit ledger yang tidak ditemukan, readback SHA yang berbeda/malformed, sequential replay, serta satu pemenang dalam race mock. Seluruh transport bersifat fake. Tes race ini bukan bukti atomicity/replay-proof GitHub.

Status keberhasilan prototype tetap `CREATE_AND_READBACK_MATCHED_UNATTESTED`; `atomicityProven`, `replayProof`, `liveRulesetBehaviorVerified`, dan `runtimeEnableAllowed` tetap `false`.

## Batas tindakan

Tidak ada F2 retry atau SQL, Neon mutation, live ledger setup, writer credential, perubahan GitHub Environment, perubahan workflow permission, migration, merge, deployment, atau production action. PR #74 tetap draft. A4-03/04/05 belum dikerjakan.

## Roadmap enam tahap setelah sesi ini

| Tahap | Status | Hasil dan blocker | Langkah berikutnya |
|---|---|---|---|
| 1. Inventaris sumber dan CI | Partial | PR/#issue dan Gate A head awal diverifikasi; keseluruhan source/provider inventory belum menutup release gate. | Pertahankan exact-SHA review untuk setiap perubahan dan lanjutkan audit cloud-only yang diizinkan. |
| 2. Solo Owner A1–A4 | Partial | A1–A3 di PR #73; A4-01/02 proposal dan mock prototype. A4-02.1 memperbaiki pemilihan target commit pada kode offline; live ledger, writer scope, ruleset, atomicity dan replay belum terbukti. | Review hasil Gate A exact-head koreksi; sebelum A4-03 perlu otorisasi tersendiri untuk setup ledger. |
| 3. Trusted Neon Viewer | Blocked | Credential Viewer belum diverifikasi oleh trusted runner; provenance target tetap unknown. | Pertahankan gate metadata-only sampai identitas efektif dan provenance terbukti secara terpisah. |
| 4. PG18 readiness | Blocked | Belum ada bukti koneksi dan katalog staging cloud yang diotorisasi pada sesi ini. | Tunggu readiness capture yang sah; tidak ada F2/SQL dalam sesi ini. |
| 5. Staging migration dan UAT | Blocked / NO-GO | Readiness, migration approval dan restore rehearsal belum lulus. | Tetap berhenti sampai seluruh gate prasyarat disetujui dan lulus. |
| 6. Vercel dan production | Blocked / NO-GO | Target/preview acceptance dan production GO terpisah belum ada. | Tidak ada deployment atau production action; lanjut hanya setelah review dan otorisasi baru. |

