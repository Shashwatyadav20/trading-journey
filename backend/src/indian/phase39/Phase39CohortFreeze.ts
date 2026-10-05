import { Phase39Cohort, Phase39TradeRecord, Phase39SessionRecord, computeHash } from "./Phase39Types";
import { PHASE39_CONFIG } from "./Phase39Config";

export class Phase39CohortFreeze {
  private cohort: Phase39Cohort | null = null;

  public createCohortSnapshot(
    sessionRecords: Phase39SessionRecord[],
    tradeRecords: Phase39TradeRecord[],
    strategyFingerprint: string = PHASE39_CONFIG.MASTER_STRATEGY_FINGERPRINT
  ): Phase39Cohort {
    if (this.cohort && this.cohort.frozen) {
      throw new Error("BLOCKED: Cannot recreate or overwrite an already frozen cohort snapshot.");
    }

    const sessionIds = sessionRecords.map((s) => s.sessionId);
    const tradeIds = tradeRecords.map((t) => t.tradeId);
    const activeSessionCount = sessionRecords.filter((s) => s.totalTrades > 0).length;

    const canonicalData = {
      sessionIds,
      tradeIds,
      sessionCount: sessionRecords.length,
      tradeCount: tradeRecords.length,
      strategyFingerprint,
    };

    const sourceEvidenceHash = computeHash(canonicalData);
    const cohortId = `COHORT_P39_${sourceEvidenceHash.substring(0, 12).toUpperCase()}`;

    // Deep freeze session and trade arrays
    const frozenSessions = Object.freeze(sessionRecords.map((s) => Object.freeze({ ...s, tradeIds: [...s.tradeIds] })));
    const frozenTrades = Object.freeze(tradeRecords.map((t) => Object.freeze({ ...t })));

    this.cohort = {
      cohortId,
      createdAt: new Date().toISOString(),
      sessionIds: Object.freeze([...sessionIds]) as any,
      tradeIds: Object.freeze([...tradeIds]) as any,
      sessionCount: sessionRecords.length,
      tradeCount: tradeRecords.length,
      activeSessionCount,
      strategyFingerprint,
      sourceEvidenceHash,
      frozen: false,
      sessions: frozenSessions as any,
      trades: frozenTrades as any,
    };

    return this.cohort;
  }

  public freeze(): Phase39Cohort {
    if (!this.cohort) {
      throw new Error("BLOCKED: Cannot freeze cohort before creating snapshot.");
    }
    this.cohort.frozen = true;
    this.cohort.frozenAt = new Date().toISOString();

    // Seal the cohort object
    Object.freeze(this.cohort);
    return this.cohort;
  }

  public getCohort(): Phase39Cohort | null {
    return this.cohort;
  }

  // Guards against mutation after freeze
  public addTrade(trade: Phase39TradeRecord): void {
    if (this.cohort?.frozen) {
      throw new Error("BLOCKED: Cannot ADD trade to a frozen validation cohort.");
    }
  }

  public deleteTrade(tradeId: string): void {
    if (this.cohort?.frozen) {
      throw new Error("BLOCKED: Cannot DELETE trade from a frozen validation cohort.");
    }
  }

  public editTrade(tradeId: string, updates: Partial<Phase39TradeRecord>): void {
    if (this.cohort?.frozen) {
      throw new Error("BLOCKED: Cannot EDIT trade in a frozen validation cohort.");
    }
  }

  public reorderTrades(): void {
    if (this.cohort?.frozen) {
      throw new Error("BLOCKED: Cannot REORDER trades in a frozen validation cohort.");
    }
  }
}
