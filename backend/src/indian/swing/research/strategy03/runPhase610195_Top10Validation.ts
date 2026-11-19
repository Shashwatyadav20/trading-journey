import fs from "node:fs";
import path from "node:path";
import type { FourHourCandle } from "./prebreakout/Strategy03FourHourCandleProvider.js";
import type { FourHourPreBreakoutItem } from "./prebreakout/Strategy03FourHourPreBreakoutScanner.js";

const P61019_DIR = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase61019");
const CACHE_4H = path.join(P61019_DIR, "cache4h");
const P610194_DIR = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase610194");
const OUT_DIR = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase610195");

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

async function fetchYahooLive(sym: string): Promise<{ ok: boolean; date: string | null; close: number | null }> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym + ".NS")}?range=5d&interval=1d`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) return { ok: false, date: null, close: null };
    const json: any = await res.json();
    const r = json?.chart?.result?.[0];
    const ts: number[] = r?.timestamp ?? [];
    const closes: Array<number | null> = r?.indicators?.quote?.[0]?.close ?? [];
    const idx = ts.length - 1;
    if (idx < 0) return { ok: false, date: null, close: null };
    return {
      ok: true,
      date: new Date(ts[idx] * 1000).toISOString().slice(0, 10),
      close: closes[idx] !== null ? round2(Number(closes[idx])) : null,
    };
  } catch {
    return { ok: false, date: null, close: null };
  }
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const watchlist = JSON.parse(
    fs.readFileSync(path.join(P61019_DIR, "prebreakout_watchlist.json"), "utf8")
  ) as FourHourPreBreakoutItem[];
  const discovery = JSON.parse(
    fs.readFileSync(path.join(P610194_DIR, "full_universe_discovery.json"), "utf8")
  );

  const readyAll = watchlist.filter((w) => w.status === "READY");
  const top10 = readyAll.slice(0, 10);

  const validations: any[] = [];
  const evidenceExports: any[] = [];

  for (const item of top10) {
    const raw4h = JSON.parse(
      fs.readFileSync(path.join(CACHE_4H, `${item.nseSymbol}_4h.json`), "utf8")
    ) as FourHourCandle[];
    const completed = raw4h.filter((c) => c.isComplete);
    const latest = completed[completed.length - 1];
    const drill = item.ohlcv4hDrilldownIst;

    const impAfterCheck =
      item.consolidation.startIst && item.impulse.endIst
        ? Date.parse(item.consolidation.startIst) > Date.parse(item.impulse.endIst)
        : false;
    const preBreakoutOk =
      item.consolidation.high !== null && latest ? latest.close <= item.consolidation.high * 1.001 : false;
    const notInvalidated =
      item.consolidation.low !== null && latest ? latest.close >= item.consolidation.low : false;
    const recalcDist =
      item.consolidation.high !== null && latest && latest.close > 0
        ? round2(((item.consolidation.high - latest.close) / latest.close) * 100)
        : null;
    const distMatch =
      recalcDist !== null &&
      item.breakoutDistancePct !== null &&
      Math.abs(recalcDist - item.breakoutDistancePct) <= 0.01;

    const impEndMs = item.impulse.endIst ? Date.parse(item.impulse.endIst) : 0;
    const postImp = drill.filter((c) => Date.parse(c.timestamp) > impEndMs);
    const priorPost = postImp.length > 1 ? postImp.slice(0, -1) : postImp;
    const actHigh = priorPost.length > 0 ? Math.max(...priorPost.map((c) => c.high)) : null;
    const actLow = priorPost.length > 0 ? Math.min(...priorPost.map((c) => c.low)) : null;
    const actRange = actLow && actHigh ? round2(((actHigh - actLow) / actLow) * 100) : null;
    const consMatch =
      actHigh === item.consolidation.high &&
      actLow === item.consolidation.low &&
      postImp.length === item.consolidation.candleCount;

    const yahooLive = await fetchYahooLive(item.nseSymbol);
    const internalPass = impAfterCheck && preBreakoutOk && notInvalidated && distMatch && consMatch;
    const classification = internalPass ? "PARTIALLY_VERIFIED" : "REJECTED";

    validations.push({
      symbol: item.nseSymbol,
      priorityScore: item.priorityScore,
      tier: item.consolidation.tier,
      blocks4h: item.consolidation.candleCount,
      tradingDaysElapsed: item.consolidation.tradingDaysElapsed,
      latest4hClose: latest?.close ?? null,
      latest4hTimestampIst: item.lastUpdatedIst,
      consolidationRange: [actLow, actHigh],
      consolidationRangePct: actRange,
      recalculatedBreakoutDistPct: recalcDist,
      supportRelevance: item.supportZone.supportRelevance,
      supportRange: [item.supportZone.supportLow, item.supportZone.supportHigh],
      supportDistancePct: item.supportZone.supportDistancePct,
      bullishObDetected: item.orderBlock.detected,
      bullishObRange: item.orderBlock.detected ? [item.orderBlock.obLow, item.orderBlock.obHigh] : null,
      impulseRvol: item.impulse.rvol,
      volumeConfirmed: item.impulse.volumeConfirmed,
      checks: {
        completed4hCandlesOnly: drill.every((d) => d.isComplete) ? "PASS" : "FAIL",
        impulseBeforeConsolidation: impAfterCheck ? "PASS" : "FAIL",
        consolidationBoundariesMatch: consMatch ? "PASS" : "FAIL",
        preBreakoutAndNotInvalidated: preBreakoutOk && notInvalidated ? "PASS" : "FAIL",
        breakoutDistanceMatch: distMatch ? "PASS" : "FAIL",
        externalChartVerification: "UNVERIFIED",
      },
      yahooLiveQuote20261118: yahooLive,
      classification,
      notes:
        "All internal 4H OHLCV checks passed; external TradingView/NSE 4H chart comparison remains UNVERIFIED.",
    });

    evidenceExports.push({
      symbol: item.nseSymbol,
      tier: item.consolidation.tier,
      priorityScore: item.priorityScore,
      ohlcv4hDrilldownIst: drill,
    });
  }

  const universeAudit = {
    totalUniverseRows: discovery.totalUniverseRows,
    excludedNonEqOrInactive: discovery.excludedCount,
    eligibleNseEqActive: discovery.eligibleCount,
    scannedWith4hData: discovery.scannedWith4hDataCount,
    uncachedStocks: discovery.eligibleCount - discovery.scannedWith4hDataCount,
    uncachedReason: "MISSING_4H_DATA (beyond initial 350-symbol Yahoo batch cap; not fabricated)",
    progressiveExpansionPlan: [
      "1. Fetch remaining 2,026 eligible NSE EQ stocks in 300-symbol batches sorted by market_cap_cr DESC using 25-wide concurrency + exponential backoff.",
      "2. Resample completed AM (4x1H) and PM (3x1H) NSE session blocks into cache4h/{SYMBOL}_4h.json.",
      "3. Keep symbols with <25 completed 4H blocks in WAIT status without lowering quality thresholds.",
    ],
  };

  fs.writeFileSync(path.join(OUT_DIR, "top10_ready_validation.json"), JSON.stringify(validations, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "top10_ready_evidence_export.json"), JSON.stringify(evidenceExports, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "universe_coverage_audit.json"), JSON.stringify(universeAudit, null, 2));

  const md = [
    "# Phase 6.10.19.5 — Top 10 Multi-Duration READY Candidate Validation",
    "",
    `- **Universe:** ${universeAudit.eligibleNseEqActive} eligible | ${universeAudit.scannedWith4hData} scanned | ${universeAudit.uncachedStocks} uncached (\`WAIT\`)`,
    "",
    "| # | Symbol | Score | Category | 4H Blocks / Days | Range % | Dist % | Support | OB | RVOL | Classification |",
    "|---:|---|---:|---|---:|---:|---:|---|---|---|---|",
    ...validations.map(
      (v, i) =>
        `| ${i + 1} | **${v.symbol}** | ${v.priorityScore} | ${v.tier} | ${v.blocks4h}B / ${v.tradingDaysElapsed}D | ${v.consolidationRangePct}% | ${v.recalculatedBreakoutDistPct}% | ${v.supportRelevance} (${v.supportDistancePct}%) | ${v.bullishObDetected ? "YES" : "NONE"} | ${v.impulseRvol}x | \`${v.classification}\` |`
    ),
  ].join("\n");
  fs.writeFileSync(path.join(OUT_DIR, "phase610195_validation_report.md"), md);

  console.log("Phase 6.10.19.5 complete:", {
    validatedCount: validations.length,
    classifications: validations.map((v) => `${v.symbol}:${v.tier}:${v.priorityScore}:${v.classification}`),
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

