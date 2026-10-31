# F14 dan F16: penutupan penerimaan V1

Tanggal: 31 Oktober 2026. Baseline rilis: `91613aef6b5b72a956a38f17a0401b62bdb9d018`.

Pemilik menyatakan verbatim: **"saya sudah verifikasi f14 dan f16, silahkan ditutup"** setelah checklist verifikasi ekspor berakun dan siklus jabatan dibahas. Ini adalah penerimaan dan instruksi penutupan oleh pemilik, bukan pengujian tambahan yang dijalankan atau disaksikan agent. Lingkungan, akun, perangkat dan langkah rinci tidak disebutkan; jangan mengarang rincian atau meminta kredensial untuk melengkapi catatan ini.

| Backlog | Lingkup diterima | Status |
| --- | --- | --- |
| F14 Export Data | CSV laporan bulanan/tahunan dan tunggakan sesuai akses laporan RT | CLOSED: dirilis dan diverifikasi pemilik |
| F16 Official Lifecycle UI | Jadwal/akhir masa jabatan, pergantian pengurus, pencabutan sesi dan audit sesuai lingkup F16 | CLOSED: dirilis dan diverifikasi pemilik |

F14 dirilis melalui [PR #124](https://github.com/Satsetx4/karturt/pull/124), merge `91613ae`, deployment `dpl_33pFJyWWr97W4mcaCUSGkM4wK1YK`. F16 dirilis melalui [PR #123](https://github.com/Satsetx4/karturt/pull/123), merge `c3b4660`, deployment `dpl_ujuEtM4cwHyGir3fFNZ55mVgEcio`; fiturnya tetap termasuk dalam rilis berikutnya. Post-merge Gate A untuk baseline `91613ae` ([run 41187800621](https://github.com/Satsetx4/karturt/actions/runs/41187800621)) telah dikonfirmasi sukses.

Bukti agent sebelumnya tetap berlaku sesuai batasnya: tes lokal, fixture sintetis, exact-head CI, deployment metadata, health/TLS/login dan penolakan akses anonim. Pernyataan historis bahwa agent belum menjalankan pengujian berakun tidak dihapus atau diubah menjadi klaim agent PASS. Gap penerimaan produk kini ditutup oleh verifikasi pemilik.

Penutupan F14 terbatas pada CSV V1; tidak menambahkan komitmen untuk database dump, dataset lain, atau format `.xlsx` khusus. Pernyataan ini tidak menjadi bukti perangkat/Excel tertentu, PostgreSQL concurrency atau recovery; job concurrency/recovery yang sebelumnya SKIPPED tetap SKIPPED. Tidak ada perubahan kode aplikasi, izin, schema, migrasi, data atau deployment dalam penutupan administratif ini.

Tahap backlog berikutnya: **F17 Admin Tooling**. Mulai dari audit alat akun/pemulihan yang sudah ada, pertahankan verified MFA, batas peran/RT dan audit; tambahkan hanya celah operasional yang terbukti diperlukan. F19, F21 dan F23 tetap pada urutan roadmap berikutnya.
