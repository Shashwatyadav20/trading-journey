import {
  EvidenceRecord,
  SourceCredibilityCategory,
  SourceTier,
  VerificationMethod,
  validateEvidenceRecord,
} from "./EvidenceSchema";

export interface SourceTrustPolicy {
  officialDomains: string[];
  institutionalFeedDomains: string[];
  institutionalSourceNames: string[];
  thirdPartyNewsDomains: string[];
  allowMultiSourceCorroboration: boolean;
  minimumCorroborationSources: number;
}

export const DEFAULT_SOURCE_TRUST_POLICY: SourceTrustPolicy = {
  officialDomains: [
    "nseindia.com",
    "bseindia.com",
    "sebi.gov.in",
    "rbi.org.in",
    "mca.gov.in",
    "cdslindia.com",
    "nsdl.co.in",
  ],
  institutionalFeedDomains: [
    "finance.yahoo.com",
    "query1.finance.yahoo.com",
    "query2.finance.yahoo.com",
    "dhan.co",
    "api.dhan.co",
    "screener.in",
    "trendlyne.com",
  ],
  institutionalSourceNames: [
    "NSE_OFFICIAL",
    "BSE_OFFICIAL",
    "YAHOO_FINANCE",
    "DHAN_HQ",
    "SCREENER",
    "TRENDLYNE",
  ],
  thirdPartyNewsDomains: [
    "moneycontrol.com",
    "economictimes.indiatimes.com",
    "livemint.com",
    "business-standard.com",
    "reuters.com",
    "bloomberg.com",
    "cnbctv18.com",
    "ndtvprofit.com",
  ],
  allowMultiSourceCorroboration: true,
  minimumCorroborationSources: 2,
};

export interface SourceVerificationSummary {
  records: EvidenceRecord[];
  verifiedCount: number;
  unverifiedCount: number;
  invalidUrlCount: number;
  corroboratedGroups: number;
}

export function isValidHttpUrl(rawUrl: string | null | undefined): boolean {
  if (!rawUrl || typeof rawUrl !== "string") {
    return false;
  }
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return false;
  }
  try {
    const parsed = new URL(trimmed);
    return (
      (parsed.protocol === "https:" || parsed.protocol === "http:") &&
      parsed.hostname.length > 0 &&
      parsed.hostname.includes(".")
    );
  } catch {
    return false;
  }
}

export function extractHostname(rawUrl: string | null | undefined): string | null {
  if (!isValidHttpUrl(rawUrl)) {
    return null;
  }
  try {
    return new URL(rawUrl!.trim()).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Classifies an evidence source into fine-grained credibility categories.
 * Never marks a source as official/regulatory/government without a verified domain.
 */
export function classifySourceCredibility(
  record: Pick<EvidenceRecord, "source" | "sourceUrl" | "category">,
  policy: SourceTrustPolicy = DEFAULT_SOURCE_TRUST_POLICY
): SourceCredibilityCategory {
  const hostname = extractHostname(record.sourceUrl);
  if (!hostname) {
    return "UNVERIFIED";
  }

  if (matchesDomain(hostname, ["nseindia.com", "bseindia.com"])) {
    return "OFFICIAL_EXCHANGE";
  }
  if (matchesDomain(hostname, ["sebi.gov.in", "rbi.org.in"])) {
    return "REGULATORY";
  }
  if (matchesDomain(hostname, ["mca.gov.in", "mospi.gov.in", "pib.gov.in"])) {
    return "GOVERNMENT";
  }
  if (matchesDomain(hostname, ["dhan.co", "api.dhan.co"])) {
    return "BROKER";
  }
  if (
    matchesDomain(hostname, [
      "finance.yahoo.com",
      "query1.finance.yahoo.com",
      "query2.finance.yahoo.com",
      "screener.in",
      "trendlyne.com",
      "cdslindia.com",
      "nsdl.co.in",
    ])
  ) {
    return "VERIFIED_FINANCIAL_PROVIDER";
  }
  if (matchesDomain(hostname, policy.thirdPartyNewsDomains)) {
    return "NEWS_MEDIA";
  }
  if (matchesDomain(hostname, policy.officialDomains)) {
    return "OFFICIAL_COMPANY";
  }
  return "THIRD_PARTY";
}

function matchesDomain(hostname: string | null, domains: string[]): boolean {
  if (!hostname) {
    return false;
  }
  return domains.some((domain) => {
    const normalized = domain.toLowerCase();
    return hostname === normalized || hostname.endsWith(`.${normalized}`);
  });
}

function normalizeClaimKey(record: EvidenceRecord): string {
  const unitPart = record.unit ? record.unit.trim().toUpperCase() : "";
  const currencyPart = record.currency ? record.currency.trim().toUpperCase() : "";
  return `${record.symbol}::${record.claim.trim().toLowerCase()}::${unitPart}::${currencyPart}`;
}

function valuesMatchForCorroboration(a: EvidenceRecord["value"], b: EvidenceRecord["value"]): boolean {
  if (a === null || b === null) {
    return false;
  }
  if (typeof a === "number" && typeof b === "number") {
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      return false;
    }
    const scale = Math.max(Math.abs(a), Math.abs(b), 1);
    return Math.abs(a - b) / scale <= 0.005;
  }
  if (typeof a === "boolean" && typeof b === "boolean") {
    return a === b;
  }
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

export class SourceVerifier {
  private readonly policy: SourceTrustPolicy;

  public constructor(policy: SourceTrustPolicy = DEFAULT_SOURCE_TRUST_POLICY) {
    this.policy = policy;
  }

  public classifySourceTier(record: EvidenceRecord): SourceTier {
    const hostname = extractHostname(record.sourceUrl);
    const sourceUpper = record.source.trim().toUpperCase();

    if (matchesDomain(hostname, this.policy.officialDomains)) {
      return "OFFICIAL_EXCHANGE_OR_FILING";
    }
    if (matchesDomain(hostname, this.policy.institutionalFeedDomains)) {
      return "INSTITUTIONAL_DATA_FEED";
    }
    if (matchesDomain(hostname, this.policy.thirdPartyNewsDomains)) {
      return "THIRD_PARTY_NEWS";
    }

    if (
      !hostname &&
      (sourceUpper.includes("NSE") ||
        sourceUpper.includes("BSE") ||
        sourceUpper.includes("SEBI") ||
        sourceUpper.includes("RBI"))
    ) {
      // Without a verifiable official URL, do not elevate to OFFICIAL_EXCHANGE_OR_FILING.
      return "UNKNOWN";
    }

    if (this.policy.institutionalSourceNames.includes(sourceUpper) && isValidHttpUrl(record.sourceUrl)) {
      return "INSTITUTIONAL_DATA_FEED";
    }

    if (record.category === "THIRD_PARTY_NEWS") {
      return "THIRD_PARTY_NEWS";
    }

    return "UNKNOWN";
  }

  public verifyAll(inputRecords: EvidenceRecord[]): SourceVerificationSummary {
    let invalidUrlCount = 0;

    // First pass: classify each record independently without fabricating verification.
    const classified: EvidenceRecord[] = inputRecords.map((orig) => {
      const record: EvidenceRecord = {
        ...orig,
        supportingEvidenceIds: [...orig.supportingEvidenceIds],
        conflictingEvidenceIds: [...orig.conflictingEvidenceIds],
        metadata: orig.metadata ? { ...orig.metadata } : undefined,
      };

      const hasValidUrl = isValidHttpUrl(record.sourceUrl);
      if (!hasValidUrl) {
        invalidUrlCount += 1;
      }

      const resolvedTier = this.classifySourceTier(record);
      record.sourceTier = resolvedTier;
      record.sourceClassification = classifySourceCredibility(record, this.policy);
      const rawPeriod = record.metadata?.dataPeriod ?? record.metadata?.period ?? null;
      record.dataPeriod =
        typeof rawPeriod === "string" && rawPeriod.trim() ? rawPeriod.trim() : null;

      // External text/news/documents are always flagged as untrusted external content.
      record.untrustedExternal =
        resolvedTier === "THIRD_PARTY_NEWS" ||
        resolvedTier === "UNKNOWN" ||
        record.category === "THIRD_PARTY_NEWS" ||
        record.category === "COMPANY_ANNOUNCEMENT" ||
        record.category === "REGULATORY_FILING";

      // Missing values cannot be verified as populated facts.
      if (record.value === null) {
        record.verificationStatus = "UNVERIFIED";
        record.verificationMethod = "NONE";
        record.confidence = 0;
        validateEvidenceRecord(record);
        return record;
      }

      if (!hasValidUrl) {
        record.verificationStatus = "UNVERIFIED";
        record.verificationMethod = "NONE";
        record.confidence = Math.min(record.confidence, 0.25);
        validateEvidenceRecord(record);
        return record;
      }

      if (resolvedTier === "OFFICIAL_EXCHANGE_OR_FILING") {
        const hasSignature = Boolean(record.metadata?.officialExchangeSignature);
        const method: VerificationMethod = hasSignature
          ? "OFFICIAL_EXCHANGE_SIGNATURE"
          : "REGULATORY_FILING_URL_MATCH";
        record.verificationStatus = "VERIFIED";
        record.verificationMethod = method;
        record.confidence = hasSignature ? 0.98 : 0.92;
        validateEvidenceRecord(record);
        return record;
      }

      if (resolvedTier === "INSTITUTIONAL_DATA_FEED") {
        record.verificationStatus = "UNVERIFIED";
        record.verificationMethod = "UNVERIFIED_EXTERNAL_FEED";
        record.confidence = Math.min(Math.max(record.confidence, 0.45), 0.7);
        validateEvidenceRecord(record);
        return record;
      }

      // THIRD_PARTY_NEWS or UNKNOWN with valid URL remains UNVERIFIED.
      record.verificationStatus = "UNVERIFIED";
      record.verificationMethod = "UNVERIFIED_EXTERNAL_FEED";
      record.confidence = Math.min(Math.max(record.confidence, 0.2), 0.45);
      validateEvidenceRecord(record);
      return record;
    });

    // Second pass: multi-source corroboration for institutional feeds / valid URLs.
    let corroboratedGroups = 0;
    if (this.policy.allowMultiSourceCorroboration) {
      const byClaim = new Map<string, EvidenceRecord[]>();
      for (const rec of classified) {
        if (rec.value === null || !isValidHttpUrl(rec.sourceUrl)) {
          continue;
        }
        const key = normalizeClaimKey(rec);
        const list = byClaim.get(key) ?? [];
        list.push(rec);
        byClaim.set(key, list);
      }

      for (const group of byClaim.values()) {
        if (group.length < this.policy.minimumCorroborationSources) {
          continue;
        }

        // Check if there are >= N distinct sources agreeing on the same value.
        for (const candidate of group) {
          if (candidate.sourceTier !== "INSTITUTIONAL_DATA_FEED" && candidate.sourceTier !== "OFFICIAL_EXCHANGE_OR_FILING") {
            continue;
          }
          const agreeing = group.filter(
            (other) =>
              other.evidenceId !== candidate.evidenceId &&
              other.source.trim().toLowerCase() !== candidate.source.trim().toLowerCase() &&
              (other.sourceTier === "INSTITUTIONAL_DATA_FEED" ||
                other.sourceTier === "OFFICIAL_EXCHANGE_OR_FILING") &&
              valuesMatchForCorroboration(candidate.value, other.value)
          );

          if (agreeing.length + 1 >= this.policy.minimumCorroborationSources) {
            const supportIds = agreeing.map((a) => a.evidenceId);
            candidate.supportingEvidenceIds = Array.from(
              new Set([...candidate.supportingEvidenceIds, ...supportIds])
            );
            if (candidate.verificationStatus !== "VERIFIED") {
              candidate.verificationStatus = "VERIFIED";
              candidate.verificationMethod = "MULTI_SOURCE_CORROBORATION";
              candidate.confidence = Math.max(candidate.confidence, 0.85);
              corroboratedGroups += 1;
            }
          }
        }
      }
    }

    for (const rec of classified) {
      validateEvidenceRecord(rec);
    }

    const verifiedCount = classified.filter((r) => r.verificationStatus === "VERIFIED").length;
    const unverifiedCount = classified.filter((r) => r.verificationStatus === "UNVERIFIED").length;

    return {
      records: classified,
      verifiedCount,
      unverifiedCount,
      invalidUrlCount,
      corroboratedGroups,
    };
  }
}

export const sourceVerifier = new SourceVerifier();

