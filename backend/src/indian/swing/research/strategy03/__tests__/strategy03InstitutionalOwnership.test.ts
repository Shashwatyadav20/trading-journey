import { describe, expect, it } from "vitest";
import {
  computeShareholdingTrends,
  detectShareholdingSourceConflict,
  parseShareholdingXbrlXml,
  validateShareholdingRecord,
} from "../OfficialShareholdingIntelligenceEngine.js";
import { Strategy03InstitutionalResearchService } from "../Strategy03ResearchPipeline.js";

const SAMPLE_SHP_XBRL = `<?xml version="1.0" encoding="UTF-8"?>
<xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance"
  xmlns:in-bse-shp="http://www.bseindia.com/xbrl/shp/2022-03-31/in-bse-shp"
  xmlns:xbrldi="http://xbrl.org/2006/xbrldi">
  <xbrli:context id="ShareholdingOfPromoterAndPromoterGroup_ContextI">
    <xbrli:entity><xbrli:identifier scheme="http://www.nseindia.com/NSESymbol">RELIANCE</xbrli:identifier>
      <xbrli:segment><xbrldi:explicitMember dimension="in-bse-shp:ShareholdingPatternAxis">in-bse-shp:ShareholdingOfPromoterAndPromoterGroupMember</xbrldi:explicitMember></xbrli:segment>
    </xbrli:entity><xbrli:period><xbrli:instant>2026-09-30</xbrli:instant></xbrli:period>
  </xbrli:context>
  <xbrli:context id="InstitutionsForeign_ContextI">
    <xbrli:entity><xbrli:identifier scheme="http://www.nseindia.com/NSESymbol">RELIANCE</xbrli:identifier>
      <xbrli:segment><xbrldi:explicitMember dimension="in-bse-shp:ShareholdingPatternAxis">in-bse-shp:InstitutionsForeignMember</xbrldi:explicitMember></xbrli:segment>
    </xbrli:entity><xbrli:period><xbrli:instant>2026-09-30</xbrli:instant></xbrli:period>
  </xbrli:context>
  <xbrli:context id="InstitutionsDomestic_ContextI">
    <xbrli:entity><xbrli:identifier scheme="http://www.nseindia.com/NSESymbol">RELIANCE</xbrli:identifier>
      <xbrli:segment><xbrldi:explicitMember dimension="in-bse-shp:ShareholdingPatternAxis">in-bse-shp:InstitutionsDomesticMember</xbrldi:explicitMember></xbrli:segment>
    </xbrli:entity><xbrli:period><xbrli:instant>2026-09-30</xbrli:instant></xbrli:period>
  </xbrli:context>
  <xbrli:context id="MutualFundsOrUTI_ContextI">
    <xbrli:entity><xbrli:identifier scheme="http://www.nseindia.com/NSESymbol">RELIANCE</xbrli:identifier>
      <xbrli:segment><xbrldi:explicitMember dimension="in-bse-shp:ShareholdingPatternAxis">in-bse-shp:MutualFundsOrUTIMember</xbrldi:explicitMember></xbrli:segment>
    </xbrli:entity><xbrli:period><xbrli:instant>2026-09-30</xbrli:instant></xbrli:period>
  </xbrli:context>
  <xbrli:context id="InsuranceCompanies_ContextI">
    <xbrli:entity><xbrli:identifier scheme="http://www.nseindia.com/NSESymbol">RELIANCE</xbrli:identifier>
      <xbrli:segment><xbrldi:explicitMember dimension="in-bse-shp:ShareholdingPatternAxis">in-bse-shp:InsuranceCompaniesMember</xbrldi:explicitMember></xbrli:segment>
    </xbrli:entity><xbrli:period><xbrli:instant>2026-09-30</xbrli:instant></xbrli:period>
  </xbrli:context>
  <in-bse-shp:ShareholdingAsAPercentageOfTotalNumberOfShares contextRef="ShareholdingOfPromoterAndPromoterGroup_ContextI">0.5044</in-bse-shp:ShareholdingAsAPercentageOfTotalNumberOfShares>
  <in-bse-shp:ShareholdingAsAPercentageOfTotalNumberOfShares contextRef="InstitutionsForeign_ContextI">0.1667</in-bse-shp:ShareholdingAsAPercentageOfTotalNumberOfShares>
  <in-bse-shp:ShareholdingAsAPercentageOfTotalNumberOfShares contextRef="InstitutionsDomestic_ContextI">0.2172</in-bse-shp:ShareholdingAsAPercentageOfTotalNumberOfShares>
  <in-bse-shp:ShareholdingAsAPercentageOfTotalNumberOfShares contextRef="MutualFundsOrUTI_ContextI">0.1031</in-bse-shp:ShareholdingAsAPercentageOfTotalNumberOfShares>
  <in-bse-shp:ShareholdingAsAPercentageOfTotalNumberOfShares contextRef="InsuranceCompanies_ContextI">0.0947</in-bse-shp:ShareholdingAsAPercentageOfTotalNumberOfShares>
  <in-bse-shp:WhetherAnySharesHeldByPromotersAreEncumberedUnderPledgedForPromoterAndPromoterGroup contextRef="MainI">false</in-bse-shp:WhetherAnySharesHeldByPromotersAreEncumberedUnderPledgedForPromoterAndPromoterGroup>
</xbrli:xbrl>`;

describe("Strategy 03 Phase 6.4.2 — Official Institutional Shareholding Intelligence", () => {
  it("parses official SHP XBRL without double-counting Mutual Funds inside DII and extracts 0% pledge", () => {
    const rec = parseShareholdingXbrlXml({
      symbol: "RELIANCE",
      isin: "INE002A01018",
      reportingQuarter: "2026-09-30",
      filingDate: "2026-10-21",
      sourceUrl: "https://nsearchives.nseindia.in/corporate/xbrl/SHP_TEST.xml",
      xmlText: SAMPLE_SHP_XBRL,
    });
    expect(rec.verificationStatus).toBe("VERIFIED");
    expect(rec.promoterPct).toBe(50.44);
    expect(rec.fiiPct).toBe(16.67);
    expect(rec.diiPct).toBe(21.72); // Does NOT add mutualFundPct (10.31) on top of 21.72
    expect(rec.mutualFundPct).toBe(10.31);
    expect(rec.insurancePct).toBe(9.47);
    expect(rec.promoterPledgedPct).toBe(0);
    expect(rec.isTotalReconciled).toBe(true);
  });

  it("computes QoQ, YoY, accumulation streaks, and preserves restated versions", () => {
    const mk = (qtr: string, fii: number, dii: number, ver = 1) =>
      parseShareholdingXbrlXml({
        symbol: "INFY",
        reportingQuarter: qtr,
        filingDate: qtr,
        sourceUrl: `https://nsearchives.nseindia.in/corporate/xbrl/${qtr}_v${ver}.xml`,
        xmlText: SAMPLE_SHP_XBRL
          .replace("0.5044", "0.4000")
          .replace("0.1667", String(fii / 100))
          .replace("0.2172", String(dii / 100)),
        version: ver,
        isRestated: ver > 1,
      });

    const trended = computeShareholdingTrends([
      mk("2025-09-30", 30.0, 20.0, 1),
      mk("2025-12-31", 31.0, 20.5, 1),
      mk("2026-03-31", 32.0, 21.0, 1),
      mk("2026-06-30", 33.0, 21.5, 1),
      mk("2026-09-30", 34.0, 22.0, 1),
      mk("2026-09-30", 34.5, 22.0, 2),
    ]);

    expect(trended).toHaveLength(6); // Older v1 preserved alongside v2
    const latest = trended[5];
    expect(latest.version).toBe(2);
    expect(latest.isRestated).toBe(true);
    expect(latest.fiiQoqChangePp).toBe(1.5);
    expect(latest.fiiYoyChangePp).toBe(4.5);
    expect(latest.consecutiveFiiAccumQtrs).toBe(4);
  });

  it("detects stale records, missing ownership, and source conflicts without zero-coercion", () => {
    const missing = parseShareholdingXbrlXml({
      symbol: "MISSINGCO",
      reportingQuarter: "2026-09-30",
      sourceUrl: "https://nsearchives.nseindia.in/corporate/xbrl/empty.xml",
      xmlText: "<xbrli:xbrl></xbrli:xbrl>",
    });
    expect(missing.verificationStatus).toBe("MISSING");
    expect(missing.fiiPct).toBeNull();
    expect(missing.promoterPledgedPct).toBeNull();

    const stale = validateShareholdingRecord(
      parseShareholdingXbrlXml({
        symbol: "OLDCO",
        reportingQuarter: "2024-03-31",
        sourceUrl: "https://nsearchives.nseindia.in/corporate/xbrl/old.xml",
        xmlText: SAMPLE_SHP_XBRL,
      }),
      { referenceNowMs: Date.parse("2026-11-17T00:00:00Z") }
    );
    expect(stale.verificationStatus).toBe("STALE");

    const verified = parseShareholdingXbrlXml({
      symbol: "RELIANCE",
      reportingQuarter: "2026-09-30",
      sourceUrl: "https://nsearchives.nseindia.in/corporate/xbrl/ok.xml",
      xmlText: SAMPLE_SHP_XBRL,
    });
    const conflicted = detectShareholdingSourceConflict(verified, { fiiPct: 25.0 });
    expect(conflicted.verificationStatus).toBe("CONFLICTED");
    expect(conflicted.hasSourceConflict).toBe(true);
  });

  it("integrates verified official ownership into Strategy03InstitutionalResearchService", async () => {
    const svc = new Strategy03InstitutionalResearchService();
    const q1 = parseShareholdingXbrlXml({
      symbol: "RELIANCE",
      reportingQuarter: "2026-06-30",
      sourceUrl: "https://nsearchives.nseindia.in/corporate/xbrl/q1.xml",
      xmlText: SAMPLE_SHP_XBRL.replace("0.1667", "0.1567"),
    });
    const q2 = parseShareholdingXbrlXml({
      symbol: "RELIANCE",
      reportingQuarter: "2026-09-30",
      sourceUrl: "https://nsearchives.nseindia.in/corporate/xbrl/q2.xml",
      xmlText: SAMPLE_SHP_XBRL,
    });
    const out = await svc.evaluate({
      symbol: "RELIANCE",
      officialOwnershipOverride: [q1, q2],
    });
    expect(out.marketWideFlowExcluded).toBe(true);
    expect(out.shareholdingVerificationStatus).toBe("VERIFIED");
    expect(out.fiiDeltaPct).toBe(1.0);
    expect(out.mutualFundPct).toBe(10.31);
    expect(out.promoterPledgedPct).toBe(0);
  });
});
