# Pembekuan Scope MVP: Mode Operasional Single-RT

**Status:** APPROVED
**Berlaku untuk:** handover MVP KartuRT

## Keputusan produk

Deployment operasional pertama melayani tepat satu RT. Fitur multi-RT untuk pengguna berada di luar scope MVP. Arsitektur multi-tenant dan batas keamanannya tetap dipertahankan sebagai fondasi produk.

| Kapabilitas atau invariant | Keputusan MVP |
| --- | --- |
| Jumlah RT operasional | 1 |
| Onboarding multi-RT | OUT OF MVP |
| Pemilih RT | OUT OF MVP |
| Pergantian tenant | OUT OF MVP |
| UI admin multi-tenant | OUT OF MVP |
| `rt_unit_id` | KEEP |
| Isolasi tenant | KEEP |
| Constraint database lintas-RT | KEEP |
| Otorisasi lintas-RT | KEEP |
| Tes otomatis lintas-RT | KEEP |

Keputusan scope ini tidak mengizinkan refactor schema, penghapusan `rt_unit_id`, maupun penghapusan atau pelemahan tenant guard.

## Fitur tertunda

Item berikut berstatus **DEFERRED**, bukan dihapus (**REMOVED**), dan tetap menjadi backlog setelah launch:

- F14 Export — DEFERRED POST-LAUNCH
- F15 Audit UI
- F16 Official Lifecycle UI
- Full F17 Admin tooling
- F19 Notifications
- F20 PWA
- Full F21 UX study
- Full F23 optimization

F14 tetap ditunda sampai setelah launch. Pembekuan scope ini hanya mencakup Package 1; dokumen ini tidak memulai Launch Safety atau implementasi fitur tertunda.

## Kebijakan acceptance F13.1

Acceptance browser manual mencakup sesi Ketua RT yang terautentikasi, navigasi dashboard ke Laporan, `/app/laporan`, kecocokan laporan dengan API pada sesi yang sama, ringkasan tahunan dan bulanan, tunggakan, seluruh viewport responsif yang diwajibkan, serta pemeriksaan kebocoran UI/keamanan yang terlihat.

Acceptance browser lintas-RT secara manual tidak diwajibkan untuk MVP operasional single-RT ini. Regresi otomatis otorisasi dan isolasi tenant tetap diwajibkan, termasuk penolakan akses lintas-RT dan tenant spoof.
