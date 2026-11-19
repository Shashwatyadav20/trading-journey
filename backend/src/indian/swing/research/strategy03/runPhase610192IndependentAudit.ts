import fs from "node:fs";
import path from "node:path";

const P61019_CACHE = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase61019/cache4h");
const P610191_DIR = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase610191");
const OUT_DIR = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase610192");

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

async function fetchYahooDailyCheck(yahooSym: string): Promise<{ ok: boolean; date: string | null; close: number | null; source: string; error?: string }> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym)}?range=5d&interval=1d`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) return { ok: false, date: null, close: null, source: url, error: `HTTP_${res.status}` };
    const json: any = await res.json();
    const result = json?.chart?.result?.[0];
    const ts: number[] = result?.timestamp ?? [];
    const closes: Array<number | null> = result?.indicators?.quote?.[0]?.close ?? [];
    const lastIdx = ts.length - 1;
    if (lastIdx < 0) return { ok: false, date: null, close: null, source: url, error: "EMPTY_YAHOO_RESULT" };
    const d = new Date(ts[lastIdx] * 1000).toISOString().slice(0, 10);
    const c = closes[lastIdx] !== null ? round2(Number(closes[lastIdx])) : null;
    return { ok: true, date: d, close: c, source: url };
  } catch (err) {
    return { ok: false, date: null, close: null, source: url, error: err instanceof Error ? err.message : String(err) };
  }
}

async function auditSymbol(sym: string) {
  const ev = JSON.parse(fs.readFileSync(path.join(P610191_DIR, `${sym}_4h_ready_evidence.json`), "utf8"));
  const all4h: any[] = JSON.parse(fs.readFileSync(path.join(P61019_CACHE, `${sym}_4h.json`), "utf8")).filter((c: any) => c.isComplete);

  const impStartIdx = all4h.findIndex((c) => new Date(Date.parse(c.timestamp) + 330 * 60_000).toISOString().replace("Z", "+05:30") === ev.impulse.startIst);
  const impEndIdx = all4h.findIndex((c) => new Date(Date.parse(c.timestamp) + 330 * 60_000).toISOString().replace("Z", "+05:30") === ev.impulse.endIst);

  const prior3 = impStartIdx >= 3 ? all4h.slice(impStartIdx - 3, impStartIdx) : [];
  const base10 = impStartIdx >= 10 ? all4h.slice(impStartIdx - 10, impStartIdx) : [];
  const impSlice = impStartIdx >= 0 && impEndIdx >= impStartIdx ? all4h.slice(impStartIdx, impEndIdx + 1) : [];

  const avgBaseVol = base10.length > 0 ? base10.reduce((a, c) => a + c.volume, 0) / base10.length : 0;
  const avgImpVol = impSlice.length > 0 ? impSlice.reduce((a, c) => a + c.volume, 0) / impSlice.length : 0;
  const baseConstituentBars = base10.map((c) => c.constituentBarCount);
  const impConstituentBars = impSlice.map((c) => c.constituentBarCount);

  const distFromSupportPct =
    ev.supportZone.supportHigh && ev.latestCompleted4hClose
      ? round2(((ev.latestCompleted4hClose - ev.supportZone.supportHigh) / ev.supportZone.supportHigh) * 100)
      : null;

  const yahooCheck = await fetchYahooDailyCheck(`${sym}.NS`);

  // Determine overall classification honestly:
  // External TradingView/NSE 4H chart is not available locally; Yahoo is the same upstream provider as our cache.
  const classification = "PARTIALLY VERIFIED";

  return {
    symbol: sym,
    classification,
    latestCompleted4hClose: ev.latestCompleted4hClose,
    latestCompleted4hTimestampIst: ev.latestCompleted4hTimestampIst,
    supportRelevance: {
      supportRange: [ev.supportZone.supportLow, ev.supportZone.supportHigh],
      distanceAboveSupportHighPct: distFromSupportPct,
      assessment:
        distFromSupportPct !== null && distFromSupportPct > 10
          ? `DISTANT_HISTORICAL_SUPPORT (${distFromSupportPct}% below current price; not immediate box support)`
          : "RELEVANT_RECENT_SUPPORT",
    },
    consolidationVisualMatch: {
      status: ev.checks.zoneBoundariesMatchCandles.status,
      candleCount: ev.consolidation.candleCount,
      range: [ev.consolidation.low, ev.consolidation.high],
    },
    priceAndDistanceSync: {
      status: ev.checks.breakoutDistanceRecalculation.status,
      breakoutDistancePct: ev.recalculatedBreakoutDistancePct,
    },
    whyNoBullishOb: {
      prior3CandlesBeforeImpulse: prior3.map((c) => ({
        timestamp: c.timestamp,
        open: round2(c.open),
        close: round2(c.close),
        isBearish: c.close < c.open,
      })),
      explanation:
        prior3.every((c) => c.close >= c.open)
          ? "All 3 completed 4H candles immediately preceding the impulse were bullish (close >= open), so no bearish OB candle existed in the 3-bar lookback."
          : "Bearish candle existed, inspect displacement.",
    },
    volumeAndRvolAudit: {
      reportedRvol: ev.impulse.rvol,
      avgBase10Vol: Math.round(avgBaseVol),
      avgImpulseVol: Math.round(avgImpVol),
      base10Volumes: base10.map((c) => ({ ts: c.timestamp, bars1h: c.constituentBarCount, vol: c.volume })),
      impulseVolumes: impSlice.map((c) => ({ ts: c.timestamp, bars1h: c.constituentBarCount, vol: c.volume })),
      constituentBarComparabilityNote:
        `AM 4H blocks aggregate 4x 1H bars while PM 4H blocks aggregate 3x 1H bars (base10 bars=[${baseConstituentBars.join(",")}], impulse bars=[${impConstituentBars.join(",")}]), which introduces ~25% block-duration asymmetry.`,
    },
    independentExternalCheck: {
      yahooLiveCheck: yahooCheck,
      tradingViewOrNse4hChartStatus: "UNVERIFIED",
      note: "Upstream Yahoo Finance cache cannot serve as independent third-party TradingView/NSE chart verification.",
    },
  };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const baj = await auditSymbol("BAJFINANCE");
  const hul = await auditSymbol("HINDUNILVR");

  fs.writeFileSync(path.join(OUT_DIR, "BAJFINANCE_independent_validation.json"), JSON.stringify(baj, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "HINDUNILVR_independent_validation.json"), JSON.stringify(hul, null, 2));

  const md = [
    "# Phase 6.10.19.2 — Independent 4H Chart Verification",
    "",
    ...([baj, hul].flatMap((r) => [
      `## ${r.symbol} — Classification: \`${r.classification}\``,
      `- **Latest 4H Close:** ${r.latestCompleted4hClose} @ ${r.latestCompleted4hTimestampIst} (Breakout Dist: ${r.priceAndDistanceSync.breakoutDistancePct}%)`,
      `- **Support Relevance:** ${r.supportRelevance.assessment}`,
      `- **Consolidation Match:** \`${r.consolidationVisualMatch.status}\` (${r.consolidationVisualMatch.candleCount}B, ${r.consolidationVisualMatch.range.join("–")})`,
      `- **Why No Bullish OB:** ${r.whyNoBullishOb.explanation}`,
      `- **RVOL Audit:** Reported=${r.volumeAndRvolAudit.reportedRvol}x (AvgImpVol=${r.volumeAndRvolAudit.avgImpulseVol}, AvgBase10Vol=${r.volumeAndRvolAudit.avgBase10Vol}). ${r.volumeAndRvolAudit.constituentBarComparabilityNote}`,
      `- **External Chart Check:** \`${r.independentExternalCheck.tradingViewOrNse4hChartStatus}\` (Yahoo live check: ok=${r.independentExternalCheck.yahooLiveCheck.ok}, date=${r.independentExternalCheck.yahooLiveCheck.date}, close=${r.independentExternalCheck.yahooLiveCheck.close})`,
      "",
    ])),
  ].join("\n");
  fs.writeFileSync(path.join(OUT_DIR, "phase610192_independent_audit.md"), md);

  console.log("Phase 6.10.19.2 complete:", {
    BAJFINANCE: {
      classification: baj.classification,
      supportDistPct: baj.supportRelevance.distanceAboveSupportHighPct,
      rvol: baj.volumeAndRvolAudit.reportedRvol,
      avgBase10Vol: baj.volumeAndRvolAudit.avgBase10Vol,
      avgImpVol: baj.volumeAndRvolAudit.avgImpulseVol,
      prior3AllBullish: baj.whyNoBullishOb.prior3CandlesBeforeImpulse.every((c: any) => !c.isBearish),
      yahooLive: baj.independentExternalCheck.yahooLiveCheck,
    },
    HINDUNILVR: {
      classification: hul.classification,
      supportDistPct: hul.supportRelevance.distanceAboveSupportHighPct,
      rvol: hul.volumeAndRvolAudit.reportedRvol,
      avgBase10Vol: hul.volumeAndRvolAudit.avgBase10Vol,
      avgImpVol: hul.volumeAndRvolAudit.avgImpulseVol,
      prior3AllBullish: hul.whyNoBullishOb.prior3CandlesBeforeImpulse.every((c: any) => !c.isBearish),
      yahooLive: hul.independentExternalCheck.yahooLiveCheck,
    },
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

