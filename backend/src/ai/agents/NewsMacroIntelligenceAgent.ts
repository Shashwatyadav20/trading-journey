import { compileCompanyResearchReport } from "../../../../lib/ai/companyResearchEngine";
import { OpenAIClientService, openAIClient } from "../core/OpenAIClient";
import { ExternalCompanyResearchSnapshot } from "../evidence/EvidenceCollector";
import { RawEvidenceInput } from "../evidence/EvidenceSchema";
import {
  EvidenceIntelligenceService,
  EvidencePackage,
  evidenceIntelligenceService,
} from "../services/EvidenceIntelligenceService";
import {
  NEWS_MACRO_SYSTEM_INSTRUCTIONS,
  buildNewsMacroPrompt,
} from "./NewsMacroIntelligencePrompts";
import {
  NewsMacroAgentResponse,
  deduplicateNewsInputs,
  validateAndGroundNewsMacroOutput,
  validateNewsMacroRequest,
} from "./NewsMacroIntelligenceSchema";

export type NewsMacroCollector = (params: {
  symbol: string | null;
  referenceDate: Date;
}) => Promise<{
  inputs: RawEvidenceInput[];
  researchSnapshot?: ExternalCompanyResearchSnapshot;
}>;

export interface NewsMacroAgentDeps {
  aiClient?: OpenAIClientService;
  evidenceService?: EvidenceIntelligenceService;
  newsMacroCollector?: NewsMacroCollector;
}

export interface NewsMacroRunOptions {
  referenceDate?: Date;
  extraEvidenceInputs?: RawEvidenceInput[];
  timeoutMs?: number;
  onEvidenceCollected?: (
    pkg: EvidencePackage,
    extraPayload?: Record<string, unknown>
  ) => void;
}

function toIsoOrNull(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.toUpperCase() === "UNKNOWN") return null;
  if (!/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) return null;
  return Number.isNaN(Date.parse(trimmed)) ? null : trimmed;
}

export function mapSnapshotNewsToEvidenceInputs(
  symbol: string,
  newsItems: ExternalCompanyResearchSnapshot["newsAndMacro"] | undefined,
  retrievedAt: string
): RawEvidenceInput[] {
  if (!Array.isArray(newsItems) || newsItems.length === 0) {
    return [];
  }
  const inputs: RawEvidenceInput[] = [];
  for (const news of newsItems) {
    if (!news || typeof news.title !== "string" || news.title.trim().length < 2) {
      continue;
    }
    const publishedAt =
      toIsoOrNull(news.publishedAtIso) ?? toIsoOrNull(news.publishedAt);
    inputs.push({
      symbol,
      category:
        news.category === "REGULATORY_SEBI"
          ? "REGULATORY_FILING"
          : "THIRD_PARTY_NEWS",
      claim: news.title.trim(),
      value: news.sentiment || "NEUTRAL",
      source: (news.publisher || "").trim() || "External News Feed",
      sourceUrl: news.link ?? null,
      publishedAt,
      retrievedAt,
      untrustedText: news.title.trim(),
      metadata: { newsCategory: news.category },
    });
  }
  return inputs;
}

/**
 * Default read-only collector reusing existing companyResearchEngine news/macro
 * pipelines when a symbol is provided. Fails safely without fabricating events.
 */
export async function defaultNewsMacroCollector(params: {
  symbol: string | null;
  referenceDate: Date;
}): Promise<{
  inputs: RawEvidenceInput[];
  researchSnapshot?: ExternalCompanyResearchSnapshot;
}> {
  let researchSnapshot: ExternalCompanyResearchSnapshot | undefined;
  const retrievedAt = params.referenceDate.toISOString();
  if (params.symbol) {
    try {
      researchSnapshot = await compileCompanyResearchReport(params.symbol);
    } catch {
      // Unavailable live snapshot is surfaced via missingInformation
    }
  }
  const inputs =
    params.symbol && researchSnapshot?.newsAndMacro
      ? mapSnapshotNewsToEvidenceInputs(
          params.symbol,
          researchSnapshot.newsAndMacro,
          retrievedAt
        )
      : [];
  return { inputs, researchSnapshot };
}

export class NewsMacroIntelligenceAgent {
  private readonly aiClient: OpenAIClientService;
  private readonly evidenceService: EvidenceIntelligenceService;
  private readonly newsMacroCollector: NewsMacroCollector;

  public constructor(deps: NewsMacroAgentDeps = {}) {
    this.aiClient = deps.aiClient ?? openAIClient;
    this.evidenceService = deps.evidenceService ?? evidenceIntelligenceService;
    this.newsMacroCollector =
      deps.newsMacroCollector ?? defaultNewsMacroCollector;
  }

  public async analyze(
    rawRequest: unknown,
    options: NewsMacroRunOptions = {}
  ): Promise<NewsMacroAgentResponse> {
    const validated = validateNewsMacroRequest(rawRequest);
    const referenceDate = options.referenceDate ?? new Date();
    const targetSymbol = validated.symbol ?? "MACRO_INDIA";

    // Independently collect news & macro evidence on the backend;
    // never trust client-supplied news, numbers, or reports.
    const collected = await this.newsMacroCollector({
      symbol: validated.symbol ?? null,
      referenceDate,
    });

    const snapshotNewsInputs =
      collected.inputs.length === 0 && collected.researchSnapshot?.newsAndMacro
        ? mapSnapshotNewsToEvidenceInputs(
            targetSymbol,
            collected.researchSnapshot.newsAndMacro,
            referenceDate.toISOString()
          )
        : [];

    const combined = [
      ...collected.inputs,
      ...snapshotNewsInputs,
      ...(options.extraEvidenceInputs ?? []),
    ];

    const { deduplicated, duplicateStoriesDetected } =
      deduplicateNewsInputs(combined);

    const pkg = this.evidenceService.buildEvidencePackage(
      targetSymbol,
      deduplicated,
      {
        referenceDate,
        retrievedAt: referenceDate.toISOString(),
      }
    );

    if (pkg.allRecords.length === 0) {
      pkg.missingInformation.push(
        `No genuine news or macro items were available from verified feeds for ${targetSymbol}.`
      );
      pkg.stats.missingCount = pkg.missingInformation.length;
    }

    options.onEvidenceCollected?.(pkg, {
      duplicateStoriesDetected,
    });

    const promptInput = buildNewsMacroPrompt(
      pkg,
      validated.symbol ?? null,
      validated.focus
    );

    let aiResult;
    try {
      aiResult = await this.aiClient.createResponse({
        tier: validated.tier,
        instructions: NEWS_MACRO_SYSTEM_INSTRUCTIONS,
        input: promptInput,
        timeoutMs: options.timeoutMs,
        metadata: {
          agent: "NewsMacroIntelligenceAgent",
          symbol: targetSymbol,
        },
      });
    } catch (err: unknown) {
      if (err && typeof err === "object") {
        (err as Record<string, unknown>).collectedEvidencePackage = pkg;
      }
      throw err;
    }

    const grounded = validateAndGroundNewsMacroOutput(aiResult.outputText, pkg);

    return {
      symbol: validated.symbol ?? null,
      focus: validated.focus ?? null,
      verificationStatus: "LLM_NEWS_MACRO_UNVERIFIED",
      readOnly: true,
      model: aiResult.model,
      provider: aiResult.provider,
      evidenceRecords: pkg.allRecords.map((r) => ({ ...r })),
      tier: validated.tier,
      generatedAt: referenceDate.toISOString(),
      duplicateStoriesDetected,
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

export const newsMacroIntelligenceAgent = new NewsMacroIntelligenceAgent();

