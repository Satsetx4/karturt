# Wave 13B.2 — Agent A: Arsitektur Staging dan Kelayakan Rp0

> **Analisis pra-koreksi owner dan pra-create.** Project baru telah dibuat berdasarkan instruksi terbaru; jangan pakai keputusan biaya/lineage di bawah sebagai status kini. Lihat [eksekusi koreksi owner terbaru](WAVE13B_2_OWNER_CORRECTION_EXECUTION.md).

Tanggal: 2026-10-15 (UTC+7)

## Keputusan

**STAGING_FEASIBILITY_UNKNOWN — JANGAN PROVISION.** Kelayakan paket Free serta region Singapore dan PostgreSQL 18 telah terkonfirmasi. Namun, metadata control-plane yang tersedia hanya dibaca dan tidak membuktikan sisa kapasitas penyimpanan seluruh akun, pemakaian aktual secara lengkap, ataupun jaminan tanpa overage/tanpa biaya untuk akun ini. Paket Free juga tidak menyediakan IP Allow, Protected Branches, dan Private Networking. Kesenjangan biaya dan keamanan ini material terhadap persetujuan bersyarat pemilik. Jangan membuat project baru selama hal-hal tersebut masih belum diketahui.

Lane ini hanya membaca metadata Neon melalui control-plane dan dokumentasi publik Neon. Tidak ada SQL, upaya membangunkan endpoint, koneksi database, penulisan ke provider, akses kredensial, tindakan Vercel, ataupun tindakan production. Kedua project staging KartuRT yang sudah ada tidak diubah.

## Acuan versi dan ruang lingkup

- Branch worktree Agent A: codex/karturt-v1-wave13b2-agent-a-20261015, berbasis baseline dokumentasi 8621001e49be3bd5e8ff10ab0a3e2e7d4e1d612a.
- Bukti source yang ditinjau Coordinator: branch RC codex/karturt-v1-rc-quality-wave13b1t-20261015, SHA 0b1e3f525039496200b2bb5f698d312ded5cb3e3.
- Acuan main yang dilindungi: 96c84588ae0c13f68a17cffd997a3e583fb7da82; lane ini tidak mengubahnya.
- Tidak ada file source aplikasi atau migrasi yang diubah dalam worktree ini.

## A01 — Inventaris akun dan project saat ini

Pada pembacaan control-plane tanggal 2026-10-15, organisasi satset (org-ancient-boat-57106549) melaporkan paket free; pembacaan yang sama menampilkan lima project yang sudah ada di organisasi itu. Batas Free Neon saat ini adalah 100 project, sehingga dari sisi jumlah project saja tampak ada ruang nominal untuk satu project tambahan. Ini belum membuktikan kapasitas penuh maupun biaya.

Metadata organisasi juga melaporkan require_mfa: false. Artinya, penegakan MFA di tingkat organisasi tidak diaktifkan; metadata ini tidak menunjukkan apakah akun pemilik perorangan menggunakan MFA. MFA akun perorangan tidak diperiksa atau diubah.

Metadata project memuat active_time, cpu_used_sec, synthetic_storage_size, dan quota_reset_at. Field tersebut bukan laporan lengkap dan tepercaya tentang penggunaan atau tagihan saat ini. Khususnya, angka nol pada field ukuran penyimpanan yang dikembalikan bukan bukti bahwa penyimpanan aktual nol atau masih tersedia. Tool control-plane yang tersambung tidak menyediakan pembacaan penggunaan seluruh akun atau invoice. Halaman billing Neon Console tidak dibuka.

## A02 — Batas paket Free dan analisis Rp0

Dokumentasi paket Neon saat ini menyebut Free seharga $0 per bulan dan mencakup 100 project, 100 CU-hours per project per bulan, penyimpanan Postgres 1 GB per project dengan batas total akun 20 GB, egress publik 5 GB per project, 10 branch per project, serta instant restore 6 jam / 1 GB-month. Pembaruan produk 2 Oktober 2026 mengonfirmasi batas penyimpanan 1 GB per project dan 100 project. Lihat [paket Neon](https://neon.com/docs/introduction/plans), [harga Neon](https://neon.com/pricing), dan [pembaruan Free 2 Oktober](https://neon.com/blog/neon-free-plan-1-gb-per-project).

Organisasi saat ini dilaporkan memakai paket Free dan lima dari 100 slot project tampak terisi. Namun, total penyimpanan Postgres seluruh akun, compute/egress per project, pemakaian produk backend terkait, kondisi pembayaran/billing, dan pembatasan khusus akun masih belum diketahui. Referensi API riwayat konsumsi project membatasi ketersediaan untuk Launch, Scale, Agent, Business, atau Enterprise dan mendokumentasikan respons 403 untuk akun yang tidak memenuhi syarat; Free tidak termasuk. Tidak ada permintaan API usage yang dicoba. Dokumentasi harga mengarahkan pelanggan ke tampilan penggunaan dan invoice di Console untuk melihat pemakaian aktual. Jadi, batas Free yang dipublikasikan tidak membuktikan bahwa organisasi ini memiliki sisa penyimpanan/pemakaian yang cukup; lane ini juga tidak dapat membuktikan syarat Rp0/tanpa overage dari pemilik. Lihat [API riwayat konsumsi](https://api-docs.neon.tech/reference/getconsumptionhistoryperprojectv2).

Tidak ada perubahan paket, pembelian, pembelian kredit, perubahan billing, perubahan kuota, atau perubahan spending limit. Label Free saja tidak dianggap sebagai jaminan biaya nol.

## A03 — Jalur membuat project root independen yang baru

API Neon POST /projects yang didokumentasikan membuat project di dalam organisasi dan mengizinkan region serta versi PostgreSQL ditentukan. Dokumentasi API saat ini menyebut PostgreSQL 14–18 didukung. Daftar region akun saat ini, yang dibaca tanpa mutasi, mencakup aws-ap-southeast-1 (Singapore). Neon mendokumentasikan bahwa setiap project memiliki root branch dan daftar branch menyediakan parent_id untuk branch turunan. Lihat [membuat project](https://api-docs.neon.tech/reference/createproject) dan [daftar branch project](https://api-docs.neon.tech/reference/listprojectbranches).

Jika semua gerbang kelak lolos, jalur teknis yang sesuai adalah membuat satu project baru di organisasi yang sudah diverifikasi, dengan permintaan eksplisit untuk aws-ap-southeast-1 dan PostgreSQL 18. Operasinya harus membuat project baru; jangan membuat branch turunan, clone, reset, import, snapshot restore, atau point-in-time restore dari project lain. Simpan hanya rekaman permintaan/operasi yang sudah disanitasi. Setelah pembuatan, pastikan ID project baru belum ada di inventaris sebelumnya, operasinya memang pembuatan project baru, project memuat root branch, dan root tidak memiliki parent_id; simpan ID dan timestamp hasil yang sudah disanitasi sebagai bukti lineage.

Dokumentasi API create-project menyebut responsnya dapat memuat URI koneksi beserta database, password, dan role; setidaknya satu role non-protected dibuat dengan password. Jika operasi kelak mendapat otorisasi terpisah, kredensial harus disamarkan sebelum respons dicatat, kredensial owner hanya disimpan di penyimpanan rahasia privat yang dikendalikan owner, dibuat role runtime terpisah dengan hak minimum, dan disiapkan prosedur rotasi/pencabutan. Role bawaan yang dihasilkan tidak terbukti cocok untuk runtime aplikasi ataupun owner migrasi.

Ini adalah jalur kelayakan berdasarkan dokumentasi, bukan bukti bahwa target sudah dibuat. Tidak ada permintaan create atau operasi provider yang dijalankan. ID project aktual, operasi, lineage branch yang dikembalikan, identitas role/database, dan isi katalog belum ada pada wave ini. SQL atau query katalog database pada target mendatang memerlukan persetujuan baru yang secara spesifik menyebut target tersebut; persetujuan D1v2 lama tidak berlaku untuk project baru. Jangan mengklaim katalog kosong atau staging sudah tersedia sebelum bukti yang diotorisasi secara terpisah diperoleh.

## A04 — Endpoint publik dan model risiko yang tersisa

Dokumentasi Neon saat ini menempatkan IP Allow pada Scale, Protected Branches pada paket berbayar, dan Private Networking pada Scale. Pada paket Free, koneksi database menggunakan Neon public proxy; artinya endpoint tetap dapat dijangkau melalui internet publik meskipun koneksinya dilindungi TLS dan password. TLS verify-full memvalidasi identitas server dan mengenkripsi koneksi, tetapi tidak membatasi pihak yang dapat menjangkau endpoint. Lihat [IP Allow](https://neon.com/docs/introduction/ip-allow), [Protected Branches](https://neon.com/docs/guides/protected-branches), dan [Private Networking](https://neon.com/docs/guides/neon-private-networking).

Untuk database staging yang secara eksplisit hanya memuat data sintetis, kontrol kompensasi yang masuk akal mencakup kredensial owner berentropi tinggi yang tidak disimpan di source/log, verifikasi TLS, role aplikasi terpisah dengan hak minimum, tanpa kredensial atau jalur jaringan production, akses owner yang terbatas, tanpa data pribadi nyata, serta siklus rotasi/pencabutan kredensial yang terdokumentasi. Kontrol ini mengurangi dampak, tetapi tidak menggantikan pembatasan IP atau koneksi privat. Free juga tidak memiliki kontrol Protected Branches di provider; metadata organisasi saat ini menunjukkan penegakan MFA tidak aktif. Lane ini tidak memiliki pengaturan atau kredensial target untuk diverifikasi, dan owner belum secara terpisah menerima risiko spesifik endpoint publik/kontrol MFA ini. Karena itu kecukupan keamanan berstatus UNKNOWN, bukan PASS.

### Batas model ancaman

- **Aset yang dilindungi:** hanya rekaman pengujian sintetis dan kredensial staging.
- **Di luar cakupan dan dilarang:** data/kredensial production, data nyata penghuni atau pengguna, konektivitas ke production, serta mutasi terhadap kedua project staging yang sudah ada.
- **Ancaman yang tersisa:** pemindaian endpoint dari internet, kebocoran atau penggunaan ulang kredensial, kredensial owner yang bocor, hak akses berlebihan, dan penulisan tak sengaja ke target yang salah. TLS saja tidak mengatasi risiko-risiko tersebut.
- **Mitigasi bersyarat:** pemeriksaan identitas endpoint/database/role secara persis, TLS verify-full, file kredensial owner privat, role runtime dengan hanya hak schema yang diperlukan, tanpa rahasia production, tanpa data nyata, tanpa konfigurasi deployment/env publik, dan pencabutan kredensial segera jika dicurigai bocor.
- **Keputusan yang belum ada:** apakah kontrol tersebut memenuhi standar owner “pengamanan memadai” walaupun IP Allow Free-tier, private networking, dan branch protection tidak tersedia. Ini ketidakpastian material; jangan provision.

## A05–A09 — Hasil gerbang, bukti, dan alternatif

| Pemeriksaan | Bukti | Status |
|---|---|---|
| Identitas organisasi dan paket | Metadata organisasi yang dibaca saja: satset, org-ancient-boat-57106549, free | PASS |
| Kuota jumlah project | Lima project terdaftar; batas paket yang dipublikasikan 100 | PASS untuk jumlah project saja |
| Singapore + PostgreSQL 18 | Daftar region yang dibaca saja mencakup Singapore; dokumentasi API mendukung PostgreSQL 18 | PASS untuk ketersediaan |
| Sisa penyimpanan seluruh akun | Tidak ada angka total penyimpanan terkini yang tepercaya; metadata lama tidak cukup | UNKNOWN |
| Penggunaan saat ini dan jaminan tanpa overage/Rp0 | API riwayat konsumsi untuk paket Free tidak tersedia; tidak ada bukti penggunaan/invoice Console atau kondisi billing | UNKNOWN |
| Metode membuat project baru | API terdokumentasi untuk project baru dan field lineage root branch; belum ada operasi yang dijalankan | PASS untuk kelayakan metode saja |
| Bukti lineage pascapembuatan dan katalog | Project belum dibuat; tidak ada bukti operasi/branch/katalog; pemeriksaan katalog pada target mendatang memerlukan persetujuan SQL baru | UNKNOWN / NOT AVAILABLE |
| Keamanan jaringan tersisa pada Free | IP Allow/private network/protected branch tidak tersedia di Free; penegakan MFA organisasi tidak aktif | UNKNOWN; standar owner belum terbukti |
| Cakupan data sintetis saja | Instruksi eksplisit owner | PASS sebagai batas operasional |

Evaluator offline terpisah di wave13b-2-provisioning-gate.mjs hanya menerima bukti yang dinormalisasi, tidak melakukan jaringan atau tindakan Neon, dan mewajibkan setiap pemeriksaan punya referensi bukti bertanggal sebelum menghasilkan PASS. Paket bukti saat ini tetap UNKNOWN, dengan mayProceedToCoordinatorGate: false. Script ini hanya memeriksa kelengkapan secara mekanis; ia bukan bukti keaslian dan bukan izin provisioning.

### Keputusan berhenti dan alternatif Rp0

**Jangan provision project Neon baru.** Sisa slot jumlah project saja tidak cukup karena sisa penyimpanan akun, status penggunaan/overage, dan kecukupan keamanan masih belum diketahui. Jangan mencoba mengatasi masalah ini dengan mengubah paket, mengaktifkan kontrol jaringan berbayar, atau memakai salah satu project staging KartuRT yang sudah ada.

Rehearsal CI PostgreSQL 18 disposable yang sudah selesai (run 38699617221 pada source SHA 0b1e3f525039496200b2bb5f698d312ded5cb3e3) adalah alternatif validasi Rp0 yang tersedia. Bukti ini hanya untuk rehearsal migrasi lokal/disposable; ini bukan project staging Neon yang sudah di-deploy dan tidak membuktikan isolasi Neon. Upaya Neon di masa mendatang memerlukan bukti baru untuk sisa penyimpanan/kuota seluruh akun dan kondisi billing/tanpa overage, penyelesaian eksplisit atas risiko endpoint publik Free, lalu peninjauan Coordinator sebelum satu operasi pembuatan project yang dibatasi secara jelas.
