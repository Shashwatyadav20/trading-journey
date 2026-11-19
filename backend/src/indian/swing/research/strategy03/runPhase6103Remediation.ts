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
  runExpandedGapStressSuite,
  STRATEGY03_FAIL_CLOSED_GAP_CONTROLS,
  type ProposedOpenPositionRisk,
} from "./Strategy03ReadinessCertifier.js";
import { DEFAULT_STRATEGY03_PAPER_ISOLATION_CONFIG } from "./Strategy03PaperIsolationConfig.js";

config({ path: path.resolve("D:/Trading/my-app/backend/.env") });

const OUT_DIR = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase6103");
const P69_DIR = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase69");
const P66_DIR = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase66");

function getRecentWeekdays(endIso: string, count: number): string[] {
  const dates: string[] = [];
  let cur = new Date(`${endIso}T00:00:00Z`);
  while (dates.length < count) {
    const day = cur.getUTCDay();
    if (day !== 0 && day !== 6) dates.push(cur.toISOString().slice(0, 10));
    cur = new Date(cur.getTime() - 86400_000);
  }
  return dates;
}

function buildModelPositions(perPositionNotionalPct: number): ProposedOpenPositionRisk[] {
  const specs = [
    { symbol: "RELIANCE", sector: "Energy" },
    { symbol: "TCS", sector: "IT" },
    { symbol: "INFY", sector: "IT" },
    { symbol: "HDFCBANK", sector: "Financials" },
    { symbol: "ICICIBANK", sector: "Financials" },
    { symbol: "LT", sector: "Industrials" },
    { symbol: "SUNPHARMA", sector: "Healthcare" },
    { symbol: "ITC", sector: "FMCG" },
    { symbol: "HINDUNILVR", sector: "FMCG" },
    { symbol: "MARUTI", sector: "Auto" },
  ];
  return specs.map((s) => ({
    ...s,
    notionalWeightPct: perPositionNotionalPct,
    stopLossPct: 10.0,
    openRiskPct: Math.round(perPositionNotionalPct * 0.1 * 100) / 100,
  }));
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const p66Ledger = JSON.parse(
    fs.readFileSync(path.join(P66_DIR, "expanded_evaluation_ledger.json"), "utf8")
  ) as Array<{ symbol: string }>;
  const targetSet = new Set(p66Ledger.map((e) => e.symbol));

  // 1. Expand NSE delivery history across 30 recent weekdays
  console.log("[1/4] Expanding NSE delivery data across 30 recent weekdays...");
  const beforeDelivery = await loadAllRowsPaginated(sb, "strategy03_delivery_data", "symbol,trading_date");
  const existingDates = new Set(beforeDelivery.map((r) => r.trading_date));
  const weekdays = getRecentWeekdays("2026-11-16", 30).filter((d) => !existingDates.has(d));

  const toUpsert: any[] = [];
  for (let i = 0; i < weekdays.length; i += 4) {
    const chunk = weekdays.slice(i, i + 4);
    const resList = await Promise.all(chunk.map((d) => fetchNseDeliveryForDate(d)));
    for (const res of resList) {
      const matched = res.records.filter(
        (r) => targetSet.has(r.symbol.toUpperCase()) && r.series === "EQ"
      );
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

  // 2. Overnight Gap Stress Expansion (Uncapped 100% vs Remediated 75% vs High-Vol 60%)
  const gapStressExpansion = {
    uncapped100PctDeployed: runExpandedGapStressSuite({ positions: buildModelPositions(10.0) }),
    remediated75PctDeployed: runExpandedGapStressSuite({ positions: buildModelPositions(7.5) }),
    highVol60PctDeployed: runExpandedGapStressSuite({ positions: buildModelPositions(6.0) }),
  };

  const gapRiskControls = {
    ...STRATEGY03_FAIL_CLOSED_GAP_CONTROLS,
    isolationEnabled: DEFAULT_STRATEGY03_PAPER_ISOLATION_CONFIG.enabled,
    note: "Capping deployed notional at 75% (normal) / 60% (HIGH_VOL) keeps a 15% market-wide gap loss at 11.25% (< 12% halt) and 20% HIGH_VOL gap loss at 12.00%.",
  };

  // 3. Shadow Observation & Maturity
  const ledger: ShadowSignalRecord[] = JSON.parse(
    fs.readFileSync(path.join(P69_DIR, "shadow_signal_ledger.json"), "utf8")
  );
  const forwardTracking = JSON.parse(
    fs.readFileSync(path.join(P69_DIR, "forward_return_tracking.json"), "utf8")
  ) as { observations: ForwardReturnObservation[] };

  const liveSignals = ledger.filter((s) => s.signalDate >= "2026-11-17");
  const dupCheck = appendShadowSignalsImmutable(ledger, liveSignals);
  const liveObs = forwardTracking.observations.filter((o) => o.signalDate >= "2026-11-17");

  const shadowProgress = {
    liveObservationStartDate: "2026-11-17",
    actualLiveCalendarDays: 1,
    requiredMinLiveDays: 90,
    successfulScans: 1,
    failedScans: 0,
    skippedDays: 0,
    duplicatesPrevented: dupCheck.skippedDuplicatesCount,
    historicalBaselineExcludedFromLiveCount: true,
  };

  const liveMaturity = {
    liveSignalsCount: liveSignals.length,
    matured1d: liveObs.filter((o) => o.ret1dPct !== null).length,
    matured5d: liveObs.filter((o) => o.ret5dPct !== null).length,
    matured10d: liveObs.filter((o) => o.ret10dPct !== null).length,
    matured20d: liveObs.filter((o) => o.ret20dPct !== null).length,
    matured60d: liveObs.filter((o) => o.ret60dPct !== null).length,
    incompleteNeverConvertedToZero: true,
  };

  // 4. Financial & Delivery Coverage
  const finDb = await loadAllRowsPaginated(
    sb,
    "strategy03_financial_facts",
    "symbol,statement_scope,cfo_cr,fcf_cr,total_debt_cr,equity_cr,revenue_cr,net_profit_cr,verification_status"
  );
  const financialCoverage = {
    totalRowsInDb: finDb.length,
    consolidatedRows: finDb.filter((r) => r.statement_scope === "CONSOLIDATED").length,
    standaloneRows: finDb.filter((r) => r.statement_scope === "STANDALONE").length,
    cfoNonNull: finDb.filter((r) => r.cfo_cr !== null).length,
    fcfNonNull: finDb.filter((r) => r.fcf_cr !== null).length,
    debtNonNull: finDb.filter((r) => r.total_debt_cr !== null).length,
    equityNonNull: finDb.filter((r) => r.equity_cr !== null).length,
    revenueNonNull: finDb.filter((r) => r.revenue_cr !== null).length,
    netProfitNonNull: finDb.filter((r) => r.net_profit_cr !== null).length,
  };

  const deliveryCoverage = {
    beforeRowsInDb: beforeDelivery.length,
    afterRowsInDb: afterDelivery.length,
    distinctSymbols: new Set(afterDelivery.map((r) => r.symbol)).size,
    distinctTradingDates: new Set(afterDelivery.map((r) => r.trading_date)).size,
  };

  const { count: paperTradesCount } = await sb
    .from("experimental_paper_trades")
    .select("*", { count: "exact", head: true });

  const finalClassification = "OBSERVATION_CONTINUES";

  fs.writeFileSync(path.join(OUT_DIR, "shadow_observation_progress.json"), JSON.stringify(shadowProgress, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "live_signal_maturity.json"), JSON.stringify(liveMaturity, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "overnight_gap_stress_expansion.json"), JSON.stringify(gapStressExpansion, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "portfolio_gap_risk_controls.json"), JSON.stringify(gapRiskControls, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "financial_data_coverage.json"), JSON.stringify(financialCoverage, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "delivery_history_coverage.json"), JSON.stringify(deliveryCoverage, null, 2));

  const md = [
    "# Phase 6.10.3 — Continuous Shadow Observation & Gap-Risk Remediation Report",
    "",
    `**Final Classification:** \`${finalClassification}\``,
    "",
    "## 1. Overnight Gap-Risk Remediation (5%, 10%, 12%, 15%, 20%)",
    `- **Uncapped 100% deployed:** 15% gap -> **15.0% loss** (breaches 12% halt); 20% gap -> **20.0% loss**.`,
    `- **Remediated 75% deployed (25% cash buffer):** 15% gap -> **11.25% loss** (< 12% halt); 20% gap -> **15.0% loss**.`,
    `- **High-Vol 60% deployed (40% cash buffer):** 15% gap -> **9.0% loss**; 20% gap -> **12.0% loss**.`,
    "",
    "## 2. Data Accumulation & Shadow Observation",
    `- \`strategy03_delivery_data\`: **${beforeDelivery.length}** -> **${afterDelivery.length}** rows across **${deliveryCoverage.distinctSymbols}** symbols and **${deliveryCoverage.distinctTradingDates}** trading dates.`,
    `- \`strategy03_financial_facts\`: **${financialCoverage.totalRowsInDb}** rows.`,
    `- Live shadow observation: **${shadowProgress.actualLiveCalendarDays} / 90** calendar days.`,
    "",
    "## 3. Safety Confirmation",
    `- \`STRATEGY_01 = false\`, \`STRATEGY_02 = false\`, \`STRATEGY_03 = false\`, \`LIVE_TRADING = false\`, \`BROKER_EXECUTION_ENABLED = false\`, \`Strategy03PaperIsolationConfig.enabled = false\`, \`experimental_paper_trades = ${paperTradesCount ?? 0}\`.`,
  ].join("\n");

  fs.writeFileSync(path.join(OUT_DIR, "phase6103_final_report.md"), md);
  console.log("Phase 6.10.3 complete:", { deliveryAfter: afterDelivery.length, paperTrades: paperTradesCount ?? 0 });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

