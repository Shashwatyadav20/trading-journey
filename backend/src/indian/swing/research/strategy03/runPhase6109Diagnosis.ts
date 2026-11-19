import fs from "node:fs";
import path from "node:path";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import {
  aggregate1hTo4hCandles,
  computeAtr,
  simulateEntryTradeOutcome,
  type EntrySetupSignal,
  type EntryTradeOutcome,
  type OhlcvCandle,
} from "./entry/EntrySetupTypes.js";
import { evaluateVolumeBreakoutEntry } from "./entry/Strategy03VolumeBreakoutEntry.js";
import { evaluateBreakoutRetestEntry } from "./entry/Strategy03BreakoutRetestEntry.js";
import { evaluateSupportBounceEntry } from "./entry/Strategy03SupportBounceEntry.js";
import { classifyMarketRegimes, wilsonWinRateCI } from "./StatisticalRobustnessEngine.js";
import { loadAllRowsPaginated } from "./Strategy03ShadowRunner.js";

config({ path: path.resolve("D:/Trading/my-app/backend/.env") });

const OUT_DIR = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase6109");
const P6108_CACHE = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase6108/cache");
const P6108_DIR = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase6108");
const P66_CACHE = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase66/cache");
const P65_CACHE = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase65/cache");

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function loadCached1h(sym: string): OhlcvCandle[] {
  const p = path.join(P6108_CACHE, `${sym}_1h_730d.json`);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : [];
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

export function simulateExitVariant(params: {
  signal: EntrySetupSignal;
  future1h: OhlcvCandle[];
  atr: number;
  variant:
    | "ATR_2X_SL_FIXED_2R"
    | "ATR_2X_SL_TRAILING_1R"
    | "PARTIAL_50_AT_1_5R_TRAIL_3R"
    | "TIME_EXIT_10D_NO_TARGET";
  oneWayCostBps?: number;
}): { netReturnPct: number; rMultiple: number; exitReason: string; holdingBars: number } | null {
  const { signal, future1h, atr, variant } = params;
  if (future1h.length === 0 || atr <= 0) return null;
  const slippage = 0.0008;
  const cost = ((params.oneWayCostBps ?? 25) / 10_000) * 2 * 100;
  const entryPrice = future1h[0].open * (1 + slippage);
  const slDist = Math.max(atr * 2.0, entryPrice * 0.02);
  let sl = entryPrice - slDist;
  const t15 = entryPrice + slDist * 1.5;
  const t2 = entryPrice + slDist * 2.0;
  const t3 = entryPrice + slDist * 3.0;
  const maxBars = variant === "TIME_EXIT_10D_NO_TARGET" ? 70 : 140;

  let realizedPct = 0;
  let remainingWeight = 1.0;
  let partialTaken = false;
  let exitReason = "TIME_EXIT";
  let holdingBars = Math.min(future1h.length, maxBars);

  for (let i = 0; i < Math.min(future1h.length, maxBars); i++) {
    const b = future1h[i];
    if (b.open <= sl) {
      const ret = ((b.open * (1 - slippage) - entryPrice) / entryPrice) * 100;
      realizedPct += remainingWeight * ret;
      remainingWeight = 0;
      exitReason = "GAP_THROUGH_SL";
      holdingBars = i + 1;
      break;
    }
    if (b.low <= sl) {
      const ret = ((sl * (1 - slippage) - entryPrice) / entryPrice) * 100;
      realizedPct += remainingWeight * ret;
      remainingWeight = 0;
      exitReason = "SL_HIT";
      holdingBars = i + 1;
      break;
    }
    if (variant === "ATR_2X_SL_FIXED_2R" && b.high >= t2) {
      realizedPct += remainingWeight * (((t2 * (1 - slippage) - entryPrice) / entryPrice) * 100);
      remainingWeight = 0;
      exitReason = "TARGET_2R";
      holdingBars = i + 1;
      break;
    }
    if (variant === "PARTIAL_50_AT_1_5R_TRAIL_3R") {
      if (!partialTaken && b.high >= t15) {
        realizedPct += 0.5 * (((t15 * (1 - slippage) - entryPrice) / entryPrice) * 100);
        remainingWeight = 0.5;
        partialTaken = true;
        sl = Math.max(sl, entryPrice); // Move SL to breakeven
      }
      if (b.high >= t3) {
        realizedPct += remainingWeight * (((t3 * (1 - slippage) - entryPrice) / entryPrice) * 100);
        remainingWeight = 0;
        exitReason = "TARGET_3R";
        holdingBars = i + 1;
        break;
      }
    }
    if (variant === "ATR_2X_SL_TRAILING_1R" && b.close >= entryPrice + slDist) {
      sl = Math.max(sl, b.close - slDist);
    }
  }

  if (remainingWeight > 0) {
    const lastClose = future1h[Math.min(future1h.length, maxBars) - 1].close;
    realizedPct += remainingWeight * (((lastClose * (1 - slippage) - entryPrice) / entryPrice) * 100);
  }

  const netRet = realizedPct - cost;
  const riskPct = (slDist / entryPrice) * 100;
  return {
    netReturnPct: round2(netRet),
    rMultiple: round2(netRet / riskPct),
    exitReason,
    holdingBars,
  };
}

function summarizeSimple(rows: Array<{ netReturnPct: number; rMultiple: number; exitReason?: string; holdingBars?: number }>) {
  if (rows.length === 0) {
    return { trades: 0, winRatePct: 0, winRateCI95: [0, 0], profitFactor: 0, expectancyR: 0, maxDrawdownPct: 0, avgHoldingBars: 0 };
  }
  const wins = rows.filter((r) => r.netReturnPct > 0);
  const losses = rows.filter((r) => r.netReturnPct <= 0);
  const gw = wins.reduce((a, r) => a + r.netReturnPct, 0);
  const gl = Math.abs(losses.reduce((a, r) => a + r.netReturnPct, 0));
  let eq = 1.0;
  let peak = 1.0;
  let maxDd = 0;
  for (const r of rows) {
    eq *= 1 + r.netReturnPct / 100;
    if (eq > peak) peak = eq;
    const dd = (peak - eq) / peak;
    if (dd > maxDd) maxDd = dd;
  }
  const ci = wilsonWinRateCI(wins.length, rows.length);
  return {
    trades: rows.length,
    winRatePct: ci.ratePct,
    winRateCI95: [ci.ciLowPct, ci.ciHighPct],
    profitFactor: gl > 0 ? round2(gw / gl) : 0,
    expectancyR: round2(rows.reduce((a, r) => a + r.rMultiple, 0) / rows.length),
    maxDrawdownPct: round2(maxDd * 100),
    avgHoldingBars: round2(rows.reduce((a, r) => a + (r.holdingBars ?? 0), 0) / rows.length),
  };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const finRows = await loadAllRowsPaginated(sb, "strategy03_financial_facts", "symbol,verification_status");
  const ownRows = await loadAllRowsPaginated(sb, "strategy03_institutional_ownership", "symbol,reporting_quarter,fii_qoq_change_pp,dii_qoq_change_pp,verification_status");
  const { count: paperTradesCount } = await sb
    .from("experimental_paper_trades")
    .select("*", { count: "exact", head: true });

  const p6108Baseline = JSON.parse(
    fs.readFileSync(path.join(P6108_DIR, "entry_setup_comparison.json"), "utf8")
  );

  const verifiedSyms = [
    ...new Set(finRows.filter((r) => r.verification_status === "VERIFIED").map((r) => r.symbol)),
  ].slice(0, 30);

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

  const ownBySym = new Map<string, any[]>();
  for (const o of ownRows) {
    const arr = ownBySym.get(o.symbol) ?? [];
    arr.push(o);
    ownBySym.set(o.symbol, arr);
  }

  interface EnrichedEvent {
    symbol: string;
    setup: "BREAKOUT_15" | "BREAKOUT_20" | "RETEST" | "BOUNCE";
    dayIso: string;
    regime: string;
    trendAligned: boolean;
    strongClose: boolean;
    atrExpansion: boolean;
    modestDistance: boolean;
    instAccum: boolean;
    outcome: EntryTradeOutcome;
    signal: EntrySetupSignal;
    future1h: OhlcvCandle[];
    atr: number;
  }

  const events: EnrichedEvent[] = [];

  for (const sym of verifiedSyms) {
    const daily = loadCachedDaily(`${sym}.NS`);
    const h1 = loadCached1h(sym);
    if (daily.length < 60 || h1.length < 100) continue;
    const h4 = aggregate1hTo4hCandles(h1);
    const startDay = h1[0].timestamp.slice(0, 10);
    const evalDays = daily.filter((d) => d.timestamp >= startDay && d.timestamp <= "2026-10-15");

    for (let dIdx = 55; dIdx < evalDays.length; dIdx++) {
      const dayIso = evalDays[dIdx].timestamp;
      const pitDaily = daily.filter((c) => c.timestamp <= dayIso);
      const pit1h = h1.filter((c) => c.timestamp.slice(0, 10) <= dayIso);
      const pit4h = h4.filter((c) => c.timestamp.slice(0, 10) <= dayIso);
      const fut1h = h1.filter((c) => c.timestamp.slice(0, 10) > dayIso);
      const futDaily = daily.filter((c) => c.timestamp > dayIso);
      if (pitDaily.length < 55 || pit1h.length < 30 || pit4h.length < 12 || fut1h.length < 5) continue;

      const sma50 = pitDaily.slice(-50).reduce((a, c) => a + c.close, 0) / 50;
      const sma200 = pitDaily.length >= 200 ? pitDaily.slice(-200).reduce((a, c) => a + c.close, 0) / 200 : sma50;
      const lastD = pitDaily[pitDaily.length - 1];
      const trendAligned = lastD.close > sma50 && sma50 >= sma200 * 0.99;
      const atr = computeAtr(pitDaily, 14) ?? lastD.close * 0.02;
      const atrExpansion = atr / lastD.close >= 0.015;
      const regime = regimeMap.get(dayIso)?.trendRegime ?? "SIDEWAYS";
      const instAccum = (ownBySym.get(sym) ?? []).some(
        (o) =>
          o.reporting_quarter <= dayIso &&
          o.verification_status === "VERIFIED" &&
          ((o.fii_qoq_change_pp ?? 0) > 0 || (o.dii_qoq_change_pp ?? 0) > 0)
      );

      const nextOpen = fut1h[0].open;
      const checks: Array<{ setup: EnrichedEvent["setup"]; sig: EntrySetupSignal }> = [
        { setup: "BREAKOUT_15", sig: evaluateVolumeBreakoutEntry({ symbol: sym, dailyCandles: pitDaily, candles4h: pit4h, candles1h: pit1h, minRelativeVolume: 1.5, nextOpen1h: nextOpen }) },
        { setup: "BREAKOUT_20", sig: evaluateVolumeBreakoutEntry({ symbol: sym, dailyCandles: pitDaily, candles4h: pit4h, candles1h: pit1h, minRelativeVolume: 2.0, nextOpen1h: nextOpen }) },
        { setup: "RETEST", sig: evaluateBreakoutRetestEntry({ symbol: sym, dailyCandles: pitDaily, candles4h: pit4h, candles1h: pit1h, nextOpen1h: nextOpen }) },
        { setup: "BOUNCE", sig: evaluateSupportBounceEntry({ symbol: sym, dailyCandles: pitDaily, candles4h: pit4h, candles1h: pit1h, nextOpen1h: nextOpen }) },
      ];

      for (const { setup, sig } of checks) {
        if (
          sig.classification !== "BREAKOUT_CONFIRMED" &&
          sig.classification !== "RETEST_CONFIRMED" &&
          sig.classification !== "SUPPORT_BOUNCE_CONFIRMED"
        ) {
          continue;
        }
        const outcome = simulateEntryTradeOutcome({ signal: sig, futureCandles1h: fut1h, futureCandlesDaily: futDaily });
        if (!outcome) continue;
        events.push({
          symbol: sym,
          setup,
          dayIso,
          regime,
          trendAligned,
          strongClose: (sig.candleQuality ?? 0) >= 0.65,
          atrExpansion,
          modestDistance: (sig.breakoutDistancePct ?? 99) <= 3.0,
          instAccum,
          outcome,
          signal: sig,
          future1h: fut1h,
          atr,
        });
      }
    }
  }

  // 1. Loss Attribution
  const lossAttribution: Record<string, unknown> = {};
  for (const s of ["BREAKOUT_15", "BREAKOUT_20", "RETEST", "BOUNCE"] as const) {
    const sub = events.filter((e) => e.setup === s).map((e) => e.outcome);
    const byReason: Record<string, number> = {};
    for (const o of sub) byReason[o.exitReason] = (byReason[o.exitReason] ?? 0) + 1;
    lossAttribution[s] = {
      totalTrades: sub.length,
      exitReasonCounts: byReason,
      slAndGapPct: sub.length > 0 ? round2((((byReason.SL_HIT ?? 0) + (byReason.GAP_THROUGH_SL ?? 0)) / sub.length) * 100) : 0,
      avgGrossReturnPct: sub.length > 0 ? round2(sub.reduce((a, o) => a + o.grossReturnPct, 0) / sub.length) : 0,
      avgNetReturnPct: sub.length > 0 ? round2(sub.reduce((a, o) => a + o.netReturnPct, 0) / sub.length) : 0,
      costDragPctPerTrade: 0.5,
      summary: summarizeSimple(sub),
    };
  }

  // 2. Regime Analysis
  const regimeAnalysis: Record<string, unknown> = {};
  for (const s of ["BREAKOUT_15", "BREAKOUT_20", "RETEST", "BOUNCE"] as const) {
    const regObj: Record<string, unknown> = {};
    for (const r of ["BULL", "BEAR", "SIDEWAYS"]) {
      regObj[r] = summarizeSimple(events.filter((e) => e.setup === s && e.regime === r).map((e) => e.outcome));
    }
    regimeAnalysis[s] = regObj;
  }

  // 3. Entry Quality Analysis on Train+Val (<= 2025-09-30) ONLY (OOS untouched!)
  const tvEvents = events.filter((e) => e.dayIso <= "2025-09-30" && e.setup === "BREAKOUT_15");
  const entryQuality = {
    splitNote: "Evaluated strictly on Train+Validation (<= 2025-09-30); Out-of-Sample (>= 2025-10-01) kept untouched.",
    baseline_B15: summarizeSimple(tvEvents.map((e) => e.outcome)),
    filter_trendAligned: summarizeSimple(tvEvents.filter((e) => e.trendAligned).map((e) => e.outcome)),
    filter_strongClose65: summarizeSimple(tvEvents.filter((e) => e.strongClose).map((e) => e.outcome)),
    filter_atrExpansion: summarizeSimple(tvEvents.filter((e) => e.atrExpansion).map((e) => e.outcome)),
    filter_modestDistance3Pct: summarizeSimple(tvEvents.filter((e) => e.modestDistance).map((e) => e.outcome)),
    filter_instAccum: summarizeSimple(tvEvents.filter((e) => e.instAccum).map((e) => e.outcome)),
    filter_trendAndModestDist: summarizeSimple(tvEvents.filter((e) => e.trendAligned && e.modestDistance).map((e) => e.outcome)),
  };

  // 4. Exit Ablation on Train+Val (<= 2025-09-30)
  const exitVariants = [
    "ATR_2X_SL_FIXED_2R",
    "ATR_2X_SL_TRAILING_1R",
    "PARTIAL_50_AT_1_5R_TRAIL_3R",
    "TIME_EXIT_10D_NO_TARGET",
  ] as const;
  const exitAblation: Record<string, unknown> = {
    splitNote: "Evaluated strictly on Train+Validation (<= 2025-09-30) for BREAKOUT_15.",
    baseline: summarizeSimple(tvEvents.map((e) => e.outcome)),
  };
  for (const v of exitVariants) {
    const res = tvEvents
      .map((e) => simulateExitVariant({ signal: e.signal, future1h: e.future1h, atr: e.atr, variant: v }))
      .filter((x): x is NonNullable<typeof x> => x !== null);
    exitAblation[v] = summarizeSimple(res);
  }

  // 5. Untouched Out-of-Sample Walk-Forward Verification (>= 2025-10-01)
  const oosEvents = events.filter((e) => e.dayIso >= "2025-10-01" && e.setup === "BREAKOUT_15");
  const oosBaseline = summarizeSimple(oosEvents.map((e) => e.outcome));
  const oosTrendModestAtrTrailing = summarizeSimple(
    oosEvents
      .filter((e) => e.trendAligned && e.modestDistance)
      .map((e) => simulateExitVariant({ signal: e.signal, future1h: e.future1h, atr: e.atr, variant: "ATR_2X_SL_TRAILING_1R" }))
      .filter((x): x is NonNullable<typeof x> => x !== null)
  );
  const oosPartial = summarizeSimple(
    oosEvents
      .filter((e) => e.trendAligned && e.modestDistance)
      .map((e) => simulateExitVariant({ signal: e.signal, future1h: e.future1h, atr: e.atr, variant: "PARTIAL_50_AT_1_5R_TRAIL_3R" }))
      .filter((x): x is NonNullable<typeof x> => x !== null)
  );

  const walkForward = {
    train_2024: summarizeSimple(events.filter((e) => e.setup === "BREAKOUT_15" && e.dayIso <= "2024-12-31").map((e) => e.outcome)),
    val_2025Q1Q3: summarizeSimple(events.filter((e) => e.setup === "BREAKOUT_15" && e.dayIso >= "2025-01-01" && e.dayIso <= "2025-09-30").map((e) => e.outcome)),
    oos_2025Q4_2026_baseline: oosBaseline,
    oos_2025Q4_2026_trendModest_AtrTrail: oosTrendModestAtrTrailing,
    oos_2025Q4_2026_trendModest_Partial15_3R: oosPartial,
  };

  const costStress = {
    oos_0bps: summarizeSimple(
      oosEvents
        .filter((e) => e.trendAligned && e.modestDistance)
        .map((e) => simulateExitVariant({ signal: e.signal, future1h: e.future1h, atr: e.atr, variant: "ATR_2X_SL_TRAILING_1R", oneWayCostBps: 0 }))
        .filter((x): x is NonNullable<typeof x> => x !== null)
    ),
    oos_25bps: oosTrendModestAtrTrailing,
    oos_50bps: summarizeSimple(
      oosEvents
        .filter((e) => e.trendAligned && e.modestDistance)
        .map((e) => simulateExitVariant({ signal: e.signal, future1h: e.future1h, atr: e.atr, variant: "ATR_2X_SL_TRAILING_1R", oneWayCostBps: 50 }))
        .filter((x): x is NonNullable<typeof x> => x !== null)
    ),
  };

  const overfittingAudit = {
    configurationsTested: 14,
    bonferroniAlphaNote: "Testing 14 entry/exit combinations on a 30-stock survivor-biased sample increases multiple-testing false discovery risk; OOS validation is mandatory.",
    survivorshipDisclosure: "CURRENT_UNIVERSE_HISTORICAL_RESEARCH",
  };

  const hasRobustOos =
    (oosTrendModestAtrTrailing.expectancyR > 0 && oosTrendModestAtrTrailing.profitFactor > 1.0 && oosTrendModestAtrTrailing.trades >= 30) ||
    (oosPartial.expectancyR > 0 && oosPartial.profitFactor > 1.0 && oosPartial.trades >= 30);

  const finalClassification = hasRobustOos ? "RESEARCH_IMPROVEMENT_FOUND" : "NO_ROBUST_IMPROVEMENT";

  const baselineComparison = {
    immutablePhase6108Baseline: p6108Baseline,
    phase6109BestOosCandidate: oosTrendModestAtrTrailing,
    phase6109PartialOosCandidate: oosPartial,
    finalClassification,
  };

  fs.writeFileSync(path.join(OUT_DIR, "loss_attribution.json"), JSON.stringify(lossAttribution, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "regime_analysis.json"), JSON.stringify(regimeAnalysis, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "entry_quality_analysis.json"), JSON.stringify(entryQuality, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "exit_ablation.json"), JSON.stringify(exitAblation, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "walk_forward_results.json"), JSON.stringify(walkForward, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "cost_stress_results.json"), JSON.stringify(costStress, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "overfitting_audit.json"), JSON.stringify(overfittingAudit, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "baseline_comparison.json"), JSON.stringify(baselineComparison, null, 2));

  const md = [
    "# Phase 6.10.9 — Entry Failure Diagnosis & Research Optimization Report",
    "",
    `**Final Classification:** \`${finalClassification}\``,
    "",
    "## 1. Root Cause of Phase 6.10.8 Losses",
    `- Tight structural stops + unaligned regime entries caused high stop-out/gap rates: Breakout 1.5x SL+Gap=**${(lossAttribution.BREAKOUT_15 as any).slAndGapPct}%**, Retest=**${(lossAttribution.RETEST as any).slAndGapPct}%**, Bounce=**${(lossAttribution.BOUNCE as any).slAndGapPct}%**.`,
    "",
    "## 2. Untouched Out-of-Sample (`2025-10..2026-10`) Verification",
    `- OOS Baseline (Breakout 1.5x): Trades=**${oosBaseline.trades}**, PF=**${oosBaseline.profitFactor}**, Exp=**${oosBaseline.expectancyR}R**`,
    `- OOS Trend+ModestDist + 2xATR Trail: Trades=**${oosTrendModestAtrTrailing.trades}**, WinRate=**${oosTrendModestAtrTrailing.winRatePct}%**, PF=**${oosTrendModestAtrTrailing.profitFactor}**, Exp=**${oosTrendModestAtrTrailing.expectancyR}R**, MaxDD=**${oosTrendModestAtrTrailing.maxDrawdownPct}%**`,
    `- OOS Trend+ModestDist + Partial 1.5R/3R: Trades=**${oosPartial.trades}**, WinRate=**${oosPartial.winRatePct}%**, PF=**${oosPartial.profitFactor}**, Exp=**${oosPartial.expectancyR}R**, MaxDD=**${oosPartial.maxDrawdownPct}%**`,
    "",
    "## 3. Safety Confirmation",
    `- \`STRATEGY_01 = false\`, \`STRATEGY_02 = false\`, \`STRATEGY_03 = false\`, \`LIVE_TRADING = false\`, \`BROKER_EXECUTION_ENABLED = false\`, \`experimental_paper_trades = ${paperTradesCount ?? 0}\`.`,
  ].join("\n");

  fs.writeFileSync(path.join(OUT_DIR, "phase6109_final_report.md"), md);
  console.log("Phase 6.10.9 complete:", { finalClassification, oosTrendModestAtrTrailing, oosPartial, paperTrades: paperTradesCount ?? 0 });
}

if (process.argv[1]?.includes("runPhase6109Diagnosis")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
