import type { FourHourCandle } from "./Strategy03FourHourCandleProvider.js";
import {
  DEFAULT_4H_SCANNER_CONFIG,
  evaluateFourHourPreBreakout,
  type FourHourPreBreakoutItem,
  type FourHourPreBreakoutStatus,
  type FourHourScannerConfig,
} from "./Strategy03FourHourPreBreakoutScanner.js";

export type MonitoringAlertType =
  | "NEW_READY_CANDIDATE"
  | "READY_APPROACHING_BREAKOUT"
  | "CONFIRMED_BREAKOUT"
  | "CONSOLIDATION_LOW_BREACHED"
  | "SUPPORT_INVALIDATED"
  | "BULLISH_OB_INVALIDATED"
  | "MOVED_TO_WAIT_DATA_ISSUE";

export interface MonitoringAlertRecord {
  eventId: string;
  symbol: string;
  alertType: MonitoringAlertType;
  previousStatus: FourHourPreBreakoutStatus | null;
  newStatus: FourHourPreBreakoutStatus;
  completed4hTimestampIst: string;
  price: number | null;
  consolidationLow: number | null;
  consolidationHigh: number | null;
  supportLow: number | null;
  supportHigh: number | null;
  obLow: number | null;
  obHigh: number | null;
  reason: string;
  source: string;
  dataFreshness: "FRESH" | "STALE" | "MISSING";
}

export interface CandidateStateTransitionRecord {
  transitionKey: string;
  symbol: string;
  previousStatus: FourHourPreBreakoutStatus | null;
  currentStatus: FourHourPreBreakoutStatus;
  completed4hTimestampIst: string;
  closePrice: number | null;
  breakoutBoundary: number | null;
  breakoutDistancePct: number | null;
  consolidationLow: number | null;
  consolidationHigh: number | null;
  supportLow: number | null;
  supportHigh: number | null;
  obLow: number | null;
  obHigh: number | null;
  reason: string;
  dataFreshness: "FRESH" | "STALE" | "MISSING";
  isCandleComplete: boolean;
}

export class Strategy03FourHourMonitoringEngine {
  private readonly latestStateBySymbol = new Map<string, CandidateStateTransitionRecord>();
  private readonly stateHistory: CandidateStateTransitionRecord[] = [];
  private readonly alerts: MonitoringAlertRecord[] = [];
  private readonly seenTransitionKeys = new Set<string>();
  private readonly seenAlertIds = new Set<string>();
  private duplicatesPrevented = 0;

  public recoverState(params: {
    stateHistory: CandidateStateTransitionRecord[];
    alerts: MonitoringAlertRecord[];
  }): void {
    for (const s of params.stateHistory) {
      if (!this.seenTransitionKeys.has(s.transitionKey)) {
        this.seenTransitionKeys.add(s.transitionKey);
        this.stateHistory.push(s);
        this.latestStateBySymbol.set(s.symbol, s);
      }
    }
    for (const a of params.alerts) {
      if (!this.seenAlertIds.has(a.eventId)) {
        this.seenAlertIds.add(a.eventId);
        this.alerts.push(a);
      }
    }
  }

  public evaluateSymbol(params: {
    nseSymbol: string;
    companyName: string;
    candles: FourHourCandle[];
    now?: Date;
    dataProvider: string;
    sourceReference: string;
    config?: FourHourScannerConfig;
  }): {
    item: FourHourPreBreakoutItem;
    stateRecord: CandidateStateTransitionRecord;
    newAlerts: MonitoringAlertRecord[];
    duplicatePrevented: boolean;
  } {
    // evaluateFourHourPreBreakout strictly filters to isComplete===true and rejects 1H candles
    const item = evaluateFourHourPreBreakout(params);
    const prev = this.latestStateBySymbol.get(params.nseSymbol) ?? null;
    const prevStatus = prev?.currentStatus ?? null;
    let curStatus = item.status;
    let curReason = item.reason;
    const tsIst = item.lastUpdatedIst || "NO_COMPLETED_4H_BAR";

    // Preserve established READY box boundaries so a downward breach or upward breakout is caught cleanly
    const consLow = prevStatus === "READY" && prev && prev.consolidationLow !== null ? prev.consolidationLow : (item.consolidation.low ?? prev?.consolidationLow ?? null);
    const consHigh = prevStatus === "READY" && prev && prev.consolidationHigh !== null ? prev.consolidationHigh : (item.consolidation.high ?? prev?.consolidationHigh ?? null);
    const suppLow = item.supportZone.supportLow ?? prev?.supportLow ?? null;
    const suppHigh = item.supportZone.supportHigh ?? prev?.supportHigh ?? null;
    const obLow = item.orderBlock.obLow ?? prev?.obLow ?? null;
    const obHigh = item.orderBlock.obHigh ?? prev?.obHigh ?? null;

    if (prevStatus === "READY" && item.currentPrice !== null && curStatus !== "WAIT") {
      if (consLow !== null && item.currentPrice < consLow) {
        curStatus = "INVALIDATED";
        curReason = "4H_CONSOLIDATION_OR_SUPPORT_LOW_BROKEN";
      } else if (consHigh !== null && item.currentPrice > consHigh * 1.001) {
        curStatus = "BREAKOUT";
        curReason = "CONFIRMED_4H_BREAKOUT_ALREADY_OCCURRED";
      }
    }

    const dataFreshness: "FRESH" | "STALE" | "MISSING" = curReason.includes("STALE")
      ? "STALE"
      : curReason.includes("MISSING") || !item.lastUpdatedIst
      ? "MISSING"
      : "FRESH";

    // Prevent duplicate evaluation of the exact same completed 4H bar & status
    if (prev && prev.completed4hTimestampIst === tsIst && prev.currentStatus === curStatus) {
      this.duplicatesPrevented++;
      return { item: { ...item, status: curStatus, reason: curReason }, stateRecord: prev, newAlerts: [], duplicatePrevented: true };
    }

    const transitionKey = `${params.nseSymbol}|${prevStatus ?? "INIT"}->${curStatus}|${tsIst}`;
    const stateRecord: CandidateStateTransitionRecord = {
      transitionKey,
      symbol: params.nseSymbol,
      previousStatus: prevStatus,
      currentStatus: curStatus,
      completed4hTimestampIst: tsIst,
      closePrice: item.currentPrice,
      breakoutBoundary: consHigh,
      breakoutDistancePct: item.breakoutDistancePct,
      consolidationLow: consLow,
      consolidationHigh: consHigh,
      supportLow: suppLow,
      supportHigh: suppHigh,
      obLow,
      obHigh,
      reason: curReason,
      dataFreshness,
      isCandleComplete: true,
    };

    if (this.seenTransitionKeys.has(transitionKey)) {
      this.duplicatesPrevented++;
      return { item, stateRecord, newAlerts: [], duplicatePrevented: true };
    }

    this.seenTransitionKeys.add(transitionKey);
    this.stateHistory.push(stateRecord);
    this.latestStateBySymbol.set(params.nseSymbol, stateRecord);

    const candidateAlerts: MonitoringAlertType[] = [];
    if (curStatus === "READY" && prevStatus !== "READY") {
      candidateAlerts.push("NEW_READY_CANDIDATE");
    }
    if (
      curStatus === "READY" &&
      item.breakoutDistancePct !== null &&
      item.breakoutDistancePct >= 0 &&
      item.breakoutDistancePct <= 1.2
    ) {
      candidateAlerts.push("READY_APPROACHING_BREAKOUT");
    }
    if (curStatus === "BREAKOUT" && prevStatus !== "BREAKOUT") {
      candidateAlerts.push("CONFIRMED_BREAKOUT");
    }
    if (curStatus === "INVALIDATED" && prevStatus !== "INVALIDATED") {
      if (item.orderBlock.invalidated || (obLow !== null && item.currentPrice !== null && item.currentPrice < obLow)) {
        candidateAlerts.push("BULLISH_OB_INVALIDATED");
      } else if (suppLow !== null && item.currentPrice !== null && item.currentPrice < suppLow) {
        candidateAlerts.push("SUPPORT_INVALIDATED");
      } else {
        candidateAlerts.push("CONSOLIDATION_LOW_BREACHED");
      }
    }
    if (curStatus === "WAIT" && prevStatus !== null && prevStatus !== "WAIT") {
      candidateAlerts.push("MOVED_TO_WAIT_DATA_ISSUE");
    }

    const newAlerts: MonitoringAlertRecord[] = [];
    for (const alertType of candidateAlerts) {
      const eventId = `${params.nseSymbol}|${alertType}|${tsIst}`;
      if (this.seenAlertIds.has(eventId)) {
        this.duplicatesPrevented++;
        continue;
      }
      this.seenAlertIds.add(eventId);
      const alert: MonitoringAlertRecord = {
        eventId,
        symbol: params.nseSymbol,
        alertType,
        previousStatus: prevStatus,
        newStatus: curStatus,
        completed4hTimestampIst: tsIst,
        price: item.currentPrice,
        consolidationLow: consLow,
        consolidationHigh: consHigh,
        supportLow: suppLow,
        supportHigh: suppHigh,
        obLow,
        obHigh,
        reason: item.reason,
        source: params.dataProvider,
        dataFreshness,
      };
      this.alerts.push(alert);
      newAlerts.push(alert);
    }

    return { item, stateRecord, newAlerts, duplicatePrevented: false };
  }

  public getLatestState(symbol: string): CandidateStateTransitionRecord | undefined {
    return this.latestStateBySymbol.get(symbol);
  }

  public getAllLatestStates(): CandidateStateTransitionRecord[] {
    return [...this.latestStateBySymbol.values()];
  }

  public getStateHistory(): CandidateStateTransitionRecord[] {
    return [...this.stateHistory];
  }

  public getAlerts(): MonitoringAlertRecord[] {
    return [...this.alerts];
  }

  public getDuplicatesPrevented(): number {
    return this.duplicatesPrevented;
  }
}

export { DEFAULT_4H_SCANNER_CONFIG };
