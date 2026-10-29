import { DeviceDataReset } from "@/components/device-data-reset";
import { ThemeToggle } from "@/components/theme-toggle";
import { InstallApp } from "@/components/install-app";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <p>Data iuran dikelola oleh pengurus RT Anda.</p>
      <div className="footer-actions">
        <DeviceDataReset />
        <ThemeToggle />
      </div>
      <InstallApp />
    </footer>
  );
}
