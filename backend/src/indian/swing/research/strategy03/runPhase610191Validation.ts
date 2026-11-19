import fs from "node:fs";
import path from "node:path";
import type { FourHourCandle } from "./prebreakout/Strategy03FourHourCandleProvider.js";
import type { FourHourPreBreakoutItem } from "./prebreakout/Strategy03FourHourPreBreakoutScanner.js";
import { toIstDateAndTime } from "./momentum/Strategy03IntradayEventEvaluator.js";

const P61019_DIR = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase61019");
const CACHE_4H = path.join(P61019_DIR, "cache4h");
const OUT_DIR = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase610191");

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

type CheckStatus = "PASS" | "FAIL" | "UNVERIFIED";

function validateReadyCandidate(item: FourHourPreBreakoutItem, raw4h: FourHourCandle[], now: Date) {
  const drill = item.ohlcv4hDrilldownIst;
  const completed4h = raw4h.filter((c) => c.isComplete);
  const incompleteCount = raw4h.length - completed4h.length;

  // 1. Consolidation occurs strictly after impulse
  const consAfterImp =
    item.consolidation.startIst && item.impulse.endIst
      ? Date.parse(item.consolidation.startIst) > Date.parse(item.impulse.endIst)
      : false;

  // 2. Pre-breakout check (latest completed 4H close <= consolidation high * 1.001)
  const latestCompleted = completed4h[completed4h.length - 1];
  const preBreakoutOk =
    item.consolidation.high !== null && latestCompleted
      ? latestCompleted.close <= item.consolidation.high * 1.001
      : false;

  // 3. Recalculate breakout distance
  const recalcDist =
    item.consolidation.high !== null && latestCompleted && latestCompleted.close > 0
      ? round2(((item.consolidation.high - latestCompleted.close) / latestCompleted.close) * 100)
      : null;
  const distMatches =
    recalcDist !== null &&
    item.breakoutDistancePct !== null &&
    Math.abs(recalcDist - item.breakoutDistancePct) <= 0.01;

  // 4. NSE IST session boundaries & duplicate check
  const seenTs = new Set<string>();
  let dupCount = 0;
  let invalidIstCount = 0;
  for (const c of drill) {
    if (seenTs.has(c.timestamp)) dupCount++;
    seenTs.add(c.timestamp);
    const { minutesOfDay } = toIstDateAndTime(c.timestamp);
    if (minutesOfDay < 555 || minutesOfDay > 930) invalidIstCount++;
  }
  const ageHours = latestCompleted ? (now.getTime() - Date.parse(latestCompleted.timestamp)) / 3_600_000 : 999;

  // 5. Recompute consolidation box from actual post-impulse prior candles
  const impEndMs = item.impulse.endIst ? Date.parse(item.impulse.endIst) : 0;
  const postImpActual = drill.filter((c) => Date.parse(c.timestamp) > impEndMs);
  const priorPostImp = postImpActual.length > 1 ? postImpActual.slice(0, -1) : postImpActual;
  const actualConsHigh = priorPostImp.length > 0 ? Math.max(...priorPostImp.map((c) => c.high)) : null;
  const actualConsLow = priorPostImp.length > 0 ? Math.min(...priorPostImp.map((c) => c.low)) : null;
  const consMatch =
    actualConsHigh !== null &&
    actualConsLow !== null &&
    actualConsHigh === item.consolidation.high &&
    actualConsLow === item.consolidation.low;

  const checks: Record<string, { status: CheckStatus; detail: string }> = {
    consolidationAfterImpulse: {
      status: consAfterImp ? "PASS" : "FAIL",
      detail: `impulseEnd=${item.impulse.endIst}, consolidationStart=${item.consolidation.startIst}`,
    },
    readyBeforeCompletedBreakout: {
      status: preBreakoutOk ? "PASS" : "FAIL",
      detail: `latest4hClose=${latestCompleted?.close}, consolidationHigh=${item.consolidation.high}`,
    },
    breakoutDistanceRecalculation: {
      status: distMatches ? "PASS" : "FAIL",
      detail: `reported=${item.breakoutDistancePct}%, recalculated=${recalcDist}%`,
    },
    nseIstTimestampsValid: {
      status: invalidIstCount === 0 ? "PASS" : "FAIL",
      detail: `invalidIstBars=${invalidIstCount}, drillCount=${drill.length}`,
    },
    noStaleMissingDuplicateIncomplete: {
      status: dupCount === 0 && ageHours <= 96 && drill.every((d) => d.isComplete) ? "PASS" : "FAIL",
      detail: `duplicates=${dupCount}, ageHours=${round2(ageHours)}, incompleteBlocksInRaw4hCache=${incompleteCount}`,
    },
    zoneBoundariesMatchCandles: {
      status: consMatch ? "PASS" : "FAIL",
      detail: `reported=[${item.consolidation.low}, ${item.consolidation.high}], actual=[${actualConsLow}, ${actualConsHigh}]`,
    },
    independentExternalChartCheck: {
      status: "UNVERIFIED",
      detail: "Awaiting manual TradingView / NSE chart comparison; no levels adjusted.",
    },
  };

  return {
    symbol: item.nseSymbol,
    status: item.status,
    priorityScore: item.priorityScore,
    latestCompleted4hClose: latestCompleted?.close ?? null,
    latestCompleted4hTimestampIst: item.lastUpdatedIst,
    supportZone: item.supportZone,
    impulse: item.impulse,
    consolidation: item.consolidation,
    orderBlock: item.orderBlock,
    recalculatedBreakoutDistancePct: recalcDist,
    incomplete4hBarsExcluded: incompleteCount,
    checks,
    complete4hOhlcvUsed: drill,
  };
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const watchlist = JSON.parse(
    fs.readFileSync(path.join(P61019_DIR, "prebreakout_watchlist.json"), "utf8")
  ) as FourHourPreBreakoutItem[];
  const now = new Date("2026-11-18T12:05:06+05:30");

  const targets = ["BAJFINANCE", "HINDUNILVR"];
  const reports: any[] = [];

  for (const sym of targets) {
    const item = watchlist.find((w) => w.nseSymbol === sym);
    const raw4h = JSON.parse(
      fs.readFileSync(path.join(CACHE_4H, `${sym}_4h.json`), "utf8")
    ) as FourHourCandle[];
    if (!item) throw new Error(`Missing ${sym} in prebreakout_watchlist.json`);
    const rep = validateReadyCandidate(item, raw4h, now);
    reports.push(rep);
    fs.writeFileSync(path.join(OUT_DIR, `${sym}_4h_ready_evidence.json`), JSON.stringify(rep, null, 2));
  }

  fs.writeFileSync(
    path.join(OUT_DIR, "phase610191_validation_report.json"),
    JSON.stringify({ validatedAtIst: "2026-11-18T12:05:06+05:30", candidates: reports }, null, 2)
  );

  const mdLines = [
    "# Phase 6.10.19.1 — 4H READY Candidate Visual & Data Validation",
    "",
    ...reports.flatMap((r) => [
      `## ${r.symbol} (Score: ${r.priorityScore}, Latest 4H Close: ${r.latestCompleted4hClose} @ ${r.latestCompleted4hTimestampIst})`,
      `- **Support Zone:** ${r.supportZone.supportLow}–${r.supportZone.supportHigh} (${r.supportZone.reason})`,
      `- **Impulse:** ${r.impulse.candleCount} x 4H (${r.impulse.startIst} to ${r.impulse.endIst}, +${r.impulse.displacementPct}%, RVOL ${r.impulse.rvol}x)`,
      `- **Consolidation:** ${r.consolidation.low}–${r.consolidation.high} (${r.consolidation.candleCount} x 4H, ${r.consolidation.rangePct}%, ${r.consolidation.tier})`,
      `- **Bullish OB:** ${r.orderBlock.obLow ?? "NONE"}–${r.orderBlock.obHigh ?? "NONE"} (${r.orderBlock.reason})`,
      `- **Recalculated Breakout Distance:** ${r.recalculatedBreakoutDistancePct}%`,
      ...Object.entries(r.checks).map(([k, v]: [string, any]) => `- **${k}:** \`${v.status}\` — ${v.detail}`),
      "",
    ]),
  ];
  fs.writeFileSync(path.join(OUT_DIR, "phase610191_validation_report.md"), mdLines.join("\n"));

  console.log(
    "Phase 6.10.19.1 complete:",
    reports.map((r) => ({
      symbol: r.symbol,
      recalcDist: r.recalculatedBreakoutDistancePct,
      incompleteExcluded: r.incomplete4hBarsExcluded,
      checks: Object.fromEntries(Object.entries(r.checks).map(([k, v]: [string, any]) => [k, v.status])),
    }))
  );
}

main();

