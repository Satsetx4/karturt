import { useState } from "react";
import { createRoot } from "react-dom/client";
import { MonthlyReportPrint } from "../src/components/monthly-report-print";
import type { RtFinancialReportResponse } from "../src/lib/reports/aggregation";

function Fixture({ report }: { report: RtFinancialReportResponse }) {
  const [month, setMonth] = useState(4);
  return <main className="page-shell"><section className="app-card"><h1>Ekspor laporan sintetis {report.year}</h1><MonthlyReportPrint report={report} rtIdentity="RT Sintetis" month={month} onMonthChange={setMonth} /></section></main>;
}
if (new URL(location.href).searchParams.get("fault") === "download") {
  URL.createObjectURL = () => { throw new Error("Synthetic download failure"); };
}
void fetch(`/api/fixture-report${location.search}`).then(async (response) => {
  const report = await response.json() as RtFinancialReportResponse;
  const root = document.getElementById("root");
  if (!root) throw new Error("Synthetic export root missing.");
  createRoot(root).render(<Fixture report={report} />);
});
