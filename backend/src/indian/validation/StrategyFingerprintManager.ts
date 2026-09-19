import crypto from "crypto";
import { StrategyFingerprint, ValidationCohort } from "../types";

export interface StrategyConfigParameters {
  strategyVersion: string;
  rsiLowerThreshold: number;
  rsiUpperThreshold: number;
  minDeltaShort: number;
  maxDeltaShort: number;
  maxGammaShort: number;
  vwapNeutralDistancePct: number;
  minSupportDistancePct: number;
  maxLossPerTrade: number;
  dailyProfitLockTarget: number;
  dailyLossLimit: number;
  maxTradesPerDay: number;
  maxConsecutiveLosses: number;
  orderSequence: string[];
}

export const MASTER_STRATEGY_CONFIG_DEFAULTS: StrategyConfigParameters = {
  strategyVersion: "1.0.0-NIFTY-MASTER",
  rsiLowerThreshold: 45,
  rsiUpperThreshold: 55,
  minDeltaShort: 0.15,
  maxDeltaShort: 0.35,
  maxGammaShort: 0.05,
  vwapNeutralDistancePct: 0.1,
  minSupportDistancePct: 0.25,
  maxLossPerTrade: 1000,
  dailyProfitLockTarget: 1000,
  dailyLossLimit: -5000,
  maxTradesPerDay: 3,
  maxConsecutiveLosses: 2,
  orderSequence: ["BUY_HEDGE", "CONFIRM_HEDGE", "SELL_SHORT", "CONFIRM_SHORT"],
};

export class StrategyFingerprintManager {
  private currentParams: StrategyConfigParameters;
  private cohorts: Map<string, ValidationCohort> = new Map();
  private activeCohortId: string;

  constructor(params: StrategyConfigParameters = MASTER_STRATEGY_CONFIG_DEFAULTS) {
    this.currentParams = { ...params };
    const fp = this.computeFingerprint(this.currentParams);
    const initialCohort: ValidationCohort = {
      cohortId: `COHORT_A_${fp.masterFingerprintHash.substring(0, 8)}`,
      cohortName: "Cohort A (Master Baseline)",
      fingerprint: fp,
      startDate: new Date().toISOString(),
      totalSessions: 0,
      totalTrades: 0,
      activeSessions: 0,
      isActive: true,
    };
    this.cohorts.set(initialCohort.cohortId, initialCohort);
    this.activeCohortId = initialCohort.cohortId;
  }

  /**
   * Computes deterministic SHA-256 fingerprint hash for strategy parameters.
   */
  public computeFingerprint(params: StrategyConfigParameters): StrategyFingerprint {
    const stratStr = JSON.stringify({
      version: params.strategyVersion,
      rsiLower: params.rsiLowerThreshold,
      rsiUpper: params.rsiUpperThreshold,
      vwapDist: params.vwapNeutralDistancePct,
      srDist: params.minSupportDistancePct,
    });
    const riskStr = JSON.stringify({
      maxLoss: params.maxLossPerTrade,
      profitLock: params.dailyProfitLockTarget,
      lossLimit: params.dailyLossLimit,
      maxTrades: params.maxTradesPerDay,
      maxConsLosses: params.maxConsecutiveLosses,
    });
    const indicatorStr = JSON.stringify({
      minDelta: params.minDeltaShort,
      maxDelta: params.maxDeltaShort,
      maxGamma: params.maxGammaShort,
    });
    const execStr = JSON.stringify({
      sequence: params.orderSequence,
    });

    const strategyConfigHash = crypto.createHash("sha256").update(stratStr).digest("hex");
    const riskConfigHash = crypto.createHash("sha256").update(riskStr).digest("hex");
    const indicatorConfigHash = crypto.createHash("sha256").update(indicatorStr).digest("hex");
    const executionConfigHash = crypto.createHash("sha256").update(execStr).digest("hex");

    const masterCombined = `${params.strategyVersion}:${strategyConfigHash}:${riskConfigHash}:${indicatorConfigHash}:${executionConfigHash}`;
    const masterFingerprintHash = crypto.createHash("sha256").update(masterCombined).digest("hex");

    return {
      version: params.strategyVersion,
      strategyConfigHash,
      riskConfigHash,
      indicatorConfigHash,
      executionConfigHash,
      masterFingerprintHash,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Returns current active fingerprint.
   */
  public getCurrentFingerprint(): StrategyFingerprint {
    return this.computeFingerprint(this.currentParams);
  }

  /**
   * Returns current active cohort.
   */
  public getActiveCohort(): ValidationCohort {
    const cohort = this.cohorts.get(this.activeCohortId);
    if (!cohort) {
      throw new Error(`Active cohort ${this.activeCohortId} not found.`);
    }
    return cohort;
  }

  /**
   * Gets all registered validation cohorts.
   */
  public getAllCohorts(): ValidationCohort[] {
    return Array.from(this.cohorts.values());
  }

  /**
   * Evaluates new parameters and automatically starts a new cohort if config changed.
   */
  public updateConfig(newParams: Partial<StrategyConfigParameters>): {
    configChanged: boolean;
    activeCohort: ValidationCohort;
  } {
    const merged = { ...this.currentParams, ...newParams };
    const oldFp = this.getCurrentFingerprint();
    const newFp = this.computeFingerprint(merged);

    if (oldFp.masterFingerprintHash !== newFp.masterFingerprintHash) {
      // Close active cohort
      const currentActive = this.getActiveCohort();
      currentActive.isActive = false;
      currentActive.endDate = new Date().toISOString();

      const cohortCount = this.cohorts.size;
      const cohortLetter = String.fromCharCode(65 + cohortCount); // A, B, C, ...
      const newCohortId = `COHORT_${cohortLetter}_${newFp.masterFingerprintHash.substring(0, 8)}`;

      const newCohort: ValidationCohort = {
        cohortId: newCohortId,
        cohortName: `Cohort ${cohortLetter} (Modified Config)`,
        fingerprint: newFp,
        startDate: new Date().toISOString(),
        totalSessions: 0,
        totalTrades: 0,
        activeSessions: 0,
        isActive: true,
      };

      this.cohorts.set(newCohortId, newCohort);
      this.activeCohortId = newCohortId;
      this.currentParams = merged;

      return { configChanged: true, activeCohort: newCohort };
    }

    return { configChanged: false, activeCohort: this.getActiveCohort() };
  }

  /**
   * Updates session and trade counts on active cohort.
   */
  public recordCohortActivity(sessionsCount: number, tradesCount: number, activeSessionsCount: number): void {
    const active = this.getActiveCohort();
    active.totalSessions = sessionsCount;
    active.totalTrades = tradesCount;
    active.activeSessions = activeSessionsCount;
  }
}

export const strategyFingerprintManager = new StrategyFingerprintManager();
