export type Strategy03ScannerStatusFilter =
  | "ALL"
  | "READY"
  | "FORMING"
  | "BREAKOUT"
  | "INVALIDATED"
  | "WAIT";

export interface Strategy03PreBreakoutRecord {
  idempotencyKey?: string;
  nseSymbol: string;
  companyName?: string;
  timeframe?: string;
  status: "READY" | "FORMING" | "BREAKOUT" | "INVALIDATED" | "WAIT";
  currentPrice: number | null;
  lastUpdatedIst?: string;
  priorityScore?: number;
  scoringReasons?: string[];
  supportZone?: {
    detected?: boolean;
    supportRelevance?: string;
    supportDistancePct?: number | null;
    supportHigh?: number | null;
    supportLow?: number | null;
    reactionCount?: number;
    liquiditySweepDetected?: boolean;
    sweepLow?: number | null;
    reclaimTimestampIst?: string | null;
    zoneStartIst?: string | null;
    zoneEndIst?: string | null;
    reason?: string;
  };
  impulse?: {
    detected?: boolean;
    candleCount?: number;
    startIst?: string | null;
    endIst?: string | null;
    bodyExpansionRatio?: number;
    displacementPct?: number;
    rvol?: number;
    volumeConfirmed?: boolean;
  };
  consolidation?: {
    detected?: boolean;
    tier?: string;
    startIst?: string | null;
    endIst?: string | null;
    high?: number | null;
    low?: number | null;
    candleCount?: number;
    tradingDaysElapsed?: number;
    rangePct?: number | null;
  };
  orderBlock?: {
    detected?: boolean;
    obHigh?: number | null;
    obLow?: number | null;
    timestampIst?: string | null;
    mitigated?: boolean;
    invalidated?: boolean;
    reason?: string;
  };
  breakoutDistancePct?: number | null;
  dataProvider?: string;
  sourceReference?: string;
  sourceTimestampIst?: string;
  independentVerificationStatus?: string;
  reason?: string;
  ohlcv4hDrilldownIst?: Array<{
    timeframe?: string;
    timestamp?: string;
    timestampIst?: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    isComplete?: boolean;
    sessionBlockType?: string;
    blockDurationMinutes?: number;
  }>;
}

export interface Strategy03SignalGuidance {
  conditionsSatisfied: string[];
  conditionsPending: string[];
  invalidationLevel: number | null;
  invalidationLabel: string | null;
  nextRequiredAction: string;
}

export const STRATEGY03_STATUS_FILTERS: readonly Strategy03ScannerStatusFilter[] = [
  "ALL",
  "READY",
  "FORMING",
  "BREAKOUT",
  "INVALIDATED",
  "WAIT",
];

/**
 * Filters Strategy 03 scanner stocks by candidate status and symbol search query
 * without altering any backend classification or ordering.
 */
export function filterStrategy03Stocks<T extends { nseSymbol: string; status: string }>(
  stocks: readonly T[],
  statusFilter: Strategy03ScannerStatusFilter,
  searchQuery: string
): T[] {
  const normalizedQuery = searchQuery.trim().toUpperCase();
  return stocks.filter((item) => {
    if (statusFilter !== "ALL" && item.status !== statusFilter) {
      return false;
    }
    if (normalizedQuery && !item.nseSymbol.toUpperCase().includes(normalizedQuery)) {
      return false;
    }
    return true;
  });
}

/**
 * Counts candidates per status bucket from existing backend data.
 */
export function countStrategy03Statuses<T extends { status: string }>(
  stocks: readonly T[]
): Record<Strategy03ScannerStatusFilter, number> {
  const counts: Record<Strategy03ScannerStatusFilter, number> = {
    ALL: stocks.length,
    READY: 0,
    FORMING: 0,
    BREAKOUT: 0,
    INVALIDATED: 0,
    WAIT: 0,
  };
  for (const s of stocks) {
    if (
      s.status === "READY" ||
      s.status === "FORMING" ||
      s.status === "BREAKOUT" ||
      s.status === "INVALIDATED" ||
      s.status === "WAIT"
    ) {
      counts[s.status] += 1;
    }
  }
  return counts;
}

/**
 * Derives Signal Information (satisfied conditions, pending conditions, invalidation level,
 * and next step) strictly from existing source fields — never fabricating values.
 */
export function deriveSignalGuidance(
  pb: Strategy03PreBreakoutRecord
): Strategy03SignalGuidance {
  const conditionsSatisfied: string[] = [];
  const conditionsPending: string[] = [];

  if (pb.supportZone?.detected) {
    conditionsSatisfied.push(
      `Support cluster detected (${pb.supportZone.reactionCount ?? 0} reactions${
        pb.supportZone.supportRelevance ? `, ${pb.supportZone.supportRelevance}` : ""
      })`
    );
  } else {
    conditionsPending.push("Institutional support cluster not detected");
  }

  if (pb.supportZone?.liquiditySweepDetected) {
    conditionsSatisfied.push("Liquidity sweep & bullish reclaim confirmed");
  }

  if (pb.impulse?.detected) {
    conditionsSatisfied.push(
      `4H bullish impulse (${pb.impulse.candleCount ?? 0}B, +${pb.impulse.displacementPct ?? 0}%)`
    );
  } else {
    conditionsPending.push("4H bullish impulse displacement pending");
  }

  if (pb.impulse?.volumeConfirmed) {
    conditionsSatisfied.push(`Impulse volume confirmed (${pb.impulse.rvol ?? 0}x RVOL)`);
  } else if (pb.impulse?.detected) {
    conditionsPending.push("Impulse RVOL confirmation below threshold");
  }

  if (pb.consolidation?.detected) {
    conditionsSatisfied.push(
      `Post-impulse consolidation (${pb.consolidation.tier}, ${pb.consolidation.candleCount ?? 0}B)`
    );
  } else {
    conditionsPending.push("Clean post-impulse 4H consolidation box pending");
  }

  if (pb.orderBlock?.detected && !pb.orderBlock?.invalidated) {
    conditionsSatisfied.push("Valid 4H Bullish Order Block intact");
  } else if (pb.orderBlock?.invalidated) {
    conditionsPending.push("4H Bullish Order Block invalidated");
  } else {
    conditionsPending.push("No valid 4H Bullish Order Block before impulse");
  }

  // Determine exact invalidation level from existing boundaries without inventing numbers
  let invalidationLevel: number | null = null;
  let invalidationLabel: string | null = null;
  if (pb.consolidation?.low != null) {
    invalidationLevel = pb.consolidation.low;
    invalidationLabel = "Consolidation Low";
  } else if (pb.supportZone?.supportLow != null) {
    invalidationLevel = pb.supportZone.supportLow;
    invalidationLabel = "Support Zone Low";
  } else if (pb.orderBlock?.obLow != null) {
    invalidationLevel = pb.orderBlock.obLow;
    invalidationLabel = "Bullish OB Low";
  }

  let nextRequiredAction = "Monitor completed 4H NSE session blocks.";
  if (pb.status === "READY") {
    nextRequiredAction =
      pb.consolidation?.high != null
        ? `Await a completed 4H candle close above consolidation high (${pb.consolidation.high}) while holding above ${invalidationLevel ?? "support"}.`
        : "Await a completed 4H breakout close above consolidation resistance.";
  } else if (pb.status === "FORMING") {
    nextRequiredAction =
      "Setup is developing; await completed 4H impulse/consolidation structure.";
  } else if (pb.status === "BREAKOUT") {
    nextRequiredAction =
      "Completed 4H breakout has already occurred; no pre-breakout entry trigger.";
  } else if (pb.status === "INVALIDATED") {
    nextRequiredAction =
      "Setup invalidated by completed 4H close below structural boundary; await fresh base.";
  } else if (pb.status === "WAIT") {
    nextRequiredAction =
      pb.reason
        ? `Data/history gate active (${pb.reason}); await sufficient fresh completed 4H blocks.`
        : "Await sufficient fresh completed 4H blocks.";
  }

  return {
    conditionsSatisfied,
    conditionsPending,
    invalidationLevel,
    invalidationLabel,
    nextRequiredAction,
  };
}

