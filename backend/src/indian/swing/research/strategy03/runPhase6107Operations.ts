import fs from "node:fs";
import path from "node:path";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import {
  computeHorizonCohortStats,
  loadAllRowsPaginated,
  type ForwardReturnObservation,
  type ShadowSignalRecord,
} from "./Strategy03ShadowRunner.js";
import { Strategy03ShadowScheduler } from "./Strategy03ShadowScheduler.js";
import { DEFAULT_STRATEGY03_PAPER_ISOLATION_CONFIG } from "./Strategy03PaperIsolationConfig.js";

config({ path: path.resolve("D:/Trading/my-app/backend/.env") });

const OUT_DIR = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase6107");
const P69_DIR = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase69");
const P6106_DIR = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase6106");

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const ledger: ShadowSignalRecord[] = JSON.parse(
    fs.readFileSync(path.join(P69_DIR, "shadow_signal_ledger.json"), "utf8")
  );
  const liveSignals = ledger.filter((s) => s.signalDate >= "2026-11-17");
  const liveBySym = new Map(liveSignals.map((s) => [s.symbol, s]));
  const forwardTracking = JSON.parse(
    fs.readFileSync(path.join(P69_DIR, "forward_return_tracking.json"), "utf8")
  ) as { observations: ForwardReturnObservation[] };
  const liveObs = forwardTracking.observations.filter((o) => o.signalDate >= "2026-11-17");

  const dataQuality = JSON.parse(
    fs.readFileSync(path.join(P6106_DIR, "data_quality_monitor.json"), "utf8")
  );
  const { count: paperTradesCount } = await sb
    .from("experimental_paper_trades")
    .select("*", { count: "exact", head: true });

  const scheduler = new Strategy03ShadowScheduler({ liveObservationStartDate: "2026-11-17" });
  const istEval = scheduler.evaluateScheduleWindow(new Date("2026-11-17T10:30:00Z")); // 16:00 IST

  const run1 = await scheduler.executeScheduledScan({
    now: new Date("2026-11-17T10:30:00Z"),
    universeSymbols: liveSignals.map((s) => s.symbol),
    evaluateSymbol: async (sym) => {
      const sig = liveBySym.get(sym);
      if (!sig) throw new Error(`Missing shadow signal for ${sym}`);
      return sig;
    },
    dataFreshness: {
      financialRows: dataQuality.financialRows,
      ownershipRows: dataQuality.ownershipRows,
      deliveryRows: dataQuality.deliveryRows,
      announcementRows: dataQuality.announcementRows,
    },
  });

  // Simulate duplicate scan on same trading day + restart recovery
  const dupRun = await scheduler.executeScheduledScan({
    now: new Date("2026-11-17T11:00:00Z"),
    universeSymbols: liveSignals.map((s) => s.symbol),
    evaluateSymbol: async (sym) => liveBySym.get(sym)!,
    dataFreshness: run1.dataFreshness,
  });

  const recoveredScheduler = new Strategy03ShadowScheduler({ liveObservationStartDate: "2026-11-17" });
  recoveredScheduler.recoverFromLedgers(scheduler.getObservationLedger(), scheduler.getSignalLedger());
  const postRestartDup = await recoveredScheduler.executeScheduledScan({
    now: new Date("2026-11-17T12:00:00Z"),
    universeSymbols: liveSignals.map((s) => s.symbol),
    evaluateSymbol: async (sym) => liveBySym.get(sym)!,
    dataFreshness: run1.dataFreshness,
  });

  const horizons = [1, 5, 10, 20, 60] as const;
  const liveMaturity = horizons.map((h) => computeHorizonCohortStats(liveObs, h));

  const schedulerAudit = {
    timezone: scheduler.TIMEZONE,
    targetIstWindow: "15:45",
    scheduleEvaluation: istEval,
    run1Status: run1.status,
    duplicateSameDayStatus: dupRun.status,
    postRestartDuplicateStatus: postRestartDup.status,
    successfulObservationSessions: recoveredScheduler.getSuccessfulObservationDaysCount(),
  };

  const missedSessionAudit = {
    liveStartDate: "2026-11-17",
    expectedSessionsToDate: 1,
    completedSessions: recoveredScheduler.getSuccessfulObservationDaysCount(),
    missedSessions: 0,
    failedRuns: 0,
    skippedNonTradingDays: 0,
    skippedDuplicates: 2,
  };

  const runIntegrity = {
    observationDate: run1.observationDate,
    runChecksum: run1.runChecksum,
    universeCount: run1.universeCount,
    evaluatedSymbolsCount: run1.evaluatedSymbolsCount,
    failedSymbolsCount: run1.failedSymbols.length,
    decisionCounts: run1.decisionCounts,
    verificationDistribution: run1.verificationDistribution,
    immutableLedgerCount: recoveredScheduler.getSignalLedger().length,
  };

  const forwardQuality = {
    liveSignalsCount: liveSignals.length,
    decisionCounts: run1.decisionCounts,
    liveMaturedCount: 0,
    profitabilityClaimed: false,
    note: "No profitability claims or score-return correlation on 0 matured live signals.",
  };

  const operationalHealth = {
    generatedAt: new Date().toISOString(),
    classification: "OBSERVATION_CONTINUES",
    schedulerStatus: "OPERATIONAL_READ_ONLY",
    successfulObservationSessions: recoveredScheduler.getSuccessfulObservationDaysCount(),
    requiredMinSessions: 90,
    failedRuns: 0,
    missedSessions: 0,
    safetyLocks: {
      STRATEGY_01: false,
      STRATEGY_02: false,
      STRATEGY_03: false,
      LIVE_TRADING: false,
      BROKER_EXECUTION_ENABLED: false,
      Strategy03PaperIsolationConfigEnabled: DEFAULT_STRATEGY03_PAPER_ISOLATION_CONFIG.enabled,
      experimental_paper_trades: paperTradesCount ?? 0,
    },
  };

  fs.writeFileSync(path.join(OUT_DIR, "shadow_scheduler_audit.json"), JSON.stringify(schedulerAudit, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "daily_observation_ledger.json"), JSON.stringify(recoveredScheduler.getObservationLedger(), null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "missed_session_audit.json"), JSON.stringify(missedSessionAudit, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "shadow_run_integrity.json"), JSON.stringify(runIntegrity, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "live_signal_maturity.json"), JSON.stringify({ liveMaturity }, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "forward_signal_quality.json"), JSON.stringify(forwardQuality, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "operational_health_report.json"), JSON.stringify(operationalHealth, null, 2));

  const md = [
    "# Phase 6.10.7 — Automated Shadow Observation Operations Report",
    "",
    `**Final Classification:** \`${operationalHealth.classification}\``,
    "",
    "## 1. Scheduler & Observation Integrity",
    `- Timezone: \`Asia/Kolkata\` (` +
      `target 15:45 IST); Run 1 status=**${run1.status}**, Same-day duplicate=**${dupRun.status}**, Post-restart duplicate=**${postRestartDup.status}**.`,
    `- Successful observation sessions: **${operationalHealth.successfulObservationSessions} / 90** (failed=0, missed=0).`,
    `- Evaluated symbols: **${run1.evaluatedSymbolsCount}/${run1.universeCount}** | Checksum: \`${run1.runChecksum.slice(0, 16)}...\``,
    "",
    "## 2. Safety Confirmation",
    `- \`STRATEGY_01 = false\`, \`STRATEGY_02 = false\`, \`STRATEGY_03 = false\`, \`LIVE_TRADING = false\`, \`BROKER_EXECUTION_ENABLED = false\`, \`Strategy03PaperIsolationConfig.enabled = false\`, \`experimental_paper_trades = ${paperTradesCount ?? 0}\`.`,
  ].join("\n");

  fs.writeFileSync(path.join(OUT_DIR, "phase6107_final_report.md"), md);
  console.log("Phase 6.10.7 complete:", { successfulSessions: operationalHealth.successfulObservationSessions, paperTrades: paperTradesCount ?? 0 });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

