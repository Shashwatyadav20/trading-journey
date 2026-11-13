import { NextRequest, NextResponse } from "next/server";
import {
  cleanNseSymbol,
  compileCompanyResearchReport,
  CompanyResearchReport,
  synthesizeGroundedResearchAnswer,
} from "../../../../lib/ai/companyResearchEngine";

export const dynamic = "force-dynamic";

interface CachedReport {
  report: CompanyResearchReport;
  cachedAt: number;
}

const CACHE_TTL_MS = 120_000;
const reportCache = new Map<string, CachedReport>();

export async function GET(req: NextRequest) {
  try {
    const symbolParam = req.nextUrl.searchParams.get("symbol") || "RELIANCE";
    const force = req.nextUrl.searchParams.get("force") === "true";
    const clean = cleanNseSymbol(symbolParam);

    const existing = reportCache.get(clean);
    if (!force && existing && Date.now() - existing.cachedAt < CACHE_TTL_MS) {
      return NextResponse.json({
        success: true,
        cached: true,
        report: existing.report,
      });
    }

    const report = await compileCompanyResearchReport(clean);
    reportCache.set(clean, { report, cachedAt: Date.now() });

    return NextResponse.json({
      success: true,
      cached: false,
      report,
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Failed to compile live company research",
      },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const symbol = cleanNseSymbol(String(body?.symbol || "RELIANCE"));
    const question = String(body?.question || "Summarize institutional conviction").trim();

    let report: CompanyResearchReport | undefined = body?.report;
    if (!report || report.cleanSymbol !== symbol) {
      const cached = reportCache.get(symbol);
      if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
        report = cached.report;
      } else {
        report = await compileCompanyResearchReport(symbol);
        reportCache.set(symbol, { report, cachedAt: Date.now() });
      }
    }

    const answer = synthesizeGroundedResearchAnswer(report, question);
    return NextResponse.json({
      success: true,
      symbol,
      answer,
      convictionScore: report.conviction.overallScore,
      fetchedAtIST: report.fetchedAtIST,
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Failed to process AI research query",
      },
      { status: 500 }
    );
  }
}
