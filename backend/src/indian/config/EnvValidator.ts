import { DEFAULT_NIFTY_CONFIG, NiftyConfig } from "./niftyConfig";

export interface EnvValidationResult {
  isValid: boolean;
  liveTradingLocked: boolean;
  paperModeActive: boolean;
  errors: string[];
  warnings: string[];
  configSummary: {
    maxLossPerTrade: number;
    dailyProfitLock: number;
    dailyLossLock: number;
    maxTradesPerDay: number;
    maxConsecutiveLosses: number;
  };
}

export class EnvValidator {
  private config: NiftyConfig;

  constructor(config: NiftyConfig = DEFAULT_NIFTY_CONFIG) {
    this.config = config;
  }

  /**
   * Validates server startup environment & configuration safety rules.
   */
  public validateEnvironment(): EnvValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Rule 1: MANDATORY LIVE TRADING LOCK
    const liveTradingEnv = process.env.LIVE_TRADING;
    if (liveTradingEnv === "true" || liveTradingEnv === "1") {
      errors.push("SECURITY CRITICAL: LIVE_TRADING env override attempted. System is locked to PAPER_TRADING mode ONLY.");
    }

    if (this.config.defaultLiveMode !== false) {
      errors.push("SECURITY CRITICAL: NiftyConfig defaultLiveMode must be false.");
    }

    // Rule 2: Server-Side Risk Limits Check
    if (this.config.dailyLossLimit > 0) {
      errors.push("CONFIG ERROR: dailyLossLimit must be negative (e.g. -5000).");
    }

    if (this.config.dailyProfitTarget <= 0) {
      errors.push("CONFIG ERROR: dailyProfitTarget must be positive (e.g. 1000).");
    }

    if (this.config.maxTradesPerDay > 5) {
      warnings.push("CONFIG WARNING: maxTradesPerDay > 5 is higher than standard NIFTY guideline (3).");
    }

    // Rule 3: Market Feed Credentials Diagnostic
    if (!process.env.TWELVE_DATA_API_KEY) {
      warnings.push("ENVIRONMENT DIAGNOSTIC: TWELVE_DATA_API_KEY not configured. Spot price will use synthetic paper provider fallback.");
    }

    // Phase 17: Genuine Data Provider Configuration Checks
    const providerEnv = process.env.NIFTY_DATA_PROVIDER;
    if (!providerEnv) {
      warnings.push("PHASE 17 DIAGNOSTIC: NIFTY_DATA_PROVIDER not specified in .env. Defaulting to NSE_INDIA.");
    } else if (providerEnv !== "NSE_INDIA" && providerEnv !== "ZERODHA" && providerEnv !== "DHAN") {
      warnings.push(`PHASE 17 WARNING: Unknown NIFTY_DATA_PROVIDER '${providerEnv}'. Expected NSE_INDIA.`);
    }

    if (!process.env.NSE_OPTION_CHAIN_STALE_MS) {
      warnings.push("PHASE 17 DIAGNOSTIC: NSE_OPTION_CHAIN_STALE_MS not set in .env. Defaulting to 60000ms (60s).");
    }

    const isValid = errors.length === 0;

    return {
      isValid,
      liveTradingLocked: true, // Permanently true
      paperModeActive: true,
      errors,
      warnings,
      configSummary: {
        maxLossPerTrade: 1000,
        dailyProfitLock: this.config.dailyProfitTarget,
        dailyLossLock: this.config.dailyLossLimit,
        maxTradesPerDay: this.config.maxTradesPerDay,
        maxConsecutiveLosses: this.config.maxConsecutiveLosses,
      },
    };
  }
}

export const envValidator = new EnvValidator();

