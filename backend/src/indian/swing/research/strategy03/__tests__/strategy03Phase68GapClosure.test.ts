import { describe, expect, it } from "vitest";
import { classifyAnnouncementDeterministically } from "../CorporateAnnouncementIntelligence.js";

describe("Strategy 03 Phase 6.8 — Corporate Announcement Intelligence & Evidence Quality", () => {
  it("classifies material order wins, capacity expansion, and acquisitions deterministically", () => {
    const orderWin = classifyAnnouncementDeterministically({
      symbol: "LT",
      seq_id: "1001",
      desc: "Order Win",
      attchmntText: "Company has bagged a major EPC work order worth Rs 2,500 Cr.",
      sort_date: "2024-08-10 15:30:00",
      attchmntFile: "https://nsearchives.nseindia.in/corporate/order1.pdf",
    });
    expect(orderWin.category).toBe("ORDER_WIN");
    expect(orderWin.verificationStatus).toBe("VERIFIED");
    expect(orderWin.publishedAt).toContain("2024-08-10");

    const capex = classifyAnnouncementDeterministically({
      symbol: "RELIANCE",
      seq_id: "1002",
      desc: "Press Release",
      attchmntText: "Board approved capacity expansion and capex for petrochemical unit.",
      sort_date: "2024-09-01 10:00:00",
    });
    expect(capex.category).toBe("CAPACITY_EXPANSION");
    expect(capex.verificationStatus).toBe("VERIFIED");
  });

  it("marks missing timestamps as MISSING and unclassified updates as UNVERIFIED", () => {
    const missingTs = classifyAnnouncementDeterministically({
      symbol: "INFY",
      seq_id: "1003",
      desc: "Order Win",
      attchmntText: "Bagged contract",
    });
    expect(missingTs.verificationStatus).toBe("MISSING");
    expect(missingTs.publishedAt).toBeNull();

    const generic = classifyAnnouncementDeterministically({
      symbol: "INFY",
      seq_id: "1004",
      desc: "General Update",
      attchmntText: "Routine intimation regarding postal ballot.",
      sort_date: "2024-09-05 12:00:00",
    });
    expect(generic.category).toBe("OTHER_UPDATE");
    expect(generic.verificationStatus).toBe("UNVERIFIED");
  });
});

