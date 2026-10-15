# Wave 13B.1T — Template Baseline Expected-State D1v2

**Status: NOT APPROVED — TEMPLATE ONLY — SEMUA NILAI EKSPEKTASI SENGAJA KOSONG**

Dokumen ini hanya daftar kosong. Ini bukan hasil katalog, bukan otorisasi, dan bukan klaim bahwa role, schema, extension, object, grant, atau migration ledger tidak ada. Jangan mengisi salinan yang terlacak di Git ini. Buat salinan lokal yang dikendalikan owner, isi dari sumber yang ditinjau secara independen, dan simpan di luar chat dan Git.

Kolom kosong berarti **belum diberikan**. Jangan menafsirkannya sebagai “tidak ada”, “kosong”, “default”, atau “aman”. Jika sumber yang disetujui memang mengharapkan tidak ada entri dalam suatu kategori, owner harus menyatakan itu secara eksplisit pada baseline privat dan mencantumkan bukti sumbernya.

## Pengikatan target

Nilai berikut adalah tuple desain tetap sebelumnya dari owner packet Wave 13B.1R. Ini bukan readback provider terbaru. Sebelum koneksi yang disetujui, coordinator harus memverifikasi ulang target persis tanpa membangunkan compute. Isi kolom readback dari verifikasi tersebut; berhenti jika ada nilai yang berbeda.

| Field identitas | Nilai desain tetap | Nilai readback terbaru (diisi owner/coordinator) |
|---|---|---|
| Organization ID | `org-ancient-boat-57106549` | |
| Project ID | `falling-bread-33359184` | |
| Branch ID | `br-muddy-frost-azot13fb` | |
| Compute ID | `ep-silent-butterfly-azrflu40` | |
| Host endpoint langsung | `ep-silent-butterfly-azrflu40.c-3.ap-southeast-1.aws.neon.tech` | |
| Database ID | `702718` | |
| Nama database | `karturt_staging` | |
| Login role | `karturt_staging_owner` | |
| Ekspektasi versi major server | PostgreSQL 18 | |

## Asal-usul dan persetujuan baseline

| Field | Nilai yang diisi owner |
|---|---|
| Dokumen/sistem sumber dan revisi | |
| SHA-256 sumber atau pengenal immutable lain | |
| Tuple target yang diikat baseline ini | |
| Waktu snapshot/observasi dan zona waktu | |
| Pernyataan kelengkapan dan pengecualian yang diketahui | |
| Owner penyusun | |
| Reviewer independen | |
| Tanggal persetujuan dan referensi catatan | |
| Referensi path lokal dan bukti ACL (path tidak boleh disalin ke Git/chat) | |

Persetujuan di sini hanya untuk expected catalog state pada perbandingan D1v2 yang persis ini. Persetujuan tidak mengizinkan perubahan provider, migrasi, D2, atau D3.

## Ekspektasi role dan membership

Isi atribut role dan hubungan membership secara persis. Jangan menyimpulkannya dari nama login role, metadata provider, atau hasil kosong.

| Nama role | LOGIN / NOLOGIN | SUPERUSER | CREATEDB | CREATEROLE | REPLICATION | BYPASSRLS | Atribut lain yang tercakup query | Owner/sumber ekspektasi |
|---|---|---|---|---|---|---|---|---|
| | | | | | | | | |

| Member role | Granted role | Grantor | Admin option | Owner/sumber ekspektasi |
|---|---|---|---|---|
| | | | | |

## Ekspektasi schema dan extension

| Jenis | Nama persis | Owner | Versi (extension saja) | ACL/grant yang diharapkan | Status dan sumber ekspektasi |
|---|---|---|---|---|---|
| Schema | | | | | |
| Extension | | | | | |

Pada salinan privat, tambahkan baris untuk setiap schema dan extension yang diharapkan. Jika sumber yang disetujui menyatakan tidak ada, tulis itu secara eksplisit dengan bukti; jangan biarkan bagian ini kosong.

## Object yang diizinkan dan ownership

Daftarkan seluruh inventory katalog yang diizinkan dan diharapkan muncul dalam bukti. Baseline privat harus cukup rinci untuk membedakan object yang diizinkan dari object tak terduga. Jangan menganggap hasil lengkap jika query mencapai cap, terkena batas izin, atau terpotong.

| Jenis object | Schema | Nama object persis | Owner | Ekspektasi keberadaan | Sumber/alasan |
|---|---|---|---|---|---|
| Relation / table / view / sequence | | | | | |
| Function / procedure | | | | | |
| Type / object katalog lain dalam cakupan query | | | | | |

## Ekspektasi raw ACL

Catat setiap raw ACL persis untuk object yang dikembalikan dalam cakupan query, termasuk grantor, grantee, privilege, dan grant option. Jangan mengganti bukti raw ACL dengan pernyataan umum seperti “least privilege”.

| Jenis object | Schema/object | Grantor | Grantee | Privilege | Grant option | Sumber ekspektasi |
|---|---|---|---|---|---|---|
| | | | | | | |

## Ekspektasi effective privilege

Catat akses efektif yang diharapkan untuk setiap role dan object. Ini perbandingan terpisah dari teks raw ACL. Rekonsiliasi membership turunan dan atribut role hanya jika paket query yang disetujui menyediakan bukti. Tandai privilege yang tidak dapat diamati sebagai unresolved/UNKNOWN.

| Role yang diperiksa | Jenis object | Schema/object | CONNECT / USAGE / SELECT / INSERT / UPDATE / DELETE / EXECUTE / lainnya | Hasil efektif yang diharapkan | Sumber bukti |
|---|---|---|---|---|---|

Cantumkan akses database, schema, relation, sequence, dan function yang relevan dari paket query yang disetujui. Jangan mengklaim cakupan privilege seluruh cluster dari paket query terbatas ini.

## Ekspektasi object migration ledger

Isi hanya identitas object ledger yang diharapkan dan properti katalog. Checklist ini tidak meminta isi baris ledger, nama migrasi, hash, atau timestamp.

| Schema ledger | Nama object ledger persis | Diharapkan ada? | Owner | Raw ACL yang diharapkan | Akses efektif yang diharapkan | Sumber/alasan |
|---|---|---|---|---|---|---|
| | | | | | | |

Keberadaan atau ketiadaan ledger harus berasal dari kontrak schema/migrasi yang disetujui. Jangan mengasumsikan path default atau menganggap ledger tidak ada karena metadata belum diberikan.

## Persetujuan perbandingan owner

| Field | Nilai |
|---|---|
| Tuple target persis diperiksa ulang tepat sebelum koneksi | |
| Pengenal/hash salinan expected-state | |
| Semua kategori terisi atau ditandai “none expected” secara eksplisit dengan bukti | |
| Seluruh hasil query lengkap dan di bawah cap | |
| Perbedaan raw ACL/effective access direkonsiliasi | |
| Referensi persetujuan baseline owner | |
| Referensi review independen | |

## Batas interpretasi

`CLEAN_CATALOG_PREFLIGHT` mensyaratkan seluruh output query terbatas cocok dengan baseline terpisah yang disetujui, tanpa cap, celah visibilitas, truncation, perbedaan target, atau perbedaan raw-ACL/effective-privilege yang belum diselesaikan. Perbedaan lengkap diklasifikasikan `UNCLEAN`; bukti yang hilang atau ketidakpastian diklasifikasikan `UNKNOWN`. Tanpa koneksi, statusnya `NOT_EXECUTED_ACCESS_SAFETY_BLOCKED`.

Bahkan perbandingan yang bersih tetap hanya hasil katalog terbatas. Hasil itu tidak membuktikan lineage branch independen, database kosong secara fisik, isolasi jaringan, biaya nol, atau izin migrasi.
