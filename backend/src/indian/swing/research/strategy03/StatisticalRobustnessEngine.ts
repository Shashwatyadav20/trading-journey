import type { DailyCandleBar, PortfolioEquityPoint } from "./HistoricalValidationEngine.js";

export type MarketTrendRegime = "BULL" | "BEAR" | "SIDEWAYS";
export type MarketVolRegime = "HIGH_VOL" | "MID_VOL" | "LOW_VOL";

export interface RegimeDayLabel {
  date: string;
  trendRegime: MarketTrendRegime;
  volRegime: MarketVolRegime;
}

export interface RegimePerformanceSummary {
  regime: string;
  tradingDays: number;
  annualizedReturnPct: number;
  cumulativeReturnPct: number;
  maxDrawdownPct: number;
  avgInvestedWeightPct: number;
  winRatePct: number;
}

export interface BootstrapSummary {
  iterations: number;
  blockSizeDays: number;
  seed: number;
  cagrPct: { p2_5: number; median: number; p97_5: number };
  sharpeRatio: { p2_5: number; median: number; p97_5: number };
  maxDrawdownPct: { p2_5: number; median: number; p97_5: number };
  probCagrBelowZeroPct: number;
  probCagrBelowCash65Pct: number;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * Deterministic Mulberry32 PRNG for reproducible block-bootstrap simulations.
 */
export function createSeededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Circular Block Bootstrap preserving time-series dependence (autocorrelation & vol clustering).
 */
export function runCircularBlockBootstrap(params: {
  dailyReturns: number[];
  iterations?: number;
  blockSizeDays?: number;
  seed?: number;
}): BootstrapSummary {
  const n = params.dailyReturns.length;
  const iterations = params.iterations ?? 1000;
  const blockSize = Math.max(1, Math.min(params.blockSizeDays ?? 21, Math.max(1, n)));
  const seed = params.seed ?? 20261117;
  const rng = createSeededRng(seed);

  if (n < 2) {
    return {
      iterations,
      blockSizeDays: blockSize,
      seed,
      cagrPct: { p2_5: 0, median: 0, p97_5: 0 },
      sharpeRatio: { p2_5: 0, median: 0, p97_5: 0 },
      maxDrawdownPct: { p2_5: 0, median: 0, p97_5: 0 },
      probCagrBelowZeroPct: 0,
      probCagrBelowCash65Pct: 0,
    };
  }

  const cagrs: number[] = [];
  const sharpes: number[] = [];
  const maxDds: number[] = [];
  const years = Math.max(1 / 252, n / 252);

  for (let iter = 0; iter < iterations; iter++) {
    const sample: number[] = [];
    while (sample.length < n) {
      const startIdx = Math.floor(rng() * n);
      for (let k = 0; k < blockSize && sample.length < n; k++) {
        sample.push(params.dailyReturns[(startIdx + k) % n]);
      }
    }

    let eq = 1.0;
    let peak = 1.0;
    let maxDd = 0;
    let sum = 0;
    for (const r of sample) {
      eq *= 1 + r;
      sum += r;
      if (eq > peak) peak = eq;
      const dd = (peak - eq) / peak;
      if (dd > maxDd) maxDd = dd;
    }

    const cagr = Math.pow(Math.max(0.0001, eq), 1 / years) - 1;
    const mean = sum / n;
    let varSum = 0;
    for (const r of sample) varSum += (r - mean) ** 2;
    const annVol = Math.sqrt(varSum / Math.max(1, n - 1)) * Math.sqrt(252);
    const sharpe = annVol > 0 ? (cagr - 0.065) / annVol : 0;

    cagrs.push(cagr * 100);
    sharpes.push(sharpe);
    maxDds.push(maxDd * 100);
  }

  const pct = (arr: number[], q: number) => {
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))));
    return round2(sorted[idx]);
  };

  const belowZero = cagrs.filter((c) => c < 0).length;
  const belowCash = cagrs.filter((c) => c < 6.5).length;

  return {
    iterations,
    blockSizeDays: blockSize,
    seed,
    cagrPct: { p2_5: pct(cagrs, 0.025), median: pct(cagrs, 0.5), p97_5: pct(cagrs, 0.975) },
    sharpeRatio: { p2_5: pct(sharpes, 0.025), median: pct(sharpes, 0.5), p97_5: pct(sharpes, 0.975) },
    maxDrawdownPct: { p2_5: pct(maxDds, 0.025), median: pct(maxDds, 0.5), p97_5: pct(maxDds, 0.975) },
    probCagrBelowZeroPct: round2((belowZero / iterations) * 100),
    probCagrBelowCash65Pct: round2((belowCash / iterations) * 100),
  };
}

/**
 * Classifies historical market regimes strictly causally using rolling 200-SMA, 60-day return, and 20-day realized vol.
 */
export function classifyMarketRegimes(bars: DailyCandleBar[]): Map<string, RegimeDayLabel> {
  const map = new Map<string, RegimeDayLabel>();
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    let trendRegime: MarketTrendRegime = "SIDEWAYS";
    if (i >= 200) {
      const sma200 = bars.slice(i - 200, i).reduce((a, x) => a + x.adjClose, 0) / 200;
      const ret60 = b.adjClose / bars[i - 60].adjClose - 1;
      if (b.adjClose > sma200 && ret60 > 0.03) trendRegime = "BULL";
      else if (b.adjClose < sma200 && ret60 < -0.03) trendRegime = "BEAR";
    }

    let volRegime: MarketVolRegime = "MID_VOL";
    if (i >= 21) {
      const slice = bars.slice(i - 20, i + 1);
      const rets: number[] = [];
      for (let k = 1; k < slice.length; k++) {
        rets.push(slice[k].adjClose / slice[k - 1].adjClose - 1);
      }
      const mean = rets.reduce((a, x) => a + x, 0) / rets.length;
      const vol = Math.sqrt(rets.reduce((a, x) => a + (x - mean) ** 2, 0) / Math.max(1, rets.length - 1)) * Math.sqrt(252);
      if (vol >= 0.18) volRegime = "HIGH_VOL";
      else if (vol < 0.12) volRegime = "LOW_VOL";
    }

    map.set(b.date, { date: b.date, trendRegime, volRegime });
  }
  return map;
}

export function evaluateEquityByRegime(params: {
  equityCurve: PortfolioEquityPoint[];
  regimeMap: Map<string, RegimeDayLabel>;
}): RegimePerformanceSummary[] {
  const buckets = new Map<string, PortfolioEquityPoint[]>();
  for (const pt of params.equityCurve) {
    const reg = params.regimeMap.get(pt.date);
    if (!reg) continue;
    for (const label of [`TREND_${reg.trendRegime}`, `VOL_${reg.volRegime}`]) {
      const arr = buckets.get(label) ?? [];
      arr.push(pt);
      buckets.set(label, arr);
    }
  }

  const summaries: RegimePerformanceSummary[] = [];
  for (const [regime, pts] of [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    let eq = 1.0;
    let peak = 1.0;
    let maxDd = 0;
    let wins = 0;
    let losses = 0;
    for (const p of pts) {
      eq *= 1 + p.dailyReturn;
      if (eq > peak) peak = eq;
      const dd = (peak - eq) / peak;
      if (dd > maxDd) maxDd = dd;
      if (p.dailyReturn > 0) wins += 1;
      else if (p.dailyReturn < 0) losses += 1;
    }
    const years = Math.max(1 / 252, pts.length / 252);
    const annRet = (Math.pow(Math.max(0.0001, eq), 1 / years) - 1) * 100;
    const avgInv = (pts.reduce((a, p) => a + p.investedWeight, 0) / Math.max(1, pts.length)) * 100;
    summaries.push({
      regime,
      tradingDays: pts.length,
      annualizedReturnPct: round2(annRet),
      cumulativeReturnPct: round2((eq - 1) * 100),
      maxDrawdownPct: round2(maxDd * 100),
      avgInvestedWeightPct: round2(avgInv),
      winRatePct: round2((wins / Math.max(1, wins + losses)) * 100),
    });
  }
  return summaries;
}

/**
 * Wilson score 95% confidence interval for win rate proportion.
 */
export function wilsonWinRateCI(wins: number, total: number): { ratePct: number; ciLowPct: number; ciHighPct: number } {
  if (total <= 0) return { ratePct: 0, ciLowPct: 0, ciHighPct: 0 };
  const z = 1.96;
  const p = wins / total;
  const denom = 1 + (z * z) / total;
  const center = (p + (z * z) / (2 * total)) / denom;
  const half = (z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total)) / denom;
  return {
    ratePct: round2(p * 100),
    ciLowPct: round2(Math.max(0, center - half) * 100),
    ciHighPct: round2(Math.min(1, center + half) * 100),
  };
}

