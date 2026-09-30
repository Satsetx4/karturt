# Fase 4.5 — Audit Core Readiness

Tanggal verifikasi: 30 September 2026

## Hasil

**GO untuk mulai pekerjaan Fase 5.** Audit writer, batas transaksi, authorization scope, dan trigger append-only lulus pengujian lokal, CI, serta Neon development. Keputusan ini mengizinkan pekerjaan Fase 5 dimulai; keputusan ini bukan persetujuan deploy ke production.

## Baseline dan SHA

| Item | Nilai |
|---|---|
| Baseline branch | `fix/phase-4-1-resident-card-cleanup` |
| Baseline SHA | `d8c9251137b8dedb601a629177f192f4c2a40f30` |
| Branch kerja | `feat/phase-4-5-audit-core-readiness` |
| Final audited implementation SHA | `10496dd3135b9aeffd9efd2d74cc94f3790c30c1` |
| Remote default branch | `feat/milestone-1-foundation` (`522447cbabfcfbd3a18e3cd50266fe91bf781cb1`) |
| Migration head | `0003_due_auth_audit_domain.sql` |

Implementation SHA di atas memuat seluruh perubahan kode yang diverifikasi Actions. Report ini merupakan commit dokumentasi sesudah implementation SHA. Branch tetap terpisah; tidak ada PR, merge, atau perubahan ke default branch.

## Compliance matrix

| Area | Status | Bukti / hasil |
|---|---|---|
| Kontrak canonical | PASS | `audit_events` menyimpan actor account UUID, action, entity type/UUID, timestamp DB, reason, dan context. Writer mengembalikan ID dan timestamp yang dibuat database. |
| Validasi writer | PASS | Writer hanya menerima objek transaksi Drizzle, memvalidasi ID/action/entity, membatasi ukuran context, dan menolak context yang belum di-allowlist. Context dua action pemulihan hanya berisi recovery reference berformat terkontrol dan jumlah sesi yang dicabut. |
| Append-only | PASS | Migration memasang trigger `BEFORE UPDATE OR DELETE` per baris serta `BEFORE TRUNCATE` per statement. Neon development menolak ketiga operasi dengan SQLSTATE `55000`. |
| Batas transaksi | PASS | Reset PIN dan pemulihan TOTP menulis perubahan domain serta audit pada transaksi yang sama. Test membuktikan commit bersama dan rollback bersama. |
| Audit insert gagal | PASS | FK aktor yang tidak valid menghasilkan SQLSTATE `23503`; perubahan password, lockout, dan sesi pada test tetap pada nilai sebelum operasi, tanpa audit sukses. |
| Domain gagal | PASS | Di Neon development, constraint domain sengaja gagal setelah audit sempat ditulis di savepoint; event audit ikut hilang. Forced rollback menghilangkan perubahan domain dan event. |
| Authorization dan scope RT | PASS | Treasurer ditolak untuk reset PIN, Chairman dari RT lain tidak menemukan target, System Admin tanpa recovery reference ditolak, dan kasus-kasus tersebut tidak meninggalkan audit sukses. Actor berasal dari principal yang dipakai service. |
| Privasi reason/context | PASS dengan batasan | Field context memiliki allowlist per action dan menolak key tak dikenal, email, nomor telepon, nilai credential yang diberi label, kode PIN/OTP berlabel, dan JWT pada reason. Batasan pemindaian reason dicatat pada residual risk. |
| Concurrency | PASS | Test integrasi menjalankan dua transaksi terpisah bersamaan; kedua mutasi domain dan kedua event audit tersimpan. |
| Neon development | PASS | Endpoint URL lokal dipetakan live ke branch `karturt-development`, bukan default `production`. Probe rollback selesai tanpa baris tersisa. Tidak ada koneksi atau SQL ke production. |
| Schema/migration | PASS | `drizzle-kit check` lulus; generate drift menyatakan tidak ada perubahan schema/migration. Head tetap `0003_due_auth_audit_domain.sql`; Neon mencatat empat migration yang cocok dengan `0000`–`0003`. |
| CI | PASS | [GitHub Actions run 36745352693](https://github.com/Satsetx4/karturt/actions/runs/36745352693) sukses pada implementation SHA `10496dd3135b9aeffd9efd2d74cc94f3790c30c1`, termasuk full suite dan production build. |
| Batas scope | PASS | Tidak ada perubahan UI/API/tabel Payment Request, WhatsApp deep link, maupun Fase 6. Wording Resident Card tidak diubah. |

## Pemeriksaan Neon development

Identity branch diverifikasi melalui metadata Neon live dan dicocokkan dengan hostname di `.env.local` tanpa menampilkan connection string atau kredensial:

- Project: `billowing-base-57949906` (KartuRT), region `aws-ap-southeast-1`.
- Development branch: `karturt-development`, ID `br-crimson-band-az6i637k`.
- Endpoint langsung: `ep-quiet-cake-azrhjiyh`.
- Default branch adalah `production`, ID `br-patient-band-azznfh28`, dengan endpoint berbeda. Branch default hanya dibaca dari metadata; tidak ada koneksi SQL ke sana.
- Label lokal sebelum probe: `APP_ENV=development`, `DATABASE_ENV=development`; database `neondb`.
- Trigger aktif: `audit_events_no_update_or_delete` dan `audit_events_no_truncate`.
- Role development memiliki privilege SQL UPDATE/DELETE/TRUNCATE, sehingga penolakan yang diamati berasal dari trigger, bukan penolakan privilege. Probe mengonfirmasi SQLSTATE `55000` untuk UPDATE, DELETE, dan TRUNCATE.
- FK aktor menggagalkan insert uji (`23503`); constraint domain uji gagal (`23514`). Kedua kasus me-rollback perubahan terkait. Transaksi luar di-rollback, lalu query read-only menemukan `0` baris probe Fase 4.5.

Pemetaan endpoint ke branch mengikuti model compute-per-branch Neon; ID endpoint berawalan `ep-` dan tercantum bersama `branch_id` pada metadata endpoint. Lihat [Neon: Manage computes](https://neon.com/docs/manage/endpoints/).

## Test dan CI

| Pemeriksaan | Hasil |
|---|---|
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `npm run test:unit -- --maxWorkers=1` | PASS — 25 test |
| `npm run test:integration -- --maxWorkers=1` | PASS — 34 test, 12 file |
| `npm run test:constraints -- --maxWorkers=1` | PASS — 14 test |
| `npm run test:authorization -- --maxWorkers=1` | PASS — 4 test |
| `npm test -- --maxWorkers=1` di runner lokal | Tidak selesai: proses Node berakhir dengan `Fatal process out of memory`; percobaan single-worker thread juga terkena OOM. Kategori terpisah semuanya lulus. |
| Full suite pada GitHub Actions | PASS — run 36745352693 |
| `npm run build` | PASS — production build lokal dengan nilai build-only non-secret |
| `npx drizzle-kit check` | PASS |
| `npm run db:generate -- --name phase_4_5_audit_core_drift_check` | PASS — tidak ada perubahan schema |
| `npm run db:test-audit-neon` | PASS — UPDATE/DELETE/TRUNCATE, FK failure, domain failure, rollback, no residue |

Run penuh CI pada runner Ubuntu sukses; OOM hanya terjadi pada runner Windows lokal. Warning Better Auth selama test login unmatched adalah keluaran yang diharapkan dan test terkait lulus.

## Bug yang ditemukan dan perbaikan

1. Writer sebelumnya menerima context `Record<string, unknown>` tanpa allowlist, sehingga caller dapat menyisipkan properti arbitrer. Writer sekarang mengunci shape context untuk event yang sudah aktif dan menolak context non-empty untuk action yang belum didaftarkan.
2. Test lama memaksa exception setelah helper audit, tetapi tidak memaksa kegagalan insert audit sebenarnya. Test baru memakai FK aktor invalid dan memastikan password, lockout, serta sesi tetap utuh.
3. Belum ada pemeriksaan concurrency audit writer. Test baru menjalankan dua mutasi/audit transaction bersamaan dan memeriksa kedua hasil.
4. Workflow Gate A belum terpicu pada branch fase ini. Filter push kini mencakup `feat/phase-4-5-audit-core-readiness`.

Tidak diperlukan migration baru: trigger dan struktur tabel sudah ada pada migration `0003`.

## Taxonomy audit untuk Fase 5/6 — desain saja

Daftar ini dokumentasi kontrak yang akan dipertimbangkan saat fase terkait dikerjakan. Tidak ada action payment, schema, endpoint, UI, notifikasi, atau WhatsApp yang ditambahkan dalam Fase 4.5.

| Action usulan | Actor/entity | Context aman yang dapat dipertimbangkan |
|---|---|---|
| `payment_request.created` | Resident terautentikasi / `payment_request` | periode tagihan, total nominal, jumlah bulan; tanpa isi bukti, nomor rekening, atau kontak |
| `payment_request.cancelled` | Resident pemilik request / `payment_request` | status sebelumnya dan reason code |
| `payment_request.verified` | Treasurer dalam RT yang sama / `payment_request` | jumlah tagihan yang ditautkan dan reason code |
| `payment_request.rejected` | Treasurer dalam RT yang sama / `payment_request` | reason code; jangan simpan teks privat yang diketik bebas |
| `payment_request.receipt_replaced` | Resident pemilik request / `payment_request` | versi/count attachment saja; bukan URL, file, OCR, atau metadata EXIF |
| `payment_reminder.delivery_attempted` | service principal / `payment_reminder` | kanal, template ID, kode hasil provider; tanpa nomor telepon, message body, atau deep link |

Setiap action baru perlu menambahkan allowlist context eksplisit, mengambil actor dari principal/service principal, memvalidasi scope RT sebelum mutasi, lalu menulis domain dan audit dalam transaksi yang sama. Event Fase 6 di atas juga hanya ide desain.

## Residual risks

- `reason` masih berupa teks bebas untuk service yang sudah ada. Writer menolak pola credential/PII yang jelas, tetapi pemeriksaan pola bukan deteksi sempurna; jangan menaruh secret, PIN, detail kontak, atau isi sensitif di reason. Fase 5 sebaiknya menggunakan reason code yang sudah ditinjau.
- Trigger append-only mencegah operasi UPDATE/DELETE/TRUNCATE biasa, tetapi pemilik tabel atau role administratif dengan hak DDL dapat menonaktifkan atau menghapus trigger. Role Neon development saat ini memang memiliki hak mutasi tabel. Audit anti-tamper terhadap insider/admin memerlukan pemisahan role/credential atau sink eksternal yang tidak dapat ditulis ulang; itu di luar scope Fase 4.5.
- Local full-suite Windows runner kehabisan memori; GitHub Actions menjalankan full suite dengan sukses pada SHA yang diuji.

## Keputusan

**PASS — GO untuk mulai Fase 5.** Gunakan transaction + audit helper untuk setiap mutasi, daftarkan context per action secara eksplisit, serta pakai reason code/safe text. Hasil ini tidak mengizinkan deploy production dan tidak mengubah keputusan atau wording Resident Card yang telah disetujui.
