import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import { parseNseSecBhavdataCsv } from "../NseDeliveryCollector";
import { parseNseBulkBlockCsv, detectRepeatedDealPatterns } from "../BulkBlockDealCollector";
import {
  parseScreenerShareholdingHtml,
  mergeShareholdingHistory,
  computeShareholdingQoQDiff,
  validateShareholdingPlausibility,
} from "../ShareholdingParser";
import {
  parseBseAnnouncementsResponse,
  classifyAnnouncementCategory,
} from "../CorporateAnnouncementCollector";
import { fetchWithBackoff, isTimestampStale } from "../Strategy03DataTypes";
import { buildStrategy03DataRoutes } from "../../../../../routes/strategy03Data";

vi.mock("../../../../../auth/middleware", () => ({
  authenticateRequest: async (request: any, reply: any) => {
    if (request.headers?.authorization !== "Bearer valid-s03-token") {
      return reply.status(401).send({ success: false, error: "Unauthorized" });
    }
    request.user = { userId: "user-s03" };
  },
  getVerifiedUser: (request: any) => request.user,
}));

describe("Phase 6.1 — Strategy 03 Institutional & Corporate Data Engine", () => {
  it("1. Parses NSE Bhavcopy & Delivery CSV, rejects duplicates, and never substitutes tradedQty for missing deliveryQty", () => {
    const csv = [
      "SYMBOL, SERIES, DATE1, PREV_CLOSE, OPEN_PRICE, HIGH_PRICE, LOW_PRICE, LAST_PRICE, CLOSE_PRICE, AVG_PRICE, TTL_TRD_QNTY, TURNOVER_LACS, NO_OF_TRADES, DELIV_QTY, DELIV_PER",
      "RELIANCE, EQ, 13-NOV-2026, 1280, 1285, 1300, 1275, 1295, 1295, 1288, 1000000, 12880, 50000, 550000, 55.00",
      "RELIANCE, EQ, 13-NOV-2026, 1280, 1285, 1300, 1275, 1295, 1295, 1288, 1000000, 12880, 50000, 550000, 55.00",
      "BE_STOCK, BE, 13-NOV-2026, 50, 50, 52, 49, 51, 51, 50.5, 10000, 5.05, 100, -, -",
    ].join("\n");

    const parsed = parseNseSecBhavdataCsv(csv, "https://nsearchives.nseindia.com/test.csv");
    expect(parsed.duplicateRows).toBe(1);
    expect(parsed.records).toHaveLength(2);
    expect(parsed.records[0].tradingDate).toBe("2026-11-13");
    expect(parsed.records[0].deliveryQty).toBe(550000);
    expect(parsed.records[0].evidence.verificationStatus).toBe("VERIFIED");

    // Missing deliveryQty stays null & MISSING (never substituted with 10000)
    expect(parsed.records[1].deliveryQty).toBeNull();
    expect(parsed.records[1].evidence.verificationStatus).toBe("MISSING");
  });

  it("2. Parses Bulk/Block deals and requires >= 2 verified disclosures for repeated pattern detection", () => {
    const csv = [
      "Date,Symbol,Security Name,Client Name,Buy/Sell,Quantity Traded,Trade Price / Wght. Avg. Price,Remarks",
      "16-NOV-2026,AAATECH,AAA Tech,NIPPON INDIA MUTUAL FUND,BUY,100000,120.5,-",
      "16-NOV-2026,AAATECH,AAA Tech,SBI MUTUAL FUND,BUY,150000,121.0,-",
      "16-NOV-2026,SOLO,Solo Ltd,ABC TRADERS,BUY,50000,80.0,-",
    ].join("\n");

    const parsed = parseNseBulkBlockCsv({
      csvText: csv,
      dealType: "BULK",
      sourceUrl: "https://nsearchives.nseindia.com/content/equities/bulk.csv",
    });
    expect(parsed.records).toHaveLength(3);
    expect(parsed.records[0].clientCategory).toBe("INSTITUTIONAL_FUND");

    const patterns = detectRepeatedDealPatterns(parsed.records, 2);
    expect(patterns).toHaveLength(1);
    expect(patterns[0].symbol).toBe("AAATECH");
    expect(patterns[0].dealCount).toBe(2);
  });

  it("3. Validates shareholding plausibility, preserves historical quarters, and versions restated filings", () => {
    const html = `
      <section id="shareholding">
        <table>
          <thead><tr><th></th><th>Jun 2026</th><th>Sep 2026</th></tr></thead>
          <tbody>
            <tr><td>Promoters +</td><td>50.00%</td><td>50.50%</td></tr>
            <tr><td>FIIs +</td><td>20.00%</td><td>21.00%</td></tr>
            <tr><td>DIIs +</td><td>15.00%</td><td>15.50%</td></tr>
            <tr><td>Public +</td><td>15.00%</td><td>13.00%</td></tr>
          </tbody>
        </table>
      </section>`;

    const qtrs = parseScreenerShareholdingHtml({
      symbol: "RELIANCE",
      html,
      sourceUrl: "https://www.screener.in/company/RELIANCE/consolidated/",
    });
    expect(qtrs).toHaveLength(2);
    expect(qtrs[0].isPlausibleSum).toBe(true);
    expect(qtrs[0].mutualFundPct).toBeNull();
    expect(qtrs[0].promoterPledgedPct).toBeNull();

    const qoq = computeShareholdingQoQDiff(qtrs[0], qtrs[1]);
    expect(qoq.fiiDeltaPct).toBe(1.0);
    expect(qoq.diiDeltaPct).toBe(0.5);

    // Restated filing for Sep 2026 creates version 2 without overwriting version 1
    const restated = [{ ...qtrs[1], fiiPct: 21.25 }];
    const merged = mergeShareholdingHistory(qtrs, restated);
    expect(merged).toHaveLength(3);
    expect(merged[2].version).toBe(2);

    // Implausible sum check
    expect(validateShareholdingPlausibility({ promoterPct: 20, fiiPct: 10, diiPct: 5, publicPct: 5 }).isPlausibleSum).toBe(false);
  });

  it("4. Extracts & classifies corporate announcements, deduplicates, and rejects stale items", () => {
    const nowIso = new Date().toISOString();
    const staleIso = new Date(Date.now() - 250 * 86400_000).toISOString();

    expect(classifyAnnouncementCategory("Company bags Rs 500 Cr Letter of Award").category).toBe("ORDER_WIN");
    expect(isTimestampStale(staleIso, 180)).toBe(true);
    expect(isTimestampStale(nowIso, 180)).toBe(false);

    const parsed = parseBseAnnouncementsResponse({
      symbol: "LT",
      companyName: "Larsen & Toubro",
      rows: [
        { NEWSID: "N1", HEADLINE: "Order Book reaches record high", DissemDT: nowIso, ATTACHMENTNAME: "a.pdf" },
        { NEWSID: "N1", HEADLINE: "Order Book reaches record high", DissemDT: nowIso, ATTACHMENTNAME: "a.pdf" },
        { NEWSID: "N2", HEADLINE: "Old capex", DissemDT: staleIso },
      ],
    });
    expect(parsed.records).toHaveLength(1);
    expect(parsed.records[0].category).toBe("ORDER_BOOK");
    expect(parsed.duplicateCount).toBe(1);
    expect(parsed.staleCount).toBe(1);
  });

  it("5. Handles rate-limit backoff retries and protects Strategy 03 ingestion APIs", async () => {
    let calls = 0;
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      calls += 1;
      if (calls === 1) return new Response("rate limit", { status: 429 });
      return new Response("ok", { status: 200 });
    }) as typeof fetch;

    try {
      const res = await fetchWithBackoff("https://example.com/test", {}, { maxRetries: 1, baseDelayMs: 5 });
      expect(res.status).toBe(200);
      expect(calls).toBe(2);
    } finally {
      globalThis.fetch = origFetch;
    }

    const mockSvc: any = {
      loadPaginatedUniverse: async () => [{ nseSymbol: "RELIANCE" }, { nseSymbol: null }],
      runControlledIngestion: async () => ({
        stats: { totalUniverseRecords: 2, nseEligibleRecords: 1, deliverySymbolsCount: 1 },
      }),
    };
    const app = Fastify();
    await app.register(buildStrategy03DataRoutes(mockSvc));

    const unauth = await app.inject({ method: "GET", url: "/api/indian/strategy03/data/coverage" });
    expect(unauth.statusCode).toBe(401);

    const authCov = await app.inject({
      method: "GET",
      url: "/api/indian/strategy03/data/coverage",
      headers: { Authorization: "Bearer valid-s03-token" },
    });
    expect(authCov.statusCode).toBe(200);
    expect(authCov.json().strategy03Active).toBe(false);

    // Reject maxEnrichedSymbols > 50 with 400
    const overLimit = await app.inject({
      method: "POST",
      url: "/api/indian/strategy03/data/ingest",
      headers: { Authorization: "Bearer valid-s03-token" },
      payload: { maxEnrichedSymbols: 75 },
    });
    expect(overLimit.statusCode).toBe(400);

    // Valid ingest -> then immediate second ingest hits 429 rate limit
    const okIngest = await app.inject({
      method: "POST",
      url: "/api/indian/strategy03/data/ingest",
      headers: { Authorization: "Bearer valid-s03-token" },
      payload: { maxEnrichedSymbols: 5 },
    });
    expect(okIngest.statusCode).toBe(200);

    const rateLimited = await app.inject({
      method: "POST",
      url: "/api/indian/strategy03/data/ingest",
      headers: { Authorization: "Bearer valid-s03-token" },
      payload: { maxEnrichedSymbols: 5 },
    });
    expect(rateLimited.statusCode).toBe(429);
    await app.close();
  });

  it("6. Flags impossible delivery %, zero-volume symbols, and unattached material announcements", () => {
    const csv = [
      "SYMBOL, SERIES, DATE1, PREV_CLOSE, OPEN_PRICE, HIGH_PRICE, LOW_PRICE, LAST_PRICE, CLOSE_PRICE, AVG_PRICE, TTL_TRD_QNTY, TURNOVER_LACS, NO_OF_TRADES, DELIV_QTY, DELIV_PER",
      "BADPCT, EQ, 13-NOV-2026, 100, 100, 105, 99, 102, 102, 101, 1000, 1.01, 10, 500, 125.5",
      "ZEROVOL, EQ, 13-NOV-2026, 100, 100, 100, 100, 100, 100, 100, 0, 0, 0, 0, 0",
    ].join("\n");
    const deliv = parseNseSecBhavdataCsv(csv, "https://nsearchives.nseindia.com/test.csv");
    expect(deliv.records[0].deliveryPct).toBeNull();
    expect(deliv.records[0].evidence.verificationStatus).toBe("CONFLICTED");
    expect(deliv.records[0].evidence.hasSourceConflict).toBe(true);
    expect(deliv.records[1].evidence.verificationStatus).toBe("MISSING");

    const nowIso = new Date().toISOString();
    const ann = parseBseAnnouncementsResponse({
      symbol: "TEST",
      companyName: "Test Ltd",
      rows: [
        { NEWSID: "A1", HEADLINE: "Company receives Work Order of Rs 200 Cr", DissemDT: nowIso },
      ],
    });
    expect(ann.records).toHaveLength(1);
    expect(ann.records[0].category).toBe("ORDER_WIN");
    expect(ann.records[0].extractionStatus).toBe("FAILED");
    expect(ann.records[0].evidence.verificationStatus).toBe("UNVERIFIED");
  });
});
