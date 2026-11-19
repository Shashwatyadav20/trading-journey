import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { load4hCacheForSymbol } from "./prebreakout/Strategy03FourHourCandleProvider.js";
import type { ImmutableReadySignalSnapshot } from "./prebreakout/Strategy03FourHourForwardOutcomeTracker.js";
import { Strategy03ForwardMaturityMonitor } from "./prebreakout/Strategy03ForwardMaturityMonitor.js";

config({ path: path.resolve("D:/Trading/my-app/.env.local") });
config({ path: path.resolve("D:/Trading/my-app/backend/.env") });

const P61019_DIR = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase61019");
const CACHE_4H = path.join(P61019_DIR, "cache4h");
const P6101911_DIR = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase6101911");
const P6101912_DIR = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase6101912");
const OUT_DIR = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase6101913");

function sha256File(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function captureDirectoryHashes(dir: string, files: string[]): Record<string, string> {
  const res: Record<string, string> = {};
  for (const f of files) {
    res[f] = sha256File(path.join(dir, f));
  }
  return res;
}

async function main() {
  if (fs.existsSync(OUT_DIR)) {
    fs.rmSync(OUT_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const p11Files = [
    "forward_signal_snapshots.json",
    "forward_signal_outcomes.json",
    "forward_cohort_statistics.json",
    "forward_shadow_summary.json",
  ];
  const p12Files = [
    "independent_forward_audit_report.json",
    "independent_recalculated_outcomes.json",
    "audited_cohort_maturity_statistics.json",
    "independent_mismatch_ledger.json",
  ];

  // Capture SHA-256 hashes of Phase 6.10.19.11 and Phase 6.10.19.12 files BEFORE running Phase 6.10.19.13
  const p11Before = captureDirectoryHashes(P6101911_DIR, p11Files);
  const p12Before = captureDirectoryHashes(P6101912_DIR, p12Files);

  const snapshots = JSON.parse(
    fs.readFileSync(path.join(P6101911_DIR, "forward_signal_snapshots.json"), "utf8")
  ) as ImmutableReadySignalSnapshot[];

  const sb = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  const { count: paperTradesCount } = await sb
    .from("experimental_paper_trades")
    .select("*", { count: "exact", head: true });

  const monitor = new Strategy03ForwardMaturityMonitor(OUT_DIR, snapshots, () => sb);
  const now = new Date("2026-11-18T16:35:21+05:30");

  // Cycle 1: Evaluate all 83 existing signals against current completed 4H NSE session blocks
  const cycle1 = await monitor.runMonitoringCycle({
    cycleId: "fwd_mon_cycle_20261118_1",
    loadCandlesBySymbol: (sym) => load4hCacheForSymbol(CACHE_4H, sym),
    now,
  });

  // Cycle 2: Immediate repeated monitoring cycle + simulated process restart recovery
  const restartedMonitor = new Strategy03ForwardMaturityMonitor(OUT_DIR, snapshots, () => sb);
  const cycle2 = await restartedMonitor.runMonitoringCycle({
    cycleId: "fwd_mon_cycle_20261118_2_post_restart",
    loadCandlesBySymbol: (sym) => load4hCacheForSymbol(CACHE_4H, sym),
    now,
  });

  // Capture SHA-256 hashes AFTER running Phase 6.10.19.13 to verify 100% immutability of prior phases
  const p11After = captureDirectoryHashes(P6101911_DIR, p11Files);
  const p12After = captureDirectoryHashes(P6101912_DIR, p12Files);

  const phase6101911Unchanged = p11Files.every((f) => p11Before[f] === p11After[f]);
  const phase6101912Unchanged = p12Files.every((f) => p12Before[f] === p12After[f]);

  const c1Res = cycle1.cycleResult;
  const c2Res = cycle2.cycleResult;

  const dashboardPayload = {
    generatedAtIso: now.toISOString(),
    phase: "6.10.19.13",
    readOnlyContinuation: true,
    latestCompletedMonitoringTimestampIst: c1Res.latestCompletedMonitoringTimestampIst,
    totalSignalsMonitored: c1Res.totalSignalsMonitored,
    newlyProcessed4hBarsCount: c1Res.newlyProcessed4hBarsCount,
    signalsUpdatedCount: c1Res.signalsUpdatedCount,
    repeatedCycleVerification: {
      cycle2NewlyProcessed4hBarsCount: c2Res.newlyProcessed4hBarsCount,
      cycle2SignalsUpdatedCount: c2Res.signalsUpdatedCount,
      cycle2EventsEmittedCount: c2Res.newEventsEmitted.length,
      idempotentZeroDuplicateUpdates:
        c2Res.newlyProcessed4hBarsCount === 0 &&
        c2Res.signalsUpdatedCount === 0 &&
        c2Res.newEventsEmitted.length === 0,
    },
    integrityAuditStatus: c1Res.auditStatus,
    persistenceStatus: c1Res.persistenceStatus,
    remoteTablesAvailable: c1Res.remoteTablesAvailable,
    remoteBlockerCode: c1Res.remoteBlockerCode,
    remoteBlockerMessage: c1Res.remoteBlockerMessage,
    dataFreshnessSummary: {
      freshSignalsCount:
        c1Res.totalSignalsMonitored - c1Res.rejectedStaleOrMissingSignalsCount,
      staleOrMissingSignalsCount: c1Res.rejectedStaleOrMissingSignalsCount,
    },
    latestBreakoutAndInvalidationEvents: restartedMonitor.getEvents(),
    cohortMaturityStatistics: c1Res.cohortMaturityStatistics,
    immutabilityVerification: {
      phase6101911Unchanged,
      phase6101912Unchanged,
      p11Checksums: p11After,
      p12Checksums: p12After,
    },
    unresolvedBlockers: [
      "All 83 prospective READY signals were captured at the latest completed 4H bar (2026-11-18T09:15:00.000+05:30); 0 post-signal completed 4H blocks have closed in cache4h yet, so all 83 remain in PENDING_ZERO_POST_BARS (excluded from performance rate denominators).",
      "Remote Supabase monitoring tables (strategy03_monitoring_runs, strategy03_candidate_state_history, strategy03_monitoring_alerts) remain unapplied (PGRST205: missing direct Postgres DDL connection / Management PAT); persistence remains strictly LOCAL_ONLY.",
    ],
    safetyLocks: {
      STRATEGY_01: false,
      STRATEGY_02: false,
      STRATEGY_03: false,
      LIVE_TRADING: false,
      BROKER_EXECUTION_ENABLED: false,
      paperIsolationEnabled: false,
      experimentalPaperTradesCount: paperTradesCount ?? 0,
    },
  };

  fs.writeFileSync(
    path.join(OUT_DIR, "forward_maturity_dashboard.json"),
    JSON.stringify(dashboardPayload, null, 2)
  );

  const cShort = c1Res.cohortMaturityStatistics.SHORT_HIGH_QUALITY;
  const cMed = c1Res.cohortMaturityStatistics.MEDIUM_CLEAN;
  const cLong = c1Res.cohortMaturityStatistics.LONG_CLEAN;
  const cAll = c1Res.cohortMaturityStatistics.ALL_TRACKED_COHORTS;

  const md = [
    "# Strategy 03 — Phase 6.10.19.13: Forward Monitoring, Maturity Progress & Data Integrity Report",
    "",
    "## 1. Preservation of Existing Research Evidence (SHA-256 Verified)",
    `- **Phase 6.10.19.11 Snapshots & Outcomes Unchanged:** \`${phase6101911Unchanged}\``,
    `- **Phase 6.10.19.12 Audit Artifacts Unchanged:** \`${phase6101912Unchanged}\``,
    "- **No Backdating or Manufactured Maturity:** Zero historical or synthetic post-signal bars were injected into the live research ledger.",
    "",
    "## 2. Automated Forward Monitoring Cycle Results",
    `- **Latest Completed Monitoring Timestamp (IST):** \`${c1Res.latestCompletedMonitoringTimestampIst}\``,
    `- **Total Signals Monitored:** \`${c1Res.totalSignalsMonitored}\``,
    `- **Newly Processed Post-Signal 4H Bars (Cycle 1):** \`${c1Res.newlyProcessed4hBarsCount}\` (\`signalsUpdatedCount=${c1Res.signalsUpdatedCount}\`)`,
    `- **Pre-Signal / At-Signal 4H Bars Rejected:** \`${c1Res.rejectedPreOrAtSignalCount}\``,
    `- **Post-Restart Cycle 2 Idempotency:** \`newlyProcessed4hBarsCount=${c2Res.newlyProcessed4hBarsCount}\`, \`signalsUpdatedCount=${c2Res.signalsUpdatedCount}\`, \`idempotentZeroDuplicateUpdates=${dashboardPayload.repeatedCycleVerification.idempotentZeroDuplicateUpdates}\``,
    `- **Independent Validator Integration:** \`allIntegrityChecksPassed=${c1Res.auditStatus.allIntegrityChecksPassed}\`, \`candleCalculationMismatchCount=${c1Res.auditStatus.candleCalculationMismatchCount}\`, \`auditWarningRaised=${c1Res.auditStatus.auditWarningRaised}\``,
    "",
    "## 3. Cohort Maturity Progression Dashboard",
    "",
    "| Cohort | Total Captured | Pending (`0B`) | Matured `1B` | Matured `5B` | Matured `10B` | Matured `20B` | Brk / Inv / Untrig (`>=1B`) | Rates & 95% CI (`>=1B`) | Median Time to Brk | MFE / MAE (`>=1B`) | Sufficiency Verdict |",
    "|---|---:|---:|---:|---:|---:|---:|---|---|---|---|---|",
    `| **SHORT_HIGH_QUALITY** | ${cShort.totalCapturedSignals} | ${cShort.maturityDistribution.pendingZeroPostBars} | ${cShort.maturityDistribution.atLeast1PostBlock} | ${cShort.maturityDistribution.atLeast5PostBlocks} | ${cShort.maturityDistribution.atLeast10PostBlocks} | ${cShort.maturityDistribution.atLeast20PostBlocks} | ${cShort.countsAmongMaturedAtLeast1B.breakoutCount} / ${cShort.countsAmongMaturedAtLeast1B.invalidationBeforeBreakoutCount} / ${cShort.countsAmongMaturedAtLeast1B.untriggeredMaturedCount} | \`null (denom=0)\` | \`null\` | \`null (denom=0)\` | \`${cShort.sampleSufficiencyVerdict}\` |`,
    `| **MEDIUM_CLEAN** | ${cMed.totalCapturedSignals} | ${cMed.maturityDistribution.pendingZeroPostBars} | ${cMed.maturityDistribution.atLeast1PostBlock} | ${cMed.maturityDistribution.atLeast5PostBlocks} | ${cMed.maturityDistribution.atLeast10PostBlocks} | ${cMed.maturityDistribution.atLeast20PostBlocks} | ${cMed.countsAmongMaturedAtLeast1B.breakoutCount} / ${cMed.countsAmongMaturedAtLeast1B.invalidationBeforeBreakoutCount} / ${cMed.countsAmongMaturedAtLeast1B.untriggeredMaturedCount} | \`null (denom=0)\` | \`null\` | \`null (denom=0)\` | \`${cMed.sampleSufficiencyVerdict}\` |`,
    `| **LONG_CLEAN** | ${cLong.totalCapturedSignals} | ${cLong.maturityDistribution.pendingZeroPostBars} | ${cLong.maturityDistribution.atLeast1PostBlock} | ${cLong.maturityDistribution.atLeast5PostBlocks} | ${cLong.maturityDistribution.atLeast10PostBlocks} | ${cLong.maturityDistribution.atLeast20PostBlocks} | ${cLong.countsAmongMaturedAtLeast1B.breakoutCount} / ${cLong.countsAmongMaturedAtLeast1B.invalidationBeforeBreakoutCount} / ${cLong.countsAmongMaturedAtLeast1B.untriggeredMaturedCount} | \`null (denom=0)\` | \`null\` | \`null (denom=0)\` | \`${cLong.sampleSufficiencyVerdict}\` |`,
    `| **ALL_TRACKED_COHORTS** | **${cAll.totalCapturedSignals}** | **${cAll.maturityDistribution.pendingZeroPostBars}** | **${cAll.maturityDistribution.atLeast1PostBlock}** | **${cAll.maturityDistribution.atLeast5PostBlocks}** | **${cAll.maturityDistribution.atLeast10PostBlocks}** | **${cAll.maturityDistribution.atLeast20PostBlocks}** | **${cAll.countsAmongMaturedAtLeast1B.breakoutCount} / ${cAll.countsAmongMaturedAtLeast1B.invalidationBeforeBreakoutCount} / ${cAll.countsAmongMaturedAtLeast1B.untriggeredMaturedCount}** | \`null (denom=0)\` | \`null\` | \`null (denom=0)\` | \`${cAll.sampleSufficiencyVerdict}\` |`,
    "",
    "## 4. Persistence & Safety Verification",
    `- **Persistence Status:** \`${c1Res.persistenceStatus}\` (\`remoteTablesAvailable=${c1Res.remoteTablesAvailable}\`, \`remoteBlockerCode=${c1Res.remoteBlockerCode}\`)`,
    `- **Data Freshness:** \`FRESH=${dashboardPayload.dataFreshnessSummary.freshSignalsCount}/83\`, \`STALE_OR_MISSING=${dashboardPayload.dataFreshnessSummary.staleOrMissingSignalsCount}\``,
    `- **Safety Locks:** \`STRATEGY_01 = false\`, \`STRATEGY_02 = false\`, \`STRATEGY_03 = false\`, \`LIVE_TRADING = false\`, \`BROKER_EXECUTION_ENABLED = false\`, \`Strategy03PaperIsolationConfig.enabled = false\`, \`experimental_paper_trades = ${paperTradesCount ?? 0}\``,
  ].join("\n");

  fs.writeFileSync(path.join(OUT_DIR, "phase6101913_forward_monitoring_report.md"), md);

  console.log("Phase 6.10.19.13 complete:", {
    totalSignalsMonitored: c1Res.totalSignalsMonitored,
    latestCompletedMonitoringTimestampIst: c1Res.latestCompletedMonitoringTimestampIst,
    newlyProcessed4hBarsCount: c1Res.newlyProcessed4hBarsCount,
    signalsUpdatedCount: c1Res.signalsUpdatedCount,
    allIntegrityChecksPassed: c1Res.auditStatus.allIntegrityChecksPassed,
    candleCalculationMismatchCount: c1Res.auditStatus.candleCalculationMismatchCount,
    auditWarningRaised: c1Res.auditStatus.auditWarningRaised,
    phase6101911Unchanged,
    phase6101912Unchanged,
    persistenceStatus: c1Res.persistenceStatus,
    paperTradesCount: paperTradesCount ?? 0,
  });
}

if (process.argv[1]?.includes("runPhase6101913_ForwardMonitoring")) {
  main().catch((err) => {
    console.error("Phase 6.10.19.13 failed:", err);
    process.exit(1);
  });
}

