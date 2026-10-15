# Wave 13B.1S — Agent B D1v2 Operator Readiness

Tanggal: 2026-10-15

Status: **NOT_EXECUTED_ACCESS_SAFETY_BLOCKED**

## Ringkasan

Prasyarat D1v2 diperiksa secara offline dan metadata Neon dibaca melalui control plane tanpa koneksi database. Target control-plane masih cocok dengan tuple yang disetujui. Eksekusi berhenti sebelum koneksi karena `psql`, CA untuk TLS `verify-full`, berkas kredensial owner-only yang dapat diverifikasi, dan baseline expected-state yang disetujui tidak tersedia pada lingkungan kerja ini.

Tidak ada query SQL, koneksi database, wake compute, perubahan provider, atau file SQL hasil ekstraksi. Karena tidak ada hasil database, status ini bukan `CLEAN_CATALOG_PREFLIGHT`, `UNCLEAN`, atau `UNKNOWN`.

## Pemeriksaan artefak SQL beku

| Pemeriksaan | Hasil | Cara pemeriksaan |
|---|---|---|
| Artefak | PASS — Git blob SHA-1 `e011f0e843d42d53c7c4c76ba479854644137fc9` | `git rev-parse HEAD:<path>` dan `git hash-object --path=<path> <path>` sama-sama cocok; `git diff HEAD -- <path>` bersih. |
| Fenced SQL | PASS — tepat 26, berurutan | Fenced block dibaca dan dinormalisasi CRLF ke LF di memori; tidak ditulis menjadi file. |
| Fingerprint tiap statement | PASS — 26/26 cocok | SHA-256 UTF-8 dari isi tiap fence dibandingkan dengan tabel fingerprint di dokumen. |
| Ordered manifest | PASS — `ab7193d72520482a50081fdb65edc098fdac1cc9530d161430ddc6b9a0759db0` | SHA-256 atas 26 baris `Qnn:<statement SHA-256>`, satu baris LF-terminated per statement. |

Dokumen yang diuji tetap [WAVE13B_1R_FIXED_SQL_REFERENCE.md](../../wave13b-1r/2026-10-14/WAVE13B_1R_FIXED_SQL_REFERENCE.md). Tidak ada isi SQL atau fingerprint yang diedit.

## Pemeriksaan lokal offline

Pemeriksaan dilakukan oleh [d1v2-offline-preflight.ps1](d1v2-offline-preflight.ps1). Skrip ini tidak memiliki langkah untuk memanggil `psql`, membuka koneksi, menghubungi Neon, membaca isi kredensial atau baseline, atau menulis file SQL. Ia menghasilkan JSON diagnostik terbatas dan berakhir dengan status non-zero jika prasyarat belum lengkap. Sebelum menyentuh file, skrip menolak UNC, mapped network drive, dan path reparse point; PATH juga hanya dipindai pada drive lokal fixed.

| Gate lokal | Hasil pada 2026-10-15 | Batas pemeriksaan |
|---|---|---|
| PostgreSQL `psql` | BLOCKED — executable tidak ditemukan pada PATH drive lokal fixed. | Skrip hanya memeriksa keberadaan executable dan ACL jika tersedia; tidak menjalankannya. Versi belum diverifikasi. |
| CA libpq | BLOCKED — `PGSSLROOTCERT` tidak disetel dan CA tidak ditemukan pada lokasi Windows default `%APPDATA%\postgresql\root.crt`. | Pemeriksaan hanya metadata keberadaan, akses baca, dan ACL write yang luas; trust chain, masa berlaku, dan handshake tidak diuji. |
| `PGPASSFILE` | BLOCKED — override `PGPASSFILE` tidak disetel dan file default libpq tidak ditemukan/ACL owner-only tidak dapat diverifikasi. | Path tidak dicetak dan konten tidak dibaca. Sumber yang diperiksa adalah override jika disetel, jika tidak lokasi default Windows. |
| Baseline expected-state | BLOCKED — tidak ada path baseline lokal yang diberikan; paket owner sebelumnya menyatakan baseline belum disetujui. | Skrip hanya memeriksa keberadaan dan akses baca bila path diberikan; isi dan persetujuan owner tidak dibaca atau dianggap sah. |
| TLS dan target | Ekspektasi tetap: `sslmode=verify-full` ke `ep-silent-butterfly-azrflu40.c-3.ap-southeast-1.aws.neon.tech`. | Ini adalah nilai target yang dipin, bukan hasil TLS. Verifikasi sertifikat dan hostname baru terjadi pada koneksi yang disetujui. |

Eksekusi checker menghasilkan `NOT_EXECUTED_ACCESS_SAFETY_BLOCKED`; `databaseConnectionAttempted=false`, `psqlLaunched=false`, `credentialContentsRead=false`, `baselineContentsRead=false`, dan `sqlFileCreated=false`. Output juga mengonfirmasi blob dan manifest di atas.

## Readback metadata Neon non-waking

Readback dilakukan pada 2026-10-15 hanya menggunakan operasi metadata control-plane baca-saja. Seluruh identifier yang disetujui masih cocok:

| Resource | Readback terbaru |
|---|---|
| Organization | `satset` — `org-ancient-boat-57106549` |
| Project | `karturt-v1-staging-clean` — `falling-bread-33359184`; PostgreSQL 18; region `aws-ap-southeast-1`; Free |
| Branch | `staging` — `br-muddy-frost-azot13fb`; `ready`, primary/default, tidak diproteksi; `init_source=parent-data`; `updated_at=2026-10-14T12:29:04Z` |
| Compute/endpoint | `ep-silent-butterfly-azrflu40`; host langsung `ep-silent-butterfly-azrflu40.c-3.ap-southeast-1.aws.neon.tech`; tipe `read_write`; status `idle`; suspended sejak `2026-10-14T06:07:17Z` |
| Database | `karturt_staging` — ID `702718`; owner `karturt_staging_owner` |
| Login role | `karturt_staging_owner`; autentikasi metadata `password` |

Metadata saat ini juga menunjukkan branch `protected=false`, `written_data_bytes=0`, ukuran logis `31,686,656` byte, `passwordless_access=true`, project `block_public_connections=false`, `block_vpc_connections=false`, serta allowlist IP kosong. Angka nol, status Free, metadata passwordless, nama branch, dan `init_source=parent-data` tidak membuktikan data kosong, lineage independen, biaya Rp0, atau akses SQL tanpa autentikasi. Metadata jaringan ini tetap menjadi blocker untuk kesiapan migrasi. Tidak ada operasi yang dimulai Agent B; endpoint tetap melaporkan status idle.

Readback control-plane bukan pembuktian isi database atau akses jaringan dari luar. Identitas wajib dibaca ulang tepat sebelum koneksi jika seluruh gate nanti terpenuhi. Pada readback 2026-10-15, jumlah operasi historis proyek staging baru tetap lima dan proyek lama `wild-art-99835126` tetap sebelas; semuanya berasal dari tanggal 14 Oktober, tanpa operasi baru pada wave ini. Kedua compute tetap idle. Nilai `written_data_bytes=0` dan `init_source=parent-data` bukan bukti emptiness atau lineage independen.

## Tindakan minimum owner

1. Sediakan dan setujui secara terpisah baseline expected-state untuk target persis di atas. Baseline minimal mencakup role dan membership, schema dan extension, owner, objek yang diizinkan, ACL mentah serta privilege efektif, dan ekspektasi keberadaan objek migration ledger. Jangan kirim isi sensitif ke chat atau repository.
2. Sediakan secara lokal `psql` PostgreSQL 18, CA Neon tepercaya untuk `verify-full`, dan `PGPASSFILE` dengan ACL owner-only untuk target persis tersebut. Jangan kirim kredensial.
3. Beri tahu coordinator setelah prasyarat lokal tersedia. Persetujuan owner yang tercatat tetap terbatas pada satu proses `psql`, satu transaksi, tepat 26 statement beku, target dan metode yang sama, serta kemungkinan satu wake compute. Coordinator harus mengulang readback identitas tanpa wake tepat sebelum koneksi.

Baseline yang bersih maupun hasil D1v2 nantinya tetap tidak membuktikan lineage independen atau pengosongan fisik database. Guard `stagingIsolationVerifiedEmpty=false` dan `PINNED_STAGING_MIGRATION_APPROVAL_PUBLIC_KEY_PEM=null` tetap wajib dipertahankan; tidak ada otorisasi DDL/migrasi dari wave ini.

## Batas dan perubahan

- Tidak memakai Neon SQL, driver database, atau koneksi langsung.
- Tidak membaca, mencetak, menyalin, atau menyimpan isi rahasia.
- Tidak mengubah guard, migration, Vercel, atau metadata/provider state.
- Tidak mendorong branch atau membuat commit; seluruh perubahan Agent B tetap lokal untuk review coordinator.
