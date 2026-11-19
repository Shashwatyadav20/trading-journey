import {
  EvidenceRecord,
  EvidenceValue,
  validateEvidenceRecord,
} from "./EvidenceSchema";

export interface ConflictResolutionOptions {
  /** Relative tolerance for numeric values after unit normalization (default 0.005 = 0.5%). */
  numericToleranceRatio?: number;
  /** Optional explicit FX rates, e.g. { USD_INR: 84.5 }. Never guessed when omitted. */
  fxRates?: Record<string, number>;
}

export interface ConflictDetail {
  conflictKey: string;
  symbol: string;
  claim: string;
  evidenceIds: string[];
  values: Array<{
    evidenceId: string;
    source: string;
    value: EvidenceValue;
    unit: string | null;
    currency: string | null;
    verificationStatus: EvidenceRecord["verificationStatus"];
  }>;
  resolvedByRule: boolean;
  conflictStatus?: "RESOLVED_BY_SOURCE_HIERARCHY" | "CONFLICT_UNRESOLVED";
  reportingPeriods?: string[];
  resolutionReason: string | null;
}

export interface ConflictResolutionResult {
  records: EvidenceRecord[];
  conflicts: ConflictDetail[];
  deduplicatedCount: number;
}

const SCALE_FACTORS: Record<string, number> = {
  "": 1,
  UNIT: 1,
  UNITS: 1,
  INR: 1,
  RUPEE: 1,
  RUPEES: 1,
  USD: 1,
  "%": 1,
  PERCENT: 1,
  PCT: 1,
  X: 1,
  RATIO: 1,
  K: 1_000,
  THOUSAND: 1_000,
  THOUSANDS: 1_000,
  LAKH: 100_000,
  LAKHS: 100_000,
  CR: 10_000_000,
  CRORE: 10_000_000,
  CRORES: 10_000_000,
  M: 1_000_000,
  MILLION: 1_000_000,
  MILLIONS: 1_000_000,
  B: 1_000_000_000,
  BILLION: 1_000_000_000,
  BILLIONS: 1_000_000_000,
};

function normalizeClaimName(claim: string): string {
  return claim.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeConflictGroupClaim(claim: string): string {
  return claim
    .trim()
    .toLowerCase()
    .replace(/\(\s*(?:consolidated|standalone)\s*\)/gi, " ")
    .replace(/\b(?:consolidated|standalone)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractReportingPeriod(record: EvidenceRecord): string | null {
  const raw =
    record.dataPeriod ??
    (typeof record.metadata?.dataPeriod === "string"
      ? record.metadata.dataPeriod
      : null);
  if (!raw || typeof raw !== "string") return null;
  const cleaned = raw.trim().toUpperCase().replace(/\s+/g, " ");
  return cleaned.length > 0 ? cleaned : null;
}

function normalizeScaleFactor(unit: string | null): number | null {
  const key = (unit ?? "").trim().toUpperCase();
  if (key in SCALE_FACTORS) {
    return SCALE_FACTORS[key];
  }
  return null;
}

function normalizeComparableNumeric(
  record: EvidenceRecord,
  fxRates: Record<string, number>
): { comparable: number; baseCurrency: string | null } | null {
  if (typeof record.value !== "number" || !Number.isFinite(record.value)) {
    return null;
  }

  const scale = normalizeScaleFactor(record.unit);
  if (scale === null) {
    return null;
  }

  const currency = record.currency ? record.currency.trim().toUpperCase() : null;
  if (!currency || currency === "INR") {
    return { comparable: record.value * scale, baseCurrency: currency };
  }

  const fxKey = `${currency}_INR`;
  const rate = fxRates[fxKey];
  if (typeof rate === "number" && Number.isFinite(rate) && rate > 0) {
    return { comparable: record.value * scale * rate, baseCurrency: "INR" };
  }

  return { comparable: record.value * scale, baseCurrency: currency };
}

function areRecordsEquivalentForDedupe(a: EvidenceRecord, b: EvidenceRecord): boolean {
  return (
    a.symbol === b.symbol &&
    normalizeClaimName(a.claim) === normalizeClaimName(b.claim) &&
    a.value === b.value &&
    (a.unit ?? null) === (b.unit ?? null) &&
    (a.currency ?? null) === (b.currency ?? null) &&
    extractReportingPeriod(a) === extractReportingPeriod(b) &&
    extractBasis(a) === extractBasis(b) &&
    a.source.trim().toLowerCase() === b.source.trim().toLowerCase() &&
    (a.sourceUrl ?? null) === (b.sourceUrl ?? null) &&
    (a.publishedAt ?? null) === (b.publishedAt ?? null)
  );
}

function extractBasis(record: EvidenceRecord): "consolidated" | "standalone" | null {
  const metaBasis = String(record.metadata?.basis ?? "").trim().toLowerCase();
  if (metaBasis === "consolidated" || metaBasis === "standalone") {
    return metaBasis;
  }
  const lowerClaim = record.claim.toLowerCase();
  if (/\bconsolidated\b/.test(lowerClaim)) return "consolidated";
  if (/\bstandalone\b/.test(lowerClaim)) return "standalone";
  return null;
}

function valuesConflict(
  a: EvidenceRecord,
  b: EvidenceRecord,
  toleranceRatio: number,
  fxRates: Record<string, number>
): boolean {
  const basisA = extractBasis(a);
  const basisB = extractBasis(b);
  if (basisA && basisB && basisA !== basisB) {
    // Consolidated vs standalone basis mismatch must never be treated as equivalent
    return true;
  }

  const periodA = extractReportingPeriod(a);
  const periodB = extractReportingPeriod(b);
  if (periodA && periodB && periodA !== periodB) {
    // Different reporting periods for the same claim must never be silently merged
    return true;
  }

  if (a.value === null || b.value === null) {
    return false;
  }

  if (typeof a.value === "number" && typeof b.value === "number") {
    const normA = normalizeComparableNumeric(a, fxRates);
    const normB = normalizeComparableNumeric(b, fxRates);

    if (!normA || !normB) {
      // Incompatible or unknown units cannot be silently reconciled.
      return (a.unit ?? "") !== (b.unit ?? "") || Math.abs(a.value - b.value) > 0;
    }

    if (
      normA.baseCurrency &&
      normB.baseCurrency &&
      normA.baseCurrency !== normB.baseCurrency
    ) {
      // Different currencies without explicit FX rate -> explicit conflict.
      return true;
    }

    const denom = Math.max(Math.abs(normA.comparable), Math.abs(normB.comparable), 1);
    return Math.abs(normA.comparable - normB.comparable) / denom > toleranceRatio;
  }

  if (typeof a.value === "boolean" && typeof b.value === "boolean") {
    return a.value !== b.value;
  }

  return (
    String(a.value).trim().toLowerCase() !== String(b.value).trim().toLowerCase()
  );
}

export class ConflictResolver {
  public resolve(
    inputRecords: EvidenceRecord[],
    options: ConflictResolutionOptions = {}
  ): ConflictResolutionResult {
    const toleranceRatio = options.numericToleranceRatio ?? 0.005;
    const fxRates = options.fxRates ?? {};

    // 1. Deduplicate identical records while preserving provenance IDs.
    const deduplicated: EvidenceRecord[] = [];
    let deduplicatedCount = 0;

    for (const orig of inputRecords) {
      const copy: EvidenceRecord = {
        ...orig,
        supportingEvidenceIds: [...orig.supportingEvidenceIds],
        conflictingEvidenceIds: [...orig.conflictingEvidenceIds],
        metadata: orig.metadata ? { ...orig.metadata } : undefined,
      };

      const existing = deduplicated.find((d) => areRecordsEquivalentForDedupe(d, copy));
      if (existing) {
        deduplicatedCount += 1;
        existing.supportingEvidenceIds = Array.from(
          new Set([...existing.supportingEvidenceIds, copy.evidenceId])
        );
        continue;
      }
      deduplicated.push(copy);
    }

    // 2. Group non-null records by (symbol, normalizedConflictGroupClaim).
    const groups = new Map<string, EvidenceRecord[]>();
    for (const rec of deduplicated) {
      if (rec.value === null) {
        continue;
      }
      const key = `${rec.symbol}::${normalizeConflictGroupClaim(rec.claim)}`;
      const list = groups.get(key) ?? [];
      list.push(rec);
      groups.set(key, list);
    }

    const conflicts: ConflictDetail[] = [];

    for (const [conflictKey, group] of groups.entries()) {
      if (group.length < 2) {
        continue;
      }

      const conflictingPairs = new Set<string>();
      for (let i = 0; i < group.length; i += 1) {
        for (let j = i + 1; j < group.length; j += 1) {
          const a = group[i];
          const b = group[j];
          if (valuesConflict(a, b, toleranceRatio, fxRates)) {
            conflictingPairs.add(a.evidenceId);
            conflictingPairs.add(b.evidenceId);
            a.conflictingEvidenceIds = Array.from(
              new Set([...a.conflictingEvidenceIds, b.evidenceId])
            );
            b.conflictingEvidenceIds = Array.from(
              new Set([...b.conflictingEvidenceIds, a.evidenceId])
            );
          }
        }
      }

      if (conflictingPairs.size === 0) {
        continue;
      }

      const conflictingRecords = group.filter((r) => conflictingPairs.has(r.evidenceId));
      const officialVerified = conflictingRecords.filter(
        (r) =>
          r.verificationStatus === "VERIFIED" &&
          r.sourceTier === "OFFICIAL_EXCHANGE_OR_FILING"
      );

      let resolvedByRule = false;
      let resolutionReason: string | null = null;

      const bases = new Set(
        conflictingRecords.map(extractBasis).filter((b): b is "consolidated" | "standalone" => b !== null)
      );
      const distinctPeriods = new Set(
        conflictingRecords
          .map(extractReportingPeriod)
          .filter((p): p is string => p !== null)
      );
      if (bases.size > 1) {
        resolvedByRule = false;
        resolutionReason =
          "CONFLICT_UNRESOLVED: Consolidated and standalone financial bases cannot be compared as equivalent.";
      } else if (distinctPeriods.size > 1) {
        resolvedByRule = false;
        resolutionReason =
          "CONFLICT_UNRESOLVED: Incompatible reporting periods cannot be merged or compared as equivalent.";
      } else if (officialVerified.length === 1) {
        const officialVal = officialVerified[0];
        const allOthersUnverified = conflictingRecords.every(
          (r) => r.evidenceId === officialVal.evidenceId || r.verificationStatus !== "VERIFIED"
        );
        if (allOthersUnverified) {
          resolvedByRule = true;
          resolutionReason = `Official verified source (${officialVal.source}) takes precedence over unverified conflicting source(s); conflict preserved for audit.`;
        }
      }

      if (!resolvedByRule && !resolutionReason) {
        resolutionReason = "CONFLICT_UNRESOLVED: Multiple conflicting values cannot be reconciled automatically.";
      }

      for (const rec of conflictingRecords) {
        rec.verificationStatus = "CONFLICTED";
        rec.confidence = Math.min(rec.confidence, 0.4);
        rec.metadata = {
          ...(rec.metadata ?? {}),
          conflictDetected: true,
          ...(resolutionReason ? { resolutionReason } : {}),
        };
        validateEvidenceRecord(rec);
      }

      const reportingPeriods = Array.from(
        new Set(
          conflictingRecords
            .map((r) => r.dataPeriod ?? (typeof r.metadata?.dataPeriod === "string" ? r.metadata.dataPeriod : null))
            .filter((p): p is string => Boolean(p))
        )
      );

      conflicts.push({
        conflictKey,
        symbol: conflictingRecords[0].symbol,
        claim: conflictingRecords[0].claim,
        evidenceIds: conflictingRecords.map((r) => r.evidenceId),
        values: conflictingRecords.map((r) => ({
          evidenceId: r.evidenceId,
          source: r.source,
          value: r.value,
          unit: r.unit,
          currency: r.currency,
          verificationStatus: r.verificationStatus,
        })),
        resolvedByRule,
        conflictStatus: resolvedByRule ? "RESOLVED_BY_SOURCE_HIERARCHY" : "CONFLICT_UNRESOLVED",
        ...(reportingPeriods.length > 0 ? { reportingPeriods } : {}),
        resolutionReason,
      });
    }

    for (const rec of deduplicated) {
      validateEvidenceRecord(rec);
    }

    return {
      records: deduplicated,
      conflicts,
      deduplicatedCount,
    };
  }
}

export const conflictResolver = new ConflictResolver();

