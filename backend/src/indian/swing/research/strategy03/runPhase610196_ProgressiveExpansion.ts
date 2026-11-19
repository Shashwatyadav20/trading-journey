import fs from "node:fs";
import path from "node:path";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import type { OhlcvCandle } from "./entry/EntrySetupTypes.js";
import {
  buildCompleted4hCandlesFromSessionBars,
  load4hCacheForSymbol,
} from "./prebreakout/Strategy03FourHourCandleProvider.js";
import {
  DEFAULT_4H_SCANNER_CONFIG,
  evaluateFourHourPreBreakout,
  type ConsolidationDurationCategory,
  type FourHourPreBreakoutItem,
  type FourHourPreBreakoutStatus,
} from "./prebreakout/Strategy03FourHourPreBreakoutScanner.js";
import { loadAllRowsPaginated } from "./Strategy03ShadowRunner.js";

config({ path: path.resolve("D:/Trading/my-app/backend/.env") });

const P61019_DIR = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase61019");
const CACHE_4H = path.join(P61019_DIR, "cache4h");
const OUT_DIR = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase610196");
const PROGRESS_FILE = path.join(OUT_DIR, "batch_progress.json");

const STATUS_PRIORITY: Record<FourHourPreBreakoutStatus, number> = {
  READY: 0,
  FORMING: 1,
  BREAKOUT: 2,
  INVALIDATED: 3,
  WAIT: 4,
};

async function fetchYahoo1hWithBackoff(
  sym: string,
  maxRetries = 2
): Promise<{ ok: boolean; bars: OhlcvCandle[]; retries: number; error?: string }> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym + ".NS")}?range=60d&interval=1h`;
  let retries = 0;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
      if (res.status === 429 && attempt < maxRetries) {
        retries++;
        await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
        continue;
      }
      if (!res.ok) return { ok: false, bars: [], retries, error: `HTTP_${res.status}` };
      const json: any = await res.json();
      const r = json?.chart?.result?.[0];
      const ts: number[] = r?.timestamp ?? [];
      const q = r?.indicators?.quote?.[0] ?? {};
      const bars: OhlcvCandle[] = [];
      for (let i = 0; i < ts.length; i++) {
        const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i], v = q.volume?.[i];
        if (o == null || h == null || l == null || c == null || v == null) continue;
        bars.push({
          timestamp: new Date(ts[i] * 1000).toISOString(),
          open: Number(o),
          high: Number(h),
          low: Number(l),
          close: Number(c),
          volume: Number(v),
        });
      }
      return { ok: bars.length > 0, bars, retries, error: bars.length === 0 ? "EMPTY_OHLCV" : undefined };
    } catch (err) {
      if (attempt < maxRetries) {
        retries++;
        await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
        continue;
      }
      return { ok: false, bars: [], retries, error: err instanceof Error ? err.message : String(err) };
    }
  }
  return { ok: false, bars: [], retries, error: "MAX_RETRIES_EXCEEDED" };
}

async function main() {
  fs.mkdirSync(CACHE_4H, { recursive: true });
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

  const eligible: Array<{ sym: string; companyName: string; capCr: number }> = [];
  for (const r of univRows) {
    const sym = r.nse_symbol ? String(r.nse_symbol).trim().toUpperCase() : "";
    if (!sym || r.series !== "EQ" || r.listing_status !== "ACTIVE") continue;
    eligible.push({
      sym,
      companyName: r.company_name ?? sym,
      capCr: r.market_cap_cr !== null ? Number(r.market_cap_cr) : 0,
    });
  }
  eligible.sort((a, b) => b.capCr - a.capCr);

  const progress = fs.existsSync(PROGRESS_FILE)
    ? JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf8"))
    : {
        batchesCompleted: 0,
        newlyCachedCount: 0,
        totalRetries: 0,
        failedFetches: [] as Array<{ symbol: string; error: string }>,
        processedSymbols: [] as string[],
      };

  const alreadyProcessed = new Set<string>(progress.processedSymbols);
  const toFetch = eligible.filter(
    (e) => !alreadyProcessed.has(e.sym) && !fs.existsSync(path.join(CACHE_4H, `${e.sym}_4h.json`))
  );

  // Process in batches of 300, max concurrency 25
  for (let bStart = 0; bStart < toFetch.length; bStart += 300) {
    const batch = toFetch.slice(bStart, bStart + 300);
    for (let cStart = 0; cStart < batch.length; cStart += 25) {
      const wave = batch.slice(cStart, cStart + 25);
      await Promise.all(
        wave.map(async (e) => {
          const res = await fetchYahoo1hWithBackoff(e.sym, 2);
          progress.totalRetries += res.retries;
          progress.processedSymbols.push(e.sym);
          if (!res.ok) {
            progress.failedFetches.push({ symbol: e.sym, error: res.error ?? "FETCH_FAILED" });
            return;
          }
          const bars4h = buildCompleted4hCandlesFromSessionBars(res.bars);
          if (bars4h.length > 0) {
            fs.writeFileSync(path.join(CACHE_4H, `${e.sym}_4h.json`), JSON.stringify(bars4h));
            progress.newlyCachedCount++;
          }
        })
      );
    }
    progress.batchesCompleted++;
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify({ ...progress, lastBatchSavedAt: new Date().toISOString() }, null, 2));
  }

  // Run 4H-only scanner across ALL eligible symbols
  const now = new Date("2026-11-18T12:35:00+05:30");
  const items: FourHourPreBreakoutItem[] = [];
  for (const e of eligible) {
    const candles4h = load4hCacheForSymbol(CACHE_4H, e.sym);
    const sourceRef = `backend/data/research/strategy03/phase61019/cache4h/${e.sym}_4h.json`;
    items.push(
      evaluateFourHourPreBreakout({
        nseSymbol: e.sym,
        companyName: e.companyName,
        candles: candles4h,
        now,
        dataProvider: "NSE 4H Session Cache (Normalized AM_240M / PM_135M)",
        sourceReference: sourceRef,
        config: DEFAULT_4H_SCANNER_CONFIG,
      })
    );
  }

  items.sort((a, b) => {
    const pDiff = STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status];
    if (pDiff !== 0) return pDiff;
    return b.priorityScore - a.priorityScore;
  });

  const statusCounts: Record<FourHourPreBreakoutStatus, number> = {
    READY: 0,
    FORMING: 0,
    BREAKOUT: 0,
    INVALIDATED: 0,
    WAIT: 0,
  };
  const readyByCategory: Record<ConsolidationDurationCategory, number> = {
    SHORT_HIGH_QUALITY: 0,
    MEDIUM_CLEAN: 0,
    LONG_CLEAN: 0,
    EXTENDED_BASE: 0,
    NONE: 0,
  };
  let cachedCount = 0;
  let scannedSufficientHistory = 0;

  for (const it of items) {
    statusCounts[it.status]++;
    if (fs.existsSync(path.join(CACHE_4H, `${it.nseSymbol}_4h.json`))) cachedCount++;
    if (!it.reason.startsWith("MISSING_OR_INSUFFICIENT_4H_DATA")) scannedSufficientHistory++;
    if (it.status === "READY") readyByCategory[it.consolidation.tier]++;
  }

  const coverageReport = {
    totalEligibleUniverse: eligible.length,
    successfullyCachedSymbols: cachedCount,
    newlyCachedThisPhase: progress.newlyCachedCount,
    scannedWithSufficient4hHistory: scannedSufficientHistory,
    stillMissingOrInsufficientData: eligible.length - scannedSufficientHistory,
    failedFetchCount: progress.failedFetches.length,
    totalRetries: progress.totalRetries,
    statusCounts,
    readyByCategory,
    topReadyCandidates: items.filter((i) => i.status === "READY").slice(0, 30).map((i) => ({
      symbol: i.nseSymbol,
      priorityScore: i.priorityScore,
      tier: i.consolidation.tier,
      blocks4h: i.consolidation.candleCount,
      tradingDays: i.consolidation.tradingDaysElapsed,
      rangePct: i.consolidation.rangePct,
      breakoutDistancePct: i.breakoutDistancePct,
      supportRelevance: i.supportZone.supportRelevance,
      obDetected: i.orderBlock.detected,
      rvol: i.impulse.rvol,
      lastUpdatedIst: i.lastUpdatedIst,
    })),
    safetyLocks: {
      STRATEGY_01: false,
      STRATEGY_02: false,
      STRATEGY_03: false,
      LIVE_TRADING: false,
      BROKER_EXECUTION_ENABLED: false,
      experimental_paper_trades: paperTradesCount ?? 0,
    },
  };

  const uiWatchlist = [
    ...items.filter((i) => i.status !== "WAIT"),
    ...items.filter((i) => i.status === "WAIT").slice(0, 30),
  ];
  fs.writeFileSync(path.join(P61019_DIR, "prebreakout_watchlist.json"), JSON.stringify(uiWatchlist, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "full_universe_4h_coverage.json"), JSON.stringify(coverageReport, null, 2));

  const md = [
    "# Phase 6.10.19.6 — Progressive NSE 4H Data Coverage Expansion",
    "",
    `- **Eligible Universe:** ${coverageReport.totalEligibleUniverse}`,
    `- **Successfully Cached:** ${coverageReport.successfullyCachedSymbols} (Newly cached: ${coverageReport.newlyCachedThisPhase})`,
    `- **Scanned (Sufficient 4H History):** ${coverageReport.scannedWithSufficient4hHistory} | **Missing/Insufficient:** ${coverageReport.stillMissingOrInsufficientData}`,
    `- **Failed Fetches:** ${coverageReport.failedFetchCount} (Retries: ${coverageReport.totalRetries})`,
    `- **Status Counts:** READY=${statusCounts.READY}, FORMING=${statusCounts.FORMING}, BREAKOUT=${statusCounts.BREAKOUT}, INVALIDATED=${statusCounts.INVALIDATED}, WAIT=${statusCounts.WAIT}`,
    `- **READY by Category:** SHORT_HIGH_QUALITY=${readyByCategory.SHORT_HIGH_QUALITY}, MEDIUM_CLEAN=${readyByCategory.MEDIUM_CLEAN}, LONG_CLEAN=${readyByCategory.LONG_CLEAN}, EXTENDED_BASE=${readyByCategory.EXTENDED_BASE}`,
    `- **Safety:** \`STRATEGY_01=false\`, \`STRATEGY_02=false\`, \`STRATEGY_03=false\`, \`LIVE_TRADING=false\`, \`BROKER_EXECUTION_ENABLED=false\`, \`experimental_paper_trades=${paperTradesCount ?? 0}\``,
  ].join("\n");
  fs.writeFileSync(path.join(OUT_DIR, "phase610196_report.md"), md);

  console.log("Phase 6.10.19.6 complete:", {
    totalEligibleUniverse: coverageReport.totalEligibleUniverse,
    successfullyCachedSymbols: coverageReport.successfullyCachedSymbols,
    newlyCachedThisPhase: coverageReport.newlyCachedThisPhase,
    scannedWithSufficient4hHistory: coverageReport.scannedWithSufficient4hHistory,
    failedFetchCount: coverageReport.failedFetchCount,
    totalRetries: coverageReport.totalRetries,
    statusCounts,
    readyByCategory,
    paperTrades: paperTradesCount ?? 0,
  });
}

if (process.argv[1]?.includes("runPhase610196_ProgressiveExpansion")) {
  main().catch((err) => {
    console.error("Phase 6.10.19.6 failed:", err);
    process.exit(1);
  });
}

