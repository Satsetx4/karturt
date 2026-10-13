# KartuRT V1 — Wave 12 Owner Approval Packet

**Tanggal:** 13 Oktober 2026 (Asia/Bangkok)
**Status:** Disiapkan untuk keputusan owner. **Tidak ada izin lanjutan yang diberikan oleh dokumen ini.**

## Ringkasan yang perlu diputuskan

Paket Wave 12 siap ditinjau, tetapi database belum siap digunakan. Source guard masih mengarah ke resource lama dan tetap menandai isolasi kosong sebagai belum diverifikasi. Tidak ada koneksi, wake, query, SQL, migrasi, fixture, publikasi GitHub, atau deployment yang dilakukan.

Metadata target yang disampaikan owner: organisasi `satset` (`org-ancient-boat-57106549`, Free); project `karturt-v1-staging` (`wild-art-99835126`); region Singapore `aws-ap-southeast-1`, PostgreSQL 18; branch `staging` (`br-hidden-cake-a1ge5xqp`), primary/default; database `karturt_staging`, owner `karturt_staging_owner`; compute minimum/maksimum 0.25 CU; suspend timeout `0`.

Nilai tersebut belum dibaca ulang oleh agen. Database ID, endpoint ID, dan hostname baru belum tersedia dalam bukti yang diperiksa. Owner menyatakan project baru dibuat kosong dan tidak diklon, tetapi isi database belum diverifikasi. Project tetap harus Free; jangan mengubah plan, menambah fitur berbayar, atau menyebabkan pengeluaran.

## Persetujuan lanjutan yang diminta

Semua item berstatus **BELUM DISETUJUI**. Persetujuan satu tahap tidak mencakup tahap lainnya.

### 1. Inisialisasi schema staging — metadata, read-only preflight, dan migrasi terbatas

**Cakupan yang diusulkan:**

1. Baca ulang metadata provider untuk organisasi/project/branch/database yang disebut di atas. Lengkapi database ID, endpoint ID, dan hostname hanya dari metadata resmi; jangan menebak dari URL/credential.
2. Jika identitas tepat, siapkan perubahan lokal terbatas pada `src/lib/staging-database-target.ts` untuk mengikat guard ke resource baru. Tinjau diff dan catat SHA akhir sebelum akses database.
3. Dengan izin eksplisit yang menyebut target lengkap dan source SHA akhir, lakukan satu wake/koneksi awal dan pemeriksaan read-only atas database, role, versi server, objek/data, serta ledger/drift.
4. Hanya jika seluruh pemeriksaan lolos dan target tetap Free tanpa biaya/fitur tambahan, jalankan tepat 14 migration `0000`–`0013` sesuai journal, satu kali, dari source SHA yang disetujui.
5. Setelah itu, verifikasi hasil secara read-only dan berhenti. Fixture, koneksi aplikasi, deployment, serta penggunaan lanjutan belum termasuk.

**Syarat wajib sebelum DDL:** semua metadata cocok; database/endpoint/role benar; tidak ada objek, data, atau ledger yang tak terduga; source SHA dan perubahan guard sudah ditinjau; serta recovery path dapat diterima tanpa biaya tambahan. Jika satu syarat tidak terbukti, **STOP sebelum DDL**. Jika migrasi gagal atau hasil parsial, jangan rerun, drop, restore, truncate, atau menghapus resource; pertahankan bukti tersanitasi dan minta keputusan recovery terpisah.

**Tidak termasuk:** fixture/teardown, pembuatan role atau credential, perubahan plan/compute/suspend timeout, data warga, koneksi aplikasi, rollback/restore, penghapusan atau pembuatan ulang resource, GitHub/CI, Vercel, Production, domain, dan DNS.

**Catatan persetujuan:** identitas endpoint/database dan SHA akhir belum tersedia. Karena itu persetujuan DDL yang dapat dieksekusi harus menyebut nilai tersebut setelah diperoleh dan source guard ditinjau. Paket saat ini sendiri tidak memberi wewenang untuk akses database atau menjalankan migrasi.

### 2. Fixture sintetis dan teardown — persetujuan terpisah

Setelah schema terverifikasi, izinkan tahap terpisah untuk membuat manifest `runId` dan data sintetis bagi minimal dua RT berbeda, menguji jalur tenant negatif, lalu membersihkan hanya record dengan marker run tersebut. Tidak boleh ada data warga asli, `TRUNCATE`, penghapusan resource, atau cleanup di luar manifest. Kegagalan hitungan/target berarti STOP.

### 3. GitHub, CI, dan source publication — persetujuan terpisah

Tentukan branch, commit, dan pemeriksaan CI yang dicakup. Tidak termasuk push atau merge ke branch default kecuali owner memberi izin tambahan yang eksplisit. Wave 12 tidak melakukan operasi GitHub.

### 4. Vercel Preview — persetujuan terpisah

Hanya untuk project Preview yang ditentukan setelah metadata dibaca ulang. Metadata yang diberikan owner menyebut `karturt-review-staging-20261012` (`prj_Mv4rABJvDNAvSD78SVt5WbjFakEq`), SSO aktif, nol deployment, dan GitHub linking belum dibuat; agen tidak memverifikasi ulang. Persetujuan Preview tidak mencakup Production, environment Production, domain/DNS, atau organisasi Vercel lain.

## Batas kebijakan untuk Wave 12 V1

- Owner mengecualikan MFA organisasi dan audit penggunaan/Rp0 sebagai blocker. Keduanya tidak diperiksa dan tidak diklaim lulus atau Rp0.
- Plan harus tetap Free. Jangan upgrade atau menambah fitur/biaya tanpa persetujuan eksplisit.
- `suspend_timeout_seconds=0` dipertahankan; perubahan custom sebelumnya ditolak HTTP 412 dan tidak boleh dicoba ulang.
- Neon TKA, Agustusan, organisasi Vercel Ard, production, DNS, dan data warga asli tetap di luar cakupan.

## Rekomendasi disposisi saat ini

**Terima paket persiapan Wave 12 untuk ditinjau; jangan menganggap database siap.** Berikan izin migrasi hanya setelah cakupan #1 diperbarui dengan metadata target lengkap serta source SHA final. Izin fixture, GitHub/CI, dan Vercel Preview harus diberikan terpisah jika kelak diperlukan.

**Status sekarang:** persiapan siap untuk keputusan owner; migrasi **BLOCKED**; **NOT STAGING READY**; **NOT release GO**.
