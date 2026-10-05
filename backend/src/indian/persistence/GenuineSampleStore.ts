import {
  Phase25MarketSessionStatus,
  NiftySpreadPosition,
  AutoHedgeSignal,
} from "../types";

export interface GenuineSessionRecord {
  sessionId: string;
  sessionDateIST: string;          // YYYY-MM-DD
  sessionStart: string;            // ISO IST
  sessionEnd: string;              // ISO IST
  timezone: "Asia/Kolkata";
  timestampUTC: string;
  timestampIST: string;
  provider: string;
  dataGate: "PASSED" | "FAILED" | "BLOCKED";
  marketSession: Phase25MarketSessionStatus;
  spotSource: string;
  optionChainSource: string;
  optionPriceSource: string;
  greeksSource: string;
  lotSizeSource: string;
  expiry: string;
  websocketStatus: string;
  reconciliationStatus: "PASS" | "FAIL";
  genuineSession: boolean;
  blockedReason: string | null;
  createdAt: string;
  finalizedAt?: string;
  timestampValidationStatus?: "PASSED" | "TIMESTAMP_VALIDATION_FAILED";
}

export interface GenuineTradeRecord {
  tradeId: string;
  sessionId: string;
  signalId: string;
  strategy: string;
  regime: string;
  entryTimestamp: string;
  entryTimestampIST: string;
  exitTimestamp?: string;
  exitTimestampIST?: string;
  dataTimestamp?: string;
  decisionTimestamp?: string;
  monitoringTimestamp?: string;
  expiry: string;
  shortStrike: number;
  hedgeStrike: number;
  optionType: "CE" | "PE";
  quantity: number;
  entryCredit: number;
  exitSpread?: number;
  grossPnL?: number;
  brokerage: number;
  STT: number;
  exchangeCharges: number;
  GST: number;
  SEBICharges: number;
  stampDuty: number;
  slippage: number;
  netPnL?: number;
  exitReason?: string;
  dataSource: string;
  priceSource: string;
  greeksSource: string;
  lotSize: number;
  genuineTrade: boolean;
  pnlType: "REAL_MARKET_DATA_PAPER_PNL" | "SYNTHETIC_PAPER_PNL" | "SIMULATED_TEST_PNL";
  validationFlags: {
    realSpot: boolean;
    realOptionChain: boolean;
    realOptionPrices: boolean;
    dataNotStale: boolean;
    lotSizeVerified: boolean;
    marketSessionValid: boolean;
    safetyLocksValid: boolean;
    reconciliationPassed: boolean;
    antiHindsightPassed: boolean;
  };
}

export interface ExclusionCounters {
  simulatedExcluded: number;
  syntheticExcluded: number;
  invalidExcluded: number;
  staleExcluded: number;
  afterHoursExcluded: number;
  duplicateExcluded: number;
}

export class GenuineSampleStore {
  private genuineSessions: Map<string, GenuineSessionRecord> = new Map();
  private genuineTrades: Map<string, GenuineTradeRecord> = new Map();
  private auditCorrectionLog: Array<{ id: string; originalId: string; timestamp: string; correctionReason: string; details: any }> = [];

  private exclusionCounters: ExclusionCounters = {
    simulatedExcluded: 0,
    syntheticExcluded: 0,
    invalidExcluded: 0,
    staleExcluded: 0,
    afterHoursExcluded: 0,
    duplicateExcluded: 0,
  };

  /**
   * Converts UTC date or ISO string to IST ISO string and components.
   */
  public getIstTimestamp(dateInput?: Date | string | number): { isoIST: string; dateIST: string; isWithinMarketHours: boolean } {
    const dt = dateInput ? new Date(dateInput) : new Date();
    const utcTime = dt.getTime() + dt.getTimezoneOffset() * 60000;
    const istTime = new Date(utcTime + 330 * 60000);

    const year = istTime.getFullYear();
    const month = String(istTime.getMonth() + 1).padStart(2, "0");
    const date = String(istTime.getDate()).padStart(2, "0");
    const hours = istTime.getHours();
    const minutes = istTime.getMinutes();
    const seconds = String(istTime.getSeconds()).padStart(2, "0");
    const day = istTime.getDay();

    const dateIST = `${year}-${month}-${date}`;
    const isoIST = `${dateIST}T${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${seconds}+05:30`;

    const timeInMinutes = hours * 60 + minutes;
    const isWeekday = day >= 1 && day <= 5;
    const isWithinMarketHours = isWeekday && timeInMinutes >= 555 && timeInMinutes <= 930; // 09:15 - 15:30 IST

    return { isoIST, dateIST, isWithinMarketHours };
  }

  /**
   * Records or finalizes a genuine market session record.
   */
  public recordSession(record: GenuineSessionRecord): GenuineSessionRecord {
    const { isoIST, dateIST, isWithinMarketHours } = this.getIstTimestamp(record.createdAt || new Date());

    // Timezone & After-Hours Integrity Verification
    let timestampValidationStatus: "PASSED" | "TIMESTAMP_VALIDATION_FAILED" = "PASSED";
    if (record.marketSession === "MARKET_OPEN" && !isWithinMarketHours) {
      timestampValidationStatus = "TIMESTAMP_VALIDATION_FAILED";
      record.genuineSession = false;
      record.blockedReason = "TIMESTAMP_VALIDATION_FAILED: Decision timestamp outside 09:15-15:30 IST market hours";
      this.exclusionCounters.afterHoursExcluded++;
    }

    const finalRecord: GenuineSessionRecord = {
      ...record,
      sessionDateIST: dateIST,
      timezone: "Asia/Kolkata",
      timestampIST: isoIST,
      timestampValidationStatus,
      createdAt: record.createdAt || new Date().toISOString(),
    };

    // Immutability Protection: Do not mutate existing finalized session
    if (this.genuineSessions.has(finalRecord.sessionId)) {
      const existing = this.genuineSessions.get(finalRecord.sessionId)!;
      if (existing.finalizedAt) {
        throw new Error(`Immutability Breach Blocked: Session ${finalRecord.sessionId} is already finalized.`);
      }
    }

    this.genuineSessions.set(finalRecord.sessionId, finalRecord);
    return finalRecord;
  }

  /**
   * Finalizes a session and locks it against future modifications.
   */
  public finalizeSession(sessionId: string): GenuineSessionRecord {
    const session = this.genuineSessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found.`);
    }
    session.finalizedAt = new Date().toISOString();
    return session;
  }

  /**
   * Records a genuine trade record. Performs strict provenance, anti-hindsight, and gate checks.
   */
  public recordTrade(trade: GenuineTradeRecord): GenuineTradeRecord {
    const entryIst = this.getIstTimestamp(trade.entryTimestamp);

    // Anti-Hindsight & Timestamp Ordering Checks:
    // dataTimestamp <= decisionTimestamp <= entryTimestamp <= monitoringTimestamp <= exitTimestamp
    let antiHindsightPassed = true;
    if (trade.dataTimestamp && trade.decisionTimestamp) {
      const dataTime = new Date(trade.dataTimestamp).getTime();
      const decisionTime = new Date(trade.decisionTimestamp).getTime();
      const entryTime = new Date(trade.entryTimestamp).getTime();
      if (dataTime > decisionTime || decisionTime > entryTime) {
        antiHindsightPassed = false;
      }
    }
    if (trade.exitTimestamp && new Date(trade.entryTimestamp).getTime() > new Date(trade.exitTimestamp).getTime()) {
      antiHindsightPassed = false;
    }

    trade.validationFlags.antiHindsightPassed = antiHindsightPassed;

    // Strict Genuine Trade Definition Criteria
    const isGenuineTrade =
      trade.validationFlags.realSpot &&
      trade.validationFlags.realOptionChain &&
      trade.validationFlags.realOptionPrices &&
      trade.validationFlags.dataNotStale &&
      trade.validationFlags.lotSizeVerified &&
      trade.validationFlags.marketSessionValid &&
      trade.validationFlags.safetyLocksValid &&
      trade.validationFlags.reconciliationPassed &&
      trade.validationFlags.antiHindsightPassed &&
      trade.pnlType === "REAL_MARKET_DATA_PAPER_PNL" &&
      entryIst.isWithinMarketHours;

    trade.genuineTrade = isGenuineTrade;

    if (!isGenuineTrade) {
      if (trade.pnlType === "SIMULATED_TEST_PNL") this.exclusionCounters.simulatedExcluded++;
      else if (trade.pnlType === "SYNTHETIC_PAPER_PNL") this.exclusionCounters.syntheticExcluded++;
      else if (!entryIst.isWithinMarketHours) this.exclusionCounters.afterHoursExcluded++;
      else this.exclusionCounters.invalidExcluded++;
    }

    // Immutability Protection: Append audit log if attempting to overwrite
    if (this.genuineTrades.has(trade.tradeId)) {
      const original = this.genuineTrades.get(trade.tradeId)!;
      this.auditCorrectionLog.push({
        id: `corr_${Date.now()}`,
        originalId: trade.tradeId,
        timestamp: new Date().toISOString(),
        correctionReason: "AUDIT_EVENT_APPEND: Attempted trade update recorded as audit correction.",
        details: { original, updated: trade },
      });
      return original; // Return original immutable trade
    }

    this.genuineTrades.set(trade.tradeId, trade);
    return trade;
  }

  /**
   * Increment exclusion counter explicitly for invalid/simulated data.
   */
  public incrementExclusion(type: keyof ExclusionCounters, count: number = 1): void {
    this.exclusionCounters[type] += count;
  }

  /**
   * Returns all genuine session records (filtering out blocked/failed sessions if requested).
   */
  public getSessions(onlyGenuine: boolean = false): GenuineSessionRecord[] {
    const all = Array.from(this.genuineSessions.values());
    return onlyGenuine ? all.filter((s) => s.genuineSession && s.timestampValidationStatus !== "TIMESTAMP_VALIDATION_FAILED") : all;
  }

  /**
   * Returns all genuine trade records.
   */
  public getTrades(onlyGenuine: boolean = false): GenuineTradeRecord[] {
    const all = Array.from(this.genuineTrades.values());
    return onlyGenuine ? all.filter((t) => t.genuineTrade) : all;
  }

  /**
   * Returns exclusion counters breakdown.
   */
  public getExclusionCounters(): ExclusionCounters {
    return { ...this.exclusionCounters };
  }

  /**
   * Clears in-memory store for testing environment resets.
   */
  public clearStore(): void {
    this.genuineSessions.clear();
    this.genuineTrades.clear();
    this.auditCorrectionLog = [];
    this.exclusionCounters = {
      simulatedExcluded: 0,
      syntheticExcluded: 0,
      invalidExcluded: 0,
      staleExcluded: 0,
      afterHoursExcluded: 0,
      duplicateExcluded: 0,
    };
  }
}

export const genuineSampleStore = new GenuineSampleStore();
