import { describe, it, expect, vi } from "vitest";
import { EvidenceCollector } from "../evidence/EvidenceCollector";
import {
  SourceVerifier,
  classifySourceCredibility,
} from "../evidence/SourceVerifier";
import { FreshnessValidator } from "../evidence/FreshnessValidator";
import { ConflictResolver } from "../evidence/ConflictResolver";
import { ResponseSynthesizer } from "../orchestrator/ResponseSynthesizer";
import { intentRouter } from "../orchestrator/IntentRouter";

describe("Phase 8.8 — AI Research Quality & Evidence Integrity Audit", () => {
  const refNow = new Date("2026-11-13T10:00:00.000Z");

  it("1. Classifies official vs unverified sources accurately and preserves provenance", () => {
    const collector = new EvidenceCollector();
    const verifier = new SourceVerifier();

    const collected = collector.collect([
      {
        evidenceId: "EV_NSE",
        symbol: "RELIANCE",
        category: "COMPANY_ANNOUNCEMENT",
        claim: "Q2 filing submitted",
        value: "Filed",
        source: "NSE_OFFICIAL",
        sourceUrl: "https://www.nseindia.com/filings/reliance-q2",
        publishedAt: "2026-11-12T10:00:00.000Z",
        retrievedAt: "2026-11-13T09:55:00.000Z",
        metadata: { dataPeriod: "Q2 FY27" },
      },
      {
        evidenceId: "EV_RBI",
        symbol: "NIFTY",
        category: "REGULATORY_FILING",
        claim: "Repo rate unchanged",
        value: 6.5,
        unit: "%",
        source: "RBI",
        sourceUrl: "https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx",
        publishedAt: "2026-11-10T10:00:00.000Z",
        retrievedAt: "2026-11-13T09:55:00.000Z",
      },
      {
        evidenceId: "EV_UNVER",
        symbol: "RELIANCE",
        category: "THIRD_PARTY_NEWS",
        claim: "Rumor about capex",
        value: 5000,
        unit: "CR",
        source: "RandomBlog",
        sourceUrl: null,
        publishedAt: "2026-11-13T08:00:00.000Z",
        retrievedAt: "2026-11-13T09:55:00.000Z",
      },
    ]);

    const verified = verifier.verifyAll(collected.records);
    expect(verified.records[0].sourceClassification).toBe("OFFICIAL_EXCHANGE");
    expect(verified.records[0].verificationStatus).toBe("VERIFIED");
    expect(verified.records[0].dataPeriod).toBe("Q2 FY27");
    expect(verified.records[0].sourceUrl).toBe("https://www.nseindia.com/filings/reliance-q2");

    expect(verified.records[1].sourceClassification).toBe("REGULATORY");
    expect(verified.records[1].verificationStatus).toBe("VERIFIED");

    expect(verified.records[2].sourceClassification).toBe("UNVERIFIED");
    expect(verified.records[2].verificationStatus).toBe("UNVERIFIED");

    expect(
      classifySourceCredibility({
        source: "DHAN_HQ",
        sourceUrl: "https://api.dhan.co/v2/optionchain",
        category: "INTRADAY_PRICE",
      })
    ).toBe("BROKER");
  });

  it("2. Evaluates freshness boundaries (FRESH, AGING, STALE, EXPIRED, UNKNOWN) and rejects missing timestamps", () => {
    const collector = new EvidenceCollector();
    const validator = new FreshnessValidator();

    const { records } = collector.collect([
      {
        evidenceId: "EV_FRESH",
        symbol: "NIFTY",
        category: "THIRD_PARTY_NEWS",
        claim: "News 1h old",
        value: "Headline",
        source: "Mint",
        publishedAt: new Date(refNow.getTime() - 1 * 3600_000).toISOString(),
        retrievedAt: refNow.toISOString(),
      },
      {
        evidenceId: "EV_AGING",
        symbol: "NIFTY",
        category: "THIRD_PARTY_NEWS",
        claim: "News 18h old",
        value: "Headline",
        source: "Mint",
        publishedAt: new Date(refNow.getTime() - 18 * 3600_000).toISOString(),
        retrievedAt: refNow.toISOString(),
      },
      {
        evidenceId: "EV_STALE",
        symbol: "NIFTY",
        category: "THIRD_PARTY_NEWS",
        claim: "News 48h old",
        value: "Headline",
        source: "Mint",
        publishedAt: new Date(refNow.getTime() - 48 * 3600_000).toISOString(),
        retrievedAt: refNow.toISOString(),
      },
      {
        evidenceId: "EV_EXPIRED",
        symbol: "NIFTY",
        category: "THIRD_PARTY_NEWS",
        claim: "News 96h old",
        value: "Headline",
        source: "Mint",
        publishedAt: new Date(refNow.getTime() - 96 * 3600_000).toISOString(),
        retrievedAt: refNow.toISOString(),
      },
      {
        evidenceId: "EV_MISSING_TS",
        symbol: "NIFTY",
        category: "QUARTERLY_FINANCIALS",
        claim: "Revenue",
        value: 1000,
        source: "Screener",
        publishedAt: null,
        retrievedAt: refNow.toISOString(),
      },
    ]);

    expect(validator.evaluateGranularFreshness(records[0], refNow).freshness).toBe("FRESH");
    expect(validator.evaluateGranularFreshness(records[1], refNow).freshness).toBe("AGING");
    expect(validator.evaluateGranularFreshness(records[2], refNow).freshness).toBe("STALE");
    expect(validator.evaluateGranularFreshness(records[3], refNow).freshness).toBe("EXPIRED");
    expect(validator.evaluateGranularFreshness(records[4], refNow).freshness).toBe("UNKNOWN");
    expect(validator.evaluateFreshness(records[4], refNow).freshness).toBe("EXPIRED");
  });

  it("3. Detects conflicting financial statements, consolidated vs standalone mismatch, and unit/currency mismatches", () => {
    const collector = new EvidenceCollector();
    const verifier = new SourceVerifier();
    const resolver = new ConflictResolver();

    const collected = collector.collect([
      {
        evidenceId: "EV_CONSOL",
        symbol: "RELIANCE",
        category: "QUARTERLY_FINANCIALS",
        claim: "Q2 Revenue",
        value: 240000,
        unit: "CR",
        currency: "INR",
        source: "NSE_OFFICIAL",
        sourceUrl: "https://www.nseindia.com/filings/1",
        publishedAt: "2026-11-10T10:00:00.000Z",
        retrievedAt: refNow.toISOString(),
        metadata: { basis: "consolidated", dataPeriod: "Q2 FY27" },
      },
      {
        evidenceId: "EV_STAND",
        symbol: "RELIANCE",
        category: "QUARTERLY_FINANCIALS",
        claim: "Q2 Revenue",
        value: 145000,
        unit: "CR",
        currency: "INR",
        source: "BSE_OFFICIAL",
        sourceUrl: "https://www.bseindia.com/filings/2",
        publishedAt: "2026-11-10T10:00:00.000Z",
        retrievedAt: refNow.toISOString(),
        metadata: { basis: "standalone", dataPeriod: "Q2 FY27" },
      },
      {
        evidenceId: "EV_USD",
        symbol: "TCS",
        category: "QUARTERLY_FINANCIALS",
        claim: "Q2 Revenue",
        value: 7500,
        unit: "M",
        currency: "USD",
        source: "Reuters",
        sourceUrl: "https://www.reuters.com/tcs",
        publishedAt: "2026-11-10T10:00:00.000Z",
        retrievedAt: refNow.toISOString(),
      },
      {
        evidenceId: "EV_INR",
        symbol: "TCS",
        category: "QUARTERLY_FINANCIALS",
        claim: "Q2 Revenue",
        value: 63000,
        unit: "CR",
        currency: "INR",
        source: "Screener",
        sourceUrl: "https://www.screener.in/company/TCS",
        publishedAt: "2026-11-10T10:00:00.000Z",
        retrievedAt: refNow.toISOString(),
      },
    ]);

    const verified = verifier.verifyAll(collected.records);
    const resolved = resolver.resolve(verified.records);

    expect(resolved.conflicts.length).toBe(2);
    const basisConflict = resolved.conflicts.find((c) => c.symbol === "RELIANCE");
    expect(basisConflict?.conflictStatus).toBe("CONFLICT_UNRESOLVED");
    expect(basisConflict?.resolutionReason).toContain("Consolidated and standalone");
    expect(basisConflict?.evidenceIds).toEqual(["EV_CONSOL", "EV_STAND"]);
    expect(basisConflict?.reportingPeriods).toEqual(["Q2 FY27"]);
  });

  it("4. Demotes unsupported claims, strips invalid citations, and flags conflicted/missing evidence in ResponseSynthesizer", async () => {
    const mockAiClient = {
      createResponse: vi.fn().mockResolvedValue({
        id: "synth_88",
        provider: "groq",
        fallbackUsed: true,
        tier: "fast",
        model: "openai/gpt-oss-120b",
        outputText: JSON.stringify({
          DIRECT_ANSWER: "Summary",
          VERIFIED_FACTS: [
            { statement: "Verified revenue from filing", evidenceIds: ["EV_REAL_1"] },
            { statement: "Fabricated target 5000", evidenceIds: ["EV_FAKE_999"] },
          ],
          UNVERIFIED_INFORMATION: [
            { statement: "Unverified analyst rumor", evidenceIds: [] },
          ],
          AI_INTERPRETATIONS: [
            { statement: "Bullish momentum", basis: "Revenue growth", evidenceIds: ["EV_REAL_1"] },
          ],
          ASSUMPTIONS: [],
          CONFLICTING_EVIDENCE: ["Conflicting margin estimate between two brokers"],
          MISSING_DATA: ["Q3 guidance unavailable"],
          RISK_WARNINGS: [],
          CONCLUSION: { summary: "Mixed evidence.", evidenceIds: ["EV_REAL_1", "EV_FAKE_999"] },
        }),
        output: [],
        usage: { inputTokens: 20, outputTokens: 20, totalTokens: 40 },
        latencyMs: 5,
      }),
    } as any;

    const synth = new ResponseSynthesizer(mockAiClient);
    const res = await synth.synthesize({
      query: "Analyze RELIANCE",
      routing: intentRouter.route("Analyze RELIANCE", "RELIANCE"),
      executions: [
        {
          agentId: "company_research",
          status: "SUCCEEDED",
          errorCategory: "SUCCESS",
          latencyMs: 10,
          error: null,
          generatedAt: refNow.toISOString(),
          evidenceIds: ["EV_REAL_1"],
          missingInformation: [],
          conflictsCount: 1,
          summaryPayload: { summary: "ok" },
        },
      ],
      tier: "fast",
      timeoutMs: 5000,
    });

    // Invalid citation stripped
    expect(res.structured.invalidEvidenceIdsStripped).toContain("EV_FAKE_999");
    // Unsupported claim demoted out of VERIFIED_FACTS into UNVERIFIED_INFORMATION
    expect(res.structured.VERIFIED_FACTS.map((f) => f.statement)).toEqual([
      "Verified revenue from filing",
    ]);
    expect(res.structured.UNVERIFIED_INFORMATION.map((u) => u.statement)).toContain(
      "Fabricated target 5000"
    );
    // Claim audit flags VERIFIED/CONFLICTED vs UNSUPPORTED
    const fabricatedAudit = res.structured.claimAudit?.find(
      (c) => c.claim === "Fabricated target 5000"
    );
    expect(fabricatedAudit?.supportStatus).toBe("UNSUPPORTED");
    const realAudit = res.structured.claimAudit?.find(
      (c) => c.claim === "Verified revenue from filing"
    );
    expect(realAudit?.supportStatus).toBe("CONFLICTED");
    expect(res.structured.MISSING_DATA).toContain("Q3 guidance unavailable");
  });
});
