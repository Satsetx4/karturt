export function serializeReportCsv(rows: readonly (readonly (string | number)[])[]) {
  function cell(value: string | number) {
    if (typeof value === "number") {
      if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid report amount.");
      return String(value);
    }
    // Quoting alone does not prevent spreadsheet programs from evaluating formulas.
    const safe = /^[\s\u0000-\u001f]*[=+\-@]/.test(value) || /^[\t\r\n]/.test(value) ? `'${value}` : value;
    return `"${safe.replaceAll('"', '""')}"`;
  }
  return "\uFEFF" + rows.map((row) => row.map(cell).join(";")).join("\r\n") + "\r\n";
}
