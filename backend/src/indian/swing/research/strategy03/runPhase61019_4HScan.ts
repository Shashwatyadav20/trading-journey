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
  type FourHourPreBreakoutItem,
  type FourHourPreBreakoutStatus,
} from "./prebreakout/Strategy03FourHourPreBreakoutScanner.js";
import { loadAllRowsPaginated } from "./Strategy03ShadowRunner.js";

config({ path: path.resolve("D:/Trading/my-app/backend/.env") });

const OUT_DIR = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase61019");
const CACHE_4H = path.join(OUT_DIR, "cache4h");
const P6108_CACHE = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase6108/cache");

const STATUS_PRIORITY: Record<FourHourPreBreakoutStatus, number> = {
  READY: 0,
  FORMING: 1,
  BREAKOUT: 2,
  INVALIDATED: 3,
  WAIT: 4,
};

async function main() {
  fs.mkdirSync(CACHE_4H, { recursive: true });
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const finRows = await loadAllRowsPaginated(sb, "strategy03_financial_facts", "symbol,verification_status");
  const univRows = await loadAllRowsPaginated(sb, "market_universe_equities", "nse_symbol,company_name");
  const { count: paperTradesCount } = await sb
    .from("experimental_paper_trades")
    .select("*", { count: "exact", head: true });

  const nameBySym = new Map<string, string>();
  for (const u of univRows) {
    if (u.nse_symbol) nameBySym.set(String(u.nse_symbol).toUpperCase(), u.company_name ?? String(u.nse_symbol));
  }

  const verifiedSyms = [
    ...new Set(finRows.filter((r: any) => r.verification_status === "VERIFIED").map((r: any) => String(r.symbol))),
  ];

  // Step 1: Build dedicated 4H NSE session cache for symbols with raw session data
  for (const sym of verifiedSyms) {
    const rawPath = path.join(P6108_CACHE, `${sym}_1h_730d.json`);
    if (fs.existsSync(rawPath)) {
      const raw1h = JSON.parse(fs.readFileSync(rawPath, "utf8")) as OhlcvCandle[];
      const bars4h = buildCompleted4hCandlesFromSessionBars(raw1h);
      fs.writeFileSync(path.join(CACHE_4H, `${sym}_4h.json`), JSON.stringify(bars4h));
    }
  }

  // Step 2: Run Strategy 03 Swing Pre-Breakout Scanner EXCLUSIVELY on 4H cache (never 1H fallback)
  const items: FourHourPreBreakoutItem[] = [];
  const now = new Date("2026-11-18T11:09:17+05:30");

  for (const sym of verifiedSyms) {
    const candles4h = load4hCacheForSymbol(CACHE_4H, sym);
    const sourceRef = `backend/data/research/strategy03/phase61019/cache4h/${sym}_4h.json`;
    const item = evaluateFourHourPreBreakout({
      nseSymbol: sym,
      companyName: nameBySym.get(sym) ?? sym,
      candles: candles4h,
      now,
      dataProvider: "NSE 4H Session Cache (AM/PM Completed Blocks)",
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

  const counts: Record<FourHourPreBreakoutStatus, number> = {
    READY: 0,
    FORMING: 0,
    BREAKOUT: 0,
    INVALIDATED: 0,
    WAIT: 0,
  };
  for (const it of items) counts[it.status]++;

  const summary = {
    timeframe: "4H_ONLY",
    oneHourExcludedFromSwing: true,
    symbolsScanned: items.length,
    counts,
    config: DEFAULT_4H_SCANNER_CONFIG,
    readyStocks: items.filter((i) => i.status === "READY"),
    safetyLocks: {
      STRATEGY_01: false,
      STRATEGY_02: false,
      STRATEGY_03: false,
      LIVE_TRADING: false,
      BROKER_EXECUTION_ENABLED: false,
      experimental_paper_trades: paperTradesCount ?? 0,
    },
  };

  fs.writeFileSync(path.join(OUT_DIR, "prebreakout_watchlist.json"), JSON.stringify(items, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "prebreakout_4h_summary.json"), JSON.stringify(summary, null, 2));

  console.log("Phase 6.10.19 4H scan complete:", {
    symbolsScanned: items.length,
    counts,
    topReady: items.filter((i) => i.status === "READY").map((i) => ({
      sym: i.nseSymbol,
      score: i.priorityScore,
      dist: i.breakoutDistancePct,
      tier: i.consolidation.tier,
    })),
    paperTrades: paperTradesCount ?? 0,
  });
}

if (process.argv[1]?.includes("runPhase61019_4HScan")) {
  main().catch((err) => {
    console.error("Phase 6.10.19 4H scan failed:", err);
    process.exit(1);
  });
}

