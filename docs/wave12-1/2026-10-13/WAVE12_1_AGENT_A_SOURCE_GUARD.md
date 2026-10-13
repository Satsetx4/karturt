# Wave 12.1 A — Source Guard Alignment

**Tanggal:** 13 Oktober 2026 (Asia/Bangkok)
**Verdict:** **PASS untuk patch source dan pemeriksaan lokal; staging tetap BLOCKED.**

## Baseline dan identitas target

- Repository: `Satsetx4/karturt`
- Worktree: `D:\!AGY\karturt-wave12-1-agent-a-20261013`
- Branch lokal: `codex/wave12-1-staging-target-20261013`
- Baseline bersih: commit `355c5804df9767e7ce8456edde4439a4a7eaedc9`, tree `df520d59d675e46f43c4b224798fe4b237e36360`.
- Patch source/test: commit `d4fc471a988c070ca2118e12ddbb0b363daa6541`, tree `15bb2fc622f19d0715906479083ae87bcbb85cec`.

Identitas target berikut dikonfirmasi oleh Agent B melalui pembacaan metadata Neon independen dan diteruskan oleh koordinator; Agent A tidak mengakses provider:

| Field | Nilai terverifikasi |
|---|---|
| Project | `wild-art-99835126` |
| Branch | `br-hidden-cake-a1ge5xqp` |
| Database | `karturt_staging` (`42079960`) |
| Endpoint | `ep-snowy-meadow-a10304d9` |
| Hostname | `ep-snowy-meadow-a10304d9.ap-southeast-1.aws.neon.tech` |
| Role | `karturt_staging_owner` |

Metadata juga melaporkan `init_source=parent-data` dan akses passwordless diizinkan. Isi database serta lineage tetap belum diverifikasi. Keadaan ini tidak dianggap sebagai bukti database kosong.

## Perubahan dan perilaku guard

- `src/lib/staging-database-target.ts` kini mencatat project, branch, database ID/nama, endpoint ID, dan hostname yang dikonfirmasi. Target lama dan endpoint/database lain tetap gagal pada pemeriksaan staging.
- `stagingIsolationVerifiedEmpty` tetap `false`. URL yang cocok melewati pencocokan identitas lalu berhenti pada guard `parent-data`; koneksi staging tidak diaktifkan.
- Endpoint langsung dan hostname pooler target tetap ditolak jika dipakai dengan label `development` atau `production`.
- `tests/unit/environment.test.ts` mencakup target cocok yang tetap diblokir, endpoint/database lama, endpoint atau database yang keliru, URL tanpa password, dan penolakan endpoint langsung/pooler pada label non-staging.
- `src/lib/env.ts`, `src/lib/env-file-preflight.ts`, wrapper Next, `src/db/migrate.ts`, dan `drizzle.config.ts` diperiksa tetapi tidak diubah. Jalur migrasi standar tetap melewati `requireDatabaseEnvironment()`; konfigurasi Drizzle offline tidak memuat kredensial atau membuka koneksi.

> Runtime `DATABASE_URL` dapat mengikat hostname endpoint dan nama database. Project ID, branch ID, dan database ID dicatat sebagai identitas allowlist/provenance; nilai tersebut tidak dikodekan di URL dan dikonfirmasi terpisah lewat metadata provider.

## Pemeriksaan lokal

Semua perintah dijalankan di worktree ini. `npm ci` memakai lockfile yang tidak berubah, dengan lifecycle scripts dan audit dinonaktifkan; dependensi hanya dipasang di `node_modules` worktree ini.

| Perintah | Exit | Hasil |
|---|---:|---|
| `npm ci --ignore-scripts --no-audit --no-fund` | 0 | 442 paket dipasang lokal; tidak menjalankan lifecycle scripts. |
| `npm test -- --maxWorkers=1 tests/unit/environment.test.ts tests/unit/env-file-preflight.test.ts` | 0 | 2 file, 18 tes lulus. Ada peringatan konfigurasi Vite yang tidak memengaruhi hasil. |
| `npm run lint` | 0 | 0 error; 2 warning yang sudah ada di `scripts/phase-12-household-browser-smoke.ts:1005` dan `src/lib/billing/resident-card.ts:91`. |
| `npm run typecheck` | 0 | `tsc --noEmit` lulus. |
| `npm run db:check:offline` | 0 | Journal Drizzle valid; memakai konfigurasi offline. |
| `npm run build` | 0 | Build produksi selesai; dijalankan dengan label staging sintetis dan `DATABASE_URL` tidak disetel, sehingga tidak dapat membuka koneksi database. |
| `git diff HEAD^ HEAD --check` | 0 | Tidak ada masalah whitespace. |

## Batas pemeriksaan

- Agent A tidak melakukan wake, koneksi, query, inspeksi isi database, migration, DDL/DML, fixture, atau teardown. Agent A tidak membaca file `.env` maupun nilai kredensial.
- Tidak ada perubahan resource Neon, Vercel, deployment, GitHub remote, merge, atau push dari lane ini.
- Guard alignment **bukan** bukti emptiness, migration pass, staging readiness, atau release approval. Pemeriksaan read-only database tetap BLOCKED selama lineage/isi belum terbukti aman dan passwordless access masih diizinkan.
- Pemeriksaan direct Next CLI bypass tidak diubah dalam patch ini.

Patch source/test berada pada commit `d4fc471a988c070ca2118e12ddbb0b363daa6541` (tree `15bb2fc622f19d0715906479083ae87bcbb85cec`). Laporan ini disiapkan terpisah untuk konsolidasi di branch dokumentasi Wave 12.1.
