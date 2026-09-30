# Laporan Cleanup Fase 4.1

Tanggal: 30 September 2026 (Asia/Jakarta)

## Baseline dan keputusan

- Repository: `https://github.com/Satsetx4/karturt`
- Baseline: `feat/phase-4-resident-card` pada `83ff613e95ef9e3fe25271894cbbb889ed30ee56`.
- Branch cleanup: `fix/phase-4-1-resident-card-cleanup`.
- Implementasi: `c5f9cc91caf0365947305578c71243ff780fdfcc`.
- Baseline Gate A/Fase 4 tetap PASS. GitHub Actions pada baseline, run [36718483776](https://github.com/Satsetx4/karturt/actions/runs/36718483776), selesai sukses.
- Runtime: Node.js `v24.18.0`, npm `11.17.0`.
- Migration head: `0003_due_auth_audit_domain`. Tidak ada schema migration.

**Keputusan cleanup: PASS.** Perubahan lulus quality gate lokal, browser visual smoke, dan GitHub Actions pada commit implementasi di atas.

## Perubahan

- Label warga kini sederhana: `Sudah bayar`, `Belum bayar`, `Dibebaskan`, dan `Tidak perlu bayar`. Riwayat memakai label yang sama; token domain tidak ditampilkan.
- Informasi tanggal jatuh tempo dan tanggal 10 dihilangkan dari kartu, ringkasan, dan riwayat. Perhitungan tunggakan tetap memakai `dueDate` dan tanggal bisnis Jakarta di fungsi ringkasan.
- Kartu bulan hanya menampilkan bulan, label, dan nominal bila relevan. Bulan `NOT_DUE` menampilkan `—`; alasan pembebasan yang tidak dipakai UI juga tidak dikirim ke browser.
- Response iuran tetap memuat hanya `billingYear`, `month`, `amount`, `dueDate`, dan `status`. Internal due UUID, `rtUnitId`, dan `householdId` tidak dikirim. Otorisasi tetap berasal dari principal terautentikasi.
- Kontrak visual `PENDING` tersedia sebagai `Menunggu konfirmasi` dengan icon/style tersendiri. Mapper dari data sekarang hanya dapat menghasilkan empat status domain yang ada; tidak ada status PENDING yang dipersist atau dibuat-buat.
- Tanggal profil ditampilkan dalam format Indonesia dan label `Terdaftar sejak`; jargon `household` dihapus.
- Copy akun non-resident tidak lagi bergantung pada Gate A dan tidak menjanjikan modul yang belum tersedia.
- Ukuran status dinaikkan menjadi 16px. Grid tetap 2 kolom pada ponsel dan 3 kolom mulai 600px; tombol navigasi memenuhi tinggi 44px dan outline fokus tetap terlihat.

## Bukti dan quality gate

| Pemeriksaan | Hasil |
|---|---|
| Lint | PASS |
| Typecheck | PASS |
| Unit | PASS — 25 test / 5 file |
| Integration dan migration | PASS — 31 test / 12 file, dijalankan per file |
| Constraints | PASS — 14 test |
| Authorization | PASS — 4 test |
| Production build | PASS |
| `drizzle-kit check` | PASS |
| Schema drift | PASS — generator menyatakan tidak ada perubahan untuk dimigrasikan |
| Full suite di CI | PASS — Gate A menjalankan test suite penuh |
| Browser visual smoke | PASS — 360×800, 390×844, 768×1024, 1440×900 |
| GitHub Actions cleanup branch | PASS — [run 36727605495](https://github.com/Satsetx4/karturt/actions/runs/36727605495) pada `c5f9cc91caf0365947305578c71243ff780fdfcc` |

Gabungan seluruh test lokal berjumlah 74 test pada 19 file dan semuanya lulus ketika dijalankan per file. Percobaan menjalankan seluruh integration suite dalam satu proses pada runner Windows kehabisan memori; pengulangan per file lulus. CI menjalankan gate gabungan pada runner GitHub.

Browser smoke memakai Chrome, CSS hasil production build, komponen kartu aktual, dan fixture sintetis tanpa nama/ID/data warga. Pemeriksaan memastikan 2×6 dan 3×4, tidak ada horizontal overflow, status 16px, empat label Indonesia terlihat, tidak ada token teknis atau tanggal jatuh tempo, tombol navigasi minimal 44px, serta outline fokus minimal 3px. Fixture tidak memuat PENDING. Reproduksi: `npm run build`, lalu `npm run smoke:resident-card` pada mesin dengan Chrome atau Edge. Screenshot tersimpan di [bukti 360×800](phase-4-1-cleanup-evidence/resident-card-360x800.png), [390×844](phase-4-1-cleanup-evidence/resident-card-390x844.png), [768×1024](phase-4-1-cleanup-evidence/resident-card-768x1024.png), dan [1440×900](phase-4-1-cleanup-evidence/resident-card-1440x900.png).

Smoke visual ini tidak mengulang login atau request logout server. Fase 4 sebelumnya sudah memverifikasi login, navigasi, fokus, logout, dan penanganan logout gagal di browser; cleanup ini tidak mengubah handler navigasi atau logout. Test authorization dan session tetap dijalankan ulang.

## Risiko tersisa

- Status `Dibebaskan` tidak lagi menampilkan alasan internal per bulan agar kartu tetap ringkas; nilai kewajiban yang dibebaskan tetap terlihat.
- Browser smoke ini menguji presentasi dengan fixture sintetis, bukan data atau sesi warga live. Preview deployment, perangkat fisik, dan screen-reader UAT tetap di luar scope cleanup.
- Local aggregate integration run terbatas oleh memori Windows; GitHub Actions menjadi bukti akhir untuk full gate gabungan.

## Batas fase

Due-day tanggal 10 dan status database tidak diubah. Tidak ada financial mutation atau schema migration.

**Fase 5 Payment Request BELUM DIMULAI.** Branch sudah dipush untuk review; tidak ada merge ke default branch.
