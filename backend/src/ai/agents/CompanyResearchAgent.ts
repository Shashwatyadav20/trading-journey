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
  COMPANY_RESEARCH_SYSTEM_INSTRUCTIONS,
  buildCompanyResearchPrompt,
} from "./CompanyResearchPrompts";
import {
  CompanyResearchAgentResponse,
  validateAndGroundResearchOutput,
  validateCompanyResearchRequest,
} from "./CompanyResearchSchema";

export type ResearchSnapshotCollector = (
  symbol: string
) => Promise<ExternalCompanyResearchSnapshot>;

export interface CompanyResearchAgentDeps {
  aiClient?: OpenAIClientService;
  evidenceService?: EvidenceIntelligenceService;
  researchCollector?: ResearchSnapshotCollector;
}

export interface CompanyResearchRunOptions {
  referenceDate?: Date;
  extraEvidenceInputs?: RawEvidenceInput[];
  timeoutMs?: number;
  onEvidenceCollected?: (
    pkg: EvidencePackage,
    extraPayload?: Record<string, unknown>
  ) => void;
}

export class CompanyResearchAgent {
  private readonly aiClient: OpenAIClientService;
  private readonly evidenceService: EvidenceIntelligenceService;
  private readonly researchCollector: ResearchSnapshotCollector;

  public constructor(deps: CompanyResearchAgentDeps = {}) {
    this.aiClient = deps.aiClient ?? openAIClient;
    this.evidenceService = deps.evidenceService ?? evidenceIntelligenceService;
    this.researchCollector =
      deps.researchCollector ??
      ((symbol: string) => compileCompanyResearchReport(symbol));
  }

  public async research(
    rawRequest: unknown,
    options: CompanyResearchRunOptions = {}
  ): Promise<CompanyResearchAgentResponse> {
    const validated = validateCompanyResearchRequest(rawRequest);
    const referenceDate = options.referenceDate ?? new Date();

    // Independently collect live company research snapshot on the backend;
    // never trust browser-supplied research reports or financial figures.
    const snapshot = await this.researchCollector(validated.symbol);

    const pkg = this.evidenceService.buildEvidencePackage(
      validated.symbol,
      options.extraEvidenceInputs ?? [],
      {
        referenceDate,
        researchSnapshot: snapshot,
      }
    );

    options.onEvidenceCollected?.(pkg);

    const promptInput = buildCompanyResearchPrompt(pkg, validated.question);

    let aiResult;
    try {
      aiResult = await this.aiClient.createResponse({
        tier: validated.tier,
        instructions: COMPANY_RESEARCH_SYSTEM_INSTRUCTIONS,
        input: promptInput,
        timeoutMs: options.timeoutMs,
        metadata: {
          agent: "CompanyResearchAgent",
          symbol: validated.symbol,
        },
      });
    } catch (err: unknown) {
      if (err && typeof err === "object") {
        (err as Record<string, unknown>).collectedEvidencePackage = pkg;
      }
      throw err;
    }

    const grounded = validateAndGroundResearchOutput(aiResult.outputText, pkg);

    return {
      symbol: validated.symbol,
      question: validated.question ?? null,
      verificationStatus: "LLM_RESEARCH_UNVERIFIED",
      readOnly: true,
      model: aiResult.model,
      provider: aiResult.provider,
      evidenceRecords: pkg.allRecords.map((r) => ({ ...r })),
      tier: validated.tier,
      generatedAt: referenceDate.toISOString(),
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

export const companyResearchAgent = new CompanyResearchAgent();

