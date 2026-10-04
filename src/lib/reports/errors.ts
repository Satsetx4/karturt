export class ReportForbiddenError extends Error {
  constructor() {
    super("Forbidden");
    this.name = "ReportForbiddenError";
  }
}

export class InvalidReportYearError extends Error {
  constructor() {
    super("Invalid report period");
    this.name = "InvalidReportYearError";
  }
}

export class ReportInvariantError extends Error {
  constructor(message = "The financial report could not be reconciled.") {
    super(message);
    this.name = "ReportInvariantError";
  }
}
