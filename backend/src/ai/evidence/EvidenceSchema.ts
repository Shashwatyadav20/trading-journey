export type EvidenceFreshness = "FRESH" | "STALE" | "EXPIRED";

export type GranularFreshness = "FRESH" | "AGING" | "STALE" | "EXPIRED" | "UNKNOWN";

export type EvidenceVerificationStatus = "VERIFIED" | "UNVERIFIED" | "CONFLICTED";

export type SourceCredibilityCategory =
  | "OFFICIAL_EXCHANGE"
  | "OFFICIAL_COMPANY"
  | "REGULATORY"
  | "GOVERNMENT"
  | "BROKER"
  | "VERIFIED_FINANCIAL_PROVIDER"
  | "NEWS_MEDIA"
  | "THIRD_PARTY"
  | "UNVERIFIED";

export type EvidenceCategory =
  | "INTRADAY_PRICE"
  | "DAILY_MARKET_DATA"
  | "QUARTERLY_FINANCIALS"
  | "COMPANY_ANNOUNCEMENT"
  | "INSTITUTIONAL_HOLDING"
  | "REGULATORY_FILING"
  | "THIRD_PARTY_NEWS";

export type SourceTier =
  | "OFFICIAL_EXCHANGE_OR_FILING"
  | "INSTITUTIONAL_DATA_FEED"
  | "THIRD_PARTY_NEWS"
  | "UNKNOWN";

export type VerificationMethod =
  | "OFFICIAL_EXCHANGE_SIGNATURE"
  | "REGULATORY_FILING_URL_MATCH"
  | "MULTI_SOURCE_CORROBORATION"
  | "UNVERIFIED_EXTERNAL_FEED"
  | "NONE";

export type EvidenceValue = number | string | boolean | null;

export interface RawEvidenceInput {
  evidenceId?: string;
  symbol: string;
  category: EvidenceCategory;
  claim: string;
  value: EvidenceValue | undefined;
  unit?: string | null;
  currency?: string | null;
  source: string;
  sourceUrl?: string | null;
  publishedAt?: string | null;
  retrievedAt?: string;
  untrustedText?: string | null;
  metadata?: Record<string, unknown>;
}

export interface EvidenceRecord {
  evidenceId: string;
  symbol: string;
  category: EvidenceCategory;
  claim: string;
  value: EvidenceValue;
  unit: string | null;
  currency: string | null;
  source: string;
  sourceTier: SourceTier;
  sourceClassification?: SourceCredibilityCategory;
  dataPeriod?: string | null;
  sourceUrl: string | null;
  publishedAt: string | null;
  retrievedAt: string;
  freshness: EvidenceFreshness;
  verificationStatus: EvidenceVerificationStatus;
  verificationMethod: VerificationMethod;
  confidence: number; // 0.0 to 1.0
  supportingEvidenceIds: string[];
  conflictingEvidenceIds: string[];
  untrustedExternal: boolean;
  metadata?: Record<string, unknown>;
}

export const VALID_EVIDENCE_CATEGORIES: ReadonlySet<EvidenceCategory> = new Set([
  "INTRADAY_PRICE",
  "DAILY_MARKET_DATA",
  "QUARTERLY_FINANCIALS",
  "COMPANY_ANNOUNCEMENT",
  "INSTITUTIONAL_HOLDING",
  "REGULATORY_FILING",
  "THIRD_PARTY_NEWS",
]);

export const VALID_FRESHNESS_STATES: ReadonlySet<EvidenceFreshness> = new Set([
  "FRESH",
  "STALE",
  "EXPIRED",
]);

export const VALID_VERIFICATION_STATUSES: ReadonlySet<EvidenceVerificationStatus> =
  new Set(["VERIFIED", "UNVERIFIED", "CONFLICTED"]);

export class EvidenceValidationError extends Error {
  public readonly statusCode = 400;
  public readonly code = "EVIDENCE_VALIDATION_ERROR";

  constructor(message: string) {
    super(message);
    this.name = "EvidenceValidationError";
  }
}

const SYMBOL_REGEX = /^[A-Z0-9._^-]{1,24}$/;

export function normalizeEvidenceSymbol(raw: string): string {
  return String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/^NSE:/i, "")
    .replace(/\.NS$/i, "")
    .replace(/\.BO$/i, "");
}

export function isValidIsoTimestamp(ts: string | null | undefined): boolean {
  if (!ts || typeof ts !== "string") return false;
  const trimmed = ts.trim();
  if (!trimmed) return false;
  const parsed = Date.parse(trimmed);
  return !Number.isNaN(parsed);
}

/**
 * Strips common prompt-injection directives and control sequences from external
 * news/announcement text while preserving factual content.
 */
export function sanitizeUntrustedText(raw: string | null | undefined): string {
  if (!raw || typeof raw !== "string") return "";
  return raw
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(
      /\b(ignore\s+(?:all\s+)?(?:previous|prior|above)\s+instructions?|system\s+prompt|you\s+are\s+now|execute\s+(?:buy|sell)\s+order|place\s+order|bypass\s+auth|reveal\s+api\s+key)\b/gi,
      "[FILTERED_DIRECTIVE]"
    )
    .replace(/<\/?(?:system|assistant|tool|function|instruction)[^>]*>/gi, "[TAG]")
    .trim()
    .slice(0, 1200);
}

export interface RawValidationResult {
  valid: boolean;
  errors: string[];
  normalizedSymbol: string;
}

/**
 * Runtime validator for incoming raw evidence before collection.
 * Preserves null values and rejects NaN, Infinity, invalid timestamps, or missing metadata.
 */
export function validateRawEvidenceInput(input: RawEvidenceInput): RawValidationResult {
  const errors: string[] = [];

  if (!input || typeof input !== "object") {
    return { valid: false, errors: ["Evidence input must be an object."], normalizedSymbol: "" };
  }

  const normalizedSymbol = normalizeEvidenceSymbol(input.symbol);
  if (!normalizedSymbol || !SYMBOL_REGEX.test(normalizedSymbol)) {
    errors.push(`Invalid or missing symbol: "${String(input.symbol || "")}".`);
  }

  if (!VALID_EVIDENCE_CATEGORIES.has(input.category)) {
    errors.push(`Invalid evidence category: "${String(input.category)}".`);
  }

  if (typeof input.claim !== "string" || input.claim.trim().length < 2) {
    errors.push("Evidence claim must be a non-empty string.");
  }

  if (typeof input.source !== "string" || input.source.trim().length < 2) {
    errors.push("Evidence source must be a non-empty string.");
  }

  if (typeof input.value === "number" && !Number.isFinite(input.value)) {
    errors.push("Numeric evidence value must be finite (no NaN or Infinity).");
  }

  if (input.publishedAt !== undefined && input.publishedAt !== null) {
    if (!isValidIsoTimestamp(input.publishedAt)) {
      errors.push(`Invalid publishedAt timestamp: "${String(input.publishedAt)}".`);
    }
  }

  if (input.retrievedAt !== undefined) {
    if (!isValidIsoTimestamp(input.retrievedAt)) {
      errors.push(`Invalid retrievedAt timestamp: "${String(input.retrievedAt)}".`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    normalizedSymbol,
  };
}

/**
 * Runtime validator for a fully constructed EvidenceRecord.
 */
export function validateEvidenceRecord(record: EvidenceRecord): void {
  if (!record.evidenceId || typeof record.evidenceId !== "string") {
    throw new EvidenceValidationError("EvidenceRecord missing evidenceId.");
  }
  if (!SYMBOL_REGEX.test(record.symbol)) {
    throw new EvidenceValidationError(`Invalid symbol in EvidenceRecord: ${record.symbol}`);
  }
  if (!VALID_EVIDENCE_CATEGORIES.has(record.category)) {
    throw new EvidenceValidationError(`Invalid category: ${record.category}`);
  }
  if (!VALID_FRESHNESS_STATES.has(record.freshness)) {
    throw new EvidenceValidationError(`Invalid freshness: ${record.freshness}`);
  }
  if (!VALID_VERIFICATION_STATUSES.has(record.verificationStatus)) {
    throw new EvidenceValidationError(`Invalid verificationStatus: ${record.verificationStatus}`);
  }
  if (!isValidIsoTimestamp(record.retrievedAt)) {
    throw new EvidenceValidationError(`Invalid retrievedAt timestamp: ${record.retrievedAt}`);
  }
  if (typeof record.confidence !== "number" || record.confidence < 0 || record.confidence > 1) {
    throw new EvidenceValidationError(`Invalid confidence score: ${record.confidence}`);
  }
}

