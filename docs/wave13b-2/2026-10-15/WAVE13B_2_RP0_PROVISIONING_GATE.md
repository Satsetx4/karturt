# Wave 13B.2 — Gerbang Provisioning Rp0

Tanggal: 2026-10-15
Status gerbang: **UNKNOWN — FAIL CLOSED — NO PROVISIONING**

## Tujuan dan kewenangan

Ini adalah gerbang offline untuk memeriksa kelengkapan bukti sebelum usulan membuat satu project Neon baru. Gerbang ini tidak tersambung ke Neon, tidak membuat atau memeriksa project, tidak membangunkan endpoint, tidak mengakses SQL atau secret, tidak mengubah billing, dan tidak melakukan tindakan apa pun pada provider. Hasil PASS hanya berarti paket bukti cukup lengkap untuk ditinjau Coordinator pada G2 sesuai keputusan bersyarat owner. PASS bukan panggilan API, bukan token otorisasi provisioning, dan bukan bukti bahwa project sudah ada.

Coordinator tetap satu-satunya pemegang kewenangan integrasi/tindakan provider. Bukti yang hilang, kedaluwarsa, tidak cocok dengan akun, atau tidak dapat diverifikasi harus tetap berstatus UNKNOWN atau BLOCKED; hanya bukti lengkap, positif, dan terikat pada target yang tepat yang dapat menghasilkan PASS.

## Pemeriksaan bukti wajib

Evaluator mewajibkan bukti yang bertanggal dan jelas cakupannya untuk semua hal berikut:

1. Identitas organisasi yang persis dan paket yang berlaku saat ini.
2. Sisa kuota jumlah project pada paket tersebut.
3. Sisa penyimpanan seluruh akun saat ini, termasuk batas total pada paket.
4. Penggunaan saat ini dan kondisi billing akun yang cukup untuk membuktikan Rp0, tidak ada perubahan paket otomatis, serta tidak ada tagihan overage untuk project yang diusulkan.
5. Kelayakan region Singapore dan PostgreSQL 18 secara persis pada waktu tindakan yang diusulkan.
6. Bentuk permintaan project baru yang tidak mencantumkan project, branch, parent, clone, import, snapshot, atau sumber restore yang sudah ada.
7. Protokol untuk mendapatkan bukti lineage positif setelah pembuatan: ID project baru dan operasi pembuatan, ditambah metadata root branch yang menunjukkan tidak ada parent. Ini bukan klaim bahwa bukti tersebut sudah ada sebelum provisioning.
8. Cakupan data sintetis saja serta rencana yang mengecualikan seluruh kredensial production dan data pengguna nyata.
9. Kontrol keamanan yang memenuhi syarat keamanan bersyarat owner, termasuk keputusan terdokumentasi tentang paparan endpoint publik dan status MFA.
10. Cakupan owner yang persis: satu project root independen, paket Free, Rp0, Singapore, PostgreSQL 18, data sintetis saja, tanpa dampak pada project staging yang sudah ada atau production.

TargetScope pada paket harus memuat tepat himpunan key yang disetujui berikut: organisasi org-ancient-boat-57106549, paket free, region aws-ap-southeast-1, PostgreSQL major 18, tepat satu operasi create yang direncanakan, sourceProjectId: null, syntheticDataOnly: true, serta kedua flag mutasi existing-staging dan production bernilai false. Nilai yang hilang menghasilkan UNKNOWN; nilai yang tidak cocok atau key tambahan apa pun (termasuk sumber branch, restore, atau import yang tidak dideklarasikan) menghasilkan BLOCKED. Target scope yang benar tidak menggantikan bukti pemeriksaan lain yang masih hilang.

Setiap referensi bukti harus mengarah ke sumber yang bisa diperiksa secara independen dan menyertakan waktu pengamatan. Jangan masukkan kredensial, URI koneksi, SQL, data pengguna, atau nilai rahasia ke paket bukti. Nilai JSON lokal PASS saja bukan bukti provider; Coordinator harus memeriksa sumber yang dirujuk.

## Hasil paket bukti saat ini

| Pemeriksaan | Status saat ini | Alasan |
|---|---|---|
| Identitas organisasi dan paket | PASS | Metadata yang dibaca saja mengidentifikasi satset / org-ancient-boat-57106549 / Free. |
| Sisa kuota jumlah project Free | PASS (terbatas) | Lima project terdaftar dibandingkan batas terpublikasi 100; ini hanya mencakup jumlah project. |
| Singapore / PostgreSQL 18 | PASS | Daftar region dan dokumentasi API mendukung nilai tersebut. |
| Jalur API untuk project baru | PASS (metode saja) | API resmi membuat project baru; branch project menampilkan root/parent lineage. Belum ada operasi yang dilakukan. |
| Sisa penyimpanan seluruh akun | UNKNOWN | Total penyimpanan saat ini dan sisa ruang dari batas akun 20 GB belum diketahui. |
| Penggunaan terkini dan Rp0/tanpa overage | UNKNOWN | Endpoint riwayat penggunaan Free dibatasi berdasarkan paket; tidak ada pembacaan penggunaan/invoice Console atau billing. |
| Kecukupan keamanan endpoint publik | UNKNOWN | Free tidak memiliki IP Allow, Private Networking, dan Protected Branches; penegakan MFA organisasi bernilai false; keputusan owner tentang risiko yang tersisa belum ada. |
| Bukti lineage pascapembuatan | UNKNOWN | Belum ada project baru atau operasi pembuatan. |

Hasil: **UNKNOWN**. mayProceedToCoordinatorGate bernilai false. Coordinator harus berhenti sebelum provisioning. Halaman [paket Neon](https://neon.com/docs/introduction/plans) menyebut batas penyimpanan Free seluruh akun 20 GB, sedangkan [API riwayat konsumsi](https://api-docs.neon.tech/reference/getconsumptionhistoryperprojectv2) menyebut penggunaan historis hanya tersedia pada paket berbayar/eligible.

## Bukti positif minimum setelah project dibuat, jika gerbang berikutnya diizinkan

Jika wave mendatang memenuhi seluruh pemeriksaan pra-provisioning dan Coordinator memutuskan menjalankan satu pembuatan project baru, simpan paket bukti yang sudah disanitasi, berisi:

- timestamp dan field permintaan/operasi yang disanitasi, yang membuktikan project baru dibuat pada organisasi yang tepat dengan aws-ap-southeast-1 / PostgreSQL 18;
- ID project baru serta inventaris sebelum/sesudah yang menunjukkan ID tersebut baru dibuat;
- ID operasi, jenis/status operasi, dan timestamp pembuatan project;
- respons daftar branch dengan ID root branch project baru serta parent_id: null secara eksplisit (atau representasi null/tidak ada yang didokumentasikan API);
- konfirmasi bahwa permintaan pembuatan tidak merujuk project, branch, restore point, import, clone, atau snapshot yang sudah ada;
- hanya identitas database dan role yang sudah disanitasi, tanpa nilai kredensial.

Metadata tersebut dapat membuktikan lineage root baru yang diminta. Metadata itu tidak membuktikan katalog kosong. Query apa pun pada target baru memerlukan persetujuan owner terpisah yang menyebut target itu secara persis; persetujuan 26 statement D1v2 lama tidak dapat dipindahkan ke target baru. Sampai saat itu, jangan membuat klaim SQL tentang isi katalog.

## Alternatif saat ini

Gunakan rehearsal PostgreSQL 18 disposable yang telah selesai, run 38699617221 pada source SHA 0b1e3f525039496200b2bb5f698d312ded5cb3e3, hanya untuk rehearsal migrasi lokal. Ini bukan Neon, bukan project staging yang sudah di-deploy, dan tidak memenuhi bukti isolasi cloud atau katalog.
