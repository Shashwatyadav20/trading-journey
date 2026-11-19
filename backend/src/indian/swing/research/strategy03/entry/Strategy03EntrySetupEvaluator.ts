import type { EntryClassification, EntrySetupSignal, OhlcvCandle } from "./EntrySetupTypes.js";
import { evaluateVolumeBreakoutEntry } from "./Strategy03VolumeBreakoutEntry.js";
import { evaluateBreakoutRetestEntry } from "./Strategy03BreakoutRetestEntry.js";
import { evaluateSupportBounceEntry } from "./Strategy03SupportBounceEntry.js";

export interface CombinedEntryResearchEvaluation {
  symbol: string;
  fundamentalScoreUnchanged: number;
  fundamentalVerificationStatus: "VERIFIED" | "UNVERIFIED" | "MISSING" | "STALE" | "CONFLICTED";
  entryClassification: EntryClassification;
  bestEntrySetupScore: number;
  bestSetup: EntrySetupSignal | null;
  allSetups: EntrySetupSignal[];
  reasons: string[];
}

/**
 * Evaluates all three independent entry setups alongside the UNCHANGED 100-point fundamental score.
 * - Missing/stale critical fundamental data always forces WAIT.
 * - High fundamental score without confirmed entry remains WATCH, never BUY.
 */
export function evaluateStrategy03EntrySetups(params: {
  symbol: string;
  fundamentalScoreUnchanged: number;
  fundamentalVerificationStatus: "VERIFIED" | "UNVERIFIED" | "MISSING" | "STALE" | "CONFLICTED";
  dailyCandles: OhlcvCandle[];
  candles4h: OhlcvCandle[];
  candles1h: OhlcvCandle[];
  minBreakoutRvol?: number;
  nextOpen1h?: number | null;
}): CombinedEntryResearchEvaluation {
  const breakout = evaluateVolumeBreakoutEntry({
    symbol: params.symbol,
    dailyCandles: params.dailyCandles,
    candles4h: params.candles4h,
    candles1h: params.candles1h,
    minRelativeVolume: params.minBreakoutRvol ?? 1.5,
    nextOpen1h: params.nextOpen1h,
  });
  const retest = evaluateBreakoutRetestEntry(params);
  const bounce = evaluateSupportBounceEntry(params);
  const allSetups = [breakout, retest, bounce];

  if (
    params.fundamentalVerificationStatus === "MISSING" ||
    params.fundamentalVerificationStatus === "STALE" ||
    params.fundamentalVerificationStatus === "CONFLICTED"
  ) {
    return {
      symbol: params.symbol,
      fundamentalScoreUnchanged: params.fundamentalScoreUnchanged,
      fundamentalVerificationStatus: params.fundamentalVerificationStatus,
      entryClassification: "WAIT",
      bestEntrySetupScore: 0,
      bestSetup: null,
      allSetups,
      reasons: [`FUNDAMENTAL_DATA_${params.fundamentalVerificationStatus}_FORCES_WAIT`],
    };
  }

  const confirmed = allSetups
    .filter(
      (s) =>
        s.classification === "BREAKOUT_CONFIRMED" ||
        s.classification === "RETEST_CONFIRMED" ||
        s.classification === "SUPPORT_BOUNCE_CONFIRMED"
    )
    .sort((a, b) => b.entrySetupScore - a.entrySetupScore);

  if (confirmed.length > 0) {
    const best = confirmed[0];
    return {
      symbol: params.symbol,
      fundamentalScoreUnchanged: params.fundamentalScoreUnchanged,
      fundamentalVerificationStatus: params.fundamentalVerificationStatus,
      entryClassification: best.classification,
      bestEntrySetupScore: best.entrySetupScore,
      bestSetup: best,
      allSetups,
      reasons: [`CONFIRMED_${best.setupType}`],
    };
  }

  const allInvalidated = allSetups.every((s) => s.classification === "INVALIDATED");
  const topWatch = [...allSetups].sort((a, b) => b.entrySetupScore - a.entrySetupScore)[0];

  return {
    symbol: params.symbol,
    fundamentalScoreUnchanged: params.fundamentalScoreUnchanged,
    fundamentalVerificationStatus: params.fundamentalVerificationStatus,
    entryClassification: allInvalidated ? "INVALIDATED" : "WATCH",
    bestEntrySetupScore: topWatch?.entrySetupScore ?? 0,
    bestSetup: topWatch ?? null,
    allSetups,
    reasons: ["NO_CONFIRMED_ENTRY_SETUP_REMAINS_WATCH"],
  };
}

