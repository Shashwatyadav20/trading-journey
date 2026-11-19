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
  INSTITUTIONAL_INTELLIGENCE_SYSTEM_INSTRUCTIONS,
  buildInstitutionalIntelligencePrompt,
} from "./InstitutionalIntelligencePrompts";
import {
  InstitutionalIntelligenceAgentResponse,
  validateAndGroundInstitutionalOutput,
  validateInstitutionalIntelligenceRequest,
} from "./InstitutionalIntelligenceSchema";

export type InstitutionalEvidenceCollector = (params: {
  symbol: string | null;
  referenceDate: Date;
}) => Promise<{
  inputs: RawEvidenceInput[];
  researchSnapshot?: ExternalCompanyResearchSnapshot;
}>;

export interface InstitutionalIntelligenceAgentDeps {
  aiClient?: OpenAIClientService;
  evidenceService?: EvidenceIntelligenceService;
  institutionalCollector?: InstitutionalEvidenceCollector;
}

export interface InstitutionalIntelligenceRunOptions {
  referenceDate?: Date;
  extraEvidenceInputs?: RawEvidenceInput[];
  timeoutMs?: number;
  onEvidenceCollected?: (
    pkg: EvidencePackage,
    extraPayload?: Record<string, unknown>
  ) => void;
}

/**
 * Default read-only collector reusing existing companyResearchEngine institutional
 * holdings & exchange disclosures when a company symbol is provided, and NSE FII/DII
 * cash-market endpoints when reachable. Never fabricates unavailable flows.
 */
export async function defaultInstitutionalEvidenceCollector(params: {
  symbol: string | null;
  referenceDate: Date;
}): Promise<{
  inputs: RawEvidenceInput[];
  researchSnapshot?: ExternalCompanyResearchSnapshot;
}> {
  const inputs: RawEvidenceInput[] = [];
  let researchSnapshot: ExternalCompanyResearchSnapshot | undefined;

  if (params.symbol) {
    try {
      researchSnapshot = await compileCompanyResearchReport(params.symbol);
    } catch {
      // Unavailable live snapshot is surfaced via missingInformation
    }
  }

  // Attempt read-only NSE FII/DII cash-market activity fetch (fails safely to empty)
  try {
    const res = await fetch("https://www.nseindia.com/api/fiidiiTradeReact", {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      const rows = (await res.json()) as Array<{
        category?: string;
        date?: string;
        buyValue?: string;
        sellValue?: string;
        netValue?: string;
      }>;
      if (Array.isArray(rows)) {
        const targetSymbol = params.symbol ?? "INSTITUTIONAL_MARKET";
        for (const row of rows) {
          const cat = String(row.category || "").toUpperCase();
          const net = Number(String(row.netValue || "").replace(/,/g, ""));
          if (!cat || !Number.isFinite(net)) continue;
          const label = cat.includes("FII") || cat.includes("FPI")
            ? "FII/FPI Cash Market Net Flow"
            : cat.includes("DII")
              ? "DII Cash Market Net Flow"
              : `${cat} Net Flow`;
          inputs.push({
            symbol: targetSymbol,
            category: "INSTITUTIONAL_HOLDING",
            claim: label,
            value: net,
            unit: "CR",
            currency: "INR",
            source: "NSE_OFFICIAL",
            sourceUrl: "https://www.nseindia.com/reports/fii-dii",
            publishedAt: params.referenceDate.toISOString(),
            metadata: {
              transactionDate: row.date ?? null,
              reportingPeriod: row.date ?? null,
              marketSegment: "CASH_EQUITY",
            },
          });
        }
      }
    }
  } catch {
    // Network/sandbox unavailable; handled transparently as missing data
  }

  return { inputs, researchSnapshot };
}

export class InstitutionalIntelligenceAgent {
  private readonly aiClient: OpenAIClientService;
  private readonly evidenceService: EvidenceIntelligenceService;
  private readonly institutionalCollector: InstitutionalEvidenceCollector;

  public constructor(deps: InstitutionalIntelligenceAgentDeps = {}) {
    this.aiClient = deps.aiClient ?? openAIClient;
    this.evidenceService = deps.evidenceService ?? evidenceIntelligenceService;
    this.institutionalCollector =
      deps.institutionalCollector ?? defaultInstitutionalEvidenceCollector;
  }

  public async analyze(
    rawRequest: unknown,
    options: InstitutionalIntelligenceRunOptions = {}
  ): Promise<InstitutionalIntelligenceAgentResponse> {
    const validated = validateInstitutionalIntelligenceRequest(rawRequest);
    const referenceDate = options.referenceDate ?? new Date();
    const targetSymbol = validated.symbol ?? "INSTITUTIONAL_MARKET";

    // Independently collect institutional evidence on the backend;
    // never trust client-supplied holdings, flows, or reports.
    const collected = await this.institutionalCollector({
      symbol: validated.symbol ?? null,
      referenceDate,
    });

    const combinedInputs = [
      ...collected.inputs,
      ...(options.extraEvidenceInputs ?? []),
    ];

    const pkg = this.evidenceService.buildEvidencePackage(
      targetSymbol,
      combinedInputs,
      {
        referenceDate,
        researchSnapshot: collected.researchSnapshot,
      }
    );

    options.onEvidenceCollected?.(pkg);

    const promptInput = buildInstitutionalIntelligencePrompt(
      pkg,
      validated.symbol ?? null,
      validated.focus
    );

    let aiResult;
    try {
      aiResult = await this.aiClient.createResponse({
        tier: validated.tier,
        instructions: INSTITUTIONAL_INTELLIGENCE_SYSTEM_INSTRUCTIONS,
        input: promptInput,
        timeoutMs: options.timeoutMs,
        metadata: {
          agent: "InstitutionalIntelligenceAgent",
          symbol: targetSymbol,
        },
      });
    } catch (err: unknown) {
      if (err && typeof err === "object") {
        (err as Record<string, unknown>).collectedEvidencePackage = pkg;
      }
      throw err;
    }

    const grounded = validateAndGroundInstitutionalOutput(
      aiResult.outputText,
      pkg
    );

    return {
      symbol: validated.symbol ?? null,
      focus: validated.focus ?? null,
      verificationStatus: "LLM_INSTITUTIONAL_INTELLIGENCE_UNVERIFIED",
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

export const institutionalIntelligenceAgent =
  new InstitutionalIntelligenceAgent();

