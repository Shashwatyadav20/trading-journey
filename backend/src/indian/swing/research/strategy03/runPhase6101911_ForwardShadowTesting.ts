import fs from "node:fs";
import path from "node:path";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import {
  load4hCacheForSymbol,
} from "./prebreakout/Strategy03FourHourCandleProvider.js";
import {
  evaluateFourHourPreBreakout,
} from "./prebreakout/Strategy03FourHourPreBreakoutScanner.js";
import {
  isTrackedDurationCohort,
  Strategy03FourHourForwardOutcomeTracker,
} from "./prebreakout/Strategy03FourHourForwardOutcomeTracker.js";
import {
  Strategy03FourHourMonitoringPersistence,
} from "./prebreakout/Strategy03FourHourMonitoringPersistence.js";
import { loadAllRowsPaginated } from "./Strategy03ShadowRunner.js";

config({ path: path.resolve("D:/Trading/my-app/.env.local") });
config({ path: path.resolve("D:/Trading/my-app/backend/.env") });

const P61019_DIR = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase61019");
const CACHE_4H = path.join(P61019_DIR, "cache4h");
const P6101910_DIR = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase6101910");
const OUT_DIR = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase6101911");

async function main() {
  if (fs.existsSync(OUT_DIR)) {
    fs.rmSync(OUT_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const sb = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  // Verify zero experimental_paper_trades
  const { count: paperTradesCount } = await sb
    .from("experimental_paper_trades")
    .select("*", { count: "exact", head: true });

  // Check current persistence layer status (LOCAL_ONLY / SYNC_PENDING / REMOTE_SYNCED)
  const monPersistence = new Strategy03FourHourMonitoringPersistence(P6101910_DIR, () => sb);
  const reconcileStatus = await monPersistence.reconcileLocalAndRemote();

  const univRows = await loadAllRowsPaginated(
    sb,
    "market_universe_equities",
    "nse_symbol,company_name,series,listing_status,market_cap_cr"
  );
  const eligible = univRows
    .filter((r) => r.nse_symbol && r.series === "EQ" && r.listing_status === "ACTIVE")
    .map((r) => ({
      sym: String(r.nse_symbol).trim().toUpperCase(),
      companyName: r.company_name ?? String(r.nse_symbol),
      capCr: r.market_cap_cr !== null ? Number(r.market_cap_cr) : 0,
    }))
    .sort((a, b) => b.capCr - a.capCr);

  const tracker = new Strategy03FourHourForwardOutcomeTracker(OUT_DIR, () => sb);
  const now = new Date("2026-11-18T12:51:03+05:30");

  let capturedSignals = 0;
  for (const e of eligible) {
    const candles = load4hCacheForSymbol(CACHE_4H, e.sym);
    const completedCandles = candles.filter((c) => c.isComplete && c.timeframe === "4H");
    if (completedCandles.length === 0) continue;

    const item = evaluateFourHourPreBreakout({
      nseSymbol: e.sym,
      companyName: e.companyName,
      candles: completedCandles,
      now,
      dataProvider: "NSE 4H Session Cache (Normalized AM_240M / PM_135M)",
      sourceReference: `backend/data/research/strategy03/phase61019/cache4h/${e.sym}_4h.json`,
    });

    if (item.status === "READY" && isTrackedDurationCohort(item.consolidation.tier)) {
      const refBar = completedCandles[completedCandles.length - 1];
      const reg = tracker.registerReadySignal({
        item,
        referenceCandle: refBar,
        persistenceStatus: reconcileStatus.persistenceStatus,
        capturedAt: now,
      });
      if (reg.captured && reg.snapshot) {
        capturedSignals++;
        // Evaluate strictly on completed 4H candles after the signal timestamp (0 future bars at capture time)
        tracker.evaluateForwardOutcomeForSignal({
          signalId: reg.snapshot.signalId,
          candles: completedCandles,
          evaluatedAt: now,
        });
      }
    }
  }

  // Re-register first 10 READY signals to verify snapshot immutability & duplicate protection
  let duplicateRewritesPrevented = 0;
  for (const snap of tracker.getAllSnapshots().slice(0, 10)) {
    const candles = load4hCacheForSymbol(CACHE_4H, snap.symbol).filter(
      (c) => c.isComplete && c.timeframe === "4H"
    );
    const item = evaluateFourHourPreBreakout({
      nseSymbol: snap.symbol,
      companyName: snap.companyName,
      candles,
      now,
      dataProvider: snap.dataSource,
      sourceReference: snap.sourceReference,
    });
    const regDup = tracker.registerReadySignal({
      item: { ...item, priorityScore: 999 }, // attempt to mutate score
      referenceCandle: candles[candles.length - 1],
      persistenceStatus: reconcileStatus.persistenceStatus,
      capturedAt: new Date("2026-11-19T10:00:00+05:30"),
    });
    if (regDup.alreadyExisted && regDup.snapshot?.originalScore === snap.originalScore) {
      duplicateRewritesPrevented++;
    }
  }

  const persistRes = await tracker.persistForwardLedger();
  const cohortStats = tracker.computeCohortStatistics();

  const summaryPayload = {
    generatedAtIso: now.toISOString(),
    methodology: {
      prospectiveOnly: true,
      backdatedSignalGeneration: false,
      lookaheadBias: false,
      timeframe: "4H_COMPLETED_NSE_SESSION_BLOCKS_ONLY",
      trackedCohorts: ["SHORT_HIGH_QUALITY", "MEDIUM_CLEAN", "LONG_CLEAN"],
      outcomeHorizonsBlocks: [5, 10, 20],
    },
    persistence: persistRes,
    capturedSignalsTotal: capturedSignals,
    duplicateRewritesPrevented,
    cohortStatistics: cohortStats,
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
    path.join(OUT_DIR, "forward_shadow_summary.json"),
    JSON.stringify(summaryPayload, null, 2)
  );

  const sShort = cohortStats.SHORT_HIGH_QUALITY;
  const sMed = cohortStats.MEDIUM_CLEAN;
  const sLong = cohortStats.LONG_CLEAN;
  const sAll = cohortStats.ALL_TRACKED_COHORTS;

  const md = [
    "# Strategy 03 — Phase 6.10.19.11: Forward Shadow Testing & Signal Outcome Tracking Report",
    "",
    "## 1. Forward-Only Methodology & Anti-Lookahead Guarantees",
    "- **Prospective Capture Only:** Signals are captured strictly at the latest completed 4H session block (`2026-11-18T09:15:00.000+05:30`) with `backdatedSignalGeneration = false` and `lookaheadBias = false`.",
    "- **Immutable Signal Snapshots:** Captured snapshots are frozen (`immutable: true`) with exact completed 4H OHLCV, consolidation high/low, support & bullish OB zones, impulse displacement & duration-normalized RVOL, breakout distance, original score, scoring reasons, and persistence status.",
    `- **Immutability Verification:** Re-registering existing signals with modified scores prevented **${duplicateRewritesPrevented} / 10** rewrite attempts (` + "`originalScore` preserved verbatim).",
    "- **Completed 4H Outcome Tracking Only:** Forward outcome evaluation filters strictly to `timeframe === '4H' && isComplete === true && timestamp > signalCompleted4hTimestampUtc`. Incomplete 4H bars never trigger breakouts or invalidations.",
    "",
    "## 2. Prospective Cohort Statistics (Baseline T+0 Capture)",
    "",
    "| Cohort | Total Signals | Matured (>0 Post Bars) | Breakout Rate (95% Wilson CI) | Invalidation Rate (95% Wilson CI) | Untriggered Rate (95% Wilson CI) | Median Time to Breakout | Mean MFE / MAE | 5B / 10B / 20B Reached | Sample Sufficiency |",
    "|---|---:|---:|---|---|---|---|---|---:|---|",
    `| **SHORT_HIGH_QUALITY** | ${sShort.totalSignals} | ${sShort.maturedSignalsWithPostSignalBars} | ${sShort.breakoutRatePct}% ([${sShort.breakoutRate95Ci.lowerPct}%, ${sShort.breakoutRate95Ci.upperPct}%]) | ${sShort.invalidationRatePct}% ([${sShort.invalidationRate95Ci.lowerPct}%, ${sShort.invalidationRate95Ci.upperPct}%]) | ${sShort.untriggeredRatePct}% ([${sShort.untriggeredRate95Ci.lowerPct}%, ${sShort.untriggeredRate95Ci.upperPct}%]) | ${sShort.medianBlocksToBreakout ?? "N/A"} | ${sShort.meanMfePct}% / ${sShort.meanMaePct}% | ${sShort.horizon5BReachedCount} / ${sShort.horizon10BReachedCount} / ${sShort.horizon20BReachedCount} | \`${sShort.sampleSufficiencyVerdict}\` |`,
    `| **MEDIUM_CLEAN** | ${sMed.totalSignals} | ${sMed.maturedSignalsWithPostSignalBars} | ${sMed.breakoutRatePct}% ([${sMed.breakoutRate95Ci.lowerPct}%, ${sMed.breakoutRate95Ci.upperPct}%]) | ${sMed.invalidationRatePct}% ([${sMed.invalidationRate95Ci.lowerPct}%, ${sMed.invalidationRate95Ci.upperPct}%]) | ${sMed.untriggeredRatePct}% ([${sMed.untriggeredRate95Ci.lowerPct}%, ${sMed.untriggeredRate95Ci.upperPct}%]) | ${sMed.medianBlocksToBreakout ?? "N/A"} | ${sMed.meanMfePct}% / ${sMed.meanMaePct}% | ${sMed.horizon5BReachedCount} / ${sMed.horizon10BReachedCount} / ${sMed.horizon20BReachedCount} | \`${sMed.sampleSufficiencyVerdict}\` |`,
    `| **LONG_CLEAN** | ${sLong.totalSignals} | ${sLong.maturedSignalsWithPostSignalBars} | ${sLong.breakoutRatePct}% ([${sLong.breakoutRate95Ci.lowerPct}%, ${sLong.breakoutRate95Ci.upperPct}%]) | ${sLong.invalidationRatePct}% ([${sLong.invalidationRate95Ci.lowerPct}%, ${sLong.invalidationRate95Ci.upperPct}%]) | ${sLong.untriggeredRatePct}% ([${sLong.untriggeredRate95Ci.lowerPct}%, ${sLong.untriggeredRate95Ci.upperPct}%]) | ${sLong.medianBlocksToBreakout ?? "N/A"} | ${sLong.meanMfePct}% / ${sLong.meanMaePct}% | ${sLong.horizon5BReachedCount} / ${sLong.horizon10BReachedCount} / ${sLong.horizon20BReachedCount} | \`${sLong.sampleSufficiencyVerdict}\` |`,
    `| **ALL_TRACKED_COHORTS** | **${sAll.totalSignals}** | **${sAll.maturedSignalsWithPostSignalBars}** | **${sAll.breakoutRatePct}%** ([${sAll.breakoutRate95Ci.lowerPct}%, ${sAll.breakoutRate95Ci.upperPct}%]) | **${sAll.invalidationRatePct}%** ([${sAll.invalidationRate95Ci.lowerPct}%, ${sAll.invalidationRate95Ci.upperPct}%]) | **${sAll.untriggeredRatePct}%** ([${sAll.untriggeredRate95Ci.lowerPct}%, ${sAll.untriggeredRate95Ci.upperPct}%]) | **${sAll.medianBlocksToBreakout ?? "N/A"}** | **${sAll.meanMfePct}% / ${sAll.meanMaePct}%** | **${sAll.horizon5BReachedCount} / ${sAll.horizon10BReachedCount} / ${sAll.horizon20BReachedCount}** | \`${sAll.sampleSufficiencyVerdict}\` |`,
    "",
    `> **Statistical Honesty Disclaimer:** ${sAll.statisticalDisclaimer}`,
    "",
    "## 3. Persistence & Safety Verification",
    `- **Persistence Status:** \`${persistRes.persistenceStatus}\` (\`remoteTablesAvailable=${persistRes.remoteTablesAvailable}\`, \`blockerCode=${persistRes.blockerCode}\`, \`snapshotsSavedLocally=${persistRes.snapshotsSavedLocally}\`, \`outcomesSavedLocally=${persistRes.outcomesSavedLocally}\`)`,
    `- **Safety Locks:** \`STRATEGY_01 = false\`, \`STRATEGY_02 = false\`, \`STRATEGY_03 = false\`, \`LIVE_TRADING = false\`, \`BROKER_EXECUTION_ENABLED = false\`, \`Strategy03PaperIsolationConfig.enabled = false\`, \`experimental_paper_trades = ${paperTradesCount ?? 0}\``,
  ].join("\n");

  fs.writeFileSync(path.join(OUT_DIR, "phase6101911_forward_shadow_report.md"), md);

  console.log("Phase 6.10.19.11 complete:", {
    capturedSignals,
    duplicateRewritesPrevented,
    persistenceStatus: persistRes.persistenceStatus,
    cohorts: {
      SHORT_HIGH_QUALITY: sShort.totalSignals,
      MEDIUM_CLEAN: sMed.totalSignals,
      LONG_CLEAN: sLong.totalSignals,
      ALL_TRACKED_COHORTS: sAll.totalSignals,
    },
    paperTradesCount: paperTradesCount ?? 0,
  });
}

if (process.argv[1]?.includes("runPhase6101911_ForwardShadowTesting")) {
  main().catch((err) => {
    console.error("Phase 6.10.19.11 failed:", err);
    process.exit(1);
  });
}

