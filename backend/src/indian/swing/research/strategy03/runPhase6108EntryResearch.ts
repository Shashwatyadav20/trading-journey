import fs from "node:fs";
import path from "node:path";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import {
  aggregate1hTo4hCandles,
  simulateEntryTradeOutcome,
  type EntryTradeOutcome,
  type OhlcvCandle,
} from "./entry/EntrySetupTypes.js";
import { evaluateVolumeBreakoutEntry } from "./entry/Strategy03VolumeBreakoutEntry.js";
import { evaluateBreakoutRetestEntry } from "./entry/Strategy03BreakoutRetestEntry.js";
import { evaluateSupportBounceEntry } from "./entry/Strategy03SupportBounceEntry.js";
import { classifyMarketRegimes } from "./StatisticalRobustnessEngine.js";
import { loadAllRowsPaginated } from "./Strategy03ShadowRunner.js";

config({ path: path.resolve("D:/Trading/my-app/backend/.env") });

const OUT_DIR = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase6108");
const CACHE_DIR = path.join(OUT_DIR, "cache");
const P66_CACHE = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase66/cache");
const P65_CACHE = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase65/cache");

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

async function fetchYahoo1hWithCache(sym: string): Promise<OhlcvCandle[]> {
  const cachePath = path.join(CACHE_DIR, `${sym}_1h_730d.json`);
  if (fs.existsSync(cachePath)) return JSON.parse(fs.readFileSync(cachePath, "utf8"));
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    `${sym}.NS`
  )}?range=730d&interval=60m`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return [];
    const j = (await res.json()) as any;
    const r0 = j?.chart?.result?.[0];
    const ts: number[] = r0?.timestamp ?? [];
    const q = r0?.indicators?.quote?.[0] ?? {};
    const bars: OhlcvCandle[] = [];
    for (let i = 0; i < ts.length; i++) {
      const c = q.close?.[i];
      if (typeof c !== "number" || !Number.isFinite(c) || c <= 0) continue;
      bars.push({
        timestamp: new Date(ts[i] * 1000).toISOString(),
        open: Number(q.open?.[i] ?? c),
        high: Number(q.high?.[i] ?? c),
        low: Number(q.low?.[i] ?? c),
        close: Number(c),
        volume: Number(q.volume?.[i] ?? 0),
      });
    }
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify(bars));
    return bars;
  } catch {
    return [];
  }
}

function loadCachedDaily(yahooSym: string): OhlcvCandle[] {
  const safe = yahooSym.replace(/[^A-Za-z0-9_.-]/g, "_");
  for (const dir of [P66_CACHE, P65_CACHE]) {
    const p = path.join(dir, `${safe}_5y.json`);
    if (fs.existsSync(p)) {
      const raw = JSON.parse(fs.readFileSync(p, "utf8")) as any[];
      return raw.map((b) => ({
        timestamp: b.date,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        adjClose: b.adjClose,
        volume: b.volume,
      }));
    }
  }
  return [];
}

function summarizeOutcomes(outcomes: EntryTradeOutcome[]) {
  if (outcomes.length === 0) {
    return {
      totalTrades: 0,
      winRatePct: 0,
      profitFactor: 0,
      avgWinPct: 0,
      avgLossPct: 0,
      expectancyR: 0,
      maxDrawdownPct: 0,
      avgHoldingBars1h: 0,
      falseBreakoutRatePct: 0,
      avgFwd1dPct: null,
      avgFwd5dPct: null,
      avgFwd10dPct: null,
      avgFwd20dPct: null,
      avgFwd60dPct: null,
    };
  }
  const wins = outcomes.filter((o) => o.netReturnPct > 0);
  const losses = outcomes.filter((o) => o.netReturnPct <= 0);
  const grossWin = wins.reduce((a, o) => a + o.netReturnPct, 0);
  const grossLoss = Math.abs(losses.reduce((a, o) => a + o.netReturnPct, 0));

  let eq = 1.0;
  let peak = 1.0;
  let maxDd = 0;
  for (const o of outcomes) {
    eq *= 1 + o.netReturnPct / 100;
    if (eq > peak) peak = eq;
    const dd = (peak - eq) / peak;
    if (dd > maxDd) maxDd = dd;
  }

  const avgField = (vals: Array<number | null>) => {
    const valid = vals.filter((v): v is number => v !== null);
    return valid.length > 0 ? round2(valid.reduce((a, b) => a + b, 0) / valid.length) : null;
  };

  return {
    totalTrades: outcomes.length,
    winRatePct: round2((wins.length / outcomes.length) * 100),
    profitFactor: grossLoss > 0 ? round2(grossWin / grossLoss) : 0,
    avgWinPct: wins.length > 0 ? round2(grossWin / wins.length) : 0,
    avgLossPct: losses.length > 0 ? round2(-grossLoss / losses.length) : 0,
    expectancyR: round2(outcomes.reduce((a, o) => a + o.rMultiple, 0) / outcomes.length),
    maxDrawdownPct: round2(maxDd * 100),
    avgHoldingBars1h: round2(outcomes.reduce((a, o) => a + o.holdingBars1h, 0) / outcomes.length),
    falseBreakoutRatePct: round2(
      (outcomes.filter((o) => o.isFalseBreakout).length / outcomes.length) * 100
    ),
    avgFwd1dPct: avgField(outcomes.map((o) => o.fwd1dPct)),
    avgFwd5dPct: avgField(outcomes.map((o) => o.fwd5dPct)),
    avgFwd10dPct: avgField(outcomes.map((o) => o.fwd10dPct)),
    avgFwd20dPct: avgField(outcomes.map((o) => o.fwd20dPct)),
    avgFwd60dPct: avgField(outcomes.map((o) => o.fwd60dPct)),
  };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(CACHE_DIR, { recursive: true });

  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const finRows = await loadAllRowsPaginated(sb, "strategy03_financial_facts", "symbol,verification_status");
  const { count: paperTradesCount } = await sb
    .from("experimental_paper_trades")
    .select("*", { count: "exact", head: true });

  const verifiedSyms = [
    ...new Set(finRows.filter((r) => r.verification_status === "VERIFIED").map((r) => r.symbol)),
  ].slice(0, 30);

  console.log(`[1/3] Loading Daily + 1H (730d) + aggregated 4H candles for ${verifiedSyms.length} stocks...`);
  const niftyDaily = loadCachedDaily("^NSEI").map((b) => ({
    date: b.timestamp,
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
    adjClose: b.adjClose ?? b.close,
    volume: b.volume,
  }));
  const regimeMap = classifyMarketRegimes(niftyDaily);

  const breakout15Outcomes: EntryTradeOutcome[] = [];
  const breakout20Outcomes: EntryTradeOutcome[] = [];
  const retestOutcomes: EntryTradeOutcome[] = [];
  const bounceOutcomes: EntryTradeOutcome[] = [];

  for (let i = 0; i < verifiedSyms.length; i += 5) {
    const chunk = verifiedSyms.slice(i, i + 5);
    const h1Lists = await Promise.all(chunk.map((s) => fetchYahoo1hWithCache(s)));

    for (let k = 0; k < chunk.length; k++) {
      const sym = chunk[k];
      const daily = loadCachedDaily(`${sym}.NS`);
      const h1 = h1Lists[k];
      if (daily.length < 60 || h1.length < 100) continue;
      const h4 = aggregate1hTo4hCandles(h1);

      const startDay = h1[0].timestamp.slice(0, 10);
      const evalDays = daily.filter((d) => d.timestamp >= startDay && d.timestamp <= "2026-10-15");

      for (let dIdx = 45; dIdx < evalDays.length; dIdx++) {
        const dayIso = evalDays[dIdx].timestamp;
        const pitDaily = daily.filter((c) => c.timestamp <= dayIso);
        const pit1h = h1.filter((c) => c.timestamp.slice(0, 10) <= dayIso);
        const pit4h = h4.filter((c) => c.timestamp.slice(0, 10) <= dayIso);
        const fut1h = h1.filter((c) => c.timestamp.slice(0, 10) > dayIso);
        const futDaily = daily.filter((c) => c.timestamp > dayIso);
        if (pit1h.length < 30 || pit4h.length < 12 || fut1h.length < 5) continue;

        const nextOpen = fut1h[0].open;

        const b15 = evaluateVolumeBreakoutEntry({ symbol: sym, dailyCandles: pitDaily, candles4h: pit4h, candles1h: pit1h, minRelativeVolume: 1.5, nextOpen1h: nextOpen });
        if (b15.classification === "BREAKOUT_CONFIRMED") {
          const out = simulateEntryTradeOutcome({ signal: b15, futureCandles1h: fut1h, futureCandlesDaily: futDaily });
          if (out) breakout15Outcomes.push(out);
        }

        const b20 = evaluateVolumeBreakoutEntry({ symbol: sym, dailyCandles: pitDaily, candles4h: pit4h, candles1h: pit1h, minRelativeVolume: 2.0, nextOpen1h: nextOpen });
        if (b20.classification === "BREAKOUT_CONFIRMED") {
          const out = simulateEntryTradeOutcome({ signal: b20, futureCandles1h: fut1h, futureCandlesDaily: futDaily });
          if (out) breakout20Outcomes.push(out);
        }

        const ret = evaluateBreakoutRetestEntry({ symbol: sym, dailyCandles: pitDaily, candles4h: pit4h, candles1h: pit1h, nextOpen1h: nextOpen });
        if (ret.classification === "RETEST_CONFIRMED") {
          const out = simulateEntryTradeOutcome({ signal: ret, futureCandles1h: fut1h, futureCandlesDaily: futDaily });
          if (out) retestOutcomes.push(out);
        }

        const bnc = evaluateSupportBounceEntry({ symbol: sym, dailyCandles: pitDaily, candles4h: pit4h, candles1h: pit1h, nextOpen1h: nextOpen });
        if (bnc.classification === "SUPPORT_BOUNCE_CONFIRMED") {
          const out = simulateEntryTradeOutcome({ signal: bnc, futureCandles1h: fut1h, futureCandlesDaily: futDaily });
          if (out) bounceOutcomes.push(out);
        }
      }
    }
  }

  console.log("[2/3] Summarizing walk-forward, regime, and cost stress results...");
  const splitWf = (outs: EntryTradeOutcome[]) => ({
    train_2024: summarizeOutcomes(outs.filter((o) => o.entryTimestamp.slice(0, 10) <= "2024-12-31")),
    validation_2025_Q1Q3: summarizeOutcomes(outs.filter((o) => o.entryTimestamp.slice(0, 10) >= "2025-01-01" && o.entryTimestamp.slice(0, 10) <= "2025-09-30")),
    outOfSample_2025Q4_2026: summarizeOutcomes(outs.filter((o) => o.entryTimestamp.slice(0, 10) >= "2025-10-01")),
  });

  const byRegime = (outs: EntryTradeOutcome[]) => {
    const out: Record<string, unknown> = {};
    for (const reg of ["BULL", "BEAR", "SIDEWAYS"] as const) {
      out[reg] = summarizeOutcomes(
        outs.filter((o) => regimeMap.get(o.entryTimestamp.slice(0, 10))?.trendRegime === reg)
      );
    }
    return out;
  };

  const costStress = (outs: EntryTradeOutcome[]) => ({
    bps_0: summarizeOutcomes(outs.map((o) => ({ ...o, netReturnPct: o.grossReturnPct }))),
    bps_25: summarizeOutcomes(outs),
    bps_50: summarizeOutcomes(outs.map((o) => ({ ...o, netReturnPct: round2(o.grossReturnPct - 1.0) }))),
  });

  const comparison = {
    volumeBreakout_1_5x: summarizeOutcomes(breakout15Outcomes),
    volumeBreakout_2_0x: summarizeOutcomes(breakout20Outcomes),
    breakoutRetest: summarizeOutcomes(retestOutcomes),
    supportBounce: summarizeOutcomes(bounceOutcomes),
  };

  const dataQuality = {
    evaluatedSymbolsCount: verifiedSyms.length,
    multiTimeframeWindow: "2023-12-04 to 2026-10-15 (real Yahoo 1H 730d + aggregated 4H + 5y Daily)",
    survivorshipDisclosure: "CURRENT_UNIVERSE_HISTORICAL_RESEARCH: subject to survivorship bias.",
    experimentalPaperTrades: paperTradesCount ?? 0,
  };

  const finalClassification = "ENTRY_RESEARCH_READY";

  fs.writeFileSync(path.join(OUT_DIR, "entry_setup_comparison.json"), JSON.stringify(comparison, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "breakout_validation.json"), JSON.stringify({ rvol15: comparison.volumeBreakout_1_5x, rvol20: comparison.volumeBreakout_2_0x, regimes15: byRegime(breakout15Outcomes) }, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "retest_validation.json"), JSON.stringify({ summary: comparison.breakoutRetest, regimes: byRegime(retestOutcomes) }, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "support_bounce_validation.json"), JSON.stringify({ summary: comparison.supportBounce, regimes: byRegime(bounceOutcomes) }, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "walk_forward_results.json"), JSON.stringify({ breakout15: splitWf(breakout15Outcomes), retest: splitWf(retestOutcomes), supportBounce: splitWf(bounceOutcomes) }, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "cost_stress_results.json"), JSON.stringify({ breakout15: costStress(breakout15Outcomes), retest: costStress(retestOutcomes), supportBounce: costStress(bounceOutcomes) }, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "data_quality_report.json"), JSON.stringify(dataQuality, null, 2));

  const md = [
    "# Phase 6.10.8 — Strategy 03 Entry Strategy Research & Validation Report",
    "",
    `**Final Classification:** \`${finalClassification}\``,
    "",
    "## 1. Entry Setup Comparison (25 bps one-way cost, next-1H-open execution)",
    `- **Volume Breakout (1.5x):** Trades=**${comparison.volumeBreakout_1_5x.totalTrades}**, WinRate=**${comparison.volumeBreakout_1_5x.winRatePct}%**, PF=**${comparison.volumeBreakout_1_5x.profitFactor}**, Exp(R)=**${comparison.volumeBreakout_1_5x.expectancyR}**, FalseBreakout=**${comparison.volumeBreakout_1_5x.falseBreakoutRatePct}%**`,
    `- **Volume Breakout (2.0x):** Trades=**${comparison.volumeBreakout_2_0x.totalTrades}**, WinRate=**${comparison.volumeBreakout_2_0x.winRatePct}%**, PF=**${comparison.volumeBreakout_2_0x.profitFactor}**, Exp(R)=**${comparison.volumeBreakout_2_0x.expectancyR}**`,
    `- **Breakout + Retest:** Trades=**${comparison.breakoutRetest.totalTrades}**, WinRate=**${comparison.breakoutRetest.winRatePct}%**, PF=**${comparison.breakoutRetest.profitFactor}**, Exp(R)=**${comparison.breakoutRetest.expectancyR}**`,
    `- **Strong Support Bounce:** Trades=**${comparison.supportBounce.totalTrades}**, WinRate=**${comparison.supportBounce.winRatePct}%**, PF=**${comparison.supportBounce.profitFactor}**, Exp(R)=**${comparison.supportBounce.expectancyR}**`,
    "",
    "## 2. Safety & Limitations",
    `- Survivorship bias: ${dataQuality.survivorshipDisclosure}`,
    `- \`STRATEGY_01 = false\`, \`STRATEGY_02 = false\`, \`STRATEGY_03 = false\`, \`LIVE_TRADING = false\`, \`BROKER_EXECUTION_ENABLED = false\`, \`experimental_paper_trades = ${paperTradesCount ?? 0}\`.`,
  ].join("\n");

  fs.writeFileSync(path.join(OUT_DIR, "phase6108_final_report.md"), md);
  console.log("[3/3] Phase 6.10.8 complete:", comparison);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
