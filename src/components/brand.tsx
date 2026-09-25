import Link from "next/link";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link className={`brand${compact ? " brand--compact" : ""}`} href="/" aria-label="KartuRT, beranda">
      <span className="brand-mark" aria-hidden="true">K</span>
      <span className="brand-copy">
        <span className="brand-name">KartuRT</span>
        {!compact && <span className="brand-caption">Administrasi warga, lebih jelas.</span>}
      </span>
    </Link>
  );
}
