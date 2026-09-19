import { describe, it, expect, beforeEach } from "vitest";
import { brokerSafetyLock } from "../security/BrokerSafetyLock";
import { securityValidator } from "../security/SecurityValidator";

describe("Phase 16 — Live Execution Safety & Security Audit Test Suite", () => {
  beforeEach(() => {
    brokerSafetyLock.setKillSwitchState("DISABLED");
  });

  it("1. Mandatory Safety Constants: PAPER_TRADING=true, LIVE_TRADING=false, BROKER_EXECUTION_ENABLED=false", () => {
    expect(brokerSafetyLock.PAPER_TRADING).toBe(true);
    expect(brokerSafetyLock.LIVE_TRADING).toBe(false);
    expect(brokerSafetyLock.BROKER_EXECUTION_ENABLED).toBe(false);
    expect(brokerSafetyLock.getLiveBrokerOrderCount()).toBe(0);
  });

  it("2. Multi-Layer Execution Lock: Execution is BLOCKED if LIVE_TRADING is false or BROKER_EXECUTION_ENABLED is false", () => {
    const safety = brokerSafetyLock.validateExecutionSafety();
    // Safety lock is active because LIVE_TRADING is false and BROKER_EXECUTION_ENABLED is false
    expect(safety.allowed).toBe(false);
    expect(safety.errorCode).toBe("LIVE_EXECUTION_PERMANENTLY_DISABLED");
  });

  it("3. Emergency Kill Switch: Halting kill switch blocks execution immediately", () => {
    brokerSafetyLock.setKillSwitchState("TRADING_HALTED");
    expect(brokerSafetyLock.getKillSwitchState()).toBe("TRADING_HALTED");

    const safety = brokerSafetyLock.validateExecutionSafety({
      brokerConnection: true,
      marketData: true,
      database: true,
      riskEngine: true,
      reconciliation: true,
      instrumentResolver: true,
      authentication: true,
    });

    expect(safety.allowed).toBe(false);
    expect(safety.errorCode).toBe("KILL_SWITCH_HALTED");
  });

  it("4. Fail-Closed Behavior: Any missing dependency forces system to FAIL CLOSED", () => {
    const safety = brokerSafetyLock.validateExecutionSafety({
      brokerConnection: false,
      marketData: true,
      database: true,
      riskEngine: true,
      reconciliation: true,
      instrumentResolver: true,
      authentication: true,
    });

    expect(safety.allowed).toBe(false);
  });

  it("5. Credential Protection: Redacts API keys, passwords, and tokens from object logs", () => {
    const sensitivePayload = {
      user: "trader_1",
      apiKey: "SECRET_BROKER_API_KEY_12345",
      password: "SuperSecretPassword123",
      TELEGRAM_BOT_TOKEN: "123456789:ABCdefGHIjklMNOpqrsTUVwxyz",
      nested: {
        accessToken: "ACCESS_TOKEN_99999",
      },
    };

    const sanitized = brokerSafetyLock.sanitizeCredentials(sensitivePayload);

    expect(sanitized.apiKey).toBe("[REDACTED_CREDENTIAL]");
    expect(sanitized.password).toBe("[REDACTED_CREDENTIAL]");
    expect(sanitized.TELEGRAM_BOT_TOKEN).toBe("[REDACTED_CREDENTIAL]");
    expect(sanitized.nested.accessToken).toBe("[REDACTED_CREDENTIAL]");
    expect(sanitized.user).toBe("trader_1");
  });

  it("6. API Security: Rejects payload attempts to enable live trading or relax risk limits", () => {
    const bypassAttempt = {
      mode: "LIVE",
      liveTrading: true,
      executeRealBroker: true,
      quantityLots: 1,
    };

    const valResult = securityValidator.validateTradeExecutionPayload(bypassAttempt);
    expect(valResult.allowed).toBe(false);
    expect(valResult.errorCode).toBe("SECURITY_LIVE_TRADING_BLOCKED");

    const riskOverrideAttempt = {
      liveTradingEnabled: true,
      dailyLossLimit: -50000,
    };

    const riskResult = securityValidator.validateRiskConfigOverride(riskOverrideAttempt);
    expect(riskResult.allowed).toBe(false);
    expect(riskResult.errorCode).toBe("SECURITY_LIVE_TRADING_LOCKED");
  });
});
