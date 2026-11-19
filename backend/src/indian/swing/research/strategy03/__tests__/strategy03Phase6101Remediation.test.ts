import { describe, expect, it } from "vitest";
import {
  DEFAULT_STRATEGY03_PAPER_ISOLATION_CONFIG,
  validateStrategy03IsolationGuard,
} from "../Strategy03PaperIsolationConfig.js";

describe("Strategy 03 Phase 6.10.1 — Execution Isolation & Readiness Remediation", () => {
  it("enforces Strategy 03 paper isolation defaults and rejects enabled/intraday/broker flags", () => {
    const ok = validateStrategy03IsolationGuard(DEFAULT_STRATEGY03_PAPER_ISOLATION_CONFIG, {
      STRATEGY_01: false,
      STRATEGY_02: false,
      STRATEGY_03: false,
      LIVE_TRADING: false,
      BROKER_EXECUTION_ENABLED: false,
    });
    expect(ok.isolated).toBe(true);
    expect(ok.reasons).toHaveLength(0);

    const bad = validateStrategy03IsolationGuard(
      { ...DEFAULT_STRATEGY03_PAPER_ISOLATION_CONFIG, enabled: true as any },
      {
        STRATEGY_01: false,
        STRATEGY_02: false,
        STRATEGY_03: true,
        LIVE_TRADING: true,
        BROKER_EXECUTION_ENABLED: true,
      }
    );
    expect(bad.isolated).toBe(false);
    expect(bad.reasons).toContain("STRATEGY_03_PAPER_MUST_DEFAULT_FALSE");
    expect(bad.reasons).toContain("STRATEGY_03_GLOBAL_FLAG_MUST_BE_FALSE");
    expect(bad.reasons).toContain("LIVE_TRADING_MUST_BE_FALSE");
    expect(bad.reasons).toContain("BROKER_EXECUTION_ENABLED_MUST_BE_FALSE");
  });
});

