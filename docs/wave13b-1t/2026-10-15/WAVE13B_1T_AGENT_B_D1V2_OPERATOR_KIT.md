# Wave 13B.1T — Agent B D1v2 Offline Operator Kit

Tanggal: 2026-10-15
Status: **NOT_EXECUTED_ACCESS_SAFETY_BLOCKED**

## Hasil lane

Lane ini hanya menyiapkan dan memeriksa perangkat operator secara offline. Tidak ada proses `psql`, koneksi database, SQL, wake compute, readback provider, atau perubahan provider yang dijalankan.

Preflight lokal lulus pada identitas artefak SQL yang dibekukan: blob `e011f0e843d42d53c7c4c76ba479854644137fc9` dan manifest SHA-256 `ab7193d72520482a50081fdb65edc098fdac1cc9530d161430ddc6b9a0759db0` berisi tepat 26 statement terurut. Prasyarat akses lokal belum lengkap, sehingga hasil tetap `NOT_EXECUTED_ACCESS_SAFETY_BLOCKED`. Ini bukan hasil katalog `CLEAN_CATALOG_PREFLIGHT`, `UNCLEAN`, atau database `UNKNOWN`.

## Audit dan perubahan preflight

Skrip sumber awal adalah [d1v2-offline-preflight.ps1](../../wave13b-1s/2026-10-15/d1v2-offline-preflight.ps1), blob Git sebelum perubahan `9715e5017b31ad50946e870eead746613b62f67c`.
Blob file pada working tree lane B setelah hardening: `0104055df2055786f369bc407da87d0b6eea9f3f` (Git path-normalized hash).

Perubahan lane ini menjaga skrip tetap offline dan memperketat penanganan file sensitif:

- Pemeriksaan file `PGPASSFILE` dan baseline sekarang hanya memakai pemeriksaan jalur lokal, keberadaan file, dan metadata ACL. Skrip tidak membuka file untuk dibaca dan tidak membaca atau menampilkan isinya.
- Jalur lokal tetap ditolak bila UNC, bukan drive fixed lokal, atau komponennya melewati reparse point/symlink.
- Nilai jalur kredensial, jalur CA, dan jalur baseline tidak dicetak. Teks exception yang mungkin memuat path atau identitas juga tidak ditampilkan.
- Baseline hanya lolos pemeriksaan metadata; skrip tidak membaca isinya, menguji kelengkapan/target binding, atau menganggap baseline disetujui.
- CA hanya diperiksa pada keberadaan, akses baca, dan broad-write ACL. Skrip tidak mengesahkan sumber sertifikat, fingerprint, masa berlaku, trust chain, hostname, atau TLS handshake.
- Output JSON secara eksplisit mencatat `networkAccessAttempted=false`, `psqlLaunched=false`, `credentialFileOpened=false`, `baselineFileOpened=false`, `caTrustValidated=false`, dan `tlsHandshakeVerified=false`. Skrip tidak membuat file SQL.

Path traversal dicek sebelum metadata file diperiksa. Pemeriksaan ACL ini merupakan preflight lokal; ia bukan bukti bahwa kredensial benar, sertifikat dipercaya, atau host yang akan dituju benar.

## Hasil dry run offline

Perintah simulasi dijalankan dari worktree dengan PowerShell tanpa membuka klien database:

~~~~powershell
.\docs\wave13b-1s\2026-10-15\d1v2-offline-preflight.ps1
~~~~

Hasil:

| Pemeriksaan | Hasil |
|---|---|
| Parse PowerShell | PASS |
| Frozen reference blob dan working tree | PASS — `e011f0e843d42d53c7c4c76ba479854644137fc9` |
| Jumlah fence dan fingerprint | PASS — 26/26 |
| Ordered manifest | PASS — `ab7193d72520482a50081fdb65edc098fdac1cc9530d161430ddc6b9a0759db0` |
| PostgreSQL 18 `psql` pada PATH lokal fixed | BLOCKED |
| Root CA di jalur default/override | BLOCKED; trust dan handshake tidak diuji |
| `PGPASSFILE` dengan ACL owner-only | BLOCKED |
| Baseline lokal aman dan owner-only | BLOCKED |
| Exit checker | `2` — status blocked yang diharapkan |
| Koneksi / SQL / wake / provider write | Tidak dilakukan |

Tidak ada raw output database atau file kredensial/baseline yang dihasilkan.

## Langkah owner untuk membuka akses lokal

1. **PostgreSQL 18 `psql`.** Mulai dari [halaman unduhan Windows PostgreSQL](https://www.postgresql.org/download/windows/). Halaman resmi mengarahkan ke installer bersertifikasi EDB yang di-host EDB dan menyediakan arsip ZIP biner untuk penggunaan lanjutan. Sediakan klien major 18; tidak perlu menjalankan server PostgreSQL lokal. Setelah tersedia, laporkan hanya lokasi executable lokal dan keluaran `psql --version` tanpa koneksi database. Rujukan: [dokumentasi `psql` PostgreSQL 18](https://www.postgresql.org/docs/18/app-psql.html).
2. **CA dan TLS.** Sediakan root CA yang sumber dan fingerprint-nya dapat dipercaya melalui jalur owner yang terpisah. Atur `PGSSLROOTCERT` ke path lokal yang aman bila tidak memakai default libpq Windows `%APPDATA%\postgresql\root.crt`. Jangan mengambil CA dari sesi koneksi yang belum terverifikasi. Run yang disetujui harus memakai `sslmode=verify-full`; libpq dengan mode ini memvalidasi chain CA dan hostname. Keberadaan file dalam checker tidak membuktikan keduanya. Rujukan: [PostgreSQL 18 SSL support](https://www.postgresql.org/docs/18/libpq-ssl.html).
3. **Kredensial.** Owner menyiapkan file lokal `PGPASSFILE` untuk target yang dipatok, umumnya di `%APPDATA%\postgresql\pgpass.conf` atau path lokal melalui environment `PGPASSFILE`. Batasi ACL ke owner Windows saat ini, dengan `SYSTEM` dan `Administrators` hanya bila memang dibutuhkan; tidak boleh ada principal luas. Checker hanya melihat owner/ACL, tidak membuka atau membaca file. Jangan memasukkan password ke command line, URI, history, chat, Git, atau log. Dokumentasi libpq: [connection parameters and password file](https://www.postgresql.org/docs/18/libpq-connect.html).
4. **Baseline expected-state.** Owner mengisi template kosong [WAVE13B_1T_D1V2_EXPECTED_STATE_TEMPLATE.md](WAVE13B_1T_D1V2_EXPECTED_STATE_TEMPLATE.md) pada salinan lokal terkontrol, meninjau target binding, lalu menyetujui baseline secara terpisah. Jangan commit atau mengirim isi baseline. Kolom kosong berarti belum ditetapkan, bukan “tidak ada”.
5. **Pemeriksaan ulang.** Setelah semua prasyarat lokal tersedia, jalankan ulang preflight ini. Hasil `OFFLINE_GATES_PRESENT_HUMAN_REVIEW_REQUIRED` tetap bukan izin untuk koneksi. Sebelum satu run yang telah disetujui, coordinator wajib melakukan readback identitas provider non-waking terbaru dan memastikan setiap field target cocok.

## Batas tindakan dan status tetap

Persetujuan yang tercatat hanya untuk satu run D1v2 dengan metode `psql -X --set=ON_ERROR_STOP=on --set=ON_ERROR_ROLLBACK=off --single-transaction`, satu backend/transaction, TLS `verify-full`, dan artifact 26 statement yang tepat. Persetujuan itu tidak mengizinkan query tambahan, retry, driver lain, target alternatif, DDL/migrasi, atau perubahan provider. Lane B tidak menggunakan persetujuan tersebut untuk membuka koneksi.

Tidak ada fresh provider identity readback pada lane ini. Tuple target yang ada di dokumen 1S/1R adalah nilai desain dari readback sebelumnya, bukan bukti bahwa identitas belum berubah. Jika metadata terbaru tidak dapat dibaca tanpa wake atau ada nilai berbeda, berhenti sebelum koneksi.

Baseline yang disetujui pun hanya bisa dipakai untuk mengklasifikasikan hasil katalog terbatas. Ia tidak membuktikan lineage independen, physical emptiness, isolation jaringan, biaya Rp0/no-overage, atau kesiapan D3. Guard `stagingIsolationVerifiedEmpty=false` dan `PINNED_STAGING_MIGRATION_APPROVAL_PUBLIC_KEY_PEM=null` harus tetap.

## Referensi internal

- [Wave 13B.1S operator readiness](../../wave13b-1s/2026-10-15/WAVE13B_1S_AGENT_B_D1V2_OPERATOR_READINESS.md)
- [Wave 13B.1R D1v2 execution report](../../wave13b-1r/2026-10-14/WAVE13B_1R_D1V2_EXECUTION_REPORT.md)
- [Wave 13B.1R owner approval packet](../../wave13b-1r/2026-10-14/WAVE13B_1R_D1V2_OWNER_APPROVAL_PACKET.md)
- [Wave 13B.1R frozen SQL reference](../../wave13b-1r/2026-10-14/WAVE13B_1R_FIXED_SQL_REFERENCE.md)
