import { describe, expect, it } from "vitest";
import { extractXbrlFinancialFactsFromXml } from "../BseXbrlBackfillService.js";

const ANNUAL_XBRL_WITH_DEBT_AND_CAPEX = `<?xml version="1.0" encoding="UTF-8"?>
<xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance"
  xmlns:in-bse-fin="http://www.bseindia.com/xbrl/fin/2020-03-31/in-bse-fin">
  <xbrli:context id="OneD">
    <xbrli:entity><xbrli:identifier scheme="http://www.nseindia.com/NSESymbol">TEST</xbrli:identifier></xbrli:entity>
    <xbrli:period><xbrli:startDate>2024-04-01</xbrli:startDate><xbrli:endDate>2025-03-31</xbrli:endDate></xbrli:period>
  </xbrli:context>
  <xbrli:context id="OneI">
    <xbrli:entity><xbrli:identifier scheme="http://www.nseindia.com/NSESymbol">TEST</xbrli:identifier></xbrli:entity>
    <xbrli:period><xbrli:instant>2025-03-31</xbrli:instant></xbrli:period>
  </xbrli:context>
  <xbrli:unit id="INR"><xbrli:measure>iso4217:INR</xbrli:measure></xbrli:unit>
  <in-bse-fin:DateOfStartOfReportingPeriod contextRef="OneD">2024-04-01</in-bse-fin:DateOfStartOfReportingPeriod>
  <in-bse-fin:DateOfEndOfReportingPeriod contextRef="OneD">2025-03-31</in-bse-fin:DateOfEndOfReportingPeriod>
  <in-bse-fin:RevenueFromOperations contextRef="OneD" unitRef="INR">100000000000</in-bse-fin:RevenueFromOperations>
  <in-bse-fin:ProfitLossForPeriod contextRef="OneD" unitRef="INR">15000000000</in-bse-fin:ProfitLossForPeriod>
  <in-bse-fin:BorrowingsNoncurrent contextRef="OneI" unitRef="INR">12000000000</in-bse-fin:BorrowingsNoncurrent>
  <in-bse-fin:BorrowingsCurrent contextRef="OneI" unitRef="INR">3000000000</in-bse-fin:BorrowingsCurrent>
  <in-bse-fin:CashFlowsFromUsedInOperatingActivities contextRef="OneD" unitRef="INR">20000000000</in-bse-fin:CashFlowsFromUsedInOperatingActivities>
  <in-bse-fin:PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities contextRef="OneD" unitRef="INR">-5000000000</in-bse-fin:PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities>
</xbrli:xbrl>`;

describe("Strategy 03 Phase 6.10.5 — Financial Data Recovery (Borrowings & FCF)", () => {
  it("extracts BorrowingsNoncurrent + BorrowingsCurrent and derives FCF only when CFO & Capex are both present", () => {
    const fact = extractXbrlFinancialFactsFromXml({
      symbol: "TEST",
      xmlText: ANNUAL_XBRL_WITH_DEBT_AND_CAPEX,
      sourceUrl: "https://nsearchives.nseindia.in/corporate/xbrl/test_annual.xml",
    });
    expect(fact.totalDebtCr).toBe(1500); // 1200 + 300 Cr
    expect(fact.cfoCr).toBe(2000);
    expect(fact.capexCr).toBe(500);
    expect(fact.fcfCr).toBe(1500); // 2000 - 500 Cr

    // When capex is missing, FCF must remain null (never coerced to CFO - 0)
    const noCapexXml = ANNUAL_XBRL_WITH_DEBT_AND_CAPEX.replace(
      /<in-bse-fin:PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities[\s\S]*?<\/in-bse-fin:PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities>/,
      ""
    );
    const noCapexFact = extractXbrlFinancialFactsFromXml({
      symbol: "TEST",
      xmlText: noCapexXml,
      sourceUrl: "https://nsearchives.nseindia.in/corporate/xbrl/test_nocapex.xml",
    });
    expect(noCapexFact.cfoCr).toBe(2000);
    expect(noCapexFact.capexCr).toBeNull();
    expect(noCapexFact.fcfCr).toBeNull();
  });
});

