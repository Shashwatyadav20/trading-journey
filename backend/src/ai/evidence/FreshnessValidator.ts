import { MarketSessionValidator } from "../../indian/market/MarketSessionValidator";
import {
  EvidenceCategory,
  EvidenceFreshness,
  EvidenceRecord,
  GranularFreshness,
  isValidIsoTimestamp,
  validateEvidenceRecord,
} from "./EvidenceSchema";

export interface CategoryFreshnessThreshold {
  freshMaxAgeMs: number;
  staleMaxAgeMs: number;
  sessionAware?: boolean;
}

export type FreshnessThresholdsConfig = Record<EvidenceCategory, CategoryFreshnessThreshold>;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export const DEFAULT_FRESHNESS_THRESHOLDS: FreshnessThresholdsConfig = {
  INTRADAY_PRICE: {
    freshMaxAgeMs: 2 * MINUTE_MS,
    staleMaxAgeMs: 15 * MINUTE_MS,
    sessionAware: true,
  },
  DAILY_MARKET_DATA: {
    freshMaxAgeMs: 24 * HOUR_MS,
    staleMaxAgeMs: 72 * HOUR_MS,
    sessionAware: true,
  },
  THIRD_PARTY_NEWS: {
    freshMaxAgeMs: 24 * HOUR_MS,
    staleMaxAgeMs: 72 * HOUR_MS,
    sessionAware: false,
  },
  COMPANY_ANNOUNCEMENT: {
    freshMaxAgeMs: 7 * DAY_MS,
    staleMaxAgeMs: 30 * DAY_MS,
    sessionAware: false,
  },
  REGULATORY_FILING: {
    freshMaxAgeMs: 7 * DAY_MS,
    staleMaxAgeMs: 30 * DAY_MS,
    sessionAware: false,
  },
  QUARTERLY_FINANCIALS: {
    freshMaxAgeMs: 95 * DAY_MS,
    staleMaxAgeMs: 140 * DAY_MS,
    sessionAware: false,
  },
  INSTITUTIONAL_HOLDING: {
    freshMaxAgeMs: 100 * DAY_MS,
    staleMaxAgeMs: 150 * DAY_MS,
    sessionAware: false,
  },
};

export interface FreshnessValidationResult {
  records: EvidenceRecord[];
  freshCount: number;
  staleCount: number;
  expiredCount: number;
  invalidTimestampCount: number;
}

const MAX_ALLOWED_FUTURE_SKEW_MS = 5 * MINUTE_MS;

export class FreshnessValidator {
  private readonly thresholds: FreshnessThresholdsConfig;
  private readonly sessionValidator: MarketSessionValidator;

  public constructor(
    thresholds: FreshnessThresholdsConfig = DEFAULT_FRESHNESS_THRESHOLDS,
    sessionValidator: MarketSessionValidator = new MarketSessionValidator()
  ) {
    this.thresholds = thresholds;
    this.sessionValidator = sessionValidator;
  }

  /**
   * Granular freshness evaluation distinguishing FRESH, AGING, STALE, EXPIRED, and UNKNOWN.
   * Never upgrades stale or expired evidence to fresh.
   */
  public evaluateGranularFreshness(
    record: EvidenceRecord,
    referenceDate: Date = new Date()
  ): { freshness: GranularFreshness; reason: string } {
    if (!isValidIsoTimestamp(record.publishedAt)) {
      return {
        freshness: "UNKNOWN",
        reason: "MISSING_OR_INVALID_PUBLISHED_AT",
      };
    }

    const base = this.evaluateFreshness(record, referenceDate);
    if (base.freshness === "FRESH") {
      const publishedMs = Date.parse(record.publishedAt!);
      const ageMs = Math.max(0, referenceDate.getTime() - publishedMs);
      const threshold = this.thresholds[record.category];
      if (ageMs >= threshold.freshMaxAgeMs * 0.5) {
        return {
          freshness: "AGING",
          reason: "APPROACHING_FRESHNESS_LIMIT",
        };
      }
    }
    return base;
  }

  public evaluateFreshness(
    record: EvidenceRecord,
    referenceDate: Date = new Date()
  ): { freshness: EvidenceFreshness; reason: string } {
    if (!isValidIsoTimestamp(record.publishedAt)) {
      return {
        freshness: "EXPIRED",
        reason: "MISSING_OR_INVALID_PUBLISHED_AT",
      };
    }

    const publishedMs = Date.parse(record.publishedAt!);
    const referenceMs = referenceDate.getTime();
    const ageMs = referenceMs - publishedMs;

    if (ageMs < -MAX_ALLOWED_FUTURE_SKEW_MS) {
      return {
        freshness: "EXPIRED",
        reason: "FUTURE_TIMESTAMP_ANOMALY",
      };
    }

    const effectiveAgeMs = Math.max(0, ageMs);
    const threshold = this.thresholds[record.category];

    // Session-aware intraday handling:
    // Outside NSE regular hours, intraday quotes older than 2m cannot be live-ticking FRESH;
    // if they are from the most recent session (<= 72h), mark STALE rather than FRESH,
    // and > 72h mark EXPIRED. During live market hours, strict 2m / 15m applies.
    if (threshold.sessionAware && record.category === "INTRADAY_PRICE") {
      const marketOpen =
        this.sessionValidator.getMarketSessionStatus(referenceDate) === "MARKET_OPEN";
      if (!marketOpen) {
        if (effectiveAgeMs <= 72 * HOUR_MS) {
          return {
            freshness: effectiveAgeMs <= threshold.freshMaxAgeMs ? "FRESH" : "STALE",
            reason: "OUTSIDE_MARKET_HOURS_LAST_SESSION",
          };
        }
        return {
          freshness: "EXPIRED",
          reason: "OUTSIDE_MARKET_HOURS_EXPIRED",
        };
      }
    }

    if (effectiveAgeMs <= threshold.freshMaxAgeMs) {
      return {
        freshness: "FRESH",
        reason: "WITHIN_FRESH_THRESHOLD",
      };
    }

    if (effectiveAgeMs <= threshold.staleMaxAgeMs) {
      return {
        freshness: "STALE",
        reason: "WITHIN_STALE_THRESHOLD",
      };
    }

    return {
      freshness: "EXPIRED",
      reason: "EXCEEDED_STALE_THRESHOLD",
    };
  }

  public validateAll(
    inputRecords: EvidenceRecord[],
    referenceDate: Date = new Date()
  ): FreshnessValidationResult {
    let invalidTimestampCount = 0;

    const validated = inputRecords.map((orig) => {
      const record: EvidenceRecord = {
        ...orig,
        supportingEvidenceIds: [...orig.supportingEvidenceIds],
        conflictingEvidenceIds: [...orig.conflictingEvidenceIds],
        metadata: orig.metadata ? { ...orig.metadata } : undefined,
      };

      const { freshness, reason } = this.evaluateFreshness(record, referenceDate);
      record.freshness = freshness;

      if (
        reason === "MISSING_OR_INVALID_PUBLISHED_AT" ||
        reason === "FUTURE_TIMESTAMP_ANOMALY"
      ) {
        invalidTimestampCount += 1;
        record.confidence = Math.min(record.confidence, 0.15);
      } else if (freshness === "EXPIRED") {
        record.confidence = Math.min(record.confidence, 0.35);
      } else if (freshness === "STALE") {
        record.confidence = Math.min(record.confidence, 0.75);
      }

      record.metadata = {
        ...(record.metadata ?? {}),
        freshnessReason: reason,
      };

      validateEvidenceRecord(record);
      return record;
    });

    return {
      records: validated,
      freshCount: validated.filter((r) => r.freshness === "FRESH").length,
      staleCount: validated.filter((r) => r.freshness === "STALE").length,
      expiredCount: validated.filter((r) => r.freshness === "EXPIRED").length,
      invalidTimestampCount,
    };
  }
}

export const freshnessValidator = new FreshnessValidator();
