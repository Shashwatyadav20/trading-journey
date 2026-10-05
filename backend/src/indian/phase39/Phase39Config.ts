import { strategyFingerprintManager } from "../validation/StrategyFingerprintManager";

export const PHASE39_CONFIG = {
  MIN_GENUINE_SESSIONS: 20,
  MIN_GENUINE_TRADES: 30,
  MIN_ACTIVE_SESSIONS: 15,
  PNL_RECONCILIATION_TOLERANCE: 0.01,
  BOOTSTRAP_ITERATIONS: 1000,
  RANDOM_SEED: 42,
  MAX_ALLOWED_OOS_DEGRADATION_PCT: 35.0,
  get MASTER_STRATEGY_FINGERPRINT() {
    return strategyFingerprintManager.getCurrentFingerprint().masterFingerprintHash;
  },
} as const;
