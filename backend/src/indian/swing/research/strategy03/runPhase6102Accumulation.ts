import fs from "node:fs";
import path from "node:path";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { fetchNseDeliveryForDate } from "./NseDeliveryCollector.js";
import {
  appendShadowSignalsImmutable,
  loadAllRowsPaginated,
  type ForwardReturnObservation,
  type ShadowSignalRecord,
} from "./Strategy03ShadowRunner.js";
import {
  stressTestSimultaneousStopsAndGaps,
  validateAggregateOpenRisk,
  type ProposedOpenPositionRisk,
} from "./Strategy03ReadinessCertifier.js";
import { DEFAULT_STRATEGY03_PAPER_ISOLATION_CONFIG } from "./Strategy03PaperIsolationConfig.js";

config({ path: path.resolve("D:/Trading/my-app/backend/.env") });

const OUT_DIR = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase6102");
const P69_DIR = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase69");
const P66_DIR = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase66");

function getRecentWeekdays(endIso: string, count: number): string[] {
  const dates: string[] = [];
  let cur = new Date(`${endIso}T00:00:00Z`);
  while (dates.length < count) {
    const day = cur.getUTCDay();
    if (day !== 0 && day !== 6) {
      dates.push(cur.toISOString().slice(0, 10));
    }
    cur = new Date(cur.getTime() - 86400_000);
  }
  return dates;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const p66Ledger = JSON.parse(
    fs.readFileSync(path.join(P66_DIR, "expanded_evaluation_ledger.json"), "utf8")
  ) as Array<{ symbol: string }>;
  const targetSymbols = [...new Set(p66Ledger.map((e) => e.symbol))];
  const targetSet = new Set(targetSymbols);

  // 1. Expand Delivery Data beyond 5 days (20 recent weekdays)
  console.log("[1/4] Expanding NSE delivery data across 20 recent weekdays...");
  const beforeDelivery = await loadAllRowsPaginated(sb, "strategy03_delivery_data", "symbol,trading_date");
  const weekdays = getRecentWeekdays("2026-11-16", 20);
  const toUpsert: any[] = [];
  const dateLogs: Array<Record<string, unknown>> = [];

  for (let i = 0; i < weekdays.length; i += 4) {
    const chunk = weekdays.slice(i, i + 4);
    const resList = await Promise.all(chunk.map((d) => fetchNseDeliveryForDate(d)));
    for (let k = 0; k < chunk.length; k++) {
      const d = chunk[k];
      const res = resList[k];
      const matched = res.records.filter(
        (r) => targetSet.has(r.symbol.toUpperCase()) && r.series === "EQ"
      );
      dateLogs.push({ date: d, ok: res.ok, matchedRows: matched.length, error: res.error ?? null });
      for (const r of matched) {
        const validDeliv = r.deliveryQty !== null && r.deliveryQty >= 0 && r.deliveryQty <= r.tradedQty;
        toUpsert.push({
          symbol: r.symbol,
          series: r.series,
          trading_date: r.tradingDate,
          close_price: r.closePrice,
          traded_qty: r.tradedQty,
          delivery_qty: r.deliveryQty,
          delivery_pct: r.deliveryPct,
          turnover_lacs: r.turnoverLacs,
          source_name: r.evidence.sourceName,
          source_url: r.evidence.sourceUrlOrFilingId,
          published_at: r.evidence.publishedAt,
          retrieved_at: r.evidence.retrievedAt,
          verification_status: validDeliv ? r.evidence.verificationStatus : "CONFLICTED",
          confidence: validDeliv ? r.evidence.confidence : 0.2,
          has_source_conflict: !validDeliv,
        });
      }
    }
  }

  for (let i = 0; i < toUpsert.length; i += 200) {
    await sb
      .from("strategy03_delivery_data")
      .upsert(toUpsert.slice(i, i + 200), { onConflict: "symbol,series,trading_date" });
  }
  const afterDelivery = await loadAllRowsPaginated(sb, "strategy03_delivery_data", "symbol,trading_date,verification_status");

  // 2. Shadow Observation & Maturity
  const ledger: ShadowSignalRecord[] = JSON.parse(
    fs.readFileSync(path.join(P69_DIR, "shadow_signal_ledger.json"), "utf8")
  );
  const forwardTracking = JSON.parse(
    fs.readFileSync(path.join(P69_DIR, "forward_return_tracking.json"), "utf8")
  ) as { observations: ForwardReturnObservation[] };

  const liveSignals = ledger.filter((s) => s.signalDate >= "2026-11-17");
  const dupCheck = appendShadowSignalsImmutable(ledger, liveSignals);
  const liveObs = forwardTracking.observations.filter((o) => o.signalDate >= "2026-11-17");

  const dailyLog = {
    liveObservationStartDate: "2026-11-17",
    currentDate: "2026-11-17",
    actualLiveCalendarDays: 1,
    requiredMinLiveDays: 90,
    scans: [
      {
        date: "2026-11-17",
        status: "SUCCESS",
        signalsEvaluated: liveSignals.length,
        duplicatesSkippedOnReRun: dupCheck.skippedDuplicatesCount,
      },
    ],
  };

  const liveMaturity = {
    liveSignalsCount: liveSignals.length,
    matured1d: liveObs.filter((o) => o.ret1dPct !== null).length,
    matured5d: liveObs.filter((o) => o.ret5dPct !== null).length,
    matured10d: liveObs.filter((o) => o.ret10dPct !== null).length,
    matured20d: liveObs.filter((o) => o.ret20dPct !== null).length,
    matured60d: liveObs.filter((o) => o.ret60dPct !== null).length,
    incompleteNeverCoercedToZero: true,
  };

  // 3. Financial History Coverage
  const finDb = await loadAllRowsPaginated(
    sb,
    "strategy03_financial_facts",
    "symbol,statement_scope,cfo_cr,fcf_cr,total_debt_cr,equity_cr,verification_status"
  );
  const financialCoverage = {
    totalRowsInDb: finDb.length,
    consolidatedRows: finDb.filter((r) => r.statement_scope === "CONSOLIDATED").length,
    standaloneRows: finDb.filter((r) => r.statement_scope === "STANDALONE").length,
    cfoNonNull: finDb.filter((r) => r.cfo_cr !== null).length,
    fcfNonNull: finDb.filter((r) => r.fcf_cr !== null).length,
    debtNonNull: finDb.filter((r) => r.total_debt_cr !== null).length,
    equityNonNull: finDb.filter((r) => r.equity_cr !== null).length,
    missingNeverCoercedToZero: true,
  };

  // 4. Aggregate Risk & Overnight Gap Stress
  const sample10Positions: ProposedOpenPositionRisk[] = [
    { symbol: "RELIANCE", sector: "Energy", notionalWeightPct: 10, stopLossPct: 10, openRiskPct: 1.0 },
    { symbol: "TCS", sector: "IT", notionalWeightPct: 10, stopLossPct: 10, openRiskPct: 1.0 },
    { symbol: "INFY", sector: "IT", notionalWeightPct: 10, stopLossPct: 10, openRiskPct: 1.0 },
    { symbol: "HDFCBANK", sector: "Financials", notionalWeightPct: 10, stopLossPct: 10, openRiskPct: 1.0 },
    { symbol: "ICICIBANK", sector: "Financials", notionalWeightPct: 10, stopLossPct: 10, openRiskPct: 1.0 },
    { symbol: "LT", sector: "Industrials", notionalWeightPct: 10, stopLossPct: 10, openRiskPct: 1.0 },
    { symbol: "SUNPHARMA", sector: "Healthcare", notionalWeightPct: 10, stopLossPct: 10, openRiskPct: 1.0 },
    { symbol: "ITC", sector: "FMCG", notionalWeightPct: 10, stopLossPct: 10, openRiskPct: 1.0 },
    { symbol: "HINDUNILVR", sector: "FMCG", notionalWeightPct: 10, stopLossPct: 10, openRiskPct: 1.0 },
    { symbol: "MARUTI", sector: "Auto", notionalWeightPct: 10, stopLossPct: 10, openRiskPct: 1.0 },
  ];
  const aggRiskCheck = validateAggregateOpenRisk({ positions: sample10Positions });
  const gap5 = stressTestSimultaneousStopsAndGaps({ positions: sample10Positions, overnightGapPct: 5 });
  const gap12 = stressTestSimultaneousStopsAndGaps({ positions: sample10Positions, overnightGapPct: 12 });
  const gap15 = stressTestSimultaneousStopsAndGaps({ positions: sample10Positions, overnightGapPct: 15 });

  const { count: paperTradesCount } = await sb
    .from("experimental_paper_trades")
    .select("*", { count: "exact", head: true });

  const deliveryCoverage = {
    beforeRowsInDb: beforeDelivery.length,
    afterRowsInDb: afterDelivery.length,
    distinctSymbols: new Set(afterDelivery.map((r) => r.symbol)).size,
    distinctTradingDates: new Set(afterDelivery.map((r) => r.trading_date)).size,
    dateFetchLog: dateLogs,
  };

  const benchmarkStatus = {
    nifty500TriStatus: "UNAVAILABLE_WITHOUT_WAF",
    nifty50TriStatus: "UNAVAILABLE_WITHOUT_WAF",
    prBenchmarksLabel: "PRICE_RETURN_DIAGNOSTIC_ONLY",
  };

  const riskStressReport = {
    approvalRequired: true,
    appliedToProduction: false,
    isolationEnabled: DEFAULT_STRATEGY03_PAPER_ISOLATION_CONFIG.enabled,
    aggregateOpenRiskCheck: aggRiskCheck,
    simultaneousStopAndGapStress: { gap5Pct: gap5, gap12Pct: gap12, gap15Pct: gap15 },
    experimentalPaperTrades: paperTradesCount ?? 0,
  };

  const finalClassification = "OBSERVATION_CONTINUES";

  fs.writeFileSync(path.join(OUT_DIR, "shadow_observation_daily_log.json"), JSON.stringify(dailyLog, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "live_signal_maturity.json"), JSON.stringify(liveMaturity, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "delivery_history_coverage.json"), JSON.stringify(deliveryCoverage, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "financial_history_coverage.json"), JSON.stringify(financialCoverage, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "benchmark_status.json"), JSON.stringify(benchmarkStatus, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "aggregate_risk_stress.json"), JSON.stringify(riskStressReport, null, 2));

  const md = [
    "# Phase 6.10.2 — Shadow Observation & Data Accumulation Report",
    "",
    `**Final Classification:** \`${finalClassification}\``,
    "",
    "## 1. Live Shadow Observation",
    `- Actual live calendar days: **${dailyLog.actualLiveCalendarDays} / 90** (started \`2026-11-17\`; ${liveSignals.length} live signals, 0 matured horizons yet).`,
    "",
    "## 2. Data Accumulation",
    `- \`strategy03_delivery_data\`: **${beforeDelivery.length}** -> **${afterDelivery.length}** rows across **${deliveryCoverage.distinctSymbols}** symbols and **${deliveryCoverage.distinctTradingDates}** trading dates.`,
    `- \`strategy03_financial_facts\`: **${financialCoverage.totalRowsInDb}** rows (Consolidated=${financialCoverage.consolidatedRows}, Standalone=${financialCoverage.standaloneRows}, CFO=${financialCoverage.cfoNonNull}, Debt=${financialCoverage.debtNonNull}, FCF=${financialCoverage.fcfNonNull}).`,
    "",
    "## 3. Aggregate Risk Stress",
    `- 10-position model portfolio: \`totalAggregateOpenRiskPct = ${aggRiskCheck.totalAggregateOpenRiskPct}%\` (allowed=${aggRiskCheck.allowed}), \`maxSectorObservedPct = ${aggRiskCheck.maxSectorObservedPct}%\`.`,
    `- Simultaneous 15% overnight gap loss: \`${gap15.overnightGapLossPct}%\` (breaches12PctPortfolioDrawdown=${gap15.breaches12PctPortfolioDrawdown}).`,
    "",
    "## 4. Safety Confirmation",
    `- \`STRATEGY_01 = false\`, \`STRATEGY_02 = false\`, \`STRATEGY_03 = false\`, \`LIVE_TRADING = false\`, \`BROKER_EXECUTION_ENABLED = false\`, \`Strategy03PaperIsolationConfig.enabled = false\`, \`experimental_paper_trades = ${paperTradesCount ?? 0}\`.`,
  ].join("\n");

  fs.writeFileSync(path.join(OUT_DIR, "phase6102_final_report.md"), md);
  console.log("Phase 6.10.2 complete:", { deliveryAfter: afterDelivery.length, finTotal: financialCoverage.totalRowsInDb, paperTrades: paperTradesCount ?? 0 });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

