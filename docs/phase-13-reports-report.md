# KartuRT F13 — Laporan Hasil Akhir

## Status

**F13 implementation:** selesai pada branch `feat/phase-13-reports`.

**Final F13 implementation/source SHA:** `f73e46270a5c887f773876aabd97baea25ec3a55` (commit produk; perubahan sesudahnya hanya dokumentasi/evidence)

**Baseline `main` SHA:** `322e439267cd4e5d5552f7816ed1d3a3eebf533c`

**Migration head:** `0013_phase_12_household_management`

**Migration hash:** `994BCC9376B207FDC0668312CC68CAB3C2CEC46BC6101EDC4C2B5EF7F51C4A85`
**`0014`:** tidak dibuat. Tidak ada perubahan schema atau data Neon.

Baseline `main` masih tepat pada SHA di atas dan GitHub Actions run `37182687768` berstatus sukses. F13 dipisah pada branch fitur; tidak ada merge ke `main`.

## Hasil implementasi

- Laporan tahunan dan bulanan, split transfer/tunai pada allocation, dan daftar tunggakan kini tersedia di `/app/laporan`.
- API hanya menyediakan `GET /api/chairman/reports?year=YYYY`; route menolak parameter tenant/role, tahun invalid, dan query berulang.
- Permission `report:read:rt` hanya diberikan kepada `rt_chairman`, dibatasi ke RT principal, dan tidak memberi hak verifikasi pembayaran.
- Agregasi memakai integer Rupiah, menghitung menurut billing period, mengecualikan payment reversed, memisahkan WAIVED dan NOT_DUE, dan gagal tertutup pada invariant yang tidak cocok.
- UI menggunakan kartu bertumpuk untuk ringkasan tahunan, 12 bulan, dan tunggakan per household. Household lama dan baru tetap terpisah meskipun nomor rumah sama.
- F13 hanya read-only. Tidak ada endpoint ekspor, migration, tabel laporan, cache laporan, atau perubahan finansial.

## Rumus yang dibekukan

Untuk setiap monthly due:

```text
target          = original monthly_due amount; 0 untuk NOT_DUE
effectiveTarget = originalAmount + adjustmentTotal; 0 untuk NOT_DUE
received        = allocation aktif dari payment yang tidak reversed
waived          = waiver_items.amount hanya untuk due berstatus WAIVED
outstanding     = effectiveTarget - received - waived
```

```text
transferReceived + cashReceived = received
effectiveTarget = received + waived + outstanding
```

Periode laporan ditentukan oleh `payment_allocations → monthly_due`, bukan tanggal payment. Pending request hanya memberi tanda operasional dan tidak mengurangi outstanding. Tunggakan berarti `outstanding > 0` dan `dueDate < Jakarta business date`. NOT_DUE menghasilkan nol untuk semua nilai finansial dan hanya menambah `notDueCount`.

Layanan F11 hanya membuat waiver untuk kewajiban belum dibayar tanpa receipt sebelumnya dan sebesar target efektif penuh. Aggregator F13 kini menolak waiver ledger yang parsial atau bercampur dengan receipt.

## Manual oracle: ekspektasi dan aktual

Fixture PGlite menggunakan tarif Rp40.000, adjustment H1 Februari +Rp10.000 dan Maret −Rp5.000, waiver H1 April, pending request H1, serta reversal H3-new. Oracle mengikuti cash sweep F8: pembayaran tunai H2 pada Mei mengalokasikan Rp40.000 untuk April dan Rp40.000 untuk Mei. Rumus pelaporan tidak berubah.

| Billing period | Target awal | Target efektif | Diterima | Transfer | Tunai | Dibebaskan | Belum diterima | Tidak ditagih |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Jan | Rp80.000 | Rp80.000 | Rp80.000 | Rp80.000 | Rp0 | Rp0 | Rp0 | 2 |
| Feb | Rp80.000 | Rp90.000 | Rp50.000 | Rp0 | Rp50.000 | Rp0 | Rp40.000 | 2 |
| Mar | Rp120.000 | Rp115.000 | Rp80.000 | Rp40.000 | Rp40.000 | Rp0 | Rp35.000 | 1 |
| Apr | Rp120.000 | Rp120.000 | Rp40.000 | Rp0 | Rp40.000 | Rp40.000 | Rp40.000 | 1 |
| Mei | Rp120.000 | Rp120.000 | Rp40.000 | Rp0 | Rp40.000 | Rp0 | Rp80.000 | 1 |
| Jun–Des, tiap bulan | Rp120.000 | Rp120.000 | Rp0 | Rp0 | Rp0 | Rp0 | Rp120.000 | 1 |

Jan–Mei aktual sama dengan oracle: target Rp520.000; target efektif Rp525.000; diterima Rp290.000 (transfer Rp120.000 + tunai Rp170.000); dibebaskan Rp40.000; belum diterima Rp195.000; NOT_DUE 7. Identitas lulus: `525.000 = 290.000 + 40.000 + 195.000`.

Total tahunan aktual: target Rp1.360.000; target efektif Rp1.365.000; diterima Rp290.000 (transfer Rp120.000 + tunai Rp170.000); dibebaskan Rp40.000; belum diterima Rp1.035.000; NOT_DUE 14. Identitas lulus: `1.365.000 = 290.000 + 40.000 + 1.035.000`. Yearly dihitung dari 12 total bulanan dan diperiksa silang dengan agregasi due independen.

Tunggakan manual oracle dan aktual:

- `2026-05-20`: Rp195.000 pada 5 due dan 3 household — H3-old Feb Rp40.000; H1 Mar Rp35.000 dan Mei Rp40.000 (pending); H3-new Apr dan Mei masing-masing Rp40.000 (payment dibalik).
- `2026-05-05`: Rp115.000 pada 3 due — H3-old Feb Rp40.000; H1 Mar Rp35.000; H3-new Apr Rp40.000. Mei belum melewati tanggal jatuh tempo.

Transfer + tunai cocok dengan diterima untuk setiap bulan dan tahun. H1 April WAIVED Rp40.000 tetap merupakan kewajiban dan terpisah dari NOT_DUE. H2 dan H3-new Mei cash sweep memengaruhi April/Mei sesuai allocation; kedua alokasi H3-new dikecualikan setelah reversal. Direct SQL lokal dan service F13 cocok untuk semua bulan, total tahunan, rincian tunggakan, pending, dan identitas household.

H3-old dan H3-new pada rumah fisik A-03 tetap dua identitas household berbeda. Test menanam snapshot historis secara langsung di PGlite karena trigger lifecycle F12 menolak perubahan retrospektif terhadap tanggal server saat ini; trigger tidak dinonaktifkan atau diubah. Regresi lifecycle F12 tetap berjalan di suite integration.

## Oracle SQL Neon independen

Pemeriksaan hanya membaca project `billowing-base-57949906`, branch `karturt-development` (`br-crimson-band-az6i637k`), database `neondb`.

- Migration journal 14 entri; head `0013_phase_12_household_management`; tidak ada 0014.
- Gate C: 32 dari 32 kategori anomali bernilai nol. Audit lifecycle F12 global: 11 dari 11 pemeriksaan nol.
- Independent SQL tahun 2026 meliputi 64 RT billing-year scopes. Target Rp17.312.000; target efektif Rp17.312.003; diterima Rp3.584.000 (transfer Rp1.974.000 + tunai Rp1.610.000); waiver Rp720.000; outstanding Rp13.008.003; NOT_DUE 231. Semua invariant, split metode, waiver, dan NOT_DUE cocok.
- Dari 251 allocation lintas-bulan senilai Rp4.562.000, 67 row milik 44 payment reversed senilai Rp1.230.000 dikeluarkan dari receipt (transfer Rp444.000, tunai Rp786.000).
- SQL service-level comparison pada satu RT aktif dengan 13 due tahun 2026 cocok pada 12 bulan, tahun, tunggakan per household, dan tunggakan per bulan. Nilai tahunan sample: target/efektif Rp240.000; diterima Rp40.000 (transfer Rp20.000, tunai Rp20.000); waiver Rp140.000; outstanding Rp60.000; NOT_DUE 1. Dua periode tunggakan Rp40.000 memiliki pending request. Semua perbandingan lulus.
- Pengelompokan lifecycle SQL menunjukkan rumah fisik dengan household aktif dan historis tetap dipisah lebih dulu menurut household ID.

Service-level comparison menggunakan principal fields dari SELECT account/assignment yang aktif; tidak membuat sesi, tidak memanggil HTTP/API, dan bukan bukti browser terautentikasi. Neon hanya menerima SELECT. Production tidak diakses.

## Authorization dan browser

| Kasus | Hasil otomatis |
| --- | --- |
| Chairman aktif pada RT sendiri | PASS |
| Chairman tidak aktif | DENY |
| Assignment Chairman sudah berakhir | DENY |
| Treasurer | DENY |
| Resident | DENY |
| System Admin | DENY |
| Spoof tenant/role, RT lain, atau parameter query tambahan | DENY / 400 |
| Pembacaan laporan mengubah ledger/audit | Tidak ada perubahan |

Unit HTTP anonim tambahan memverifikasi `/app/laporan` mengarah ke `/login/pengurus`; GET API anonim mengembalikan 401 dengan `cache-control: no-store`.

**Authenticated Chairman browser smoke belum dilakukan.** Tab sign-in lokal tersedia, tetapi tidak ada sesi Ketua RT yang sudah terautentikasi. Saya tidak meminta atau memasukkan kredensial, membuat akun, atau mereset akun. Karena itu dashboard → Laporan, pemilihan tahun, nilai UI, viewport 360/390/430/768/1440, serta negative browser/API checks dengan sesi Treasurer, Resident, System Admin, dan RT lain belum dapat dibuktikan. Automated service/route tests tidak menggantikan acceptance browser tersebut.

Tidak ada screenshot acceptance yang diklaim. Lihat `docs/phase-13-reports-evidence/browser-summary.json` untuk batas verifikasi browser.

## Gate lokal dan dependency

- `npm ci`: PASS; package lock tidak berubah.
- lint: PASS, 0 error; tersisa 1 warning lama pada `scripts/phase-12-household-browser-smoke.ts:1005`.
- typecheck: PASS.
- unit: 7 file / 42 test PASS.
- integration: 31 file / 154 test PASS.
- constraints: 8 file / 42 test PASS.
- authorization: 12 file / 111 test PASS.
- full `npm test`: 58 file / 349 test PASS.
- production build: PASS; route `/api/chairman/reports` dan page `/app/laporan` terbangun.
- `npx drizzle-kit check`: PASS; schema drift: tidak ada perubahan.
- `npm audit`: 5 High dependency entries dari satu temuan root dev-only `braces@3.0.3`, GHSA-vfj7-8cjw-p6xm, yang tetap dibatasi ke residual `RA-2026-F12-001`. Tidak ada temuan High/Critical baru. `npm audit --omit=dev`: 0 vulnerability.
- GitHub Actions pada source SHA F13: **PASS**, run [`37191610714`](https://github.com/Satsetx4/karturt/actions/runs/37191610714), head `f73e46270a5c887f773876aabd97baea25ec3a55`.

## Risiko tersisa

1. Authenticated browser acceptance dan live negative role/cross-RT browser checks belum terpenuhi karena tidak ada sesi akun Ketua RT yang dapat dipakai. Ini menghalangi F13 PASS.
2. Satu-satunya residual dependency yang diterima tetap `RA-2026-F12-001` untuk dev-only `braces@3.0.3`; waiver tidak diperluas.
3. Satu warning lint lama F12 tetap ada dan tidak berasal dari perubahan F13.

F14 belum dimulai. Tidak ada export, merge, migration, atau perubahan Neon production.

F13 FAIL — F14 NO-GO — blocker: authenticated Chairman browser smoke and live negative role/cross-RT browser checks are incomplete.

## Addendum F13.1 — Acceptance closure (4 Oktober 2026)

Status FAIL di atas adalah catatan historis dan tidak dihapus atau ditulis ulang. Blocker awalnya adalah browser Ketua RT yang terautentikasi belum diuji. Untuk mode operasional Single-RT yang telah disetujui, manual browser cross-RT tidak lagi diwajibkan; penolakan Treasurer, Resident, System Admin, inactive/ended Chairman, cross-RT, tenant spoof, dan direct API tetap dibuktikan oleh regresi authorization otomatis.

Source closure `6b90bdb35f7fe15950bf809b1792dee9db2df93b` menyelesaikan acceptance browser Ketua RT: dashboard → Laporan → `/app/laporan`, tahun 2026, 12 ringkasan bulanan, kecocokan UI dengan API pada sesi yang sama, dan kecocokan API dengan SQL SELECT independen. Lima viewport 360×800, 390×844, 430×900, 768×1024, dan 1440×900 lulus. Target sentuh minimum 44px pada link brand laporan diperbaiki sebelum gate lokal dan browser final diulang.

Gate C tetap 32/32 nol; migration journal tetap 14 entri pada `0013_phase_12_household_management` tanpa `0014`; audit lifecycle F12 global tetap 11/11 nol. Uji fixture-specific F12.1 tidak dijalankan karena manifest tidak tersedia. Lihat [laporan closure F13.1](phase-13-1-acceptance-closure-report.md) dan folder `docs/phase-13-1-acceptance-evidence/` untuk rincian serta bukti kurasi.

Pada source closure, seluruh gate lokal lulus. Dependency audit tetap hanya memiliki residual dev-only yang sudah diterima `RA-2026-F12-001` (`braces@3.0.3`); production-only audit 0 vulnerability. Neon development menerima hanya rotasi credential sementara dan pencabutan sesi untuk satu akun Ketua RT sintetis; rotasi cleanup terverifikasi dan jumlah sesi akhir nol. Production tidak diakses.

Keputusan scope: **Single-RT MVP operational mode APPROVED; Multi-RT architecture PRESERVED; F14 DEFERRED POST-LAUNCH.** Gate A run `37202396608` PASS pada SHA `0093d9cb197924b4d4aaf1e338ef56aa10a6aa3f`; perubahan addendum readiness ini membentuk SHA baru yang harus lulus Gate A pada exact SHA sebelum promotion atau memulai Launch Safety. Identitas run final exact-SHA dicatat dalam handover coordinator. Tidak ada merge ke `main`, migration baru, production work, Launch Safety, atau implementasi F14 dalam Package 1.
