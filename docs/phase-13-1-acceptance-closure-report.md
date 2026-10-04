# KartuRT F13.1 — Laporan Penutupan Acceptance

**Tanggal:** 4 Oktober 2026

**Branch kerja:** `fix/phase-13-1-acceptance-closure`

**Source F13.1 yang diuji:** `6b90bdb35f7fe15950bf809b1792dee9db2df93b`

## Keputusan scope MVP

Mode operasional Single-RT disetujui untuk MVP: deployment pertama melayani satu RT. Fitur pengguna multi-RT berada di luar MVP, sementara `rt_unit_id`, isolasi tenant, constraint database, otorisasi, dan tes otomatis lintas-RT tetap dipertahankan. Tidak ada refactor schema, migration baru, penghapusan tenant guard, atau penyederhanaan model tenant.

F14 Export, F15 Audit UI, F16 Official Lifecycle UI, full F17 Admin tooling, F19 Notifications, F20 PWA, full F21 UX study, dan full F23 optimization berstatus **DEFERRED**, bukan dihapus. F14 berstatus **DEFERRED POST-LAUNCH**. Rincian keputusan ada di [mvp-single-rt-scope-freeze.md](mvp-single-rt-scope-freeze.md).

## Acceptance F13.1

F13 sebelumnya berstatus FAIL karena acceptance browser Ketua RT yang terautentikasi belum diselesaikan. Closure ini menyelesaikan jalur browser untuk deployment operasional Single-RT. Browser manual lintas-RT tidak diwajibkan oleh kebijakan acceptance yang telah disetujui; penolakan lintas-RT dan tenant spoof tetap diwajibkan lewat regresi otomatis.

- Login Ketua RT sintetis pada Neon development, dashboard → Laporan → `/app/laporan`: **PASS**.
- Tahun yang tersedia: 2026. Ringkasan tahunan dan semua 12 kartu bulanan tampil. Nilai UI cocok dengan `GET /api/chairman/reports?year=2026` yang dibaca dalam sesi yang sama: **PASS**.
- Agregasi SQL langsung, hanya SELECT, cocok dengan API untuk total tahunan, setiap bulan, dan tunggakan: **PASS**. Pada fixture ini tunggakan berjumlah Rp0, 0 periode, dan 0 household; nilai tersebut cocok antara UI, API, dan SQL.
- Identitas tahunan dan bulanan `Transfer + Tunai = Diterima` serta `Diterima + Dibebaskan + Belum diterima = Target efektif`: **PASS**.
- Pemeriksaan UI tidak menemukan UUID, SQL/stack trace, atau credential pada halaman laporan. Jumlah baris ledger/audit sebelum dan sesudah pembacaan sama; tes authorization juga memverifikasi read model tidak mengubah data finansial maupun audit: **PASS**.
- Lima viewport 360×800, 390×844, 430×900, 768×1024, dan 1440×900: **PASS**. Tidak ada horizontal overflow, nilai mata uang terpotong, kartu bertumpuk, selector tahun tidak bisa dipakai, tunggakan tidak terbaca, atau target sentuh di bawah 44px. Temuan awal berupa link brand 35px telah diperbaiki menjadi minimum 44px dan gate lokal diulang pada source SHA di atas.

### Semantik laporan

Fixture browser live tidak memiliki baris waiver, pending request, atau reversal; karena itu closure tidak mengklaim status tersebut teramati pada UI fixture live. Label “Dibebaskan” dan “Tidak ditagih” tampil terpisah. Tes manual oracle PGlite yang lulus pada source SHA ini membuktikan WAIVED terpisah dari NOT_DUE, NOT_DUE bernilai finansial nol, pending tidak dihitung sebagai penerimaan, allocation dari payment reversed dikecualikan, dan household historis tidak digabung dengan household pengganti pada nomor rumah yang sama.

Fixture browser live memiliki 4 household historis, tetapi tidak ada yang mempunyai tunggakan sehingga API dan UI tidak menampilkannya pada daftar tunggakan. Pemisahan lifecycle historis/pengganti dibuktikan oleh oracle PGlite dan query F13 terdahulu; tidak dinyatakan sebagai contoh live yang tampil.

## Authorization, integritas, dan kualitas

- Regresi authorization: 12 file / 111 tes **PASS**. Chairman aktif hanya dapat membaca RT sendiri; Chairman tidak aktif/assignment berakhir, Treasurer, Resident, System Admin, cross-RT, tenant spoof, dan query spoof ditolak. Perilaku API/halaman anonim aman.
- Migration journal: 14 entri, head `0013_phase_12_household_management`, tanpa `0014`. Tidak ada migration/schema drift.
- Gate C: 32/32 kategori anomali bernilai nol. Audit lifecycle F12 global: 11/11 pemeriksaan bernilai nol. Pemeriksaan fixture-specific F12.1 tidak dijalankan karena manifest F12.1 tidak tersedia pada branch ini.
- Gate lokal pada source SHA `6b90bdb35f7fe15950bf809b1792dee9db2df93b`: install, lint, typecheck, unit 42, integration 154, constraints 42, authorization 111, full suite 349, pemeriksaan Drizzle journal, schema drift, dan production build **PASS**. Lint menyisakan satu warning lama F12 pada `scripts/phase-12-household-browser-smoke.ts:1005`.
- Audit dependency penuh hanya menemukan residual dev-only yang sudah diterima `RA-2026-F12-001` untuk `braces@3.0.3`; tidak ada High/Critical baru. Audit dependency production-only: 0 vulnerability.

## Neon dan batas lingkungan

Target yang diverifikasi adalah DEVELOPMENT: project `billowing-base-57949906`, branch `karturt-development` (`br-crimson-band-az6i637k`), endpoint `ep-quiet-cake-azrhjiyh`, database `neondb`. Pemeriksaan integritas dan pembandingan laporan menggunakan SELECT. Satu-satunya write adalah rotasi credential sementara dan pencabutan sesi pada akun Ketua RT sintetis yang telah diidentifikasi; credential sementara kemudian diganti, dan jumlah sesi akhir terverifikasi nol. Tidak ada write ke ledger/audit dari pembacaan laporan. Production database dan deployment tidak disentuh.

## Evidence

Folder `docs/phase-13-1-acceptance-evidence/` berisi 13 file dengan ukuran total 556.138 byte. Isinya mencakup ringkasan browser, rekonsiliasi UI/API/SQL, lima hasil viewport, authorization, oracle manual, Gate C, lifecycle, Neon, audit dependency, gate kualitas, dan tiga screenshot kurasi. Screenshot dibuat dari server development sehingga badge `N` milik Next.js terlihat; badge itu bukan bagian dari UI produk. Bukti tidak menyimpan password, PIN, cookie, token, session secret, nama household, atau UUID.

## Verdict

F13 acceptance dan regresi lokal/browser: **PASS**. Riwayat FAIL F13 sebelum closure tetap tersimpan di [phase-13-reports-report.md](phase-13-reports-report.md), lalu ditutup oleh addendum F13.1.

```text
F13 PASS
Single-RT MVP operational mode: APPROVED
Multi-RT architecture: PRESERVED
F14: DEFERRED POST-LAUNCH
READY FOR MAIN PROMOTION: YES
READY FOR LAUNCH SAFETY GATE: YES
```

Gate A run `37202396608` PASS pada SHA `0093d9cb197924b4d4aaf1e338ef56aa10a6aa3f`. Perubahan readiness ini membentuk SHA branch baru; push tersebut wajib mendapat Gate A PASS pada exact SHA sebelum promotion atau memulai Launch Safety. Identitas run final exact-SHA dicatat dalam handover coordinator.
