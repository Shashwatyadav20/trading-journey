import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { ConversationService } from "../conversation/ConversationService";
import { InstitutionalTerminalService } from "../context/InstitutionalTerminalService";
import { UnifiedIntelligenceContext } from "../context/UnifiedContextSchema";
import { NewsMacroIntelligenceAgent } from "../agents/NewsMacroIntelligenceAgent";
import { PortfolioPositionRecord } from "../agents/PortfolioIntelligenceSchema";
import { AIProviderError } from "../core/AIProvider";

function createInMemorySupabaseMock() {
  const tables: Record<string, any[]> = {
    ai_conversations: [],
    ai_messages: [],
  };

  function makeQuery(tableName: string) {
    const filters: Array<(row: any) => boolean> = [];
    let orderBy: { col: string; asc: boolean } | null = null;
    let rangeBounds: [number, number] | null = null;
    let limitCount: number | null = null;
    let selectSingle = false;

    const api: any = {
      select: () => api,
      eq: (col: string, val: any) => {
        filters.push((r) => r[col] === val);
        return api;
      },
      or: (expr: string) => {
        if (expr.includes("STANDALONE_TERMINAL_CONTEXT")) {
          filters.push(
            (r) =>
              r.last_intent === null ||
              r.last_intent === undefined ||
              r.last_intent !== "STANDALONE_TERMINAL_CONTEXT"
          );
        }
        return api;
      },
      order: (col: string, opts?: { ascending?: boolean }) => {
        orderBy = { col, asc: opts?.ascending ?? true };
        return api;
      },
      range: (from: number, to: number) => {
        rangeBounds = [from, to];
        return api;
      },
      limit: (n: number) => {
        limitCount = n;
        return api;
      },
      single: () => {
        selectSingle = true;
        return api;
      },
      maybeSingle: () => {
        selectSingle = true;
        return api;
      },
      insert: (payload: any) => {
        const rows = Array.isArray(payload) ? payload : [payload];
        for (const r of rows) {
          tables[tableName].push({ ...r });
        }
        return {
          select: () => ({
            single: async () => ({ data: rows[0], error: null }),
          }),
          then: (resolve: any) => resolve({ data: rows, error: null }),
        };
      },
      upsert: (
        payload: any,
        opts?: { onConflict?: string; ignoreDuplicates?: boolean }
      ) => {
        const rows = Array.isArray(payload) ? payload : [payload];
        const conflictKey = opts?.onConflict ?? "id";
        for (const r of rows) {
          const idx = tables[tableName].findIndex(
            (existing) => existing[conflictKey] === r[conflictKey]
          );
          if (idx === -1) {
            tables[tableName].push({ ...r });
          } else if (!opts?.ignoreDuplicates) {
            tables[tableName][idx] = { ...tables[tableName][idx], ...r };
          }
        }
        return Promise.resolve({ data: rows, error: null });
      },
      update: (patch: any) => {
        return {
          eq: (col1: string, val1: any) => ({
            eq: (col2: string, val2: any) => {
              for (const row of tables[tableName]) {
                if (row[col1] === val1 && row[col2] === val2) {
                  Object.assign(row, patch);
                }
              }
              return Promise.resolve({ error: null });
            },
          }),
        };
      },
      delete: () => ({
        eq: (col1: string, val1: any) => ({
          eq: (col2: string, val2: any) => {
            tables[tableName] = tables[tableName].filter(
              (r) => !(r[col1] === val1 && r[col2] === val2)
            );
            return Promise.resolve({ error: null });
          },
        }),
      }),
      then: (resolve: any) => {
        let rows = tables[tableName].filter((r) => filters.every((f) => f(r)));
        const totalCount = rows.length;
        if (orderBy) {
          const { col, asc } = orderBy;
          rows = [...rows].sort((a, b) =>
            asc
              ? String(a[col]).localeCompare(String(b[col]))
              : String(b[col]).localeCompare(String(a[col]))
          );
        }
        if (rangeBounds) {
          rows = rows.slice(rangeBounds[0], rangeBounds[1] + 1);
        } else if (limitCount !== null) {
          rows = rows.slice(0, limitCount);
        }
        if (selectSingle) {
          return resolve({ data: rows[0] ?? null, error: null });
        }
        return resolve({ data: rows, error: null, count: totalCount });
      },
    };
    return api;
  }

  return {
    tables,
    from: (tableName: string) => makeQuery(tableName),
  };
}

function makeUnifiedContext(
  userId: string,
  symbol: string,
  createdAt: string,
  contextId = crypto.randomUUID()
): UnifiedIntelligenceContext {
  return {
    contextId,
    userId,
    symbol,
    companyName: symbol,
    exchange: "NSE",
    createdAt,
    requestedAt: createdAt,
    marketTimestamp: createdAt,
    researchPeriod: {
      requestedPeriod: "Q2FY27",
      detectedPeriods: ["Q2FY27"],
      incompatiblePeriodsRejected: [],
    },
    agentExecutions: [],
    evidenceReferences: [],
    sourceProvenance: [],
    freshnessSummary: {
      freshCount: 1,
      agingCount: 0,
      staleCount: 0,
      expiredCount: 0,
      unknownCount: 0,
      hasMixedFreshness: false,
      explicitWarning: null,
    },
    conflicts: [],
    missingData: [],
    qualityAssessment: {
      availableEvidenceCount: 1,
      missingDataCount: 0,
      staleEvidenceCount: 0,
      expiredEvidenceCount: 0,
      conflictedEvidenceCount: 0,
      completedAgentsCount: 1,
      failedAgentsCount: 0,
      skippedAgentsCount: 0,
      completedAgents: ["company_research"],
      failedAgents: [],
      skippedAgents: [],
      qualityClassification: "COMPLETE",
    },
    contextStatus: "COMPLETE",
  };
}

describe("Phase 9.6.7 — Institutional Terminal Production Blockers", () => {
  it("1, 2, 3, 4 & 11. Persists standalone contexts to Supabase, restores after restart, prevents duplicates, isolates users, and keeps chat conversations clean", async () => {
    const supabaseMock = createInMemorySupabaseMock();

    // Instance 1 (before simulated backend restart)
    const convSvc1 = new ConversationService({ supabaseClient: supabaseMock });
    const ctxId = crypto.randomUUID();
    const ctxA = makeUnifiedContext("user-A", "RELIANCE", "2026-11-15T10:00:00.000Z", ctxId);
    const ctxB = makeUnifiedContext("user-B", "TCS", "2026-11-15T10:05:00.000Z");

    await convSvc1.recordUnifiedContext("user-A", ctxA);
    // Duplicate retry with same contextId
    await convSvc1.recordUnifiedContext("user-A", ctxA);
    await convSvc1.recordUnifiedContext("user-B", ctxB);

    // Existing conversation persistence remains intact and excludes internal anchor
    const chatConv = await convSvc1.createConversation("user-A", "RELIANCE chat");
    await convSvc1.appendMessage("user-A", chatConv.id, {
      role: "user",
      content: "Analyze RELIANCE",
    });

    expect(supabaseMock.tables.ai_messages.filter((m) => m.user_id === "user-A")).toHaveLength(2);

    // Instance 2 (simulated backend restart — fresh ConversationService with empty in-memory maps)
    const convSvc2 = new ConversationService({ supabaseClient: supabaseMock });
    const terminalSvc2 = new InstitutionalTerminalService({ conversations: convSvc2 });

    const historyA = await terminalSvc2.getResearchHistory("user-A", { limit: 10, offset: 0 });
    const historyB = await terminalSvc2.getResearchHistory("user-B", { limit: 10, offset: 0 });
    const convListA = await convSvc2.listConversations("user-A", { limit: 20, offset: 0 });

    expect(historyA.total).toBe(1);
    expect(historyA.entries[0].contextId).toBe(ctxId);
    expect(historyA.entries[0].symbol).toBe("RELIANCE");

    expect(historyB.total).toBe(1);
    expect(historyB.entries[0].symbol).toBe("TCS");

    // Chat conversation list must not expose the internal STANDALONE_TERMINAL_CONTEXT anchor
    expect(convListA.total).toBe(1);
    expect(convListA.conversations[0].title).toBe("RELIANCE chat");
  });

  it("5. Supports pagination beyond 100 standalone research history records", async () => {
    const supabaseMock = createInMemorySupabaseMock();
    const convSvc1 = new ConversationService({ supabaseClient: supabaseMock });

    for (let i = 0; i < 125; i++) {
      const ts = new Date(Date.UTC(2026, 10, 1, 0, i, 0)).toISOString();
      await convSvc1.recordUnifiedContext(
        "user-paginated",
        makeUnifiedContext("user-paginated", i % 2 === 0 ? "RELIANCE" : "TCS", ts)
      );
    }

    // Fresh instance after restart
    const convSvc2 = new ConversationService({ supabaseClient: supabaseMock });
    const terminalSvc2 = new InstitutionalTerminalService({ conversations: convSvc2 });

    const page6 = await terminalSvc2.getResearchHistory("user-paginated", {
      limit: 25,
      offset: 100,
    });

    expect(page6.total).toBe(125);
    expect(page6.entries).toHaveLength(25);
  });

  it("6, 7 & 8. Computes portfolio P&L (long + short), exposure, allocation %, max concentration, and keeps missing prices as null", async () => {
    const convSvc = new ConversationService({ forceInMemory: true });
    const positions: PortfolioPositionRecord[] = [
      {
        id: "pos-1",
        userId: "user-port",
        instrument: "RELIANCE",
        side: "BUY",
        quantity: 10,
        entryPrice: 1200,
        currentPrice: 1300, // +1000 P&L, 13000 exposure
        realizedPnL: 0,
        status: "OPEN",
      },
      {
        id: "pos-2",
        userId: "user-port",
        instrument: "TCS",
        side: "SELL",
        quantity: 2,
        entryPrice: 4000,
        currentPrice: 3800, // short profit +400 P&L, 7600 exposure
        realizedPnL: 0,
        status: "OPEN",
      },
      {
        id: "pos-3",
        userId: "user-port",
        instrument: "INFY",
        side: "BUY",
        quantity: 5,
        entryPrice: 1500,
        currentPrice: null, // missing price -> null P&L, never 0
        realizedPnL: 0,
        status: "OPEN",
      },
      {
        id: "pos-other",
        userId: "user-other",
        instrument: "HDFCBANK",
        side: "BUY",
        quantity: 100,
        entryPrice: 1600,
        currentPrice: 1700,
        realizedPnL: 0,
        status: "OPEN",
      },
    ];

    const terminalSvc = new InstitutionalTerminalService({
      conversations: convSvc,
      positionsLoader: async (uid) => positions.filter((p) => p.userId === uid),
    });

    const res = await terminalSvc.getPortfolioResearchIntelligence("user-port");

    expect(res.totalHoldings).toBe(3);
    expect(res.totalExposure).toBe(20600);
    // Aggregate unrealizedPnL sums priced open positions (1000 + 400 = 1400),
    // while INFY (missing price) remains null on its holding and is listed in missingPriceInstruments
    expect(res.unrealizedPnL).toBe(1400);
    expect(res.missingPriceInstruments).toEqual(["INFY"]);
    expect(res.maxPositionConcentrationPct).toBeCloseTo(63.11, 2);

    const reliance = res.holdings.find((h) => h.symbol === "RELIANCE")!;
    const tcs = res.holdings.find((h) => h.symbol === "TCS")!;
    const infy = res.holdings.find((h) => h.symbol === "INFY")!;

    expect(reliance.unrealizedPnL).toBe(1000);
    expect(reliance.exposure).toBe(13000);
    expect(tcs.unrealizedPnL).toBe(400);
    expect(tcs.exposure).toBe(7600);
    expect(infy.unrealizedPnL).toBeNull();
    expect(infy.exposure).toBeNull();
  });

  it("9 & 10. Emits standalone news evidence with provenance/freshness/UNKNOWN timestamps, deduplicates, and handles empty feeds honestly", async () => {
    const refDate = new Date("2026-11-15T12:00:00.000Z");
    const failingAiClient = {
      createResponse: async () => {
        throw new AIProviderError({
          message: "Mocked 503",
          provider: "gemini",
          statusCode: 503,
          code: "MOCK_503",
          retryable: false,
          tier: "balanced",
          model: "mock",
        });
      },
    } as any;

    let capturedPkg: any = null;
    const agentWithNews = new NewsMacroIntelligenceAgent({
      aiClient: failingAiClient,
      newsMacroCollector: async () => ({
        inputs: [],
        researchSnapshot: {
          symbol: "RELIANCE.NS",
          cleanSymbol: "RELIANCE",
          companyName: "Reliance Industries",
          fundamentals: {
            trailingPE: null,
            forwardPE: null,
            priceToBook: null,
            roePct: null,
            debtToEquity: null,
            quarterlyRevenueGrowthPct: null,
            quarterlyEarningsGrowthPct: null,
            operatingMarginPct: null,
            marketCapCr: null,
          },
          institutionalHoldings: {
            institutionsPercentHeld: null,
            insidersPromoterPercentHeld: null,
            institutionsCount: null,
          },
          technicals: {
            ltp: null,
            changePct: null,
            vwap: null,
            ema20: null,
          },
          newsAndMacro: [
            {
              title: "Reliance expands retail footprint in Q3",
              publisher: "Economic Times",
              publishedAt: "2026-11-15T10:00:00.000Z",
              publishedAtIso: "2026-11-15T10:00:00.000Z",
              link: "https://example.com/news/1",
              category: "COMPANY_NEWS",
              sentiment: "POSITIVE",
            },
            {
              title: "Reliance expands retail footprint in Q3",
              publisher: "Economic Times",
              publishedAt: "2026-11-15T10:00:00.000Z",
              publishedAtIso: "2026-11-15T10:00:00.000Z",
              link: "https://example.com/news/1",
              category: "COMPANY_NEWS",
              sentiment: "POSITIVE",
            },
            {
              title: "SEBI disclosure without timestamp",
              publisher: "NSE Filing",
              publishedAt: "UNKNOWN",
              publishedAtIso: null,
              link: "https://example.com/news/2",
              category: "REGULATORY_SEBI",
              sentiment: "NEUTRAL",
            },
          ],
        },
      }),
    });

    await expect(
      agentWithNews.analyze(
        { symbol: "RELIANCE", tier: "balanced" },
        {
          referenceDate: refDate,
          onEvidenceCollected: (pkg) => {
            capturedPkg = pkg;
          },
        }
      )
    ).rejects.toThrow();

    expect(capturedPkg).not.toBeNull();
    expect(capturedPkg.allRecords).toHaveLength(2);
    expect(capturedPkg.allRecords[0].source).toBe("Economic Times");
    expect(capturedPkg.allRecords[0].sourceUrl).toBe("https://example.com/news/1");
    expect(capturedPkg.allRecords[1].publishedAt).toBeNull();
    expect(capturedPkg.allRecords[1].freshness).toBe("EXPIRED");

    // Empty feed must emit 0 fabricated news and explicit missingInformation
    let emptyPkg: any = null;
    const emptyAgent = new NewsMacroIntelligenceAgent({
      aiClient: failingAiClient,
      newsMacroCollector: async () => ({ inputs: [] }),
    });

    await expect(
      emptyAgent.analyze(
        { symbol: "RELIANCE", tier: "balanced" },
        {
          referenceDate: refDate,
          onEvidenceCollected: (pkg) => {
            emptyPkg = pkg;
          },
        }
      )
    ).rejects.toThrow();

    expect(emptyPkg.allRecords).toHaveLength(0);
    expect(emptyPkg.missingInformation.length).toBeGreaterThan(0);
  });
});
