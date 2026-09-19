import { DailyRiskState } from "../types";
import { DEFAULT_NIFTY_CONFIG, NiftyConfig } from "../config/niftyConfig";
import { paperPersistenceManager } from "../persistence/PaperPersistenceManager";

export class DailyRiskController {
  private config: NiftyConfig;
  private state: DailyRiskState;
  private currentDateStr: string;

  constructor(config: NiftyConfig = DEFAULT_NIFTY_CONFIG) {
    this.config = config;
    this.currentDateStr = new Date().toISOString().split("T")[0];
    this.state = this.getInitialState();
  }

  private getInitialState(): DailyRiskState {
    return {
      dailyPnl: 0,
      dailyLossLimit: this.config.dailyLossLimit,
      dailyProfitTarget: this.config.dailyProfitTarget,
      tradesCountToday: 0,
      maxTradesPerDay: this.config.maxTradesPerDay,
      consecutiveLosses: 0,
      maxConsecutiveLosses: this.config.maxConsecutiveLosses,
      isDailyLossLocked: false,
      isDailyProfitLocked: false,
      isTradeLocked: false,
      lockReason: null,
    };
  }

  /**
   * Restores risk state after process restart.
   */
  public reconstructState(savedState: DailyRiskState): void {
    if (savedState) {
      this.state = { ...savedState };
    }
  }

  private checkDateRollover(): void {
    const today = new Date().toISOString().split("T")[0];
    if (today !== this.currentDateStr) {
      this.currentDateStr = today;
      this.state = this.getInitialState();
      paperPersistenceManager.persistDailyRisk(this.state);
    }
  }

  public getState(): DailyRiskState {
    this.checkDateRollover();
    return { ...this.state };
  }

  public recordTradeClosed(netPnl: number): void {
    this.checkDateRollover();
    this.state.dailyPnl = Number((this.state.dailyPnl + netPnl).toFixed(2));
    this.state.tradesCountToday += 1;

    if (netPnl < 0) {
      this.state.consecutiveLosses += 1;
    } else if (netPnl > 0) {
      this.state.consecutiveLosses = 0;
    }

    // Evaluate Locks
    if (this.state.dailyPnl >= this.config.dailyProfitTarget) {
      this.state.isDailyProfitLocked = true;
      this.state.isTradeLocked = true;
      this.state.lockReason = `Daily net profit target reached (₹${this.config.dailyProfitTarget}). New trades locked for today.`;
    } else if (this.state.dailyPnl <= this.config.dailyLossLimit) {
      this.state.isDailyLossLocked = true;
      this.state.isTradeLocked = true;
      this.state.lockReason = `Daily maximum loss limit reached (₹${Math.abs(
        this.config.dailyLossLimit
      )}). New trades locked for today.`;
    } else if (this.state.tradesCountToday >= this.config.maxTradesPerDay) {
      this.state.isTradeLocked = true;
      this.state.lockReason = `Maximum trades per day (${this.config.maxTradesPerDay}) reached.`;
    } else if (
      this.state.consecutiveLosses >= this.config.maxConsecutiveLosses
    ) {
      this.state.isTradeLocked = true;
      this.state.lockReason = `Maximum consecutive losses (${this.config.maxConsecutiveLosses}) reached.`;
    }

    paperPersistenceManager.persistDailyRisk(this.state);
  }

  public recordTradeResult(netPnl: number): void {
    this.recordTradeClosed(netPnl);
  }

  public canTrade(): { allowed: boolean; reason: string | null } {
    this.checkDateRollover();
    if (this.state.isTradeLocked) {
      return { allowed: false, reason: this.state.lockReason };
    }
    return { allowed: true, reason: null };
  }

  public resetLocks(): void {
    this.state = this.getInitialState();
    paperPersistenceManager.persistDailyRisk(this.state);
  }
}

export const dailyRiskController = new DailyRiskController();

