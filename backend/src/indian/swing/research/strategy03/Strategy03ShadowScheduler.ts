import crypto from "node:crypto";
import { marketSessionValidator } from "../../../market/MarketSessionValidator.js";
import {
  appendShadowSignalsImmutable,
  type ShadowResearchDecision,
  type ShadowSignalRecord,
} from "./Strategy03ShadowRunner.js";

export type ShadowRunStatus =
  | "SUCCESS"
  | "PARTIAL"
  | "FAILED"
  | "SKIPPED_NON_TRADING_DAY"
  | "SKIPPED_DUPLICATE";

export interface DailyObservationRecord {
  runId: string;
  observationDate: string; // YYYY-MM-DD (Asia/Kolkata)
  scheduledTimeIst: string;
  actualStartTime: string;
  completionTime: string;
  status: ShadowRunStatus;
  marketDataTimestamp: string | null;
  evaluationTimestamp: string;
  universeCount: number;
  evaluatedSymbolsCount: number;
  failedSymbols: Array<{ symbol: string; error: string }>;
  decisionCounts: Record<ShadowResearchDecision, number>;
  verificationDistribution: Record<string, number>;
  dataFreshness: {
    financialRows: number;
    ownershipRows: number;
    deliveryRows: number;
    announcementRows: number;
  };
  runChecksum: string;
  errorMessage?: string;
}

export interface ShadowScheduleEvaluation {
  istDate: string;
  istTime: string;
  isTradingDay: boolean;
  isAfterTargetWindow: boolean;
  reason: string;
}

export class Strategy03ShadowScheduler {
  public readonly TARGET_HOUR_IST = 15;
  public readonly TARGET_MINUTE_IST = 45;
  public readonly TIMEZONE = "Asia/Kolkata";
  public readonly liveObservationStartDate: string;

  private observationLedger: DailyObservationRecord[] = [];
  private signalLedger: ShadowSignalRecord[] = [];

  constructor(options?: {
    liveObservationStartDate?: string;
    initialObservations?: DailyObservationRecord[];
    initialSignals?: ShadowSignalRecord[];
  }) {
    this.liveObservationStartDate = options?.liveObservationStartDate ?? "2026-11-17";
    if (options?.initialObservations) {
      this.observationLedger = [...options.initialObservations];
    }
    if (options?.initialSignals) {
      this.signalLedger = [...options.initialSignals];
    }
  }

  public recoverFromLedgers(
    observations: DailyObservationRecord[],
    signals: ShadowSignalRecord[]
  ): void {
    const obsByDate = new Map<string, DailyObservationRecord>();
    for (const o of observations) {
      if (!obsByDate.has(o.observationDate)) obsByDate.set(o.observationDate, o);
    }
    this.observationLedger = [...obsByDate.values()].sort((a, b) =>
      a.observationDate.localeCompare(b.observationDate)
    );
    const sigRes = appendShadowSignalsImmutable([], signals);
    this.signalLedger = sigRes.ledger;
  }

  public evaluateScheduleWindow(now: Date | number | string = new Date()): ShadowScheduleEvaluation {
    const ist = marketSessionValidator.getIstComponents(now);
    const istTime = `${String(ist.hours).padStart(2, "0")}:${String(ist.minutes).padStart(2, "0")}:${String(
      ist.seconds
    ).padStart(2, "0")}`;

    if (ist.dayOfWeek === 0 || ist.dayOfWeek === 6) {
      return {
        istDate: ist.dateString,
        istTime,
        isTradingDay: false,
        isAfterTargetWindow: false,
        reason: "WEEKEND",
      };
    }

    const session = marketSessionValidator.getMarketSessionStatus(now);
    if (session === "HOLIDAY") {
      return {
        istDate: ist.dateString,
        istTime,
        isTradingDay: false,
        isAfterTargetWindow: false,
        reason: "NSE_HOLIDAY",
      };
    }

    const afterTarget =
      ist.hours > this.TARGET_HOUR_IST ||
      (ist.hours === this.TARGET_HOUR_IST && ist.minutes >= this.TARGET_MINUTE_IST);

    return {
      istDate: ist.dateString,
      istTime,
      isTradingDay: true,
      isAfterTargetWindow: afterTarget,
      reason: afterTarget ? "ELIGIBLE_AFTER_CLOSE" : "BEFORE_TARGET_WINDOW_15_45_IST",
    };
  }

  public async executeScheduledScan(params: {
    now?: Date | string | number;
    universeSymbols: string[];
    evaluateSymbol: (symbol: string, observationDate: string) => Promise<ShadowSignalRecord>;
    dataFreshness: DailyObservationRecord["dataFreshness"];
  }): Promise<DailyObservationRecord> {
    const now = params.now ?? new Date();
    const sched = this.evaluateScheduleWindow(now);
    const startIso = new Date().toISOString();
    const scheduledTimeIst = `${sched.istDate}T15:45:00+05:30`;

    // Reject historical backfill as live observation
    if (sched.istDate < this.liveObservationStartDate) {
      const rec: DailyObservationRecord = {
        runId: crypto.randomUUID(),
        observationDate: sched.istDate,
        scheduledTimeIst,
        actualStartTime: startIso,
        completionTime: new Date().toISOString(),
        status: "FAILED",
        marketDataTimestamp: null,
        evaluationTimestamp: startIso,
        universeCount: params.universeSymbols.length,
        evaluatedSymbolsCount: 0,
        failedSymbols: [],
        decisionCounts: { BUY_CANDIDATE: 0, WATCH: 0, WAIT: 0, SELL_CANDIDATE: 0 },
        verificationDistribution: {},
        dataFreshness: params.dataFreshness,
        runChecksum: "",
        errorMessage: `HISTORICAL_BACKFILL_FORBIDDEN: ${sched.istDate} < ${this.liveObservationStartDate}`,
      };
      rec.runChecksum = this.computeChecksum(rec, []);
      return rec;
    }

    if (!sched.isTradingDay) {
      const rec: DailyObservationRecord = {
        runId: crypto.randomUUID(),
        observationDate: sched.istDate,
        scheduledTimeIst,
        actualStartTime: startIso,
        completionTime: new Date().toISOString(),
        status: "SKIPPED_NON_TRADING_DAY",
        marketDataTimestamp: null,
        evaluationTimestamp: startIso,
        universeCount: params.universeSymbols.length,
        evaluatedSymbolsCount: 0,
        failedSymbols: [],
        decisionCounts: { BUY_CANDIDATE: 0, WATCH: 0, WAIT: 0, SELL_CANDIDATE: 0 },
        verificationDistribution: {},
        dataFreshness: params.dataFreshness,
        runChecksum: "",
        errorMessage: sched.reason,
      };
      rec.runChecksum = this.computeChecksum(rec, []);
      this.observationLedger.push(rec);
      return rec;
    }

    // Prevent duplicate evaluations for the same trading date
    const existingSuccess = this.observationLedger.find(
      (o) => o.observationDate === sched.istDate && (o.status === "SUCCESS" || o.status === "PARTIAL")
    );
    if (existingSuccess) {
      const dupRec: DailyObservationRecord = {
        ...existingSuccess,
        runId: crypto.randomUUID(),
        actualStartTime: startIso,
        completionTime: new Date().toISOString(),
        status: "SKIPPED_DUPLICATE",
        errorMessage: `Duplicate scan prevented for ${sched.istDate}; original runId=${existingSuccess.runId}`,
      };
      return dupRec;
    }

    const signals: ShadowSignalRecord[] = [];
    const failedSymbols: Array<{ symbol: string; error: string }> = [];

    for (const sym of params.universeSymbols) {
      try {
        const sig = await params.evaluateSymbol(sym, sched.istDate);
        signals.push(sig);
      } catch (err) {
        failedSymbols.push({
          symbol: sym,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const decisionCounts: Record<ShadowResearchDecision, number> = {
      BUY_CANDIDATE: 0,
      WATCH: 0,
      WAIT: 0,
      SELL_CANDIDATE: 0,
    };
    const verificationDistribution: Record<string, number> = {};
    for (const s of signals) {
      decisionCounts[s.decision] += 1;
      verificationDistribution[s.verificationStatus] =
        (verificationDistribution[s.verificationStatus] ?? 0) + 1;
    }

    const status: ShadowRunStatus =
      signals.length === 0
        ? "FAILED"
        : failedSymbols.length > 0
        ? "PARTIAL"
        : "SUCCESS";

    if (status === "SUCCESS" || status === "PARTIAL") {
      const appended = appendShadowSignalsImmutable(this.signalLedger, signals);
      this.signalLedger = appended.ledger;
    }

    const completionIso = new Date().toISOString();
    const record: DailyObservationRecord = {
      runId: crypto.randomUUID(),
      observationDate: sched.istDate,
      scheduledTimeIst,
      actualStartTime: startIso,
      completionTime: completionIso,
      status,
      marketDataTimestamp: signals[0]?.marketDataTimestamp ?? null,
      evaluationTimestamp: completionIso,
      universeCount: params.universeSymbols.length,
      evaluatedSymbolsCount: signals.length,
      failedSymbols,
      decisionCounts,
      verificationDistribution,
      dataFreshness: params.dataFreshness,
      runChecksum: "",
    };
    record.runChecksum = this.computeChecksum(record, signals);

    // Preserve immutable observation history: never overwrite existing date
    this.observationLedger.push(record);
    return record;
  }

  public getObservationLedger(): DailyObservationRecord[] {
    return [...this.observationLedger];
  }

  public getSignalLedger(): ShadowSignalRecord[] {
    return [...this.signalLedger];
  }

  public getSuccessfulObservationDaysCount(): number {
    return new Set(
      this.observationLedger.filter((o) => o.status === "SUCCESS").map((o) => o.observationDate)
    ).size;
  }

  private computeChecksum(rec: DailyObservationRecord, signals: ShadowSignalRecord[]): string {
    const payload = JSON.stringify({
      observationDate: rec.observationDate,
      status: rec.status,
      evaluatedSymbolsCount: rec.evaluatedSymbolsCount,
      decisionCounts: rec.decisionCounts,
      signalKeys: signals.map((s) => `${s.idempotencyKey}:${s.decision}:${s.score}`).sort(),
    });
    return crypto.createHash("sha256").update(payload).digest("hex");
  }
}
