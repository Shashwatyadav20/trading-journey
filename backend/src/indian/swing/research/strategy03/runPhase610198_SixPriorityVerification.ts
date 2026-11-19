import fs from "node:fs";
import path from "node:path";
import type { FourHourCandle } from "./prebreakout/Strategy03FourHourCandleProvider.js";
import type { FourHourPreBreakoutItem } from "./prebreakout/Strategy03FourHourPreBreakoutScanner.js";

const P61019_DIR = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase61019");
const CACHE_4H = path.join(P61019_DIR, "cache4h");
const OUT_DIR = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase610198");

const TARGET_SYMBOLS = ["ANANDRATHI", "GLAXO", "SUNPHARMA", "TORNTPHARM", "CORALFINAC", "IOB"] as const;

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function toIstIso(utcIso: string): string {
  const ms = Date.parse(utcIso);
  if (!Number.isFinite(ms)) return utcIso;
  return new Date(ms + 330 * 60_000).toISOString().replace("Z", "+05:30");
}

async function fetchLiveMarketCheck(sym: string): Promise<{
  provider: string;
  retrievedAtIst: string;
  latestPrice: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  error?: string;
}> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym + ".NS")}?range=2d&interval=1d`;
  const retrievedAtIst = new Date(Date.now() + 330 * 60_000).toISOString().replace("Z", "+05:30");
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) return { provider: url, retrievedAtIst, latestPrice: null, dayHigh: null, dayLow: null, error: `HTTP_${res.status}` };
    const json: any = await res.json();
    const r = json?.chart?.result?.[0];
    const q = r?.indicators?.quote?.[0] ?? {};
    const closes: Array<number | null> = q.close ?? [];
    const highs: Array<number | null> = q.high ?? [];
    const lows: Array<number | null> = q.low ?? [];
    const idx = closes.length - 1;
    if (idx < 0) return { provider: url, retrievedAtIst, latestPrice: null, dayHigh: null, dayLow: null, error: "EMPTY" };
    return {
      provider: "Yahoo Finance Live Quote API",
      retrievedAtIst,
      latestPrice: closes[idx] !== null ? round2(Number(closes[idx])) : null,
      dayHigh: highs[idx] !== null ? round2(Number(highs[idx])) : null,
      dayLow: lows[idx] !== null ? round2(Number(lows[idx])) : null,
    };
  } catch (err) {
    return {
      provider: url,
      retrievedAtIst,
      latestPrice: null,
      dayHigh: null,
      dayLow: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function verifySymbol(sym: string, watchlist: FourHourPreBreakoutItem[]) {
  const item = watchlist.find((w) => w.nseSymbol === sym);
  if (!item) throw new Error(`Missing ${sym} in prebreakout_watchlist.json`);

  const raw4h = JSON.parse(fs.readFileSync(path.join(CACHE_4H, `${sym}_4h.json`), "utf8")) as FourHourCandle[];
  const completed = raw4h.filter((c) => c.isComplete);
  const latest = completed[completed.length - 1];

  const impStartIdx = completed.findIndex((c) => toIstIso(c.timestamp) === item.impulse.startIst);
  const impEndIdx = completed.findIndex((c) => toIstIso(c.timestamp) === item.impulse.endIst);
  const impBars = impStartIdx >= 0 && impEndIdx >= impStartIdx ? completed.slice(impStartIdx, impEndIdx + 1) : [];
  const base10 = impStartIdx >= 10 ? completed.slice(impStartIdx - 10, impStartIdx) : [];
  const postImp = impEndIdx >= 0 ? completed.slice(impEndIdx + 1) : [];
  const priorPost = postImp.length > 1 ? postImp.slice(0, -1) : postImp;

  const recalcConsHigh = priorPost.length > 0 ? round2(Math.max(...priorPost.map((c) => c.high))) : null;
  const recalcConsLow = priorPost.length > 0 ? round2(Math.min(...priorPost.map((c) => c.low))) : null;
  const recalcRangePct =
    recalcConsHigh && recalcConsLow ? round2(((recalcConsHigh - recalcConsLow) / recalcConsLow) * 100) : null;
  const recalcDistPct =
    recalcConsHigh && latest?.close ? round2(((recalcConsHigh - latest.close) / latest.close) * 100) : null;

  // Duration-normalized RVOL verification
  const volPerHr = (c: FourHourCandle) => {
    const hrs = c.blockDurationMinutes ? c.blockDurationMinutes / 60 : Math.max(1, c.constituentBarCount || 4);
    return c.volume / hrs;
  };
  const avgBaseVolPerHr = base10.length > 0 ? base10.reduce((a, c) => a + volPerHr(c), 0) / base10.length : 0;
  const avgImpVolPerHr = impBars.length > 0 ? impBars.reduce((a, c) => a + volPerHr(c), 0) / impBars.length : 0;
  const recalcNormRvol = avgBaseVolPerHr > 0 ? round2(avgImpVolPerHr / avgBaseVolPerHr) : 0;

  // Verify OB candle
  const obBar = completed.find((c) => toIstIso(c.timestamp) === item.orderBlock.timestampIst) ?? null;
  const obValid =
    Boolean(obBar) &&
    obBar!.close < obBar!.open &&
    !postImp.some((c) => c.close < obBar!.low);

  // Verify immediate support
  const recalcSuppDist =
    item.supportZone.supportHigh && latest?.close
      ? round2(((latest.close - item.supportZone.supportHigh) / item.supportZone.supportHigh) * 100)
      : null;
  const immediateSupportOk = recalcSuppDist !== null && recalcSuppDist <= 8.0;

  const liveQuote = await fetchLiveMarketCheck(sym);
  const completedSnapshotBrokenOut =
    recalcConsHigh !== null && latest ? latest.close > recalcConsHigh * 1.001 : false;
  const completedSnapshotInvalidated =
    (recalcConsLow !== null && latest ? latest.close < recalcConsLow : false) ||
    (obBar && latest ? latest.close < obBar.low : false);

  const liveIntradayVsBox =
    liveQuote.latestPrice !== null && recalcConsHigh !== null && recalcConsLow !== null
      ? liveQuote.latestPrice > recalcConsHigh * 1.001
        ? "INTRADAY_ABOVE_BOX_HIGH_UNCONFIRMED_4H"
        : liveQuote.latestPrice < recalcConsLow
        ? "INTRADAY_BELOW_BOX_LOW_WATCH_INVALIDATION"
        : "INSIDE_CONSOLIDATION_BOX"
      : "LIVE_QUOTE_UNAVAILABLE";

  const checks = {
    completed4hCandlesVerified: completed.length >= 25 && item.ohlcv4hDrilldownIst.every((c) => c.isComplete) ? "PASS" : "FAIL",
    consolidationBoundariesVerified:
      recalcConsHigh === round2(item.consolidation.high ?? 0) &&
      recalcConsLow === round2(item.consolidation.low ?? 0)
        ? "PASS"
        : "FAIL",
    bullishImpulseBeforeConsolidation:
      impBars.length >= 3 && Date.parse(item.consolidation.startIst!) > Date.parse(item.impulse.endIst!)
        ? "PASS"
        : "FAIL",
    bullishOrderBlockVerified: obValid ? "PASS" : "FAIL",
    immediateSupportVerified: immediateSupportOk ? "PASS" : "FAIL",
    breakoutDistanceRecalculated:
      recalcDistPct !== null && Math.abs(recalcDistPct - (item.breakoutDistancePct ?? 99)) <= 0.02
        ? "PASS"
        : "FAIL",
    durationNormalizedRvolVerified:
      recalcNormRvol >= 1.15 && item.impulse.rvol >= 1.15 ? "PASS" : "FAIL",
    notBrokenOutOrInvalidatedOnCompleted4h:
      !completedSnapshotBrokenOut && !completedSnapshotInvalidated ? "PASS" : "FAIL",
    independentTradingView4hChartComparison: "UNVERIFIED",
  };

  const allInternalPass = Object.entries(checks)
    .filter(([k]) => k !== "independentTradingView4hChartComparison")
    .every(([, v]) => v === "PASS");

  const classification = !allInternalPass
    ? "REJECTED"
    : "PARTIALLY_VERIFIED";

  return {
    symbol: sym,
    companyName: item.companyName,
    classification,
    priorityScore: item.priorityScore,
    consolidationCategory: item.consolidation.tier,
    latestCompleted4hTimestampIst: item.lastUpdatedIst,
    latestCompleted4hClose: round2(latest?.close ?? 0),
    consolidation: {
      startIst: item.consolidation.startIst,
      endIst: item.consolidation.endIst,
      blocks4h: item.consolidation.candleCount,
      tradingDays: item.consolidation.tradingDaysElapsed,
      scannerHigh: round2(item.consolidation.high ?? 0),
      scannerLow: round2(item.consolidation.low ?? 0),
      recalculatedHigh: recalcConsHigh,
      recalculatedLow: recalcConsLow,
      recalculatedRangePct: recalcRangePct,
      recalculatedBreakoutDistPct: recalcDistPct,
    },
    impulse: {
      startIst: item.impulse.startIst,
      endIst: item.impulse.endIst,
      candleCount: item.impulse.candleCount,
      displacementPct: item.impulse.displacementPct,
      scannerNormRvol: item.impulse.rvol,
      recalculatedNormRvol: recalcNormRvol,
      avgBaseVolPerHr: Math.round(avgBaseVolPerHr),
      avgImpulseVolPerHr: Math.round(avgImpVolPerHr),
    },
    orderBlock: {
      timestampIst: item.orderBlock.timestampIst,
      obHigh: round2(item.orderBlock.obHigh ?? 0),
      obLow: round2(item.orderBlock.obLow ?? 0),
      invalidationLevel: round2(item.orderBlock.obLow ?? 0),
      isBearishCandleConfirmed: Boolean(obBar && obBar.close < obBar.open),
      invalidated: item.orderBlock.invalidated,
    },
    supportZone: {
      supportLow: item.supportZone.supportLow,
      supportHigh: item.supportZone.supportHigh,
      reactionCount: item.supportZone.reactionCount,
      liquiditySweepDetected: item.supportZone.liquiditySweepDetected,
      recalculatedDistancePct: recalcSuppDist,
      relevance: item.supportZone.supportRelevance,
    },
    independentObservations: {
      liveQuoteCheck: liveQuote,
      liveIntradayVsScannerBox: liveIntradayVsBox,
      scannerCloseVsLivePriceDiffPct:
        liveQuote.latestPrice && latest?.close
          ? round2(((liveQuote.latestPrice - latest.close) / latest.close) * 100)
          : null,
      tradingView4hChartStatus: "UNVERIFIED (no external third-party 4H OHLCV chart feed connected)",
    },
    checks,
    complete4hOhlcvSequenceIst: item.ohlcv4hDrilldownIst,
  };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const watchlist = JSON.parse(
    fs.readFileSync(path.join(P61019_DIR, "prebreakout_watchlist.json"), "utf8")
  ) as FourHourPreBreakoutItem[];

  const results: any[] = [];
  for (const sym of TARGET_SYMBOLS) {
    const rep = await verifySymbol(sym, watchlist);
    results.push(rep);
    fs.writeFileSync(path.join(OUT_DIR, `${sym}_priority_verification.json`), JSON.stringify(rep, null, 2));
  }

  const consolidated = {
    verifiedAtIst: new Date(Date.now() + 330 * 60_000).toISOString().replace("Z", "+05:30"),
    totalCandidates: results.length,
    classifications: Object.fromEntries(results.map((r) => [r.symbol, r.classification])),
    comparisons: results.map((r) => ({
      symbol: r.symbol,
      category: r.consolidationCategory,
      score: r.priorityScore,
      completed4hClose: r.latestCompleted4hClose,
      liveIntradayPrice: r.independentObservations.liveQuoteCheck.latestPrice,
      scannerVsLiveDiffPct: r.independentObservations.scannerCloseVsLivePriceDiffPct,
      liveIntradayStatus: r.independentObservations.liveIntradayVsScannerBox,
      consolidationBox: [r.consolidation.recalculatedLow, r.consolidation.recalculatedHigh],
      obZone: [r.orderBlock.obLow, r.orderBlock.obHigh],
      supportZone: [r.supportZone.supportLow, r.supportZone.supportHigh],
      supportDistPct: r.supportZone.recalculatedDistancePct,
      breakoutDistPct: r.consolidation.recalculatedBreakoutDistPct,
      normRvol: r.impulse.recalculatedNormRvol,
      classification: r.classification,
    })),
  };

  fs.writeFileSync(path.join(OUT_DIR, "consolidated_6_priority_comparison.json"), JSON.stringify(consolidated, null, 2));
  fs.writeFileSync(
    path.join(OUT_DIR, "updated_priority_review_watchlist.json"),
    JSON.stringify(results.map(({ complete4hOhlcvSequenceIst, ...rest }) => rest), null, 2)
  );

  const md = [
    "# Phase 6.10.19.8 — Six Priority Candidate Independent Verification",
    "",
    "| Symbol | Category | Score | 4H Close | Live Quote | Box Low–High | OB Low–High | Supp Dist % | Brk Dist % | Norm RVOL | Intraday Box Status | Classification |",
    "|---|---|---:|---:|---:|---|---|---:|---:|---:|---|---|",
    ...consolidated.comparisons.map(
      (c) =>
        `| **${c.symbol}** | ${c.category} | ${c.score} | ${c.completed4hClose} | ${c.liveIntradayPrice ?? "—"} (${c.scannerVsLiveDiffPct ?? 0}%) | ${c.consolidationBox[0]}–${c.consolidationBox[1]} | ${c.obZone[0]}–${c.obZone[1]} | ${c.supportDistPct}% | ${c.breakoutDistPct}% | ${c.normRvol}x | \`${c.liveIntradayStatus}\` | \`${c.classification}\` |`
    ),
  ].join("\n");
  fs.writeFileSync(path.join(OUT_DIR, "phase610198_verification_report.md"), md);

  console.log("Phase 6.10.19.8 complete:", consolidated.comparisons);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
