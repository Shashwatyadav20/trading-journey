import crypto from "crypto";

export interface Phase34LongHorizonCohort {
  cohortId: string;
  parentPhase31CohortId: string;
  parentPhase32DatasetId: string;
  strategyFingerprint: string;
  startTimestamp: string;
  currentTimestamp: string;
  sessionCount: number;
  tradeCount: number;
  activeSessionCount: number;
  status: "ACCUMULATING" | "FROZEN" | "INVALID";
  freezeTimestamp: string | null;
}

export class Phase34CohortManager {
  private cohort: Phase34LongHorizonCohort | null = null;
  private isFrozen: boolean = false;

  public initializeCohort(
    parentPhase31CohortId: string,
    parentPhase32DatasetId: string,
    strategyFingerprint: string
  ): Phase34LongHorizonCohort {
    if (this.cohort) {
      return this.cohort;
    }

    const now = new Date().toISOString();
    const cohortId = `LH_COHORT_P34_${crypto.createHash("sha256").update(`${parentPhase31CohortId}_${strategyFingerprint}`).digest("hex").substring(0, 8)}`;

    this.cohort = {
      cohortId,
      parentPhase31CohortId,
      parentPhase32DatasetId,
      strategyFingerprint,
      startTimestamp: now,
      currentTimestamp: now,
      sessionCount: 0,
      tradeCount: 0,
      activeSessionCount: 0,
      status: "ACCUMULATING",
      freezeTimestamp: null,
    };

    return this.cohort;
  }

  public updateCohortCounts(sessionCount: number, tradeCount: number, activeSessionCount: number): Phase34LongHorizonCohort {
    if (!this.cohort) {
      throw new Error("COHORT_NOT_INITIALIZED: Initialize cohort before updating counts.");
    }

    if (this.isFrozen) {
      throw new Error("COHORT_FROZEN: Cannot update counts on a frozen cohort.");
    }

    this.cohort = {
      ...this.cohort,
      currentTimestamp: new Date().toISOString(),
      sessionCount,
      tradeCount,
      activeSessionCount,
    };

    return this.cohort;
  }

  public freezeCohort(): Phase34LongHorizonCohort {
    if (!this.cohort) {
      throw new Error("COHORT_NOT_INITIALIZED: Cannot freeze unitialized cohort.");
    }

    if (this.isFrozen) {
      return this.cohort;
    }

    const now = new Date().toISOString();
    this.cohort = Object.freeze({
      ...this.cohort,
      currentTimestamp: now,
      freezeTimestamp: now,
      status: "FROZEN",
    });

    this.isFrozen = true;
    return this.cohort;
  }

  public getCohort(): Phase34LongHorizonCohort | null {
    return this.cohort;
  }

  public reset(): void {
    this.cohort = null;
    this.isFrozen = false;
  }
}

export const phase34CohortManager = new Phase34CohortManager();
