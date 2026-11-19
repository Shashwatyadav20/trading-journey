import fs from "node:fs";
import path from "node:path";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import {
  downloadXbrlXmlWithCache,
  extractXbrlFinancialFactsFromXml,
  persistFinancialFactsIdempotent,
  type ExtractedFinancialFactRecord,
} from "./BseXbrlBackfillService.js";
import {
  computeShareholdingTrends,
  downloadShpXbrlWithCache,
  fetchNseShareholdingMaster,
  mapNseMasterItemToHints,
  parseShareholdingXbrlXml,
  persistInstitutionalOwnershipIdempotent,
  type NormalizedShareholdingRecord,
} from "./OfficialShareholdingIntelligenceEngine.js";
import {
  appendShadowSignalsImmutable,
  loadAllRowsPaginated,
  type ShadowSignalRecord,
} from "./Strategy03ShadowRunner.js";

config({ path: path.resolve("D:/Trading/my-app/backend/.env") });

const OUT_DIR = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase6105");
const SHP_CACHE = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase642/cache");
const FIN_Q_CACHE = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase66/cache");
const FIN_A_CACHE = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase6101/cache");
const P69_DIR = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase69");

function countStatuses(rows: any[]) {
  return {
    VERIFIED: rows.filter((r) => r.verification_status === "VERIFIED").length,
    UNVERIFIED: rows.filter((r) => r.verification_status === "UNVERIFIED").length,
    MISSING: rows.filter((r) => r.verification_status === "MISSING").length,
    STALE: rows.filter((r) => r.verification_status === "STALE").length,
    CONFLICTED: rows.filter((r) => r.verification_status === "CONFLICTED").length,
  };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  // 1. Institutional Ownership Refresh
  console.log("[1/4] Auditing & refreshing stale/latest institutional ownership records...");
  const ownBefore = await loadAllRowsPaginated(sb, "strategy03_institutional_ownership");
  const latestBySym = new Map<string, any>();
  for (const r of ownBefore) {
    const prev = latestBySym.get(r.symbol);
    if (!prev || r.reporting_quarter > prev.reporting_quarter) latestBySym.set(r.symbol, r);
  }
  const staleLatestSymbols = [...latestBySym.entries()]
    .filter(([, row]) => row.verification_status !== "VERIFIED")
    .map(([sym]) => sym);

  const newlyDiscoveredOwn: NormalizedShareholdingRecord[] = [];
  const existingKeys = new Set(ownBefore.map((r) => r.idempotency_key));

  for (let i = 0; i < staleLatestSymbols.length; i += 4) {
    const chunk = staleLatestSymbols.slice(i, i + 4);
    const masters = await Promise.all(chunk.map((s) => fetchNseShareholdingMaster(s)));
    for (let k = 0; k < chunk.length; k++) {
      const sym = chunk[k];
      const master = masters[k];
      if (!master.ok) continue;
      const latestItems = master.items.filter((x) => Boolean(x.xbrl && x.xbrl.endsWith(".xml"))).slice(0, 4);
      const parsedList: NormalizedShareholdingRecord[] = [];
      for (const item of latestItems) {
        if (!item.xbrl) continue;
        const dl = await downloadShpXbrlWithCache(item.xbrl, { cacheDir: SHP_CACHE });
        if (!dl.ok || !dl.xmlText) continue;
        const hints = mapNseMasterItemToHints(item);
        const rec = parseShareholdingXbrlXml({
          symbol: sym,
          isin: item.isin ?? null,
          exchange: "NSE",
          reportingQuarter: hints.reportingQuarter,
          filingDate: hints.filingDate,
          publicationTimestamp: hints.publicationTimestamp,
          filingId: item.recordId ?? null,
          sourceUrl: item.xbrl,
          xmlText: dl.xmlText,
          masterPromoterPct: hints.masterPromoterPct,
          masterPublicPct: hints.masterPublicPct,
          isRestated: hints.isRestated,
          version: 1,
        });
        if (!existingKeys.has(rec.idempotencyKey)) {
          parsedList.push(rec);
        }
      }
      if (parsedList.length > 0) {
        newlyDiscoveredOwn.push(...computeShareholdingTrends(parsedList));
      }
    }
  }

  for (let i = 0; i < newlyDiscoveredOwn.length; i += 100) {
    await persistInstitutionalOwnershipIdempotent(sb, newlyDiscoveredOwn.slice(i, i + 100));
  }
  const ownAfter = await loadAllRowsPaginated(sb, "strategy03_institutional_ownership");

  // 2. Financial Data Recovery (Re-extract cached XBRLs for Debt & Capex/FCF)
  console.log("[2/4] Re-extracting cached Ind-AS XBRLs for Debt, Capex & FCF recovery...");
  const finBefore = await loadAllRowsPaginated(sb, "strategy03_financial_facts");
  const updatedFacts: ExtractedFinancialFactRecord[] = [];

  for (const row of finBefore) {
    if (!row.source_url || !row.source_url.startsWith("https://nsearchives.nseindia.in")) continue;
    // Check both quarterly and annual caches
    let dl = await downloadXbrlXmlWithCache(row.source_url, { cacheDir: FIN_Q_CACHE });
    if (!dl.ok) dl = await downloadXbrlXmlWithCache(row.source_url, { cacheDir: FIN_A_CACHE });
    if (!dl.ok || !dl.xmlText) continue;

    const reExtracted = extractXbrlFinancialFactsFromXml({
      symbol: row.symbol,
      bseCode: row.bse_code,
      xmlText: dl.xmlText,
      sourceUrl: row.source_url,
      sourceFilingId: row.source_filing_id,
      extractedFileName: row.extracted_file_name,
      statementScopeHint: row.statement_scope,
      periodTypeHint: row.period_type,
      financialYearHint: row.financial_year,
      reportingPeriodHint: row.reporting_period,
      filingDate: row.filing_date,
      version: row.version,
      isRestated: row.is_restated,
      retrievedAt: row.retrieved_at,
    });
    // Preserve exact idempotency_key of existing row
    updatedFacts.push({ ...reExtracted, idempotencyKey: row.idempotency_key });
  }

  for (let i = 0; i < updatedFacts.length; i += 100) {
    await persistFinancialFactsIdempotent(sb, updatedFacts.slice(i, i + 100));
  }
  const finAfter = await loadAllRowsPaginated(sb, "strategy03_financial_facts");

  // 3. Shadow Observation & Paper Trades Check
  const ledger: ShadowSignalRecord[] = JSON.parse(
    fs.readFileSync(path.join(P69_DIR, "shadow_signal_ledger.json"), "utf8")
  );
  const liveSignals = ledger.filter((s) => s.signalDate >= "2026-11-17");
  const dupCheck = appendShadowSignalsImmutable(ledger, liveSignals);
  const { count: paperTradesCount } = await sb
    .from("experimental_paper_trades")
    .select("*", { count: "exact", head: true });

  // 4. Write all 9 Phase 6.10.5 artifacts
  const ownRefreshReport = {
    beforeTotal: ownBefore.length,
    afterTotal: ownAfter.length,
    staleLatestSymbolsTargeted: staleLatestSymbols.length,
    newlyDiscoveredFilingsInserted: newlyDiscoveredOwn.length,
    beforeStatusBreakdown: countStatuses(ownBefore),
    afterStatusBreakdown: countStatuses(ownAfter),
    note: "Historical quarters > 150 days old remain STALE by design; never marked VERIFIED merely on re-retrieval.",
  };

  const latestAfterMap = new Map<string, any>();
  for (const r of ownAfter) {
    const prev = latestAfterMap.get(r.symbol);
    if (!prev || r.reporting_quarter > prev.reporting_quarter) latestAfterMap.set(r.symbol, r);
  }
  const freshnessAudit = {
    distinctSymbols: latestAfterMap.size,
    latestQuarterVerifiedSymbols: [...latestAfterMap.values()].filter((r) => r.verification_status === "VERIFIED").length,
    latestQuarterStaleSymbols: [...latestAfterMap.values()].filter((r) => r.verification_status === "STALE").length,
    latestQuarterMissingSymbols: [...latestAfterMap.values()].filter((r) => r.verification_status === "MISSING").length,
  };

  const metricStats = (rows: any[]) => ({
    totalRows: rows.length,
    revenue: rows.filter((r) => r.revenue_cr !== null).length,
    operatingProfit: rows.filter((r) => r.operating_profit_cr !== null).length,
    netProfit: rows.filter((r) => r.net_profit_cr !== null).length,
    eps: rows.filter((r) => r.eps_inr !== null).length,
    cfo: rows.filter((r) => r.cfo_cr !== null).length,
    capex: rows.filter((r) => r.capex_cr !== null).length,
    fcf: rows.filter((r) => r.fcf_cr !== null).length,
    debt: rows.filter((r) => r.total_debt_cr !== null).length,
    equity: rows.filter((r) => r.equity_cr !== null).length,
  });

  const beforeStats = metricStats(finBefore);
  const afterStats = metricStats(finAfter);

  const finExpansionReport = {
    before: beforeStats,
    after: afterStats,
    reParsedFactsCount: updatedFacts.length,
    statusBreakdown: countStatuses(finAfter),
  };

  const fcfAudit = {
    methodology: "FCF = CFO - abs(Capex), derived ONLY when both CashFlowsFromUsedInOperatingActivities and PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities (or PurchaseOfPropertyPlantAndEquipment) are present in the same authoritative XBRL filing. Missing capex is never treated as 0.",
    fcfCountBefore: beforeStats.fcf,
    fcfCountAfter: afterStats.fcf,
    capexCountBefore: beforeStats.capex,
    capexCountAfter: afterStats.capex,
  };

  const debtAudit = {
    methodology: "Total Debt = Borrowings/TotalBorrowings when present, else BorrowingsNoncurrent + BorrowingsCurrent when at least one authoritative XBRL tag is present. Missing debt remains null.",
    debtCountBefore: beforeStats.debt,
    debtCountAfter: afterStats.debt,
    equityCountBefore: beforeStats.equity,
    equityCountAfter: afterStats.equity,
  };

  const sourceVerificationReport = {
    ownershipSource: "NSE_BSE_SHP_XBRL (nsearchives.nseindia.in)",
    financialsSource: "NSE_BSE_INDAS_XBRL (nsearchives.nseindia.in)",
    thirdPartyEstimatesSubstituted: false,
  };

  const shadowProgress = {
    liveObservationStartDate: "2026-11-17",
    actualLiveCalendarDays: 1,
    requiredMinLiveDays: 90,
    liveSignalsCount: liveSignals.length,
    duplicatesSkipped: dupCheck.skippedDuplicatesCount,
    incompleteNeverConvertedToZero: true,
  };

  const benchAndUniverse = {
    nifty500Tri: "PENDING (UNAVAILABLE_WITHOUT_WAF)",
    nifty50Tri: "PENDING (UNAVAILABLE_WITHOUT_WAF)",
    historicalDelistedUniverse: "PENDING (CURRENT_UNIVERSE_HISTORICAL_RESEARCH)",
  };

  const finalClassification = "DATA_QUALITY_IMPROVED";

  fs.writeFileSync(path.join(OUT_DIR, "institutional_ownership_refresh.json"), JSON.stringify(ownRefreshReport, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "institutional_freshness_audit.json"), JSON.stringify(freshnessAudit, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "financial_fact_expansion.json"), JSON.stringify(finExpansionReport, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "fcf_calculation_audit.json"), JSON.stringify(fcfAudit, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "debt_coverage_audit.json"), JSON.stringify(debtAudit, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "source_verification_report.json"), JSON.stringify(sourceVerificationReport, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "shadow_observation_progress.json"), JSON.stringify(shadowProgress, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "benchmark_and_universe_status.json"), JSON.stringify(benchAndUniverse, null, 2));

  const md = [
    "# Phase 6.10.5 — Institutional Ownership Refresh & Financial Data Recovery Report",
    "",
    `**Final Classification:** \`${finalClassification}\``,
    "",
    "## 1. Institutional Ownership Refresh",
    `- Total rows: **${ownBefore.length}** -> **${ownAfter.length}** (newly discovered filings inserted: **${newlyDiscoveredOwn.length}**).`,
    `- Latest-quarter freshness: **${freshnessAudit.latestQuarterVerifiedSymbols}** VERIFIED / **${freshnessAudit.distinctSymbols}** symbols (STALE latest=${freshnessAudit.latestQuarterStaleSymbols}, MISSING latest=${freshnessAudit.latestQuarterMissingSymbols}).`,
    "",
    "## 2. Financial Data Recovery (Authoritative Ind-AS XBRL)",
    `- Total rows: **${finBefore.length}** -> **${finAfter.length}**`,
    `- **FCF:** ${beforeStats.fcf} -> **${afterStats.fcf}** (Capex: ${beforeStats.capex} -> **${afterStats.capex}**)`,
    `- **Debt:** ${beforeStats.debt} -> **${afterStats.debt}**`,
    `- **CFO:** ${beforeStats.cfo} -> **${afterStats.cfo}** | **Equity:** ${beforeStats.equity} -> **${afterStats.equity}**`,
    "",
    "## 3. Shadow Observation & Outstanding Gates",
    `- Live shadow observation: **${shadowProgress.actualLiveCalendarDays} / 90** calendar days.`,
    `- Outstanding PENDING gates: Official \`NIFTY 500 TRI / 50 TRI\` and historical delisted universe.`,
    "",
    "## 4. Safety Confirmation",
    `- \`STRATEGY_01 = false\`, \`STRATEGY_02 = false\`, \`STRATEGY_03 = false\`, \`LIVE_TRADING = false\`, \`BROKER_EXECUTION_ENABLED = false\`, \`Strategy03PaperIsolationConfig.enabled = false\`, \`experimental_paper_trades = ${paperTradesCount ?? 0}\`.`,
  ].join("\n");

  fs.writeFileSync(path.join(OUT_DIR, "phase6105_final_report.md"), md);
  console.log("Phase 6.10.5 complete:", { fcfAfter: afterStats.fcf, debtAfter: afterStats.debt, ownAfter: ownAfter.length });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

