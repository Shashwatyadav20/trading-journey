export interface SecurityValidationResult {
  allowed: boolean;
  reason: string | null;
  errorCode: string | null;
}

export class SecurityValidator {
  /**
   * Sanitizes input strings against XSS or SQL injection characters.
   */
  public sanitizeString(input: string): string {
    if (!input) return "";
    return input.replace(/[<>'";]/g, "").trim();
  }

  /**
   * Validates paper execution order parameters and checks for live-trading tampering.
   */
  public validateTradeExecutionPayload(payload: any): SecurityValidationResult {
    if (!payload || typeof payload !== "object") {
      return { allowed: false, reason: "Malformed request payload", errorCode: "SECURITY_MALFORMED_PAYLOAD" };
    }

    // Security Rule 1: Live Trading Bypass Attempt Rejection
    if (payload.liveTrading === true || payload.mode === "LIVE" || payload.executeRealBroker === true) {
      return {
        allowed: false,
        reason: "Security Violation: LIVE_TRADING bypass attempt blocked. Only paper execution is allowed.",
        errorCode: "SECURITY_LIVE_TRADING_BLOCKED",
      };
    }

    // Security Rule 2: Quantity & Price Integrity
    if (payload.quantityLots !== undefined && (payload.quantityLots <= 0 || payload.quantityLots > 10)) {
      return {
        allowed: false,
        reason: "Security Violation: Quantity lots must be between 1 and 10",
        errorCode: "SECURITY_INVALID_LOTS",
      };
    }

    if (payload.spotPrice !== undefined && payload.spotPrice <= 0) {
      return {
        allowed: false,
        reason: "Security Violation: Spot price must be > 0",
        errorCode: "SECURITY_INVALID_SPOT_PRICE",
      };
    }

    return { allowed: true, reason: null, errorCode: null };
  }

  /**
   * Validates server-side risk parameter integrity against client overrides.
   */
  public validateRiskConfigOverride(attemptedConfig: any): SecurityValidationResult {
    if (attemptedConfig.liveTradingEnabled === true) {
      return {
        allowed: false,
        reason: "Security Lock: LIVE_TRADING cannot be enabled via API.",
        errorCode: "SECURITY_LIVE_TRADING_LOCKED",
      };
    }

    if (attemptedConfig.dailyLossLimit && attemptedConfig.dailyLossLimit < -10000) {
      return {
        allowed: false,
        reason: "Security Lock: Daily loss limit cannot be relaxed beyond ₹-10,000 server lock.",
        errorCode: "SECURITY_RISK_LIMIT_EXCEEDED",
      };
    }

    return { allowed: true, reason: null, errorCode: null };
  }
}

export const securityValidator = new SecurityValidator();
