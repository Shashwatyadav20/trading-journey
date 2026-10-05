import { GenuineTradeRecord } from "../persistence/GenuineSampleStore";

export type TradeExclusionReason =
  | "SYNTHETIC_DATA"
  | "SIMULATED_DATA"
  | "AFTER_HOURS"
  | "TIMESTAMP_VIOLATION"
  | "TIMEZONE_MISMATCH"
  | "PROVENANCE_FAILED"
  | "STALE_DATA"
  | "INVALID_EXPIRY"
  | "LOT_SIZE_UNVERIFIED"
  | "RECONCILIATION_FAILED"
  | "HINDSIGHT_VIOLATION"
  | "DUPLICATE_TRADE"
  | "NOT_GENUINE_SESSION"
  | "STRATEGY_CHANGED"
  | "MANUAL_EXCLUSION";

export interface Phase29FinalizedTrade {
  tradeId: string;
  sessionId: string;
  genuineTrade: boolean;
  finalizedAt: string;
  strategyFingerprintHash: string;
  cohortId: string;
  cohortLabel: "VALIDATION_COHORT" | "POST_VALIDATION_OBSERVATIONS";
  provenanceGate: {
    spotProvenance: "DHAN_WEBSOCKET" | "APPROVED" | "FAILED";
    optionPriceProvenance: "DHAN_WEBSOCKET" | "DHAN_OPTION_CHAIN" | "FAILED";
    oiProvenance: "DHAN_OPTION_CHAIN" | "FAILED";
    ivProvenance: "DHAN_OPTION_CHAIN" | "FAILED";
    deltaProvenance: "DHAN_OPTION_CHAIN" | "DERIVED_APPROVED" | "FAILED";
    lotSizeProvenance: "DHAN_INSTRUMENT_MASTER" | "FAILED";
    expiryProvenance: "DHAN_EXPIRY_LIST" | "FAILED";
  };
  timestampGate: {
    dataTimestampOk: boolean;
    decisionTimestampOk: boolean;
    entryTimestampOk: boolean;
    monitoringTimestampOk: boolean;
    exitTimestampOk: boolean;
    orderValid: boolean;
  };
  exclusionReason: TradeExclusionReason | null;
  originalRecord: Readonly<GenuineTradeRecord>;
}

export interface Phase29TradeCorrectionEvent {
  correctionId: string;
  originalRecordId: string;
  reason: string;
  oldValue: unknown;
  newValue: unknown;
  timestamp: string;
  source: string;
}

export interface Phase29ExclusionAuditEntry {
  recordId: string;
  timestamp: string;
  reason: TradeExclusionReason;
  source: string;
  details: Record<string, unknown>;
}

export class Phase29TradeFinalizer {
  private finalizedTrades: Map<string, Phase29FinalizedTrade> = new Map();
  private correctionEvents: Phase29TradeCorrectionEvent[] = [];
  private exclusionAudit: Phase29ExclusionAuditEntry[] = [];
  private exclusionCounters: Record<TradeExclusionReason, number> = {
    SYNTHETIC_DATA: 0,
    SIMULATED_DATA: 0,
    AFTER_HOURS: 0,
    TIMESTAMP_VIOLATION: 0,
    TIMEZONE_MISMATCH: 0,
    PROVENANCE_FAILED: 0,
    STALE_DATA: 0,
    INVALID_EXPIRY: 0,
    LOT_SIZE_UNVERIFIED: 0,
    RECONCILIATION_FAILED: 0,
    HINDSIGHT_VIOLATION: 0,
    DUPLICATE_TRADE: 0,
    NOT_GENUINE_SESSION: 0,
    STRATEGY_CHANGED: 0,
    MANUAL_EXCLUSION: 0,
  };

  private strategyFingerprintHash: string;
  private cohortId: string;
  private validationSampleComplete = false;

  constructor(fingerprintHash: string, cohortId: string) {
    this.strategyFingerprintHash = fingerprintHash;
    this.cohortId = cohortId;
  }

  public markValidationComplete(): void {
    this.validationSampleComplete = true;
  }

  /**
   * Validates and finalizes a trade.
   * A trade counts only if genuineSession=true AND all provenance/timestamp gates pass.
   */
  public finalizeTrade(
    trade: GenuineTradeRecord,
    currentFingerprintHash: string
  ): Phase29FinalizedTrade {
    const now = new Date().toISOString();

    // Duplicate prevention
    if (this.finalizedTrades.has(trade.tradeId)) {
      this.recordExclusion(trade.tradeId, "DUPLICATE_TRADE", "Phase29TradeFinalizer", {
        message: "Duplicate trade ID detected",
      });
      this.exclusionCounters.DUPLICATE_TRADE++;
      return this.finalizedTrades.get(trade.tradeId)!;
    }

    const cohortLabel: "VALIDATION_COHORT" | "POST_VALIDATION_OBSERVATIONS" =
      this.validationSampleComplete ? "POST_VALIDATION_OBSERVATIONS" : "VALIDATION_COHORT";

    // Strategy fingerprint check
    const tradeFpHash = (trade as any).strategyFingerprintHash;
    if (
      currentFingerprintHash !== this.strategyFingerprintHash ||
      (tradeFpHash && tradeFpHash !== this.strategyFingerprintHash)
    ) {
      this.recordExclusion(trade.tradeId, "STRATEGY_CHANGED", "Phase29TradeFinalizer", {
        expected: this.strategyFingerprintHash,
        current: currentFingerprintHash,
        tradeHash: tradeFpHash,
      });
      this.exclusionCounters.STRATEGY_CHANGED++;
      return this.buildExcludedTrade(trade, "STRATEGY_CHANGED", cohortLabel, now);
    }

    // Genuine session requirement
    if (!trade.genuineTrade) {
      let reason: TradeExclusionReason = "NOT_GENUINE_SESSION";
      if (trade.pnlType === "SYNTHETIC_PAPER_PNL") reason = "SYNTHETIC_DATA";
      else if (trade.pnlType === "SIMULATED_TEST_PNL") reason = "SIMULATED_DATA";
      else if (trade.validationFlags && !trade.validationFlags.lotSizeVerified) reason = "LOT_SIZE_UNVERIFIED";
      else if (trade.validationFlags && !trade.validationFlags.reconciliationPassed) reason = "RECONCILIATION_FAILED";

      this.recordExclusion(trade.tradeId, reason, "Phase29TradeFinalizer", {
        flags: trade.validationFlags,
        pnlType: trade.pnlType,
      });
      this.exclusionCounters[reason]++;
      return this.buildExcludedTrade(trade, reason, cohortLabel, now);
    }

    // Data provenance gate
    const provenanceGate = this.validateProvenance(trade);
    const provenancePassed = Object.values(provenanceGate).every(
      (v) => v !== "FAILED"
    );

    if (!provenancePassed) {
      this.recordExclusion(trade.tradeId, "PROVENANCE_FAILED", "Phase29TradeFinalizer", {
        provenanceGate,
      });
      this.exclusionCounters.PROVENANCE_FAILED++;
      return this.buildExcludedTrade(trade, "PROVENANCE_FAILED", cohortLabel, now);
    }

    // Timestamp ordering gate
    const timestampGate = this.validateTimestamps(trade);
    if (!timestampGate.orderValid) {
      this.recordExclusion(trade.tradeId, "TIMESTAMP_VIOLATION", "Phase29TradeFinalizer", {
        timestampGate,
      });
      this.exclusionCounters.TIMESTAMP_VIOLATION++;
      return this.buildExcludedTrade(trade, "TIMESTAMP_VIOLATION", cohortLabel, now);
    }

    const finalized: Phase29FinalizedTrade = {
      tradeId: trade.tradeId,
      sessionId: trade.sessionId,
      genuineTrade: true,
      finalizedAt: now,
      strategyFingerprintHash: this.strategyFingerprintHash,
      cohortId: this.cohortId,
      cohortLabel,
      provenanceGate,
      timestampGate,
      exclusionReason: null,
      originalRecord: Object.freeze({ ...trade }),
    };

    this.finalizedTrades.set(trade.tradeId, finalized);
    return finalized;
  }

  private buildExcludedTrade(
    trade: GenuineTradeRecord,
    reason: TradeExclusionReason,
    cohortLabel: "VALIDATION_COHORT" | "POST_VALIDATION_OBSERVATIONS",
    now: string
  ): Phase29FinalizedTrade {
    const excluded: Phase29FinalizedTrade = {
      tradeId: trade.tradeId,
      sessionId: trade.sessionId,
      genuineTrade: false,
      finalizedAt: now,
      strategyFingerprintHash: this.strategyFingerprintHash,
      cohortId: this.cohortId,
      cohortLabel,
      provenanceGate: {
        spotProvenance: "FAILED",
        optionPriceProvenance: "FAILED",
        oiProvenance: "FAILED",
        ivProvenance: "FAILED",
        deltaProvenance: "FAILED",
        lotSizeProvenance: "FAILED",
        expiryProvenance: "FAILED",
      },
      timestampGate: {
        dataTimestampOk: false,
        decisionTimestampOk: false,
        entryTimestampOk: false,
        monitoringTimestampOk: false,
        exitTimestampOk: false,
        orderValid: false,
      },
      exclusionReason: reason,
      originalRecord: Object.freeze({ ...trade }),
    };
    this.finalizedTrades.set(trade.tradeId, excluded);
    return excluded;
  }

  private validateProvenance(trade: GenuineTradeRecord): Phase29FinalizedTrade["provenanceGate"] {
    const isRealSpot = trade.validationFlags?.realSpot ?? true;
    const isRealOptionChain = trade.validationFlags?.realOptionChain ?? true;
    const isRealOptionPrices = trade.validationFlags?.realOptionPrices ?? true;
    const isLotSizeVerified = trade.validationFlags?.lotSizeVerified ?? true;
    const dataSourceOk = trade.dataSource === "DHAN" || (trade as any).spotSource === "DHAN";
    const priceSourceOk = trade.priceSource === "DHAN" || (trade as any).optionPriceSource === "DHAN";

    return {
      spotProvenance: isRealSpot && dataSourceOk ? "DHAN_WEBSOCKET" : "FAILED",
      optionPriceProvenance: isRealOptionPrices && priceSourceOk ? "DHAN_WEBSOCKET" : "FAILED",
      oiProvenance: isRealOptionChain ? "DHAN_OPTION_CHAIN" : "FAILED",
      ivProvenance: isRealOptionChain ? "DHAN_OPTION_CHAIN" : "FAILED",
      deltaProvenance: isRealOptionChain ? "DHAN_OPTION_CHAIN" : "FAILED",
      lotSizeProvenance: isLotSizeVerified ? "DHAN_INSTRUMENT_MASTER" : "FAILED",
      expiryProvenance: trade.expiry ? "DHAN_EXPIRY_LIST" : "FAILED",
    };
  }

  private validateTimestamps(trade: GenuineTradeRecord): Phase29FinalizedTrade["timestampGate"] {
    const entryTs = new Date(trade.entryTimestamp).getTime();
    const dataTs = trade.dataTimestamp ? new Date(trade.dataTimestamp).getTime() : entryTs;
    const decisionTs = trade.decisionTimestamp
      ? new Date(trade.decisionTimestamp).getTime()
      : entryTs;
    const monitoringTs = trade.monitoringTimestamp
      ? new Date(trade.monitoringTimestamp).getTime()
      : entryTs;
    const exitTs = trade.exitTimestamp ? new Date(trade.exitTimestamp).getTime() : monitoringTs;

    const dataOk = dataTs <= decisionTs;
    const decisionOk = decisionTs <= entryTs;
    const entryOk = entryTs <= monitoringTs;
    const monitoringOk = monitoringTs <= exitTs;
    const exitOk = true;

    return {
      dataTimestampOk: dataOk,
      decisionTimestampOk: decisionOk,
      entryTimestampOk: entryOk,
      monitoringTimestampOk: monitoringOk,
      exitTimestampOk: exitOk,
      orderValid: dataOk && decisionOk && entryOk && monitoringOk,
    };
  }

  private recordExclusion(
    recordId: string,
    reason: TradeExclusionReason,
    source: string,
    details: Record<string, unknown>
  ): void {
    this.exclusionAudit.push({
      recordId,
      timestamp: new Date().toISOString(),
      reason,
      source,
      details,
    });
  }

  public getGenuineFinalized(): Phase29FinalizedTrade[] {
    return Array.from(this.finalizedTrades.values()).filter((t) => t.genuineTrade);
  }

  public getAllFinalized(): Phase29FinalizedTrade[] {
    return Array.from(this.finalizedTrades.values());
  }

  public getExclusionCounters(): Record<TradeExclusionReason, number> {
    return { ...this.exclusionCounters };
  }

  public getExclusionAudit(): Phase29ExclusionAuditEntry[] {
    return [...this.exclusionAudit];
  }

  public getCorrectionEvents(): Phase29TradeCorrectionEvent[] {
    return [...this.correctionEvents];
  }

  public reset(): void {
    this.finalizedTrades.clear();
    this.correctionEvents = [];
    this.exclusionAudit = [];
    this.validationSampleComplete = false;
    for (const key of Object.keys(this.exclusionCounters) as TradeExclusionReason[]) {
      this.exclusionCounters[key] = 0;
    }
  }
}
