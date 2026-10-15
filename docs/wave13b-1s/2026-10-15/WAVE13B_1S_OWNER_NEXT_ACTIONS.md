# Wave 13B.1S — Owner Next Actions

## Tindakan minimum untuk D1v2

1. Sediakan dan setujui baseline expected-state untuk role/membership, schema/extensions, ownership, objek yang diizinkan, ACL mentah serta privilege efektif, dan migration ledger target baru yang dipin. Jangan kirim isi sensitif ke chat atau Git.
2. Siapkan secara lokal `psql` PostgreSQL 18, CA Neon tepercaya, serta `PGPASSFILE` owner-only untuk hostname dan role yang dipin. Jangan kirim kredensial.
3. Setelah prasyarat tersedia, beri tahu coordinator agar ia mengulang readback metadata non-waking tepat sebelum koneksi. Jika identitas berbeda, jangan terhubung.

> Persetujuan tercatat terbatas pada satu proses `psql` dengan `-X --set=ON_ERROR_STOP=on --set=ON_ERROR_ROLLBACK=off --single-transaction`, `sslmode=verify-full`, target staging baru yang dipin, tepat 26 SQL fence beku, serta kemungkinan satu wake. Persetujuan tidak mencakup SQL tambahan, retry, driver lain, migrasi, DDL, guard flip, target lama, atau produksi.

## Tindakan minimum untuk menutup audit dependency

Audit penuh menemukan lima advisory high pada dependency development saja; production-only audit bersih. npm tidak menunjukkan remediation non-major untuk `eslint-config-next@16.3.8`. Owner perlu memilih dan menyetujui jalur upgrade toolchain yang kompatibel sebelum dependency audit bisa dinyatakan bersih. Tidak ada dependency yang diturunkan atau diubah dalam wave ini.

## Gerbang berikutnya

Hasil katalog bersih tidak membuktikan lineage independen atau database kosong secara fisik. D3 tetap NO-GO sampai lineage/emptiness terbukti positif, role/network aman, final SHA dan hash migrasi disetujui, serta artefak Ed25519 one-time owner-signed diverifikasi. Wave ini tidak mengizinkan provisioning atau mutasi provider. RC final tetap `RC_PARTIAL` sampai owner memutuskan penyelesaian advisory dev-only; semua Gate A, concurrency, PG18 rehearsal, dan QA suite pada SHA `193b25be6394db9196c22617e9b55b4427cf6f86` telah lulus.

## Referensi

- [Laporan kesiapan D1v2](WAVE13B_1S_AGENT_B_D1V2_OPERATOR_READINESS.md)
- [Laporan koordinator](WAVE13B_1S_COORDINATOR_REPORT.md)
- [Matriks penerimaan RC](WAVE13B_1S_RC_ACCEPTANCE_MATRIX.md)
