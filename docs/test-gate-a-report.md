# Test Gate A — Repair Fase 0–3

**Tanggal:** 30 September 2026
**Branch kerja:** `repair/phase-0-3`
**Baseline source commit:** `522447cbabfcfbd3a18e3cd50266fe91bf781cb1`
**Verified repair code commit:** `d01f57cadb59511a67725b261906b5c1be41ec3c`
**Migration head:** `0003_due_auth_audit_domain`
**Runtime:** Node.js `v24.19.0`
**Source of truth:** `karturt-feat-milestone-1-foundation.zip` dan Master Context v2 tanggal 30 September 2026.

Perubahan ini berada pada branch terpisah. Tidak ada push atau merge ke `main`.

## Ringkasan keputusan gate

**Automated Gate A lokal: PASS.** Seluruh lint, typecheck, unit, integration, constraints, authorization, build, migration consistency, dan migration smoke lokal yang dapat dijalankan lulus.

**Gate A keseluruhan: NO-GO ke Fase 4.** Development Neon tidak terkonfigurasi pada checkout ini (`.env.local` tidak ada dan `DATABASE_URL` tidak tersedia). Karena itu isolasi branch Neon, penerapan migration pada database development yang sesungguhnya, dan auth/billing smoke terhadap Neon belum diverifikasi. Guard `npm run db:check` berhenti sebelum mencoba koneksi, sesuai perilaku fail-fast.

GO per tahap di bawah berarti implementasi dan bukti lokal tahap tersebut selesai. Itu tidak membuka Fase 4 selama gate Neon masih terbuka.

## Laporan per tahap

| Tahap | File utama yang berubah | Perbaikan dan bukti | Risiko tersisa / workaround | Hasil tahap |
|---|---|---|---|---|
| **0 — Freeze baseline dan inventaris** | `docs/test-gate-a-report.md` | Source ZIP dipetakan ke baseline `522447c`; perubahan dikerjakan pada branch `repair/phase-0-3`. Status awal dan mismatch diambil dari Master Context v2 dan dibandingkan dengan schema, route, migration, serta test yang tersedia. | ZIP tidak membawa metadata Git. Baseline SHA berasal dari checkout yang isinya cocok dengan ZIP; laporan tetap membedakan baseline itu dari repair commit. | **GO** |
| **1 — Schema `NOT_DUE`** | `src/db/schema.ts`, `drizzle/0003_due_auth_audit_domain.sql`, `drizzle/meta/0003_snapshot.json`, `drizzle/meta/_journal.json` | Enum due menjadi `not_due/unpaid/paid/waived`; constraint membedakan `NOT_DUE` tanpa obligation dari `WAIVED` yang memerlukan nominal positif dan alasan. Test upgrade menjalankan migration lama, membuat legacy `waived/not_yet_resident`, lalu memastikan hasilnya `not_due` dengan alasan kosong. | Penerapan pada Neon belum dilakukan. Workaround: setelah development branch terkonfirmasi dan backup disiapkan, jalankan migration terkontrol di sana lalu cek enum/row hasil. | **GO lokal** |
| **2 — Billing lifecycle join/leave** | `src/lib/billing/generator.ts`, `src/lib/billing/activation.ts`, `drizzle/0002_monthly_due_period_guard.sql`, `tests/unit/billing-generator.test.ts`, `tests/integration/billing-generator.test.ts` | Bulan sebelum join dan setelah bulan akhir menjadi `NOT_DUE`; tunggakan saat household aktif tetap melekat pada household lama; due generator tetap 12 bulan, jatuh tempo tanggal 10, fee snapshot, serta retry aman. Regression mencakup join, leave, tanggal invalid, dan pengulangan generator. | Aturan prorata untuk mulai/akhir pada tengah bulan tidak ditentukan Master Context. Implementasi mengenakan bulan mulai dan bulan akhir sebagai bulan penuh, konsisten dengan model bulanan yang ada; konfirmasi bisnis diperlukan sebelum dipakai menagih data nyata. | **GO lokal** |
| **3 — Regression test billing** | `tests/unit/billing-generator.test.ts`, `tests/integration/billing-generator.test.ts`, `tests/constraints/database-constraints.test.ts`, `tests/integration/migration-upgrade.test.ts` | Status dan batas tanggal diuji pada generator, constraint PostgreSQL-compatible, retry, legacy backfill, serta periode household yang berakhir. Empat suite Gate A mencatat 17 unit, 27 integration, 14 constraint, dan 4 authorization test lulus. | PGlite tidak mewakili beberapa koneksi Neon independen untuk race/concurrency produksi. Workaround: jalankan concurrent smoke terhadap development Neon sebelum data warga dipakai. | **GO lokal** |
| **4 — Resident provisioning** | `scripts/provision-account.ts`, `src/lib/accounts/resident-provisioning.ts`, `.env.example`, `tests/integration/account-provisioning.test.ts`, `README.md` | Identifier warga diturunkan dari `house.number`. PIN harus enam digit numerik. Provisioning memverifikasi person/household/house aktif dan konsistensi RT; input identifier bebas untuk akun resident ditolak. Prefix env account disamakan dengan yang dibaca script. | CLI belum dijalankan pada Neon nyata karena tidak ada kredensial development. Jalankan hanya dengan variabel one-time di `.env.local` dan koneksi branch development. | **GO lokal** |
| **5 — Lockout PIN** | `src/lib/auth/login-lockout.ts`, `src/lib/auth/login-account.ts`, `src/app/api/login/[type]/route.ts`, `tests/integration/resident-lockout.test.ts`, `tests/integration/resident-login-route.test.ts` | Lima PIN salah mengunci akun 15 menit; keberhasilan login/reset mengosongkan counter. Jalur HTTP resident diuji dengan house number + PIN yang benar. Respons gagal tetap generik, sementara rate limit IP Better Auth aktif. | Perilaku `x-forwarded-for` harus dikonfirmasi di deployment: proxy tepercaya perlu menimpa header dari klien. Workaround sebelum produksi: batasi trusted proxy dan uji rate limit dari edge deployment. | **GO lokal** |
| **6 — Credential reset dan recovery** | `src/lib/auth/reset-resident-pin.ts`, `src/lib/auth/recover-system-admin-two-factor.ts`, `src/app/api/residents/[accountId]/reset-pin/route.ts`, `src/app/api/system-admin/accounts/[accountId]/recover-two-factor/route.ts`, `src/lib/audit/writer.ts`, `tests/integration/audit-and-credential-reset.test.ts`, `tests/integration/authentication.test.ts` | Ketua RT dapat reset PIN dalam RT-nya; Bendahara dan cross-RT ditolak. System Admin reset warga memerlukan reason + reference. Reset mencabut sesi dan menulis audit dalam transaksi. Backup code diuji satu kali pakai. Kehilangan authenticator dan seluruh backup code memakai recovery oleh System Admin lain yang telah memverifikasi TOTP; sesi target dicabut, faktor lama dihapus, tindakan diaudit, dan target tetap tidak memperoleh principal sampai TOTP baru diverifikasi. | Recovery darurat mensyaratkan ada System Admin lain yang masih dapat memverifikasi TOTP. Untuk instalasi dengan hanya satu admin yang kehilangan seluruh faktor, prosedur operator/out-of-band belum diotomasi. Workaround operasional: pertahankan admin recovery kedua yang telah diverifikasi dan ikat tindakan ke incident reference. | **GO lokal** |
| **7 — Official temporal lifecycle** | `src/lib/officials/lifecycle.ts`, `src/lib/auth/principal.ts`, `src/app/api/login/[type]/route.ts`, `drizzle/0003_due_auth_audit_domain.sql`, `tests/integration/official-lifecycle.test.ts`, `tests/constraints/database-constraints.test.ts` | `startsOn` dan `endsOn` inklusif terhadap business date Jakarta. Assignment mendatang belum memberi akses. Trigger menolak periode overlap untuk role RT yang sama atau account yang sama dan tetap mengizinkan pergantian berurutan; principal harus menemukan tepat satu assignment aktif. | Pengujian trigger dilakukan di PGlite, bukan transaksi paralel pada Neon. Workaround: validasi data existing/preflight dan concurrent assignment pada development Neon sebelum organisasi memakai akun pejabat. | **GO lokal** |
| **8 — Environment/config hazards** | `src/lib/env.ts`, `drizzle.config.ts`, `src/app/layout.tsx`, `scripts/bootstrap-rt.ts`, `scripts/provision-account.ts`, `.env.example`, `tests/unit/environment.test.ts` | Label `APP_ENV` dan `DATABASE_ENV` wajib eksplisit dan cocok; fallback URL database lokal di tooling dihapus; staging/production memerlukan app origin HTTPS eksplisit; placeholder auth secret ditolak. Bootstrap dan provisioning membaca prefix variabel yang sama dengan contoh. Production build dijalankan memakai nilai build-only, bukan credential deployment. | Label environment tidak membuktikan identitas branch di balik URL. Workaround: cocokkan Neon project/branch ID secara independen sebelum mengisi secret development atau menjalankan migration. | **GO lokal** |
| **9 — Authorization dan IDOR** | `src/lib/auth/permissions.ts`, `src/lib/auth/principal.ts`, `src/lib/billing/activation.ts`, `src/lib/billing/generator.ts`, `src/lib/billing/resident-dues.ts`, `src/app/api/resident/monthly-dues/route.ts`, `tests/authorization/permissions.test.ts`, `tests/integration/resident-dues-authorization.test.ts` | Tenant RT/household diturunkan dari principal dan scope wajib eksplisit untuk permission tenant. Service activation/generation tidak menerima `rtUnitId` dari klien. Resident dues dibaca hanya dari household pada principal; cross-RT, cross-household, Treasurer, dan principal tidak lengkap ditolak. | Service dues dan policy dites dengan PGlite; route handler dues tidak dijalankan end-to-end dengan session Neon. Workaround sebelum rilis: jalankan HTTP smoke terautentikasi pada preview + Neon development. | **GO lokal** |
| **10 — Security/regression tests** | `tests/unit/*`, `tests/integration/*`, `tests/constraints/database-constraints.test.ts`, `tests/authorization/permissions.test.ts` | Mencakup provisioning, login route, lockout, TOTP/backup code, recovery/reset, revocation, append-only audit, billing, bootstrap idempotency, migration upgrade, official lifecycle, dan data isolation. Semua suite lulus pada repair commit. | Tidak ada browser/device atau deployment-edge test pada tahap ini; pekerjaan yang berubah adalah fondasi server/data. Workaround: jalankan browser/preview dan perangkat nyata saat environment dev tersedia. | **GO lokal** |
| **11 — Audit Core sebelum financial mutation** | `src/db/schema.ts`, `drizzle/0003_due_auth_audit_domain.sql`, `src/lib/audit/writer.ts`, `src/lib/auth/reset-resident-pin.ts`, `src/lib/auth/recover-system-admin-two-factor.ts`, `tests/integration/audit-and-credential-reset.test.ts` | Audit event memuat actor/action/entity/time/reason/context, mempunyai append-only trigger, dan ditulis dalam transaksi yang sama dengan credential mutation. Test membuktikan commit bersama serta rollback bersama bila operasi gagal. | Payment/waiver/adjustment mutation belum ada pada fase ini dan tidak diklaim terlindungi oleh writer. Saat service finansial dibuat, semua mutation kritis harus memanggil writer yang sama sebelum digunakan. | **GO untuk foundation** |
| **12 — Dokumentasi dan Gate A** | `README.md`, `docs/milestone-1-architecture.md`, `docs/test-gate-a-report.md` | Dokumen diperbarui tentang PIN, provisioning, recovery, due lifecycle, migration head, dan Gate A. Hasil serta hal yang belum terverifikasi dicatat pada laporan ini. | Neon development dan deployment smoke menunggu environment yang terisolasi dan terkonfirmasi. | **GO untuk laporan; Gate A keseluruhan NO-GO** |

## Bukti Test Gate A

| Pemeriksaan | Hasil | Bukti |
|---|---|---|
| Lint | PASS | `npm run lint` |
| Typecheck | PASS | `npm run typecheck` |
| Unit | PASS — 4 file, 17 test | `npm run test:unit` |
| Integration | PASS — 10 file, 27 test | `npm run test:integration` |
| Constraints | PASS — 1 file, 14 test | `npm run test:constraints` |
| Authorization | PASS — 1 file, 4 test | `npm run test:authorization` |
| Full suite | PASS — 16 file, 62 test | `npm test` |
| Production build | PASS | `npm run build` dengan label production, HTTPS origin, dan secret sementara khusus build; tidak memakai Neon credential |
| Migration journal consistency | PASS | `npx drizzle-kit check` dengan label eksplisit dan URL dummy yang tidak dipakai untuk koneksi |
| Schema drift | PASS | `npm run db:generate -- --name gate_a_schema_drift` menghasilkan “No schema changes, nothing to migrate” |
| Clean migration | PASS lokal | Test integration membuat database PGlite kosong dan menerapkan seluruh migration `0000`–`0003` |
| Legacy upgrade migration | PASS lokal | `tests/integration/migration-upgrade.test.ts` menjalankan `0000`–`0002`, memuat baris legacy, lalu menguji `0003` |
| Auth/billing smoke | PASS lokal | PGlite menguji resident login route, principal, dues milik household sendiri, activation/generation, due lifecycle, dan retry |
| Bootstrap rerun | PASS lokal | `tests/integration/bootstrap.test.ts` mencakup retry dan concurrent retry di PGlite |
| Production config validation | PASS lokal | `tests/unit/environment.test.ts` dan production build menolak label/URL/secret yang tidak valid |
| Neon development `db:check` | BLOCKED | `npm run db:check` berhenti pada guard eksplisit karena tidak ada `.env.local`, `APP_ENV`, `DATABASE_ENV`, atau `DATABASE_URL` |
| Browser/device smoke | NOT RUN | Tidak ada perubahan visual flow pada repair server/data; browser, preview deployment, dan perangkat fisik tetap perlu verifikasi di gate UX/UAT |

## Bug yang ditemukan dan diperbaiki

- Bulan sebelum household mulai disimpan sebagai waiver; sekarang menjadi `NOT_DUE`, dan data legacy dimigrasikan.
- Generator belum menutup periode setelah household berakhir; kini future month menjadi `NOT_DUE` sementara kewajiban historis tetap pada household lama.
- Constraint due sebelumnya tidak dapat membedakan ketiadaan kewajiban dari waiver; invariant amount/rate/reason diperketat untuk semua status.
- Provisioning resident menerima identifier bebas dan kurang memeriksa relasi RT/entity aktif; sekarang identifier berasal dari nomor rumah dan hubungan diperiksa di server.
- PIN salah belum memiliki lockout account-level yang ditentukan; sekarang lima kegagalan memicu lock 15 menit.
- Reset credential belum memiliki jalur terstruktur dengan audit dan session revocation; jalur Chairman dan recovery System Admin ditambahkan.
- Emergency recovery 2FA memerlukan backup code satu-kali-pakai dan jalur jika semua faktor hilang; kedua jalur kini diuji.
- Pemeriksaan pejabat sebelumnya tidak menghormati seluruh rentang `startsOn`/`endsOn`; sekarang menggunakan tanggal bisnis Jakarta dan menjaga larangan assignment overlap.
- Tooling memiliki fallback database yang berisiko dan contoh konfigurasi tidak selaras; tooling sekarang fail-fast dengan label eksplisit dan konfigurasi deployment tervalidasi.
- Authorization helper dapat dipanggil tanpa scope tenant yang memadai; tenant scope kini wajib dan data resident diturunkan dari principal.
- Belum ada fondasi audit append-only yang atomic; Audit Core kini tersedia untuk mutation kritis sebelum payment/waiver flow dipakai.

## Risiko tersisa dan tindak lanjut

1. **P1 — Gate blocker:** siapkan Neon branch development terpisah, pastikan project/branch ID, isi label yang cocok, jalankan `npm run db:check`, terapkan migration, lalu lakukan auth/billing HTTP smoke terhadap branch itu. Jangan memakai production connection untuk verifikasi ini.
2. **P2 — Proxy/IP trust:** pastikan hosting menimpa `x-forwarded-for` atau batasi trusted proxy sebelum mengandalkan limit per-IP.
3. **P2 — Database concurrency:** konfirmasi transaction/trigger behavior dengan koneksi PostgreSQL independen pada Neon development.
4. **P2 — Recovery satu-admin:** emergency TOTP recovery saat ini memerlukan admin lain yang sudah verified. Pertahankan admin kedua dan incident reference; prosedur operator untuk sistem yang hanya memiliki satu admin belum diotomasi.
5. **P2 — Billing bulan parsial:** tidak ada aturan prorata; saat ini bulan mulai dan akhir dihitung penuh. Konfirmasi sebelum tagihan data riil dibentuk untuk rumah yang mulai/berakhir di tengah bulan.
6. **P2 — Browser/deployment:** auth cookie, recovery UI, Resident Card, dan perilaku browser/mobile belum diuji pada deployment/physical device; Resident Card sendiri tetap berada di Fase 4.
7. **Audit boundary:** belum ada payment, waiver, reversal, atau adjustment service. Jangan membangun/mengaktifkan mutation finansial sebelum service tersebut menulis audit event dalam transaksi yang sama.

## Keputusan

**Repair Fase 0–3: selesai pada branch kerja; automated local gates PASS.**
**Test Gate A: NO-GO ke Fase 4 sampai development Neon, branch identity, migration, dan smoke live terverifikasi.**
**Merge/push:** tidak dilakukan.
