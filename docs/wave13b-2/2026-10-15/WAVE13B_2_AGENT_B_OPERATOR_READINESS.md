# Wave 13B.2 — Agent B Operator Readiness

> **Packet ini membahas D1v2 pada target lama saja.** Untuk operator path project baru, gunakan [paket operator Free-only](../../codex/Wave-13B2-Free-Only-Staging-Operator-Packet-2026-10-15.md) dan [status koreksi owner terbaru](WAVE13B_2_OWNER_CORRECTION_EXECUTION.md). Approval D1v2 lama tidak berlaku ke project baru.

Tanggal: 2026-10-15
Status: **D1v2 NOT_EXECUTED_ACCESS_SAFETY_BLOCKED**

## Hasil dan batas lane

Pemeriksaan ini hanya membaca artefak Git dan menjalankan checker pra-koneksi yang offline. Tidak ada koneksi database, query, wake, akses kredensial, pengambilan CA, operasi provider, migrasi, deployment, atau file SQL hasil ekstraksi. Target dan persetujuan D1v2 lama tetap terikat pada tuple di owner packet; lane ini tidak melakukan readback identitas terbaru.

Persetujuan owner sebelumnya hanya mencakup satu proses psql, satu backend dan transaksi, tepat 26 statement beku, sslmode=verify-full, target lama yang dipatok, serta kemungkinan satu wake. Persetujuan itu tidak berlaku untuk proyek baru, target pengganti, metode lain, query tambahan, atau retry. Tidak ada izin migrasi/DDL.

## Integritas artefak beku

| Pemeriksaan | Hasil |
|---|---|
| Branch dan baseline docs | codex/karturt-v1-wave13b2-agent-b-20261015, HEAD 8621001e49be3bd5e8ff10ab0a3e2e7d4e1d612a |
| Frozen SQL reference | PASS — Git blob SHA-1 e011f0e843d42d53c7c4c76ba479854644137fc9 |
| Statement fences | PASS — tepat 26, berurutan |
| Fingerprint per statement | PASS — 26/26 cocok dengan tabel di referensi |
| Ordered manifest | PASS — SHA-256 ab7193d72520482a50081fdb65edc098fdac1cc9530d161430ddc6b9a0759db0 |
| Offline checker | PASS — blob 0104055df2055786f369bc407da87d0b6eea9f3f |
| File SQL hasil ekstraksi | Tidak dibuat |

Checker menghitung SHA-256 dari setiap isi fence setelah normalisasi baris LF di memori, mencocokkannya dengan tabel fingerprint, lalu memverifikasi hash manifest terurut. Artefak SQL dan checker tidak diedit.

Secara isi, urutan dimulai dengan SET TRANSACTION READ ONLY, lalu guard untuk database/login role/active role/versi PostgreSQL 18, kemudian baca metadata katalog terbatas. Referensi membatasi query ke nama/atribut role, schema, extension, objek, ACL mentah dan efektif, serta keberadaan objek migration ledger. Tidak ada pembacaan baris aplikasi atau isi ledger. Hasilnya tetap dapat memuat nama role, schema, objek, dan grant; jika suatu hari dijalankan dengan otorisasi lengkap, output harus tetap di lingkungan lokal yang dikendalikan owner dan ringkasan yang dibagikan harus disanitasi. Tidak ada raw output database pada lane ini.

## Checker offline dan perlindungan lokal

Saya menjalankan d1v2-offline-preflight.ps1 dari worktree ini. JSON checker menyatakan NOT_EXECUTED_ACCESS_SAFETY_BLOCKED dan menunjukkan:

| Gate lokal | Hasil pada run ini | Batas yang diperiksa |
|---|---|---|
| psql.exe | BLOCKED | Hanya dicari pada PATH di fixed drive lokal; tidak dijalankan dan versinya tidak diperiksa. |
| Root CA | BLOCKED | PGSSLROOTCERT tidak disetel dan file default libpq Windows tidak tersedia. Checker hanya menguji keberadaan, akses baca, dan broad-write ACL; bukan asal-usul CA, masa berlaku, chain, hostname, atau TLS. |
| PGPASSFILE | BLOCKED | File default/override tidak lolos pemeriksaan. Checker tidak mencetak path, membuka file, atau membaca password. |
| Expected-state baseline | BLOCKED | Tidak ada baseline lokal yang diberikan. Checker tidak membaca isi, target binding, kelengkapan, atau persetujuan owner. |
| Target TLS yang dipatok | PASS sebagai nilai harapan saja | Menampilkan host/project/branch/database/role yang diwajibkan; bukan readback terbaru atau handshake TLS. |

Checker secara eksplisit melaporkan databaseConnectionAttempted=false, networkAccessAttempted=false, psqlLaunched=false, credentialFileOpened=false, baselineFileOpened=false, credentialContentsRead=false, baselineContentsRead=false, caTrustValidated=false, tlsHandshakeVerified=false, baselineApprovalVerified=false, dan sqlFileCreated=false. Proses selesai dengan status non-zero; source checker menetapkan exit 2 untuk status blocked.

Audit kode checker mengonfirmasi:

- Menolak UNC, mapped/network drive, dan komponen path reparse point sebelum pemeriksaan metadata; executable hanya dicari pada fixed drive lokal.
- PGPASSFILE dan baseline diperiksa melalui path lokal, keberadaan, dan metadata ACL. Untuk berkas tersebut, owner harus merupakan akun Windows saat ini; principal yang diizinkan terbatas pada akun itu, SYSTEM, dan Administrators. Konten tidak dibuka.
- CA dan psql.exe hanya diperiksa untuk keberadaan, keterbacaan, dan tidak adanya broad-write grant. Checker tidak memvalidasi publisher/hash executable.
- Path lokal, konten rahasia, dan teks exception tidak dicetak. Output JSON hanya memberikan status dan nilai target yang sudah dipatok.

Ini adalah pemeriksaan awal, bukan bukti bahwa password benar, baseline disetujui, binari resmi, CA dipercaya, sertifikat valid, atau server yang akan menerima koneksi adalah target yang benar. Dokumentasi libpq menyebut Windows mengasumsikan pgpass.conf berada di direktori profil yang aman dan tidak melakukan pemeriksaan permission khusus; gate checker lokal ini sengaja menerapkan ACL yang lebih ketat sebagai syarat proyek.

## Jalur operator Windows yang disiapkan

1. **Sediakan klien PostgreSQL 18.** Mulai dari [halaman unduhan PostgreSQL untuk Windows](https://www.postgresql.org/download/windows/) yang mengarahkan ke installer interaktif EDB dan juga menyediakan arsip biner. Pilih distribusi Windows x64 PostgreSQL major 18 dari jalur resmi; jika installer menyediakan pemilihan komponen, pilih Command Line Tools dan jangan membuat atau menyalakan server/cluster lokal. Verifikasi tanda tangan/penerbit paket dari EDB, lalu jalankan psql --version secara lokal tanpa koneksi database. Dokumentasi: [psql PostgreSQL 18](https://www.postgresql.org/docs/18/app-psql.html).
2. **Siapkan CA tepercaya untuk libpq.** Gunakan bundle CA publik yang sumbernya ditinjau dan dijaga pemutakhirannya, misalnya bundle Mozilla yang dipublikasikan melalui [curl CA Extract](https://curl.se/docs/caextract.html); catat sumber dan SHA-256 saat owner menyetujui salinan. Letakkan pada path lokal yang aman dan set PGSSLROOTCERT ke path itu, atau gunakan lokasi default Windows %APPDATA%\postgresql\root.crt. Jangan mengambil sertifikat dari endpoint koneksi yang belum diautentikasi atau menyematkan leaf certificate yang dapat berubah. Run yang diotorisasi tetap harus memakai sslmode=verify-full: libpq memeriksa rantai ke CA tepercaya dan mencocokkan hostname dengan sertifikat. Hanya keberadaan file yang bisa diperiksa offline; verifikasi chain/hostname baru terbukti pada koneksi yang disetujui. Rujukan: [PostgreSQL 18 SSL Support](https://www.postgresql.org/docs/18/libpq-ssl.html).
3. **Owner mengelola PGPASSFILE secara lokal.** Default Windows libpq adalah %APPDATA%\postgresql\pgpass.conf; alternatif path lokal dapat ditentukan melalui PGPASSFILE. Isinya memakai format host:port:database:username:password, tetapi password tidak boleh ditempatkan pada command line, URI, shell history, chat, Git, atau log. Owner menulis file secara lokal melalui alur yang dikendalikannya, lalu membatasi ACL ke akun saat ini (dan hanya SYSTEM/Administrators bila diperlukan); jangan mengirim atau menyalin isi file ke report. Checker dapat memeriksa metadata ACL tanpa membuka file. Rujukan: [Password File PostgreSQL 18](https://www.postgresql.org/docs/18/libpq-pgpass.html).
4. **Siapkan baseline dari sumber terpisah.** Gunakan salinan owner-controlled di luar Git/chat dari [template expected-state Wave 13B.1T](../../wave13b-1t/2026-10-15/WAVE13B_1T_D1V2_EXPECTED_STATE_TEMPLATE.md). Sumber baseline tidak boleh berupa hasil target yang sedang diperiksa. Isi dan review terpisah harus mencakup tuple target, role dan membership beserta opsinya, schema, extension, object/owner, ACL mentah, effective privilege, dan identitas/properti katalog migration ledger. Tabel template yang kosong tetap **UNKNOWN**; itu bukan pernyataan “tidak ada”. Semua nilai perlu sumber independen, revisi/hash, reviewer, dan persetujuan owner sebelum bisa dibandingkan.
5. **Jalankan ulang hanya checker offline saat prasyarat tersedia.** Hasil OFFLINE_GATES_PRESENT_HUMAN_REVIEW_REQUIRED tetap tidak memberi izin koneksi. Coordinator harus melakukan fresh non-waking identity readback sebelum mempertimbangkan satu run yang sudah diotorisasi. Bila target berbeda/tidak dapat dibuktikan atau ada kegagalan/ketidakpastian, berhenti tanpa koneksi.

PostgreSQL 18 psql mendukung pola satu transaksi -X --set=ON_ERROR_STOP=on --set=ON_ERROR_ROLLBACK=off --single-transaction yang tercatat pada owner packet. Itu hanya prosedur untuk satu target/metode yang telah disetujui setelah seluruh gate dibuka; saya tidak menjalankannya dan tidak menyiapkan file SQL pada lane ini.

## Status dan blokir

**D1v2: NOT_EXECUTED_ACCESS_SAFETY_BLOCKED.** Checker tidak menemukan executable psql pada PATH lokal fixed, tidak menemukan CA default/override, PGPASSFILE yang lolos gate, ataupun baseline expected-state owner-approved. Dengan bukti ini, tidak ada hasil katalog database; statusnya bukan CLEAN_CATALOG_PREFLIGHT, bukan UNCLEAN, dan bukan kesimpulan tentang isi database. Bahkan hasil katalog yang kelak cocok hanya mencakup query terbatas dan tidak membuktikan lineage independen, physical emptiness, network isolation, biaya Rp0, atau izin migrasi.

Tidak ada Neon SQL, koneksi/readback provider, wake, credential retrieval, DDL/migrasi, perubahan source guard, Vercel, deployment, commit, atau push oleh Agent B.
