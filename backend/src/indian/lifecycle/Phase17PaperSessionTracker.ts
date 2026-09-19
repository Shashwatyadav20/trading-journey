import { Phase17PaperSession, DataSourceType } from "../types";

export class Phase17PaperSessionTracker {
  private currentSession: Phase17PaperSession;

  constructor() {
    this.currentSession = this.createInitialSession();
  }

  private createInitialSession(): Phase17PaperSession {
    const today = new Date().toISOString().split("T")[0];
    return {
      sessionId: `p17_sess_${today.replace(/-/g, "")}`,
      startTime: new Date().toISOString(),
      dataSource: "NSE_INDIA",
      spotSource: "SYNTHETIC",
      optionChainSource: "SYNTHETIC",
      optionPriceSource: "SYNTHETIC",
      dataGate: "BLOCKED",
      isGenuinePaperSample: false,
      signals: 0,
      noTradeReasons: {},
      entries: 0,
      exits: 0,
      charges: 0,
      slippage: 0,
      grossPnl: 0,
      netPnl: 0,
      maxDrawdown: 0,
      riskViolations: 0,
      reconciliationStatus: "PENDING",
    };
  }

  public updateDataSources(
    spotSource: DataSourceType,
    optionChainSource: DataSourceType,
    optionPriceSource: DataSourceType,
    providerName: string = "NSE_INDIA",
  ): void {
    this.currentSession.spotSource = spotSource;
    this.currentSession.optionChainSource = optionChainSource;
    this.currentSession.optionPriceSource = optionPriceSource;
    this.currentSession.dataSource = providerName;

    const isGenuine =
      spotSource === "REAL" &&
      optionChainSource === "REAL" &&
      optionPriceSource === "REAL";

    this.currentSession.isGenuinePaperSample = isGenuine;
    this.currentSession.dataGate = isGenuine ? "READY" : "BLOCKED";
  }

  public recordSignal(noTradeReason?: string | null): void {
    this.currentSession.signals += 1;
    if (noTradeReason) {
      this.currentSession.noTradeReasons[noTradeReason] =
        (this.currentSession.noTradeReasons[noTradeReason] ?? 0) + 1;
    }
  }

  public recordTradeEntry(charges: number = 0, slippage: number = 0): void {
    this.currentSession.entries += 1;
    this.currentSession.charges = Number((this.currentSession.charges + charges).toFixed(2));
    this.currentSession.slippage = Number((this.currentSession.slippage + slippage).toFixed(2));
  }

  public recordTradeExit(
    grossPnl: number,
    netPnl: number,
    charges: number = 0,
    slippage: number = 0,
  ): void {
    this.currentSession.exits += 1;
    this.currentSession.grossPnl = Number((this.currentSession.grossPnl + grossPnl).toFixed(2));
    this.currentSession.netPnl = Number((this.currentSession.netPnl + netPnl).toFixed(2));
    this.currentSession.charges = Number((this.currentSession.charges + charges).toFixed(2));
    this.currentSession.slippage = Number((this.currentSession.slippage + slippage).toFixed(2));

    if (netPnl < 0) {
      const currentDd = Math.abs(netPnl);
      if (currentDd > this.currentSession.maxDrawdown) {
        this.currentSession.maxDrawdown = Number(currentDd.toFixed(2));
      }
    }
  }

  public recordRiskViolation(): void {
    this.currentSession.riskViolations += 1;
  }

  public getCurrentSession(): Phase17PaperSession {
    return { ...this.currentSession };
  }

  public resetSession(): void {
    this.currentSession = this.createInitialSession();
  }
}

export const phase17PaperSessionTracker = new Phase17PaperSessionTracker();
