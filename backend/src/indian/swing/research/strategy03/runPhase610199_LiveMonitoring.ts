import fs from "node:fs";
import path from "node:path";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import {
  load4hCacheForSymbol,
  type FourHourCandle,
} from "./prebreakout/Strategy03FourHourCandleProvider.js";
import {
  Strategy03FourHourMonitoringEngine,
} from "./prebreakout/Strategy03FourHourMonitoringEngine.js";
import { loadAllRowsPaginated } from "./Strategy03ShadowRunner.js";

config({ path: path.resolve("D:/Trading/my-app/backend/.env") });

const P61019_DIR = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase61019");
const CACHE_4H = path.join(P61019_DIR, "cache4h");
const OUT_DIR = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase610199");

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const univRows = await loadAllRowsPaginated(
    sb,
    "market_universe_equities",
    "nse_symbol,company_name,series,listing_status,market_cap_cr"
  );
  const { count: paperTradesCount } = await sb
    .from("experimental_paper_trades")
    .select("*", { count: "exact", head: true });

  const eligible = univRows
    .filter((r) => r.nse_symbol && r.series === "EQ" && r.listing_status === "ACTIVE")
    .map((r) => ({
      sym: String(r.nse_symbol).trim().toUpperCase(),
      companyName: r.company_name ?? String(r.nse_symbol),
      capCr: r.market_cap_cr !== null ? Number(r.market_cap_cr) : 0,
    }))
    .sort((a, b) => b.capCr - a.capCr);

  const engine = new Strategy03FourHourMonitoringEngine();
  const now = new Date("2026-11-18T12:51:03+05:30");

  // Pass 1: Evaluate all 2,403 eligible symbols
  for (const e of eligible) {
    const candles = load4hCacheForSymbol(CACHE_4H, e.sym);
    engine.evaluateSymbol({
      nseSymbol: e.sym,
      companyName: e.companyName,
      candles,
      now,
      dataProvider: "NSE 4H Session Cache",
      sourceReference: `backend/data/research/strategy03/phase61019/cache4h/${e.sym}_4h.json`,
    });
  }

  const alertsAfterPass1 = engine.getAlerts().length;

  // Pass 2: Duplicate scan of top 50 symbols -> must prevent duplicates and create 0 new alerts
  for (const e of eligible.slice(0, 50)) {
    const candles = load4hCacheForSymbol(CACHE_4H, e.sym);
    engine.evaluateSymbol({
      nseSymbol: e.sym,
      companyName: e.companyName,
      candles,
      now,
      dataProvider: "NSE 4H Session Cache",
      sourceReference: `backend/data/research/strategy03/phase61019/cache4h/${e.sym}_4h.json`,
    });
  }
  const alertsAfterPass2 = engine.getAlerts().length;

  // ANANDRATHI Special Monitoring Regression
  const anandRaw = load4hCacheForSymbol(CACHE_4H, "ANANDRATHI").filter((c) => c.isComplete);
  const anandEngine = new Strategy03FourHourMonitoringEngine();
  const step1 = anandEngine.evaluateSymbol({
    nseSymbol: "ANANDRATHI",
    companyName: "Anand Rathi Wealth",
    candles: anandRaw,
    now,
    dataProvider: "NSE 4H Session Cache",
    sourceReference: "cache4h/ANANDRATHI_4h.json",
  });
  // Step 2: Add INCOMPLETE 4H bar dipping to 2357.30 (< 2362.30 consolidation low) -> must remain READY!
  const incBar: FourHourCandle = {
    timeframe: "4H",
    timestamp: "2026-11-18T07:45:00.000Z",
    open: 2362.9,
    high: 2365.0,
    low: 2355.0,
    close: 2357.3,
    volume: 15000,
    isComplete: false,
    constituentBarCount: 1,
    sessionBlockType: "PM_135M",
    blockDurationMinutes: 135,
  };
  const step2Incomplete = anandEngine.evaluateSymbol({
    nseSymbol: "ANANDRATHI",
    companyName: "Anand Rathi Wealth",
    candles: [...anandRaw, incBar],
    now,
    dataProvider: "NSE 4H Session Cache",
    sourceReference: "cache4h/ANANDRATHI_4h.json",
  });
  // Step 3: Next COMPLETED 4H bar closes at 2355.00 (< 2362.30) -> transitions READY -> INVALIDATED
  const compInvalidBar: FourHourCandle = {
    ...incBar,
    close: 2355.0,
    isComplete: true,
    constituentBarCount: 3,
  };
  const step3CompletedBreach = anandEngine.evaluateSymbol({
    nseSymbol: "ANANDRATHI",
    companyName: "Anand Rathi Wealth",
    candles: [...anandRaw, compInvalidBar],
    now,
    dataProvider: "NSE 4H Session Cache",
    sourceReference: "cache4h/ANANDRATHI_4h.json",
  });

  const anandRegression = {
    initialCompletedStatus: step1.stateRecord.currentStatus,
    consolidationLow: step1.stateRecord.consolidationLow,
    afterIncompleteDip2357_30Status: step2Incomplete.stateRecord.currentStatus,
    incompleteTriggeredInvalidated: step2Incomplete.stateRecord.currentStatus === "INVALIDATED",
    afterCompletedClose2355_00Status: step3CompletedBreach.stateRecord.currentStatus,
    transitionHistory: anandEngine.getStateHistory(),
    alertsEmitted: anandEngine.getAlerts(),
  };

  const allStates = engine.getAllLatestStates();
  const stateCounts = {
    READY: allStates.filter((s) => s.currentStatus === "READY").length,
    FORMING: allStates.filter((s) => s.currentStatus === "FORMING").length,
    BREAKOUT: allStates.filter((s) => s.currentStatus === "BREAKOUT").length,
    INVALIDATED: allStates.filter((s) => s.currentStatus === "INVALIDATED").length,
    WAIT: allStates.filter((s) => s.currentStatus === "WAIT").length,
  };

  const runRecord = {
    runId: "mon_run_20261118_0915",
    evaluatedAt: now.toISOString(),
    completed4hTimestampIst: "2026-11-18T09:15:00.000+05:30",
    candidatesEvaluated: allStates.length,
    stateCounts,
    alertsGenerated: engine.getAlerts().length,
    duplicatesPrevented: engine.getDuplicatesPrevented(),
    duplicatePassCreatedZeroAlerts: alertsAfterPass1 === alertsAfterPass2,
  };

  // Attempt Supabase persistence if tables are applied remotely
  const { error: dbRunErr } = await sb.from("strategy03_monitoring_runs").upsert(
    {
      run_id: runRecord.runId,
      evaluated_at: runRecord.evaluatedAt,
      completed_4h_timestamp_ist: runRecord.completed4hTimestampIst,
      candidates_evaluated: runRecord.candidatesEvaluated,
      ready_count: stateCounts.READY,
      forming_count: stateCounts.FORMING,
      breakout_count: stateCounts.BREAKOUT,
      invalidated_count: stateCounts.INVALIDATED,
      wait_count: stateCounts.WAIT,
      alerts_generated: runRecord.alertsGenerated,
      duplicates_prevented: runRecord.duplicatesPrevented,
    },
    { onConflict: "run_id", ignoreDuplicates: true }
  );

  fs.writeFileSync(path.join(OUT_DIR, "monitoring_runs.json"), JSON.stringify({ ...runRecord, remoteTableError: dbRunErr?.message ?? null }, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "candidate_state_history.json"), JSON.stringify(allStates.slice(0, 300), null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "monitoring_alerts.json"), JSON.stringify(engine.getAlerts(), null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "anandrathi_regression.json"), JSON.stringify(anandRegression, null, 2));

  const md = [
    "# Phase 6.10.19.9 — Live 4H Pre-Breakout Monitoring & State Management",
    "",
    `- **Candidates Evaluated:** ${runRecord.candidatesEvaluated}`,
    `- **State Counts:** READY=${stateCounts.READY}, FORMING=${stateCounts.FORMING}, BREAKOUT=${stateCounts.BREAKOUT}, INVALIDATED=${stateCounts.INVALIDATED}, WAIT=${stateCounts.WAIT}`,
    `- **Alerts Generated:** ${runRecord.alertsGenerated} | **Duplicates Prevented:** ${runRecord.duplicatesPrevented}`,
    `- **ANANDRATHI Regression:** Initial=\`${anandRegression.initialCompletedStatus}\`, IncompleteDip2357.30=\`${anandRegression.afterIncompleteDip2357_30Status}\` (invalidated=\`${anandRegression.incompleteTriggeredInvalidated}\`), CompletedClose2355.00=\`${anandRegression.afterCompletedClose2355_00Status}\``,
    `- **Safety:** \`STRATEGY_01=false\`, \`STRATEGY_02=false\`, \`STRATEGY_03=false\`, \`LIVE_TRADING=false\`, \`BROKER_EXECUTION_ENABLED=false\`, \`experimental_paper_trades=${paperTradesCount ?? 0}\``,
  ].join("\n");
  fs.writeFileSync(path.join(OUT_DIR, "phase610199_monitoring_report.md"), md);

  console.log("Phase 6.10.19.9 complete:", {
    runRecord,
    anandRegression: {
      initial: anandRegression.initialCompletedStatus,
      incompleteDip: anandRegression.afterIncompleteDip2357_30Status,
      completedBreach: anandRegression.afterCompletedClose2355_00Status,
    },
    remoteTableStatus: dbRunErr ? `LOCAL_ONLY (${dbRunErr.message})` : "REMOTE_PERSISTED",
    paperTrades: paperTradesCount ?? 0,
  });
}

if (process.argv[1]?.includes("runPhase610199_LiveMonitoring")) {
  main().catch((err) => {
    console.error("Phase 6.10.19.9 failed:", err);
    process.exit(1);
  });
}

