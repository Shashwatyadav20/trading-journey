import type { SupabaseClient } from "@supabase/supabase-js";
import {
  evaluatePointInTimeSnapshot,
  filterAnnouncementsAsOf,
  filterCandlesAsOf,
  filterFinancialsAsOf,
  filterOwnershipAsOf,
  type DailyCandleBar,
  type HistoricalScoreBreakdown,
} from "./HistoricalValidationEngine.js";
import type { ExtractedFinancialFactRecord, VerificationStatus } from "./BseXbrlBackfillService.js";
import type { NormalizedShareholdingRecord } from "./OfficialShareholdingIntelligenceEngine.js";
import type { ClassifiedAnnouncementRecord } from "./CorporateAnnouncementIntelligence.js";

export type ShadowResearchDecision = "BUY_CANDIDATE" | "SELL_CANDIDATE" | "WATCH" | "WAIT";

export interface ShadowSignalRecord {
  idempotencyKey: string; // `${symbol}|${signalDate}`
  symbol: string;
  sector: string;
  signalDate: string; // YYYY-MM-DD
  marketDataTimestamp: string;
  evaluationTimestamp: string;
  decision: ShadowResearchDecision;
  score: number;
  confidence: number;
  verificationStatus: VerificationStatus;
  missingFields: string[];
  evidenceSummary: string[];
  referencePrice: number | null;
  scoreBreakdown: HistoricalScoreBreakdown;
  immutable: true;
}

export interface ForwardReturnObservation {
  idempotencyKey: string;
  symbol: string;
  sector: string;
  signalDate: string;
  decision: ShadowResearchDecision;
  referencePrice: number;
  ret1dPct: number | null;
  ret5dPct: number | null;
  ret10dPct: number | null;
  ret20dPct: number | null;
  ret60dPct: number | null;
  mfePct: number | null;
  maePct: number | null;
  observationTradingDays: number;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * Complete paginated loader for any Supabase table (bypasses PostgREST 1,000-row default cap).
 */
export async function loadAllRowsPaginated<T = any>(
  supabase: SupabaseClient<any>,
  tableName: string,
  selectCols = "*",
  pageSize = 1000
): Promise<T[]> {
  const all: T[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from(tableName)
      .select(selectCols)
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error(`[${tableName}] pagination error: ${error.code} ${error.message}`);
    const batch = (data ?? []) as T[];
    all.push(...batch);
    if (batch.length < pageSize) break;
    offset += pageSize;
  }
  return all;
}

export function mapScoreToShadowDecision(breakdown: HistoricalScoreBreakdown): {
  decision: ShadowResearchDecision;
  verificationStatus: VerificationStatus;
  confidence: number;
} {
  const hasCriticalMissing = breakdown.missingData.includes("insufficientVerifiedFinancials");
  if (hasCriticalMissing) {
    return { decision: "WAIT", verificationStatus: "MISSING", confidence: 0.25 };
  }
  const hasInstMissing = breakdown.missingData.includes("verifiedInstitutionalOwnership");
  const verificationStatus: VerificationStatus = hasInstMissing ? "UNVERIFIED" : "VERIFIED";
  const confidence = verificationStatus === "VERIFIED" ? 0.9 : 0.65;

  if (breakdown.totalScore >= 50 && verificationStatus === "VERIFIED") {
    return { decision: "BUY_CANDIDATE", verificationStatus, confidence };
  }
  if (breakdown.totalScore >= 35) {
    return { decision: "WATCH", verificationStatus, confidence };
  }
  if (breakdown.totalScore < 25 && verificationStatus === "VERIFIED") {
    return { decision: "SELL_CANDIDATE", verificationStatus, confidence };
  }
  return { decision: "WAIT", verificationStatus, confidence };
}

export class Strategy03ShadowRunner {
  public evaluateSymbolAsOf(params: {
    symbol: string;
    sector: string;
    signalDate: string;
    financials: ExtractedFinancialFactRecord[];
    ownership: NormalizedShareholdingRecord[];
    announcements: ClassifiedAnnouncementRecord[];
    candles: DailyCandleBar[];
    evaluationTimestamp?: string;
  }): ShadowSignalRecord {
    const evaluationTimestamp = params.evaluationTimestamp ?? new Date().toISOString();
    const pitFins = filterFinancialsAsOf(params.financials, params.signalDate);
    const pitOwn = filterOwnershipAsOf(params.ownership, params.signalDate);
    const pitCandles = filterCandlesAsOf(params.candles, params.signalDate);
    const pitAnns = filterAnnouncementsAsOf(
      params.announcements.map((a) => ({
        exchange: a.exchange,
        filingId: a.filingId,
        symbol: a.symbol,
        companyName: a.companyName,
        category: a.category as any,
        headline: a.headline,
        extractedText: a.extractedText,
        extractionStatus: a.verificationStatus === "VERIFIED" ? ("EXTRACTED" as const) : ("PDF_ATTACHMENT_ONLY" as const),
        extractionConfidence: a.extractionConfidence,
        isAmbiguous: a.isAmbiguous,
        evidence: {
          sourceName: "NSE_CORPORATE_ANNOUNCEMENTS",
          sourceUrlOrFilingId: a.filingId,
          sourceUrl: a.sourceUrl,
          reportingPeriod: a.publishedAt?.slice(0, 10) ?? params.signalDate,
          retrievedAt: a.retrievedAt,
          publishedAt: a.publishedAt,
          isStale: false,
          hasSourceConflict: a.hasSourceConflict,
          verificationStatus: a.verificationStatus,
          confidence: a.extractionConfidence,
        },
      })),
      params.signalDate
    );

    const breakdown = evaluatePointInTimeSnapshot(
      {
        symbol: params.symbol,
        sector: params.sector,
        asOfDate: params.signalDate,
        financials: pitFins,
        ownership: pitOwn,
        announcements: pitAnns,
        candles: pitCandles,
      },
      "A_FULL_STRATEGY_03"
    );

    const mapped = mapScoreToShadowDecision(breakdown);
    const latestCandle = pitCandles[pitCandles.length - 1] ?? null;

    return {
      idempotencyKey: `${params.symbol.toUpperCase()}|${params.signalDate}`,
      symbol: params.symbol.toUpperCase(),
      sector: params.sector,
      signalDate: params.signalDate,
      marketDataTimestamp: latestCandle ? `${latestCandle.date}T15:30:00+05:30` : `${params.signalDate}T00:00:00Z`,
      evaluationTimestamp,
      decision: mapped.decision,
      score: breakdown.totalScore,
      confidence: mapped.confidence,
      verificationStatus: mapped.verificationStatus,
      missingFields: breakdown.missingData,
      evidenceSummary: breakdown.publicationTimestamps,
      referencePrice: latestCandle ? round2(latestCandle.adjClose) : null,
      scoreBreakdown: breakdown,
      immutable: true,
    };
  }
}

/**
 * Appends new shadow signals without ever overwriting existing immutable (symbol, signalDate) records.
 */
export function appendShadowSignalsImmutable(
  existingLedger: ShadowSignalRecord[],
  newSignals: ShadowSignalRecord[]
): { ledger: ShadowSignalRecord[]; addedCount: number; skippedDuplicatesCount: number } {
  const seen = new Set(existingLedger.map((s) => s.idempotencyKey));
  const merged = [...existingLedger];
  let addedCount = 0;
  let skippedDuplicatesCount = 0;

  for (const sig of newSignals) {
    if (seen.has(sig.idempotencyKey)) {
      skippedDuplicatesCount += 1;
      continue;
    }
    seen.add(sig.idempotencyKey);
    merged.push(sig);
    addedCount += 1;
  }

  return { ledger: merged, addedCount, skippedDuplicatesCount };
}

/**
 * Computes forward 1D, 5D, 10D, 20D, 60D returns and MFE/MAE using strictly post-signal adjusted close prices.
 */
export function trackForwardReturns(
  signal: ShadowSignalRecord,
  allCandles: DailyCandleBar[]
): ForwardReturnObservation | null {
  if (signal.referencePrice === null || signal.referencePrice <= 0) return null;
  const future = allCandles.filter((c) => c.date > signal.signalDate);
  if (future.length === 0) {
    return {
      idempotencyKey: signal.idempotencyKey,
      symbol: signal.symbol,
      sector: signal.sector,
      signalDate: signal.signalDate,
      decision: signal.decision,
      referencePrice: signal.referencePrice,
      ret1dPct: null,
      ret5dPct: null,
      ret10dPct: null,
      ret20dPct: null,
      ret60dPct: null,
      mfePct: null,
      maePct: null,
      observationTradingDays: 0,
    };
  }

  const ref = signal.referencePrice;
  const retAt = (idx: number) =>
    future.length >= idx ? round2(((future[idx - 1].adjClose - ref) / ref) * 100) : null;

  let maxHigh = -Infinity;
  let minLow = Infinity;
  for (const bar of future.slice(0, 60)) {
    const retBar = ((bar.adjClose - ref) / ref) * 100;
    if (retBar > maxHigh) maxHigh = retBar;
    if (retBar < minLow) minLow = retBar;
  }

  return {
    idempotencyKey: signal.idempotencyKey,
    symbol: signal.symbol,
    sector: signal.sector,
    signalDate: signal.signalDate,
    decision: signal.decision,
    referencePrice: ref,
    ret1dPct: retAt(1),
    ret5dPct: retAt(5),
    ret10dPct: retAt(10),
    ret20dPct: retAt(20),
    ret60dPct: retAt(60),
    mfePct: Number.isFinite(maxHigh) ? round2(maxHigh) : null,
    maePct: Number.isFinite(minLow) ? round2(minLow) : null,
    observationTradingDays: future.length,
  };
}

export interface HorizonCohortSummary {
  horizonDays: 1 | 5 | 10 | 20 | 60;
  eligibleSignals: number;
  maturedSignals: number;
  incompleteSignals: number;
  avgReturnPct: number | null;
  medianReturnPct: number | null;
  winRatePct: number | null;
  avgMfePct: number | null;
  avgMaePct: number | null;
}

export function computeHorizonCohortStats(
  observations: ForwardReturnObservation[],
  horizonDays: 1 | 5 | 10 | 20 | 60
): HorizonCohortSummary {
  const key =
    horizonDays === 1
      ? "ret1dPct"
      : horizonDays === 5
      ? "ret5dPct"
      : horizonDays === 10
      ? "ret10dPct"
      : horizonDays === 20
      ? "ret20dPct"
      : "ret60dPct";

  const matured = observations.filter((o) => o[key] !== null);
  const rets = matured.map((o) => o[key] as number).sort((a, b) => a - b);
  const mfes = matured.map((o) => o.mfePct).filter((v): v is number => v !== null);
  const maes = matured.map((o) => o.maePct).filter((v): v is number => v !== null);

  const avg = (arr: number[]) => (arr.length > 0 ? round2(arr.reduce((a, b) => a + b, 0) / arr.length) : null);
  const median =
    rets.length === 0
      ? null
      : rets.length % 2 === 1
      ? rets[Math.floor(rets.length / 2)]
      : round2((rets[rets.length / 2 - 1] + rets[rets.length / 2]) / 2);

  return {
    horizonDays,
    eligibleSignals: observations.length,
    maturedSignals: matured.length,
    incompleteSignals: observations.length - matured.length,
    avgReturnPct: avg(rets),
    medianReturnPct: median,
    winRatePct: rets.length > 0 ? round2((rets.filter((r) => r > 0).length / rets.length) * 100) : null,
    avgMfePct: avg(mfes),
    avgMaePct: avg(maes),
  };
}

export function computeScoreReturnCorrelation(pairs: Array<{ score: number; forwardRetPct: number }>): number | null {
  if (pairs.length < 3) return null;
  const n = pairs.length;
  const meanX = pairs.reduce((a, p) => a + p.score, 0) / n;
  const meanY = pairs.reduce((a, p) => a + p.forwardRetPct, 0) / n;
  let num = 0;
  let denX = 0;
  let denY = 0;
  for (const p of pairs) {
    const dx = p.score - meanX;
    const dy = p.forwardRetPct - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  const den = Math.sqrt(denX * denY);
  return den > 0 ? round2(num / den) : null;
}
