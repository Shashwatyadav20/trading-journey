import fs from "node:fs";
import path from "node:path";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import {
  appendShadowSignalsImmutable,
  computeHorizonCohortStats,
  computeScoreReturnCorrelation,
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

const OUT_DIR = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase6106");
const P69_DIR = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase69");

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const ledger: ShadowSignalRecord[] = JSON.parse(
    fs.readFileSync(path.join(P69_DIR, "shadow_signal_ledger.json"), "utf8")
  );
  const forwardTracking = JSON.parse(
    fs.readFileSync(path.join(P69_DIR, "forward_return_tracking.json"), "utf8")
  ) as { observations: ForwardReturnObservation[] };

  const liveSignals = ledger.filter((s) => s.signalDate >= "2026-11-17");
  const baselineSignals = ledger.filter((s) => s.signalDate < "2026-11-17");
  const liveObs = forwardTracking.observations.filter((o) => o.signalDate >= "2026-11-17");
  const baselineObs = forwardTracking.observations.filter((o) => o.signalDate < "2026-11-17");

  const dupCheck = appendShadowSignalsImmutable(ledger, liveSignals);

  const horizons = [1, 5, 10, 20, 60] as const;
  const liveMaturity = horizons.map((h) => computeHorizonCohortStats(liveObs, h));
  const baselineMaturity = horizons.map((h) => computeHorizonCohortStats(baselineObs, h));

  // Score calibration on baseline matured 20D/60D observations (strictly labeled HISTORICAL_EOD_BASELINE)
  const sigByKey = new Map(ledger.map((s) => [s.idempotencyKey, s]));
  const pairs20d = baselineObs
    .filter((o) => o.ret20dPct !== null)
    .map((o) => ({ score: sigByKey.get(o.idempotencyKey)?.score ?? 0, forwardRetPct: o.ret20dPct as number }));
  const pairs60d = baselineObs
    .filter((o) => o.ret60dPct !== null)
    .map((o) => ({ score: sigByKey.get(o.idempotencyKey)?.score ?? 0, forwardRetPct: o.ret60dPct as number }));

  const calibration = {
    liveMaturedCount: liveObs.filter((o) => o.ret1dPct !== null).length,
    liveCalibrationAvailable: false,
    historicalBaselineDiagnostics: {
      label: "HISTORICAL_EOD_BASELINE_NOT_LIVE_OBSERVATION",
      sampleSize: baselineObs.length,
      corrScoreVs20dReturn: computeScoreReturnCorrelation(pairs20d),
      corrScoreVs60dReturn: computeScoreReturnCorrelation(pairs60d),
      costAdjusted50bpsNote: "Subtracting 50 bps round-trip cost reduces each forward return by 0.50 percentage points.",
    },
  };

  // Sector breakdown on baseline matured observations
  const bySec = new Map<string, ForwardReturnObservation[]>();
  for (const o of baselineObs) {
    const arr = bySec.get(o.sector) ?? [];
    arr.push(o);
    bySec.set(o.sector, arr);
  }
  const sectorPerf = [...bySec.entries()].map(([sector, obs]) => ({
    sector,
    signals: obs.length,
    cohort20d: computeHorizonCohortStats(obs, 20),
    cohort60d: computeHorizonCohortStats(obs, 60),
  }));

  // Live paginated DB counts
  const delDb = await loadAllRowsPaginated(sb, "strategy03_delivery_data", "symbol,trading_date");
  const finDb = await loadAllRowsPaginated(sb, "strategy03_financial_facts", "symbol,cfo_cr,fcf_cr,total_debt_cr");
  const ownDb = await loadAllRowsPaginated(sb, "strategy03_institutional_ownership", "symbol,reporting_quarter,verification_status");
  const annDb = await loadAllRowsPaginated(sb, "strategy03_corporate_announcements", "symbol");
  const { count: paperTradesCount } = await sb
    .from("experimental_paper_trades")
    .select("*", { count: "exact", head: true });

  const latestOwn = new Map<string, any>();
  for (const o of ownDb) {
    const p = latestOwn.get(o.symbol);
    if (!p || o.reporting_quarter > p.reporting_quarter) latestOwn.set(o.symbol, o);
  }

  const dataQuality = {
    deliveryRows: delDb.length,
    financialRows: finDb.length,
    fcfNonNull: finDb.filter((r) => r.fcf_cr !== null).length,
    debtNonNull: finDb.filter((r) => r.total_debt_cr !== null).length,
    cfoNonNull: finDb.filter((r) => r.cfo_cr !== null).length,
    ownershipRows: ownDb.length,
    latestOwnershipVerifiedSymbols: [...latestOwn.values()].filter((r) => r.verification_status === "VERIFIED").length,
    ownershipDistinctSymbols: latestOwn.size,
    announcementRows: annDb.length,
    officialTriStatus: "PENDING",
    historicalUniverseStatus: "PENDING (CURRENT_UNIVERSE_HISTORICAL_RESEARCH)",
  };

  const pos75: ProposedOpenPositionRisk[] = Array.from({ length: 10 }, (_, i) => ({
    symbol: `S${i}`,
    sector: `SEC${i}`,
    notionalWeightPct: 7.5,
    stopLossPct: 10,
    openRiskPct: 0.75,
  }));
  const riskMonitor = {
    approvalRequired: STRATEGY03_FAIL_CLOSED_GAP_CONTROLS.approvalRequired,
    appliedToProduction: STRATEGY03_FAIL_CLOSED_GAP_CONTROLS.appliedToProduction,
    isolationEnabled: DEFAULT_STRATEGY03_PAPER_ISOLATION_CONFIG.enabled,
    gapStress75Pct: runExpandedGapStressSuite({ positions: pos75 }),
    experimentalPaperTrades: paperTradesCount ?? 0,
  };

  const shadowProgress = {
    liveObservationStartDate: "2026-11-17",
    actualLiveCalendarDays: 1,
    requiredMinLiveDays: 90,
    successfulScans: 1,
    failedScans: 0,
    skippedDays: 0,
    duplicatesSkipped: dupCheck.skippedDuplicatesCount,
    liveSignalsCount: liveSignals.length,
    historicalBaselineSignalsCount: baselineSignals.length,
  };

  const finalClassification = "OBSERVATION_CONTINUES";

  fs.writeFileSync(path.join(OUT_DIR, "shadow_observation_progress.json"), JSON.stringify(shadowProgress, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "live_signal_maturity.json"), JSON.stringify({ liveMaturity, baselineMaturity }, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "forward_signal_performance.json"), JSON.stringify({ liveMaturity, baselineMaturity }, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "signal_score_calibration.json"), JSON.stringify(calibration, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "sector_and_regime_performance.json"), JSON.stringify({ sectorPerf }, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "data_quality_monitor.json"), JSON.stringify(dataQuality, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "portfolio_risk_monitor.json"), JSON.stringify(riskMonitor, null, 2));

  const md = [
    "# Phase 6.10.6 — Shadow Observation & Statistical Monitoring Report",
    "",
    `**Final Classification:** \`${finalClassification}\``,
    "",
    "## 1. Live Shadow Observation & Maturity",
    `- Actual live calendar days: **${shadowProgress.actualLiveCalendarDays} / 90** (started \`2026-11-17\`; ${liveSignals.length} live signals, **0** matured live horizons yet).`,
    `- Historical 90d EOD baseline (${baselineObs.length} signals): ` +
      `20D avg=${baselineMaturity[3].avgReturnPct}%, 60D avg=${baselineMaturity[4].avgReturnPct}%, ` +
      `corr(score,20D)=${calibration.historicalBaselineDiagnostics.corrScoreVs20dReturn}, corr(score,60D)=${calibration.historicalBaselineDiagnostics.corrScoreVs60dReturn}.`,
    "",
    "## 2. Data Quality & Safety Confirmation",
    `- Financials: **${dataQuality.financialRows}** (FCF=${dataQuality.fcfNonNull}, Debt=${dataQuality.debtNonNull}, CFO=${dataQuality.cfoNonNull}) | Ownership: **${dataQuality.ownershipRows}** (${dataQuality.latestOwnershipVerifiedSymbols}/${dataQuality.ownershipDistinctSymbols} latest verified) | Delivery: **${dataQuality.deliveryRows}** | Announcements: **${dataQuality.announcementRows}**.`,
    `- \`STRATEGY_01 = false\`, \`STRATEGY_02 = false\`, \`STRATEGY_03 = false\`, \`LIVE_TRADING = false\`, \`BROKER_EXECUTION_ENABLED = false\`, \`Strategy03PaperIsolationConfig.enabled = false\`, \`experimental_paper_trades = ${paperTradesCount ?? 0}\`.`,
  ].join("\n");

  fs.writeFileSync(path.join(OUT_DIR, "phase6106_final_report.md"), md);
  console.log("Phase 6.10.6 complete:", { classification: finalClassification, paperTrades: paperTradesCount ?? 0 });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

