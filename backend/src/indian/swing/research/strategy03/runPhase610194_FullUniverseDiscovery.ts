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
const OUT_DIR = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase610194");

const STATUS_PRIORITY: Record<FourHourPreBreakoutStatus, number> = {
  READY: 0,
  FORMING: 1,
  BREAKOUT: 2,
  INVALIDATED: 3,
  WAIT: 4,
};

async function fetchYahoo1h(sym: string): Promise<{ ok: boolean; bars: OhlcvCandle[]; error?: string }> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym + ".NS")}?range=60d&interval=1h`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) return { ok: false, bars: [], error: `HTTP_${res.status}` };
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
    return { ok: bars.length > 0, bars, error: bars.length === 0 ? "EMPTY_OHLCV" : undefined };
  } catch (err) {
    return { ok: false, bars: [], error: err instanceof Error ? err.message : String(err) };
  }
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

  const excluded: Array<{ symbol: string; reason: string }> = [];
  const eligible: Array<{ sym: string; companyName: string; capCr: number }> = [];

  for (const r of univRows) {
    const sym = r.nse_symbol ? String(r.nse_symbol).trim().toUpperCase() : "";
    if (!sym) {
      excluded.push({ symbol: String(r.symbol ?? "UNKNOWN"), reason: "MISSING_NSE_SYMBOL" });
      continue;
    }
    if (r.series !== "EQ") {
      excluded.push({ symbol: sym, reason: `NON_EQ_SERIES_${r.series ?? "NULL"}` });
      continue;
    }
    if (r.listing_status !== "ACTIVE") {
      excluded.push({ symbol: sym, reason: `LISTING_STATUS_${r.listing_status ?? "NULL"}` });
      continue;
    }
    eligible.push({
      sym,
      companyName: r.company_name ?? sym,
      capCr: r.market_cap_cr !== null ? Number(r.market_cap_cr) : 0,
    });
  }

  // Sort eligible by market cap descending (largest liquid NSE equities first)
  eligible.sort((a, b) => b.capCr - a.capCr);

  // Fetch genuine 60d 1H -> build completed 4H session cache for top 350 uncached eligible equities
  const failedFetches: Array<{ symbol: string; error: string }> = [];
  const toFetch = eligible.filter((e) => !fs.existsSync(path.join(CACHE_4H, `${e.sym}_4h.json`))).slice(0, 350);

  for (let i = 0; i < toFetch.length; i += 25) {
    const batch = toFetch.slice(i, i + 25);
    await Promise.all(
      batch.map(async (e) => {
        const res = await fetchYahoo1h(e.sym);
        if (!res.ok) {
          failedFetches.push({ symbol: e.sym, error: res.error ?? "FETCH_FAILED" });
          return;
        }
        const bars4h = buildCompleted4hCandlesFromSessionBars(res.bars);
        if (bars4h.length > 0) {
          fs.writeFileSync(path.join(CACHE_4H, `${e.sym}_4h.json`), JSON.stringify(bars4h));
        }
      })
    );
  }

  // Run 4H-only scanner across ALL eligible symbols (uncached -> WAIT cleanly)
  const now = new Date("2026-11-18T12:25:00+05:30");
  const items: FourHourPreBreakoutItem[] = [];

  for (const e of eligible) {
    const candles4h = load4hCacheForSymbol(CACHE_4H, e.sym);
    const sourceRef = `backend/data/research/strategy03/phase61019/cache4h/${e.sym}_4h.json`;
    const item = evaluateFourHourPreBreakout({
      nseSymbol: e.sym,
      companyName: e.companyName,
      candles: candles4h,
      now,
      dataProvider: "NSE 4H Session Cache",
      sourceReference: sourceRef,
      config: DEFAULT_4H_SCANNER_CONFIG,
    });
    items.push(item);
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
  const readyByCategory: Record<ConsolidationDurationCategory, FourHourPreBreakoutItem[]> = {
    SHORT_HIGH_QUALITY: [],
    MEDIUM_CLEAN: [],
    LONG_CLEAN: [],
    EXTENDED_BASE: [],
    NONE: [],
  };
  let symbolsWith4hData = 0;

  for (const it of items) {
    statusCounts[it.status]++;
    if (!it.reason.startsWith("MISSING_OR_INSUFFICIENT_4H_DATA")) symbolsWith4hData++;
    if (it.status === "READY") {
      readyByCategory[it.consolidation.tier].push(it);
    }
  }

  const summary = {
    totalUniverseRows: univRows.length,
    excludedCount: excluded.length,
    eligibleCount: eligible.length,
    scannedWith4hDataCount: symbolsWith4hData,
    failedFetchCount: failedFetches.length,
    statusCounts,
    readyByCategoryCounts: {
      SHORT_HIGH_QUALITY: readyByCategory.SHORT_HIGH_QUALITY.length,
      MEDIUM_CLEAN: readyByCategory.MEDIUM_CLEAN.length,
      LONG_CLEAN: readyByCategory.LONG_CLEAN.length,
      EXTENDED_BASE: readyByCategory.EXTENDED_BASE.length,
    },
    anyShort3to4DayQualified: readyByCategory.SHORT_HIGH_QUALITY.length > 0,
    readyCandidates: items.filter((i) => i.status === "READY").map((i) => ({
      symbol: i.nseSymbol,
      companyName: i.companyName,
      priorityScore: i.priorityScore,
      tier: i.consolidation.tier,
      blocks4h: i.consolidation.candleCount,
      tradingDays: i.consolidation.tradingDaysElapsed,
      rangePct: i.consolidation.rangePct,
      breakoutDistancePct: i.breakoutDistancePct,
      supportRelevance: i.supportZone.supportRelevance,
      supportDistancePct: i.supportZone.supportDistancePct,
      obDetected: i.orderBlock.detected,
      verificationStatus: i.independentVerificationStatus,
      scoringReasons: i.scoringReasons,
    })),
    failedFetches: failedFetches.slice(0, 20),
    safetyLocks: {
      STRATEGY_01: false,
      STRATEGY_02: false,
      STRATEGY_03: false,
      LIVE_TRADING: false,
      BROKER_EXECUTION_ENABLED: false,
      experimental_paper_trades: paperTradesCount ?? 0,
    },
  };

  // Save top 200 items (all READY/FORMING/BREAKOUT/INVALIDATED + sample WAIT) to watchlist JSON
  const uiWatchlist = [
    ...items.filter((i) => i.status !== "WAIT"),
    ...items.filter((i) => i.status === "WAIT").slice(0, 30),
  ];
  fs.writeFileSync(path.join(P61019_DIR, "prebreakout_watchlist.json"), JSON.stringify(uiWatchlist, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "full_universe_discovery.json"), JSON.stringify(summary, null, 2));

  console.log("Phase 6.10.19.4 complete:", {
    totalUniverseRows: summary.totalUniverseRows,
    excludedCount: summary.excludedCount,
    eligibleCount: summary.eligibleCount,
    scannedWith4hDataCount: summary.scannedWith4hDataCount,
    failedFetchCount: summary.failedFetchCount,
    statusCounts: summary.statusCounts,
    readyByCategoryCounts: summary.readyByCategoryCounts,
    anyShort3to4DayQualified: summary.anyShort3to4DayQualified,
    topReady: summary.readyCandidates.slice(0, 15).map((r) => `${r.symbol}(${r.priorityScore},${r.tier},${r.blocks4h}B)`),
    paperTrades: paperTradesCount ?? 0,
  });
}

if (process.argv[1]?.includes("runPhase610194_FullUniverseDiscovery")) {
  main().catch((err) => {
    console.error("Phase 6.10.19.4 failed:", err);
    process.exit(1);
  });
}

