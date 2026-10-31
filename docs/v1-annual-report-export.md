# F14: ekspor CSV tahunan

Baseline: main `c3b46606ec58f3a3cac642c81d46053155cce42b` (rilis F16 / PR #123). Slice ini melengkapi CSV bulanan dengan satu CSV tahunan, bukan database dump, daftar kontak warga, atau berkas Excel berformat khusus.

## Alur dan lingkup

Ketua/Bendahara → Laporan iuran → pilih tahun → Unduh CSV tahunan. Pemilihan bulan tetap berlaku untuk cetak/PDF dan CSV bulanan; CSV tahunan selalu memuat semua 12 bulan pada tahun laporan yang sudah dimuat. Satu tombol tambahan memakai gaya/tata letak yang ada; tidak ada halaman, endpoint, schema, dependency atau izin baru.

Data berasal dari respons laporan RT yang sudah diotorisasi dan divalidasi pada alur laporan yang ada. Tahun yang diganti mengosongkan laporan lama selama pemuatan, sehingga kontrol unduh tidak tersedia pada respons lama. Tidak ada akses RT pilihan dari klien, query tambahan, penulisan audit/ledger, atau perubahan perhitungan laporan. Tidak ada klaim pencatatan audit tersendiri untuk file yang diunduh; pola ini sama dengan CSV bulanan.

## Isi berkas

`laporan-iuran-YYYY-tahunan.csv`: UTF-8 BOM, delimiter titik koma, CRLF, dan 11 kolom: Bagian, Periode tagihan, Keterangan, Rumah, Warga, Status rumah tangga, Mulai menempati, Akhir menempati, Jatuh tempo, Menunggu konfirmasi, Nilai (rupiah).

- Identitas RT/tahun dan posisi tanggal laporan yang dimuat; bukan snapshot penutupan tahun atau buku kas.
- Ringkasan tahunan dan 12 ringkasan bulanan: target awal/efektif, saldo awal impor, transfer, tunai, total pembayaran, pemutihan dan sisa kewajiban.
- Sisa kewajiban sampai bulan berjalan dan bulan mendatang dipisahkan. Kategori sampai bulan berjalan tidak otomatis berarti seluruhnya sudah menunggak.
- Tunggakan berasal dari daftar overdue laporan: outstanding positif dan jatuh tempo sebelum tanggal bisnis WIB. Bulan mendatang atau tepat pada tanggal jatuh tempo tidak dimasukkan.
- Nama dan status/tanggal masa tinggal membedakan riwayat rumah tangga lama dengan yang baru di nomor rumah yang sama. Tidak menambahkan PIN, hash, kontak, sesi, atau payload internal.

Perhitungan keuangan tetap milik laporan yang ada. Serializer mengecek rekonsiliasi jumlah 12 bulan ke tahunan, pembagian sisa kewajiban, serta rincian/total tunggakan; angka tidak aman atau respons tidak konsisten menolak unduhan. Teks yang berpotensi menjadi formula diberi apostrof, termasuk setelah whitespace/control character. Kutip, delimiter, Unicode dan baris baru tetap di-escape sebagai isi sel. Serializer CSV yang sama dipakai bulanan tanpa mengubah bentuk berkas bulanan.

Data unduhan adalah data yang sudah dimuat di layar. Tidak menambahkan cache, localStorage, service worker, background queue, atau jaminan bahwa file yang sudah diunduh ikut dicabut saat logout. File yang berisi nama warga tetap mengikuti pembatasan penggunaan yang sudah dijelaskan pada panduan laporan.

## Acceptance criteria

1. Ketua/Bendahara aktif hanya mengekspor laporan RT sendiri; peran lain, akun nonaktif, penugasan berakhir dan principal palsu ditolak oleh pembacaan laporan yang ada.
2. Nama berkas dan isi mengikuti tahun laporan, seluruh 12 bulan disertakan; CSV bulanan tetap mengikuti bulan yang dipilih.
3. Saldo awal dan pemutihan tidak dicampur ke pembayaran baru; reversal mengikuti laporan yang ada. Jumlah bulanan, tahunan, due-now/future dan tunggakan konsisten.
4. Tunggakan tidak mencakup kewajiban mendatang atau yang tepat jatuh tempo; status pending tetap informasi terpisah dari pembayaran terverifikasi.
5. Nomor rumah yang dipakai kembali tidak menyatukan riwayat penghuni; nama kosong tidak diganti nama fiktif.
6. Formula injection, kutip, delimiter, Unicode, newline, angka tidak aman, bulan duplikat/hilang dan total tidak konsisten diuji. Gagal unduh menampilkan pesan, tanpa sukses semu.
7. Tombol dapat dipakai pada 360/390/420/768/1440 px dalam kedua tema, tanpa overflow horizontal dan target sentuh minimal 44 px.

## Bukti dan batas

53 tes terfokus pada CSV tahunan/bulanan, rendering, serta otorisasi layanan/route laporan lulus. Seluruh suite lokal: 767 tes pada 100 file lulus. Typecheck, lint file terkait, dan diff check lulus. Build bersih dan CI final-SHA dicatat pada PR setelah selesai.

Fixture HTTP/React lokal menggunakan data sintetis saja. Klik browser menghasilkan berkas CSV tahunan 2026 yang diperiksa langsung dengan parser CSV: BOM benar, 11 kolom, 12 bulan, sisa kewajiban 80000, bagian mendatang 40000, tunggakan 40000. Unduhan bulanan Desember 2026 mempertahankan 7 kolom dan tunggakan nol. Unduhan tahunan 2025 memuat periode 2025 dan tunggakan 80000. Data contoh ini bukan angka Production.

Penantian event download pada alat browser sempat habis waktu; bukti unduhan memakai klik normal, file baru bertimestamp setelah klik dan pemeriksaan parser. Bukan klaim bahwa mekanisme event alat tersebut lulus. Simulasi kegagalan pembuatan Blob URL menampilkan pesan gagal unduh. Pemeriksaan DOM pada kedua tema/lima lebar lulus tanpa overflow/kontrol kurang dari 44px; tampilan gelap 390px diperiksa secara visual dan log fixture sebelum fault injection kosong.

Belum dijalankan: login/unduhan pada Preview berakun, ekspor dalam PWA terpasang Android/iPhone, dan native Excel UI. Validasi parser CSV bukan bukti tampilan Excel pada semua locale. PostgreSQL concurrency/recovery tidak dijalankan untuk slice read-only ini. Semua file uji berasal dari data sintetis, tanpa membaca atau menyalin data warga Production.

Sebelum rilis: exact-SHA CI, deploy Preview yang disetujui, periksa unduhan dengan akun sintetis Ketua/Bendahara serta penolakan peran lain, dan penerimaan pengguna. Excel `.xlsx` berformat khusus atau ekspor operasional lain memerlukan penentuan dataset tersendiri.
