import { MarketSessionValidator } from "../../indian/market/MarketSessionValidator";
import { priceStore } from "../../market/MarketPriceStore";
import { OpenAIClientService, openAIClient } from "../core/OpenAIClient";
import { RawEvidenceInput } from "../evidence/EvidenceSchema";
import {
  EvidenceIntelligenceService,
  EvidencePackage,
  evidenceIntelligenceService,
} from "../services/EvidenceIntelligenceService";
import {
  MARKET_INTELLIGENCE_SYSTEM_INSTRUCTIONS,
  buildMarketIntelligencePrompt,
} from "./MarketIntelligencePrompts";
import {
  MarketIntelligenceAgentResponse,
  assessMarketRegimeFromEvidence,
  validateAndGroundMarketOutput,
  validateMarketIntelligenceRequest,
} from "./MarketIntelligenceSchema";

export type MarketEvidenceCollector = (
  referenceDate: Date
) => Promise<RawEvidenceInput[]>;

export interface MarketIntelligenceAgentDeps {
  aiClient?: OpenAIClientService;
  evidenceService?: EvidenceIntelligenceService;
  marketCollector?: MarketEvidenceCollector;
  sessionValidator?: MarketSessionValidator;
}

export interface MarketIntelligenceRunOptions {
  referenceDate?: Date;
  extraEvidenceInputs?: RawEvidenceInput[];
  timeoutMs?: number;
  onEvidenceCollected?: (
    pkg: EvidencePackage,
    extraPayload?: Record<string, unknown>
  ) => void;
}

interface YahooIndexSpec {
  ticker: string;
  label: string;
  claimPrefix: string;
}

const INDEX_SPECS: YahooIndexSpec[] = [
  { ticker: "^NSEI", label: "NIFTY 50", claimPrefix: "NIFTY 50" },
  { ticker: "^NSEBANK", label: "BANKNIFTY", claimPrefix: "BANKNIFTY" },
  { ticker: "^CNXFIN", label: "FINNIFTY", claimPrefix: "FINNIFTY" },
  { ticker: "^BSESN", label: "SENSEX", claimPrefix: "SENSEX" },
  { ticker: "^INDIAVIX", label: "India VIX", claimPrefix: "India VIX" },
];

async function fetchYahooIndexSnapshot(
  spec: YahooIndexSpec,
  referenceDate: Date
): Promise<RawEvidenceInput[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(spec.ticker)}?interval=1d&range=2d`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) {
      return [];
    }
    const data = (await res.json()) as {
      chart?: {
        result?: Array<{
          meta?: {
            regularMarketPrice?: number;
            chartPreviousClose?: number;
            regularMarketTime?: number;
          };
        }>;
      };
    };
    const meta = data?.chart?.result?.[0]?.meta;
    const price = meta?.regularMarketPrice;
    const prevClose = meta?.chartPreviousClose;
    const publishedAt =
      typeof meta?.regularMarketTime === "number"
        ? new Date(meta.regularMarketTime * 1000).toISOString()
        : referenceDate.toISOString();

    const inputs: RawEvidenceInput[] = [
      {
        symbol: "MARKET",
        category: "INTRADAY_PRICE",
        claim:
          spec.label === "India VIX"
            ? "India VIX"
            : `${spec.claimPrefix} Spot Price`,
        value: typeof price === "number" && Number.isFinite(price) ? Number(price.toFixed(2)) : null,
        unit: spec.label === "India VIX" ? "RATIO" : "INR",
        currency: spec.label === "India VIX" ? null : "INR",
        source: "YAHOO_FINANCE",
        sourceUrl: `https://finance.yahoo.com/quote/${encodeURIComponent(spec.ticker)}`,
        publishedAt,
      },
    ];

    if (
      spec.label !== "India VIX" &&
      typeof price === "number" &&
      typeof prevClose === "number" &&
      prevClose > 0
    ) {
      const changePct = Number((((price - prevClose) / prevClose) * 100).toFixed(2));
      inputs.push({
        symbol: "MARKET",
        category: "DAILY_MARKET_DATA",
        claim: `${spec.claimPrefix} Change %`,
        value: changePct,
        unit: "%",
        currency: null,
        source: "YAHOO_FINANCE",
        sourceUrl: `https://finance.yahoo.com/quote/${encodeURIComponent(spec.ticker)}`,
        publishedAt,
      });
    }

    return inputs;
  } catch {
    return [];
  }
}

/**
 * Default read-only market evidence collector reusing MarketPriceStore
 * and Yahoo Finance index feeds without modifying any market calculations.
 */
export async function defaultMarketEvidenceCollector(
  referenceDate: Date
): Promise<RawEvidenceInput[]> {
  const inputs: RawEvidenceInput[] = [];

  // 1. Read any cached live prices already in backend MarketPriceStore
  const storeMapping: Array<{ key: string; claim: string }> = [
    { key: "NIFTY", claim: "NIFTY 50 Spot Price" },
    { key: "BANKNIFTY", claim: "BANKNIFTY Spot Price" },
    { key: "FINNIFTY", claim: "FINNIFTY Spot Price" },
    { key: "SENSEX", claim: "SENSEX Spot Price" },
    { key: "INDIAVIX", claim: "India VIX" },
  ];

  for (const item of storeMapping) {
    const cached = priceStore.getPrice(item.key);
    if (cached && typeof cached.price === "number" && Number.isFinite(cached.price)) {
      inputs.push({
        symbol: "MARKET",
        category: "INTRADAY_PRICE",
        claim: item.claim,
        value: cached.price,
        unit: item.key === "INDIAVIX" ? "RATIO" : "INR",
        currency: item.key === "INDIAVIX" ? null : "INR",
        source: cached.source || "MARKET_PRICE_STORE",
        sourceUrl: null, // Internal store without verifiable external URL stays UNVERIFIED unless corroborated
        publishedAt: cached.timestamp || referenceDate.toISOString(),
      });
    }
  }

  // 2. Fetch live index & India VIX quotes from Yahoo Finance
  const fetched = await Promise.all(
    INDEX_SPECS.map((spec) => fetchYahooIndexSnapshot(spec, referenceDate))
  );
  for (const batch of fetched) {
    inputs.push(...batch);
  }

  return inputs;
}

export class MarketIntelligenceAgent {
  private readonly aiClient: OpenAIClientService;
  private readonly evidenceService: EvidenceIntelligenceService;
  private readonly marketCollector: MarketEvidenceCollector;
  private readonly sessionValidator: MarketSessionValidator;

  public constructor(deps: MarketIntelligenceAgentDeps = {}) {
    this.aiClient = deps.aiClient ?? openAIClient;
    this.evidenceService = deps.evidenceService ?? evidenceIntelligenceService;
    this.marketCollector =
      deps.marketCollector ?? defaultMarketEvidenceCollector;
    this.sessionValidator =
      deps.sessionValidator ?? new MarketSessionValidator();
  }

  public async analyze(
    rawRequest: unknown,
    options: MarketIntelligenceRunOptions = {}
  ): Promise<MarketIntelligenceAgentResponse> {
    const validated = validateMarketIntelligenceRequest(rawRequest);
    const referenceDate = options.referenceDate ?? new Date();
    const sessionStatus =
      this.sessionValidator.getMarketSessionStatus(referenceDate);

    // Independently collect market evidence on the backend;
    // never trust browser-supplied prices, breadth, or regime labels.
    const collectedInputs = await this.marketCollector(referenceDate);
    const allInputs = [...collectedInputs, ...(options.extraEvidenceInputs ?? [])];

    const pkg = this.evidenceService.buildEvidencePackage("MARKET", allInputs, {
      referenceDate,
    });

    const deterministicRegime = assessMarketRegimeFromEvidence(pkg);

    options.onEvidenceCollected?.(pkg, {
      regimeAssessment: deterministicRegime,
    });

    const promptInput = buildMarketIntelligencePrompt(
      pkg,
      deterministicRegime,
      sessionStatus,
      validated.focus
    );

    let aiResult;
    try {
      aiResult = await this.aiClient.createResponse({
        tier: validated.tier,
        instructions: MARKET_INTELLIGENCE_SYSTEM_INSTRUCTIONS,
        input: promptInput,
        timeoutMs: options.timeoutMs,
        metadata: {
          agent: "MarketIntelligenceAgent",
          sessionStatus,
        },
      });
    } catch (err: unknown) {
      if (err && typeof err === "object") {
        (err as Record<string, unknown>).collectedEvidencePackage = pkg;
        (err as Record<string, unknown>).regimeAssessment = deterministicRegime;
      }
      throw err;
    }

    const grounded = validateAndGroundMarketOutput(
      aiResult.outputText,
      pkg,
      deterministicRegime,
      sessionStatus
    );

    return {
      focus: validated.focus ?? null,
      sessionStatus,
      verificationStatus: "LLM_MARKET_INTELLIGENCE_UNVERIFIED",
      readOnly: true,
      model: aiResult.model,
      provider: aiResult.provider,
      evidenceRecords: pkg.allRecords.map((r) => ({ ...r })),
      tier: validated.tier,
      generatedAt: referenceDate.toISOString(),
      regimeAssessment: deterministicRegime,
      report: grounded.report,
      unsupportedClaims: grounded.unsupportedClaims,
      invalidEvidenceIdsCited: grounded.invalidEvidenceIdsCited,
      rawResponseInvalid: grounded.rawResponseInvalid,
      evidenceSummary: {
        totalRecords: pkg.allRecords.length,
        verifiedCount: pkg.stats.verifiedCount,
        unverifiedCount: pkg.stats.unverifiedCount,
        staleCount: pkg.stats.staleCount,
        expiredCount: pkg.stats.expiredCount,
        conflictedCount: pkg.stats.conflictedCount,
        conflicts: pkg.conflicts,
        missingInformation: pkg.missingInformation,
        evidenceIdsUsed: grounded.evidenceIdsUsed,
      },
    };
  }
}

export const marketIntelligenceAgent = new MarketIntelligenceAgent();

