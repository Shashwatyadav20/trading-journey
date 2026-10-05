export interface Phase34DailyObservationRecord {
  sessionId: string;
  marketDate: string;
  genuine: boolean;
  activeSession: boolean;
  tradeCount: number;
  winCount: number;
  lossCount: number;
  grossPnL: number;
  charges: number;
  slippage: number;
  netPnL: number;
  strategyFingerprint: string;
  riskLock: "NORMAL" | "PROFIT_LOCK" | "LOSS_LOCK" | "EMERGENCY_LOCK";
  noTradeStatus: boolean;
  dataQualityEvents: string[];
  recordedAt: string;
}

export class Phase34DailyObservationStore {
  private dailyRecords: Map<string, Phase34DailyObservationRecord> = new Map();

  /**
   * Records an immutable daily observation.
   * Prevents rewriting existing session records.
   */
  public recordDailyObservation(record: Phase34DailyObservationRecord): { success: boolean; reason?: string } {
    if (this.dailyRecords.has(record.sessionId)) {
      return { success: false, reason: `DUPLICATE_SESSION: Session ${record.sessionId} already exists in Phase34 Daily Observation Store.` };
    }

    const immutableRecord = Object.freeze({ ...record });
    this.dailyRecords.set(record.sessionId, immutableRecord);
    return { success: true };
  }

  public getDailyObservations(genuineOnly: boolean = false): readonly Phase34DailyObservationRecord[] {
    const list = Array.from(this.dailyRecords.values());
    if (genuineOnly) {
      return list.filter((r) => r.genuine);
    }
    return list;
  }

  public getDailyObservation(sessionId: string): Phase34DailyObservationRecord | undefined {
    return this.dailyRecords.get(sessionId);
  }

  public clearAllForTesting(): void {
    this.dailyRecords.clear();
  }
}

export const phase34DailyObservationStore = new Phase34DailyObservationStore();
