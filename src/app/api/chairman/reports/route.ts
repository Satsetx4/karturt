import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import {
  MfaEnrollmentRequiredError,
  UnauthenticatedError,
  getCurrentPrincipal,
} from "@/lib/auth/principal";
import { jakartaBusinessDate } from "@/lib/officials/lifecycle";
import {
  getRtFinancialReport,
  InvalidReportYearError,
  ReportForbiddenError,
} from "@/lib/reports/rt-financial-report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function reportJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function reportErrorResponse(error: unknown) {
  if (error instanceof UnauthenticatedError || error instanceof MfaEnrollmentRequiredError) {
    return reportJson({ message: "Sesi berakhir. Silakan masuk kembali." }, 401);
  }
  if (error instanceof ReportForbiddenError || (error instanceof Error && error.message.startsWith("Forbidden:"))) {
    return reportJson({ message: "Laporan hanya tersedia untuk Ketua RT aktif." }, 403);
  }
  if (error instanceof InvalidReportYearError) {
    return reportJson({ message: "Tahun laporan tidak valid." }, 400);
  }
  return reportJson({ message: "Laporan belum dapat dimuat. Silakan coba lagi." }, 500);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const keys = [...new Set(url.searchParams.keys())];
  const years = url.searchParams.getAll("year");
  if (keys.some((key) => key !== "year") || years.length > 1) {
    return reportJson({ message: "Filter laporan tidak valid." }, 400);
  }

  let year: number | undefined;
  if (years[0] !== undefined) {
    if (!/^\d{4}$/.test(years[0])) {
      return reportJson({ message: "Tahun laporan tidak valid." }, 400);
    }
    year = Number(years[0]);
    if (!Number.isInteger(year) || year < 2000 || year > 2200) {
      return reportJson({ message: "Tahun laporan tidak valid." }, 400);
    }
  }

  try {
    const principal = await getCurrentPrincipal();
    const result = await getRtFinancialReport(getDb(), principal, {
      year,
      businessDate: jakartaBusinessDate(),
    });
    return reportJson(result);
  } catch (error) {
    return reportErrorResponse(error);
  }
}
