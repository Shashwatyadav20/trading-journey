import { describe, expect, it } from "vitest";
import { fetchOfficialNseIntegratedFilingList } from "../BseXbrlBackfillService.js";

describe("Strategy 03 Phase 6.10.11 — Integrated Filing XBRL Adapter", () => {
  it("filters integrated-filing-results JSON to valid Ind-AS XBRL XMLs", async () => {
    const mockFetch = async () =>
      new Response(
        JSON.stringify({
          data: [
            {
              symbol: "INFY",
              type: "Integrated Filing- Governance",
              xbrl: null,
              seq_Id: "1",
            },
            {
              symbol: "INFY",
              type: "Integrated Filing- Financials",
              consolidated: "Consolidated",
              qe_Date: "30-SEP-2026",
              broadcast_Date: "23-Oct-2026 20:21:18",
              seq_Id: "203729",
              xbrl: "https://nsearchives.nseindia.in/corporate/xbrl/INTEGRATED_FILING_INDAS_1745057.xml",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    const res = await fetchOfficialNseIntegratedFilingList("INFY", {
      fetchImpl: mockFetch as typeof fetch,
    });
    expect(res.ok).toBe(true);
    expect(res.filings).toHaveLength(1);
    expect(res.filings[0].seq_Id).toBe("203729");
  });
});

