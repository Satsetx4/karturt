# Fase 12 — Household Management: Laporan Implementasi

## Status

**Hasil gerbang: F12 FAIL / F13 NO-GO.**

Implementasi tersedia pada branch fitur dan seluruh pemeriksaan lokal serta audit finansial Neon pascamigrasi yang sudah dijalankan lulus. F12 belum memenuhi syarat PASS karena smoke browser terautentikasi belum selesai dan audit dependensi penuh masih melaporkan temuan High pada rantai dependensi pengembangan. CI GitHub untuk commit implementasi sedang berjalan ketika laporan ini disiapkan.

## Baseline dan perubahan

- Repo: `Satsetx4/karturt`
- Baseline `main`: `ff9628b7fa178fb3c56ff3530adeb4719b9fe295`
- Branch: `feat/phase-12-household-management`
- Commit implementasi: `16f4b4b87b8e2c9d7070bb7dc8a0d2edc18b3e17`
- Commit message: `feat: implement phase 12 household management`
- CI Gate A pada SHA implementasi lulus: [run 37109357295](https://github.com/Satsetx4/karturt/actions/runs/37109357295). Full suite, migration journal/drift checks, dan production build berhasil.
- CI Gate A pada revisi laporan pertama `e636f681a1dd2b884821f124d34ae3e0ec4505b0` juga lulus: [run 37109493645](https://github.com/Satsetx4/karturt/actions/runs/37109493645).
- Tidak ada perubahan atau merge ke `main`; production tidak disentuh; F13 tidak dimulai.
- Source contract yang dibekukan sebelum implementasi: [phase-12-household-management-design.md](phase-12-household-management-design.md).

## Keputusan lifecycle

1. **Create:** Ketua RT aktif dalam RT sendiri dapat membuat household untuk rumah yang ada, membuat resident/person/account baru, dan memulai billing sesuai tanggal mulai.
2. **Edit:** hanya nama resident, nomor telepon, dan label rumah. Identitas rumah/login, relasi person-household, serta tanggal lifecycle tidak dapat diubah lewat edit umum.
3. **Deactivate:** tanggal berakhir dan alasan wajib; household/person dinonaktifkan, akun resident dinonaktifkan, sesi dicabut, dan tindakan dicatat dalam audit.
4. **Replace:** operasi atomik pada batas bulan. Household lama berakhir sehari sebelum tanggal mulai household baru. Resident/person/account baru dibuat untuk household baru.
5. **Transfer orang yang sama:** tidak didukung dalam MVP. Person lama tidak dipindahkan dan riwayat relasinya tidak ditimpa. Transfer identitas yang aman memerlukan model membership temporal terpisah dan desain backfill.

Tanggal mulai tidak dapat diedit setelah pembuatan. Deactivate dan replace memerlukan alasan 1–500 karakter. Tidak ada hard delete untuk house, household, person, account, atau riwayat.

## Aturan iuran dan riwayat

- Household baru mulai pada hari pertama bulan efektif; household lama berakhir pada hari terakhir bulan sebelumnya. Tidak ada prorata.
- Dues sebelum tanggal mulai household baru menjadi `NOT_DUE`; dues pada periode aktif dibuat memakai snapshot tarif yang berlaku.
- Saat deactivate/replace, hanya dues setelah tanggal akhir yang belum tersentuh dan berstatus `UNPAID` yang dapat menjadi `NOT_DUE` dengan amount 0. Perubahan dilakukan dalam transaksi lifecycle yang sama.
- Jika ada alokasi pembayaran (termasuk riwayat reversal), payment request/item, waiver, atau adjustment pada periode pascaakhir, operasi ditolak sebagai konflik; data finansial tidak ditulis ulang.
- Tunggakan pada masa aktif tetap milik household lama. Tidak ada pemindahan utang ke household baru dan deactivate tidak berarti waiver.
- Pengamanan mengikuti lock order stabil: house → household → dues terurut → people/accounts. Audit kritis ditulis dalam transaksi yang sama; kegagalan audit membatalkan mutasi.

## Login, sesi, PIN, dan otorisasi

- Resident baru memakai nomor rumah sebagai login identifier yang ditentukan server.
- Unique index resident mengecualikan akun `disabled` historis sehingga rumah yang sama dapat dipakai resident pengganti. Akun resident aktif/non-disabled tetap unik per RT; resolver login menolak kandidat aktif lintas-RT yang ambigu.
- Setelah Better Auth membuat sesi, login resident memeriksa ulang akun, hash kredensial, status person/household, dan identitas login. Jika terjadi race dengan reset/deactivate/replace, sesi dibatalkan dan respons tetap generik.
- PIN awal dan reset harus tepat enam digit; PIN di-hash segera, tidak dimasukkan ke response/audit/log, lock counter direset, dan semua sesi resident lama dicabut.
- Ketua RT aktif hanya dapat mengelola household/reset resident di RT sendiri. Bendahara dan resident tidak berwenang. System Admin tidak mendapat editor household umum; pemulihan PIN hanya melalui jalur structured recovery yang tersedia.
- Reset PIN dan create/edit/deactivate/replace menggunakan audit kritis. Context audit memuat ID, tanggal efektif, jumlah sesi/dues terdampak, atau nama field yang berubah; bukan PIN/hash/token.

## Migrasi dan Neon development

- Migration head: `0013_phase_12_household_management`
- File: `drizzle/0013_phase_12_household_management.sql`
- Hash yang tercatat di journal Neon: `994BCC9376B207FDC0668312CC68CAB3C2CEC46BC6101EDC4C2B5EF7F51C4A85`
- Target yang dipakai: project `billowing-base-57949906`, branch `karturt-development` / `br-crimson-band-az6i637k`, database `neondb`.
- Migrasi 0013 diterapkan hanya ke branch development tersebut setelah preflight dan pemeriksaan lokal. Total journal: 14 entry.
- Bukti lokal migrasi: clean migration 0000→0013 dan upgrade 0012→0013 lulus; upgrade mempertahankan data/ledger F11. `drizzle-kit check` lulus dan schema drift check tidak menemukan perubahan lanjutan.
- Preflight dan post-migration: household overlap 0, household aktif ganda 0, login resident aktif ganda 0, serta ambiguitas current login lintas-RT 0.
- Setelah 0013, runner Gate C read-only resmi memeriksa 32 kategori finansial: **32/32 bernilai 0**. Tidak ada fixture atau mutasi smoke pada data Neon selain migrasi yang diminta.
- Production tidak diakses.

## Pemeriksaan lokal

| Pemeriksaan | Hasil |
|---|---|
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| Integration suite | PASS — 30 file, 153 test |
| Authorization suite | PASS — 89/89 test |
| `npm test -- --maxWorkers=1` | PASS — 54 file, 321 test |
| `npm run build` | PASS |
| `npx drizzle-kit check` | PASS |
| Schema drift generation check | PASS — tidak ada perubahan schema baru |
| Clean migration dan upgrade | PASS |
| Targeted lifecycle/history/security/concurrency suites | PASS |
| GitHub Actions pada commit implementasi | PASS — run 37109357295 |
| GitHub Actions pada revisi laporan pertama | PASS — run 37109493645 |

## HTTP dan browser

Server lokal dijalankan dengan konfigurasi development yang endpoint-nya terverifikasi sama dengan branch Neon yang disebut di atas.

- Halaman publik dan halaman masuk pengurus berhasil dirender di browser.
- Tampilan halaman publik/login diperiksa pada viewport 360×800, 390×844, 430×900, 768×1024, dan 1440×900. Screenshot pada 360px dan 390px tidak menunjukkan overflow horizontal yang tampak.
- Tanpa sesi, `GET /app/rumah` memberi redirect 307 ke `/login/pengurus`; `GET /api/chairman/households` memberi 401.
- Smoke terautentikasi untuk list/search/add/edit/deactivate/replace/reset, login resident, konfirmasi, dan perilaku sesi **belum dilakukan** karena tidak ada sesi/akun Chairman disposable yang disediakan. Browser dibiarkan pada layar sign-in lokal agar pemilik akun dapat masuk tanpa membagikan kredensial di chat. Karena itu bukti browser ini belum membuktikan alur household end-to-end.

## Temuan Critical/High dan residual

- **Critical: 0.**
- **High: 1 akar temuan** (terlihat pada lima entri paket transitive dalam `npm audit`): `braces` melalui rantai ESLint development dependency `eslint-config-next → @next/eslint-plugin-next → fast-glob → micromatch → braces`. Audit production-only melaporkan 0 kerentanan. GitHub Advisory Database menandai versi terdampak `braces <= 3.0.3` dan belum mencantumkan versi perbaikan: [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/ghsa-vfj7-8cjw-p6xm). Tidak ada downgrade major atau override spekulatif yang diterapkan.
- Transfer orang yang sama antar-household tetap diblokir sampai tersedia model temporal yang aman.
- Smoke HTTP/browser terautentikasi dan CI final pada HEAD terbaru masih harus diselesaikan.

## Keputusan

**F12 FAIL** sampai semua gerbang yang tertunda lulus, termasuk smoke browser autentikasi, CI pada HEAD akhir, dan resolusi temuan High sesuai kebijakan acceptance.

**F13 NO-GO.** Jangan mulai F13 sampai gerbang F12 dinyatakan PASS dan residual yang memblokir ditutup.

## F12.1 Acceptance Closure Update — 2026-10-04

Bagian ini melengkapi riwayat laporan F12 di atas; status akhir closure mengacu pada laporan [phase-12-1-acceptance-closure-report.md](phase-12-1-acceptance-closure-report.md). Baseline tetap `b933cc9a279d91191d6d7fa8c76f6202fbb68da5`; branch kerja `fix/phase-12-1-acceptance-closure`; exact source SHA yang diuji `414e08d1689e2a5775f3c34f4ca6fe7010fcf2c7`.

Smoke browser terautentikasi kini lulus untuk Chairman list/search/add/edit/deactivate, reset PIN dan pencabutan sesi, replacement penghuni satu rumah dengan preservasi tunggakan, conflict protection tanpa mutasi parsial, penolakan akses Treasurer/lintas-RT, serta lima ukuran viewport. Audit read-only pasca-smoke menemukan 11/11 kategori global dan 15/15 pemeriksaan fixture nol; Gate C tetap 32/32 nol. Migration head tidak berubah: 14 entri hingga `0013_phase_12_household_management`.

CI final pada exact source SHA dan satu-satunya blocker dependency dicatat dalam laporan closure. Audit penuh masih menemukan satu akar High (`braces@3.0.3`) pada rantai development lint tooling; audit production-only 0, dan upstream belum menyediakan versi patch. Karena acceptance mensyaratkan audit penuh tanpa High, hasil akhirnya tetap:

**F12 FAIL — F13 NO-GO — remaining blocker: full dependency audit masih melaporkan High yang belum dipatch pada dependency development `braces@3.0.3`.**

Tidak ada perubahan production, migration `0014`, merge ke `main`, atau pekerjaan F13.


## F12.2 Clean Integration Addendum — 2026-10-04

Addendum ini memperbarui verdict F12.1 sebagai keputusan F12 terkini sesuai risk acceptance terbatas yang disetujui pemilik proyek, [RA-2026-F12-001](security-risk-acceptance-f12-braces.md). Semua pernyataan FAIL sebelumnya tetap utuh sebagai kesimpulan historis berdasarkan aturan acceptance dan bukti saat itu.

### Acceptance disposition

* **Authenticated browser acceptance: RESOLVED.** Alur Ketua RT untuk daftar, pencarian, pembuatan, pengubahan, dan penonaktifan household lulus; reset PIN mencabut sesi; replacement penghuni pada rumah yang sama mempertahankan tunggakan lama; konflik ditolak tanpa mutasi parsial; pemeriksaan otorisasi dan lima ukuran viewport lulus pada source F12.1 yang diuji.
* **Integritas finansial dan migrasi: PASS.** Journal Neon development tetap 14 entri hingga `0013_phase_12_household_management`; tidak ada `0014`. Audit lifecycle read-only yang diulang pada 2026-10-04 menghasilkan 11/11 pemeriksaan anomali global bernilai nol; bukti pasca-smoke sebelumnya pada exact target yang sama mencatat 15/15 pemeriksaan fixture nol. Gate C menghasilkan 32/32 kategori anomali bernilai nol.
* **Audit dependency runtime/production: PASS.** `npm audit --omit=dev` melaporkan 0 vulnerability. Critical runtime blockers: **0**. High runtime blockers: **0**.
* **Full dependency audit:** belum bersih. `npm audit` melaporkan **5 entri High, 0 Critical**, seluruhnya propagasi dari satu akar temuan: `braces@3.0.3` dalam rantai development lint-tooling. Temuan tetap berseverity High dan berstatus **KNOWN / ACCEPTED RESIDUAL RISK**, bukan resolved.
* **Batas risk acceptance:** hanya GHSA-vfj7-8cjw-p6xm / CVE-2026-93687 pada rantai development-only tersebut. Acceptance tidak mencakup temuan High lain atau di masa depan, temuan Critical, kerentanan runtime/production, masalah kode aplikasi, atau cacat autentikasi/kredensial.

Checkpoint bersih harus lulus quality gates pada clean source dan CI untuk exact checkpoint sebelum promosi. Exact SHA clean/main dan ID run CI akan dicatat pada laporan integrasi final setelah diverifikasi; addendum ini sengaja belum menyatakannya.

**After the clean-source/local quality gates pass, the F12 verdict is: F12 PASS — with explicitly accepted dev-tooling residual risk RA-2026-F12-001. GO integration to main. GO F13 planning only after clean main checkpoint is verified.**

Production tetap di luar cakupan mutasi checkpoint ini. Implementasi F13 belum dimulai.
