import zlib from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  mergeAndValidateQuarterSequence,
  normalizeAmountToCrores,
  reconcileFinancialStatements,
} from "../AuthoritativeFinancialAdapter.js";
import {
  deriveQuarterlyFromYtd,
  downloadAndExtractBseZip,
  extractXbrlFinancialFactsFromXml,
  extractZipFromBuffer,
  isSafeZipEntryName,
  validateOfficialSourceUrl,
} from "../BseXbrlBackfillService.js";

/**
 * Helper to construct a valid in-memory ZIP archive (optionally with bit-3 zeroed LFH sizes).
 */
function buildTestZip(
  entries: Array<{ name: string; content: Buffer; deflate?: boolean; zeroLfhSizes?: boolean }>
): Buffer {
  const localParts: Buffer[] = [];
  const cdParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const compMethod = entry.deflate ? 8 : 0;
    const payload = entry.deflate ? zlib.deflateRawSync(entry.content) : entry.content;

    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4);
    lfh.writeUInt16LE(entry.zeroLfhSizes ? 0x0008 : 0, 6);
    lfh.writeUInt16LE(compMethod, 8);
    lfh.writeUInt32LE(entry.zeroLfhSizes ? 0 : payload.length, 18);
    lfh.writeUInt32LE(entry.zeroLfhSizes ? 0 : entry.content.length, 22);
    lfh.writeUInt16LE(nameBuf.length, 26);
    lfh.writeUInt16LE(0, 28);

    const localChunk = Buffer.concat([lfh, nameBuf, payload]);
    localParts.push(localChunk);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(entry.zeroLfhSizes ? 0x0008 : 0, 8);
    cd.writeUInt16LE(compMethod, 10);
    cd.writeUInt32LE(payload.length, 20);
    cd.writeUInt32LE(entry.content.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    cdParts.push(Buffer.concat([cd, nameBuf]));

    offset += localChunk.length;
  }

  const cdBuf = Buffer.concat(cdParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...localParts, cdBuf, eocd]);
}

const SAMPLE_XBRL = `<?xml version="1.0" encoding="UTF-8"?>
<xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance"
  xmlns:in-bse-fin="http://www.bseindia.com/xbrl/fin/2020-03-31/in-bse-fin"
  xmlns:xbrldi="http://xbrl.org/2006/xbrldi"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <xbrli:context id="OneD">
    <xbrli:entity><xbrli:identifier scheme="http://www.nseindia.com/NSESymbol">INFY</xbrli:identifier></xbrli:entity>
    <xbrli:period><xbrli:startDate>2024-10-01</xbrli:startDate><xbrli:endDate>2024-12-31</xbrli:endDate></xbrli:period>
  </xbrli:context>
  <xbrli:context id="SegD">
    <xbrli:entity>
      <xbrli:identifier scheme="http://www.nseindia.com/NSESymbol">INFY</xbrli:identifier>
      <xbrli:segment><xbrldi:explicitMember dimension="in-bse-fin:SegmentAxis">in-bse-fin:Segment1</xbrldi:explicitMember></xbrli:segment>
    </xbrli:entity>
    <xbrli:period><xbrli:startDate>2024-10-01</xbrli:startDate><xbrli:endDate>2024-12-31</xbrli:endDate></xbrli:period>
  </xbrli:context>
  <xbrli:context id="OneI">
    <xbrli:entity><xbrli:identifier scheme="http://www.nseindia.com/NSESymbol">INFY</xbrli:identifier></xbrli:entity>
    <xbrli:period><xbrli:instant>2024-12-31</xbrli:instant></xbrli:period>
  </xbrli:context>
  <xbrli:unit id="INR"><xbrli:measure>iso4217:INR</xbrli:measure></xbrli:unit>
  <xbrli:unit id="INRPerShare"><xbrli:divide><xbrli:unitNumerator><xbrli:measure>iso4217:INR</xbrli:measure></xbrli:unitNumerator><xbrli:unitDenominator><xbrli:measure>xbrli:shares</xbrli:measure></xbrli:unitDenominator></xbrli:divide></xbrli:unit>
  <in-bse-fin:ScripCode contextRef="OneD">500209</in-bse-fin:ScripCode>
  <in-bse-fin:NatureOfReportStandaloneConsolidated contextRef="OneD">Consolidated</in-bse-fin:NatureOfReportStandaloneConsolidated>
  <in-bse-fin:ReportingQuarter contextRef="OneD">Third quarter</in-bse-fin:ReportingQuarter>
  <in-bse-fin:DateOfStartOfReportingPeriod contextRef="OneD">2024-10-01</in-bse-fin:DateOfStartOfReportingPeriod>
  <in-bse-fin:DateOfEndOfReportingPeriod contextRef="OneD">2024-12-31</in-bse-fin:DateOfEndOfReportingPeriod>
  <in-bse-fin:DateOfStartOfFinancialYear contextRef="OneD">2024-04-01</in-bse-fin:DateOfStartOfFinancialYear>
  <in-bse-fin:DateOfEndOfFinancialYear contextRef="OneD">2025-03-31</in-bse-fin:DateOfEndOfFinancialYear>
  <in-bse-fin:RevenueFromOperations contextRef="SegD" unitRef="INR" decimals="-7">99990000000.00</in-bse-fin:RevenueFromOperations>
  <in-bse-fin:RevenueFromOperations contextRef="OneD" unitRef="INR" decimals="-7">417640000000.00</in-bse-fin:RevenueFromOperations>
  <in-bse-fin:ProfitBeforeTax contextRef="OneD" unitRef="INR" decimals="-7">95000000000.00</in-bse-fin:ProfitBeforeTax>
  <in-bse-fin:ProfitLossForPeriod contextRef="OneD" unitRef="INR" decimals="-7">68060000000.00</in-bse-fin:ProfitLossForPeriod>
  <in-bse-fin:FinanceCosts contextRef="OneD" unitRef="INR" decimals="-7">1200000000.00</in-bse-fin:FinanceCosts>
  <in-bse-fin:DepreciationDepletionAndAmortisationExpense contextRef="OneD" unitRef="INR" decimals="-7">11500000000.00</in-bse-fin:DepreciationDepletionAndAmortisationExpense>
  <in-bse-fin:BasicEarningsLossPerShareFromContinuingOperations contextRef="OneD" unitRef="INRPerShare" decimals="2">16.43</in-bse-fin:BasicEarningsLossPerShareFromContinuingOperations>
  <in-bse-fin:Borrowings contextRef="OneI" unitRef="INR" decimals="-7" xsi:nil="true"/>
  <in-bse-fin:Equity contextRef="OneI" unitRef="INR" decimals="-7">912000000000.00</in-bse-fin:Equity>
</xbrli:xbrl>`;

describe("Strategy 03 Phase 6.4.1 — Official XBRL & ZIP Extraction", () => {
  it("validates official BSE/NSE source URLs and rejects untrusted hosts", () => {
    expect(validateOfficialSourceUrl("https://www.bseindia.com/downloads1/test.zip").ok).toBe(true);
    expect(validateOfficialSourceUrl("https://nsearchives.nseindia.in/corporate/xbrl/a.xml").ok).toBe(true);
    expect(validateOfficialSourceUrl("http://www.bseindia.com/downloads1/test.zip").ok).toBe(false);
    expect(validateOfficialSourceUrl("https://evil.example.com/test.zip").ok).toBe(false);
  });

  it("extracts deflated XML from bit-3 ZIP via Central Directory and classifies PDFs", () => {
    const zipBuf = buildTestZip([
      { name: "filing/result.xml", content: Buffer.from(SAMPLE_XBRL, "utf8"), deflate: true, zeroLfhSizes: true },
      { name: "filing/signed.pdf", content: Buffer.from("%PDF-1.4 fake"), deflate: true, zeroLfhSizes: true },
    ]);
    const res = extractZipFromBuffer(zipBuf);
    expect(res.ok).toBe(true);
    expect(res.xmlFiles).toHaveLength(1);
    expect(res.xmlFiles[0].name).toBe("filing/result.xml");
    expect(res.xmlFiles[0].content.toString("utf8")).toContain("417640000000.00");
    expect(res.pdfFileNames).toEqual(["filing/signed.pdf"]);
  });

  it("rejects malformed archives, path traversal entries, and oversized ZIPs", () => {
    expect(extractZipFromBuffer(Buffer.from("not a zip")).ok).toBe(false);
    expect(isSafeZipEntryName("../../etc/passwd")).toBe(false);
    expect(isSafeZipEntryName("C:\\Windows\\system32\\x.xml")).toBe(false);
    expect(isSafeZipEntryName("/abs/path.xml")).toBe(false);

    const traversalZip = buildTestZip([{ name: "../../evil.xml", content: Buffer.from("<x/>") }]);
    const resTraversal = extractZipFromBuffer(traversalZip);
    expect(resTraversal.ok).toBe(false);
    expect(resTraversal.error).toContain("path traversal");

    const bigZip = buildTestZip([{ name: "big.xml", content: Buffer.alloc(4096, 65) }]);
    const resBomb = extractZipFromBuffer(bigZip, { maxExtractedBytes: 1024 });
    expect(resBomb.ok).toBe(false);
    expect(resBomb.error).toContain("maxExtractedBytes");
  });

  it("extracts context-aware Ind-AS XBRL facts, skips segment axes, and handles xsi:nil", () => {
    const fact = extractXbrlFinancialFactsFromXml({
      symbol: "INFY",
      xmlText: SAMPLE_XBRL,
      sourceUrl: "https://nsearchives.nseindia.in/corporate/xbrl/sample.xml",
    });
    expect(fact.verificationStatus).toBe("VERIFIED");
    expect(fact.bseCode).toBe("500209");
    expect(fact.statementScope).toBe("CONSOLIDATED");
    expect(fact.periodType).toBe("Q3");
    expect(fact.financialYear).toBe("2024-2025");
    expect(fact.reportingPeriod).toBe("2024-12-31");
    expect(fact.revenueCr).toBe(41764);
    expect(fact.pbtCr).toBe(9500);
    expect(fact.netProfitCr).toBe(6806);
    expect(fact.epsInr).toBe(16.43);
    expect(fact.totalDebtCr).toBeNull(); // xsi:nil="true"
    expect(fact.equityCr).toBe(91200);
    expect(fact.ebitdaCr).toBe(10770); // 9500 + 120 + 1150
    expect(fact.idempotencyKey).toBe("INFY|CONSOLIDATED|Q3|2024-12-31|v1");
  });

  it("handles negative profits and YTD-to-quarterly derivation", () => {
    const q3Cum = extractXbrlFinancialFactsFromXml({
      symbol: "TESTCO",
      xmlText: SAMPLE_XBRL.replace("68060000000.00", "-1500000000.00"),
      sourceUrl: "https://nsearchives.nseindia.in/corporate/xbrl/c1.xml",
    });
    expect(q3Cum.netProfitCr).toBe(-150);

    const priorCum = { ...q3Cum, revenueCr: 30000, pbtCr: 6000, netProfitCr: 4500 };
    const annualCum = { ...q3Cum, periodType: "ANNUAL" as const, revenueCr: 45000, pbtCr: 9000, netProfitCr: 6500 };
    const q4 = deriveQuarterlyFromYtd({
      cumulativeFact: annualCum,
      priorCumulativeFact: priorCum,
      targetPeriodType: "Q4",
    });
    expect(q4.isDerivedQuarterly).toBe(true);
    expect(q4.periodType).toBe("Q4");
    expect(q4.revenueCr).toBe(15000);
    expect(q4.netProfitCr).toBe(2000);
  });

  it("handles failed download gracefully without crashing", async () => {
    const mockFetch = async () =>
      new Response("<html>Not Found</html>", {
        status: 404,
        headers: { "content-type": "text/html" },
      });
    const res = await downloadAndExtractBseZip("https://www.bseindia.com/downloads1/missing.zip", {
      fetchImpl: mockFetch as typeof fetch,
      maxRetries: 0,
    });
    expect(res.ok).toBe(false);
    expect(res.httpStatus).toBe(404);
  });

  it("preserves unit normalization, reconciliation conflicts, and versioned restatements", () => {
    expect(normalizeAmountToCrores(12500, "LAKHS")).toBe(125);
    const { statement, conflicts } = reconcileFinancialStatements({
      authoritative: {
        symbol: "INFY",
        statementScope: "CONSOLIDATED",
        periodType: "Q3",
        reportingPeriod: "2024-12-31",
        publishedAt: new Date().toISOString(),
        revenueCr: 41764,
        operatingProfitCr: 9620,
        netProfitCr: 6806,
        epsInr: 16.43,
        operatingCashFlowCr: null,
        capexCr: null,
        freeCashFlowCr: null,
        totalDebtCr: null,
        totalEquityCr: 91200,
        operatingMarginPct: 23.03,
        debtToEquity: null,
        roePct: 7.46,
        rocePct: 10.55,
        isRestated: false,
        version: 1,
        evidence: {
          sourceName: "NSE_BSE_INDAS_XBRL",
          sourceUrl: "https://nsearchives.nseindia.in/corporate/xbrl/sample.xml",
          retrievedAt: new Date().toISOString(),
          publishedAt: new Date().toISOString(),
          isStale: false,
          hasSourceConflict: false,
          verificationStatus: "VERIFIED",
          confidence: 0.96,
        },
      },
      thirdParty: { revenueCr: 30000, netProfitCr: 6806 },
    });
    expect(conflicts.length).toBe(1);
    expect(statement.evidence.verificationStatus).toBe("CONFLICTED");

    const seq = mergeAndValidateQuarterSequence([statement, { ...statement, revenueCr: 41800 }]);
    expect(seq.merged.map((m) => m.version)).toEqual([1, 2]);
    expect(seq.merged[1].isRestated).toBe(true);
  });
});
