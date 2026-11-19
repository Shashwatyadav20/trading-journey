import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  countStrategy03Statuses,
  deriveSignalGuidance,
  filterStrategy03Stocks,
  STRATEGY03_STATUS_FILTERS,
  type Strategy03PreBreakoutRecord,
} from "../../../../../../../lib/indian/strategy03ScannerHelpers.js";

const WATCHLIST_PATH = path.resolve(
  "D:/Trading/my-app/backend/data/research/strategy03/phase61019/prebreakout_watchlist.json"
);

describe("Strategy 03 Clean Stock Scanner UI Helpers", () => {
  it("preserves all existing stocks, counts all statuses accurately, and filters by status and symbol search", () => {
    const stocks = JSON.parse(
      fs.readFileSync(WATCHLIST_PATH, "utf8")
    ) as Strategy03PreBreakoutRecord[];

    expect(stocks.length).toBe(2383);

    const allFiltered = filterStrategy03Stocks(stocks, "ALL", "");
    expect(allFiltered).toHaveLength(stocks.length);

    const counts = countStrategy03Statuses(stocks);
    expect(counts.ALL).toBe(2383);
    expect(counts.READY).toBe(83);
    expect(counts.FORMING).toBe(1792);
    expect(counts.BREAKOUT).toBe(18);
    expect(counts.INVALIDATED).toBe(460);
    expect(counts.WAIT).toBe(30);

    for (const status of STRATEGY03_STATUS_FILTERS) {
      const filtered = filterStrategy03Stocks(stocks, status, "");
      expect(filtered).toHaveLength(counts[status]);
    }

    const searchSun = filterStrategy03Stocks(stocks, "READY", "sunpharma");
    expect(searchSun).toHaveLength(1);
    expect(searchSun[0].nseSymbol).toBe("SUNPHARMA");
  });

  it("derives signal guidance strictly from source fields without fabricating missing values", () => {
    const stocks = JSON.parse(
      fs.readFileSync(WATCHLIST_PATH, "utf8")
    ) as Strategy03PreBreakoutRecord[];

    const readySample = stocks.find((s) => s.nseSymbol === "ANANDRATHI")!;
    const readyGuidance = deriveSignalGuidance(readySample);
    expect(readyGuidance.invalidationLevel).toBe(readySample.consolidation?.low ?? null);
    expect(readyGuidance.conditionsSatisfied.length).toBeGreaterThan(0);

    const missingSample: Strategy03PreBreakoutRecord = {
      nseSymbol: "EMPTYTEST",
      status: "WAIT",
      currentPrice: null,
      reason: "MISSING_OR_INSUFFICIENT_4H_DATA_0",
    };
    const missingGuidance = deriveSignalGuidance(missingSample);
    expect(missingGuidance.invalidationLevel).toBeNull();
    expect(missingGuidance.invalidationLabel).toBeNull();
    expect(missingGuidance.nextRequiredAction).toContain("MISSING_OR_INSUFFICIENT_4H_DATA_0");
  });
});
