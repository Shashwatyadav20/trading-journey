import fs from "node:fs";
import path from "node:path";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import type { OhlcvCandle } from "./entry/EntrySetupTypes.js";
import { sanitizeIntraday1hSeries } from "./momentum/Strategy03IntradayEventEvaluator.js";
import { DEFAULT_PREBREAKOUT_CONFIG } from "./prebreakout/Strategy03PreBreakoutConfig.js";
import {
  evaluatePreBreakoutSetup,
  type PreBreakoutSetupItem,
  type PreBreakoutStatus,
} from "./prebreakout/Strategy03PreBreakoutDetector.js";
import { loadAllRowsPaginated } from "./Strategy03ShadowRunner.js";

config({ path: path.resolve("D:/Trading/my-app/backend/.env") });

const OUT_DIR = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase61019");
const P6108_CACHE = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase6108/cache");

const STATUS_PRIORITY: Record<PreBreakoutStatus, number> = {
  READY: 0,
  FORMING: 1,
  BREAKOUT: 2,
  INVALIDATED: 3,
  WAIT: 4,
};

function loadCached1h(sym: string): OhlcvCandle[] {
  const p = path.join(P6108_CACHE, `${sym}_1h_730d.json`);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : [];
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
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

  // Include RELIANCE if user requested checking historical examples (never fabricate if missing)
  const scanSyms = verifiedSyms.includes("RELIANCE") ? verifiedSyms : [...verifiedSyms, "RELIANCE"];

  const seenKeys = new Set<string>();
  const items: PreBreakoutSetupItem[] = [];
  let duplicatesPrevented = 0;

  for (const sym of scanSyms) {
    const raw1h = loadCached1h(sym);
    const { candles } = sanitizeIntraday1hSeries(raw1h);
    const sourceRef = `backend/data/research/strategy03/phase6108/cache/${sym}_1h_730d.json`;
    const setup = evaluatePreBreakoutSetup({
      nseSymbol: sym,
      companyName: nameBySym.get(sym) ?? sym,
      completedCandles: candles,
      dataProvider: "Yahoo Finance 1H Cache",
      sourceReference: sourceRef,
      config: DEFAULT_PREBREAKOUT_CONFIG,
    });

    if (seenKeys.has(setup.idempotencyKey)) {
      duplicatesPrevented++;
      continue;
    }
    seenKeys.add(setup.idempotencyKey);
    items.push(setup);
  }

  items.sort((a, b) => {
    const pDiff = STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status];
    if (pDiff !== 0) return pDiff;
    return (a.breakoutDistancePct ?? 999) - (b.breakoutDistancePct ?? 999);
  });

  const counts: Record<PreBreakoutStatus, number> = {
    READY: 0,
    FORMING: 0,
    BREAKOUT: 0,
    INVALIDATED: 0,
    WAIT: 0,
  };
  for (const it of items) counts[it.status]++;

  const summary = {
    symbolsScanned: items.length,
    counts,
    duplicatesPrevented,
    config: DEFAULT_PREBREAKOUT_CONFIG,
    readyStocks: items.filter((i) => i.status === "READY").map((i) => ({
      symbol: i.nseSymbol,
      companyName: i.companyName,
      currentPrice: i.currentPrice,
      consolidationHigh: i.consolidationHigh,
      consolidationLow: i.consolidationLow,
      obHigh: i.obHigh,
      obLow: i.obLow,
      breakoutDistancePct: i.breakoutDistancePct,
      structureEvidence: i.structureEvidence,
      reason: i.reason,
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

  fs.writeFileSync(path.join(OUT_DIR, "prebreakout_watchlist.json"), JSON.stringify(items, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "prebreakout_scan_summary.json"), JSON.stringify(summary, null, 2));

  const md = [
    "# Phase 6.10.19 — High-Quality Pre-Breakout Stock Detection",
    "",
    `- **Symbols Scanned:** ${items.length} | **Duplicates Prevented:** ${duplicatesPrevented}`,
    `- **Status Counts:** READY=${counts.READY}, FORMING=${counts.FORMING}, BREAKOUT=${counts.BREAKOUT}, INVALIDATED=${counts.INVALIDATED}, WAIT=${counts.WAIT}`,
    `- **Safety:** \`STRATEGY_01=false\`, \`STRATEGY_02=false\`, \`STRATEGY_03=false\`, \`LIVE_TRADING=false\`, \`BROKER_EXECUTION_ENABLED=false\`, \`experimental_paper_trades=${paperTradesCount ?? 0}\``,
  ].join("\n");
  fs.writeFileSync(path.join(OUT_DIR, "phase61019_final_report.md"), md);

  console.log("Phase 6.10.19 complete:", {
    symbolsScanned: items.length,
    counts,
    duplicatesPrevented,
    readyCount: summary.readyStocks.length,
    paperTrades: paperTradesCount ?? 0,
  });
}

if (process.argv[1]?.includes("runPhase61019PreBreakoutScan")) {
  main().catch((err) => {
    console.error("Phase 6.10.19 failed:", err);
    process.exit(1);
  });
}

