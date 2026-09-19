import { SessionState, PaperSessionRecord } from "../types";
import { dailyRiskController } from "../risk/DailyRiskController";

export class PaperSessionManager {
  private forcedSessionMode: SessionState | null = null;
  private isSimulationMode: boolean = false;
  private sessionsMap: Map<string, PaperSessionRecord> = new Map();
  private currentSessionId: string = "";

  constructor() {
    this.initCurrentSession();
  }

  private initCurrentSession(): string {
    const today = new Date().toISOString().split("T")[0];
    const sessionId = `sess_${today.replace(/-/g, "")}`;

    if (!this.sessionsMap.has(sessionId)) {
      const newSession: PaperSessionRecord = {
        sessionId,
        date: today,
        marketOpen: `${today}T09:15:00+05:30`,
        marketClose: `${today}T15:30:00+05:30`,
        dataSource: "NIFTY_LIVE_FEED",
        dataQuality: "SYNTHETIC OPTION DATA — PAPER ESTIMATION",
        isSyntheticOptionData: true,
        startingEquity: 500000,
        endingEquity: 500000,
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        grossPnl: 0,
        charges: 0,
        slippage: 0,
        netPnl: 0,
        state: "PRE_MARKET",
      };
      this.sessionsMap.set(sessionId, newSession);
    }

    this.currentSessionId = sessionId;
    return sessionId;
  }

  /**
   * Sets forced session override for testing or manual simulation control.
   */
  public setForcedSessionState(state: SessionState | null) {
    this.forcedSessionMode = state;
  }

  /**
   * Sets simulation mode state.
   */
  public setSimulationMode(enabled: boolean) {
    this.isSimulationMode = enabled;
  }

  /**
   * Returns current NIFTY paper trading session state and metadata.
   */
  public getSessionState(): {
    state: SessionState;
    isOpenForTrading: boolean;
    reason: string;
    symbol: string;
    isPaperMode: boolean;
    isLiveTradingEnabled: boolean;
    isSimulationMode: boolean;
    sessionId: string;
    currentSession?: PaperSessionRecord;
  } {
    const sessionId = this.initCurrentSession();
    const currentSession = this.sessionsMap.get(sessionId);

    let calculatedState: SessionState = "PRE_MARKET";
    let isOpen = false;
    let reasonText = "";

    if (this.forcedSessionMode) {
      calculatedState = this.forcedSessionMode;
      isOpen = this.forcedSessionMode === "ACTIVE" || this.forcedSessionMode === "MARKET_OPEN";
      reasonText = `Forced session override active (${this.forcedSessionMode})`;
    } else {
      const dailyState = dailyRiskController.getState();
      if (dailyState.isTradeLocked) {
        calculatedState = "RISK_LOCKED";
        isOpen = false;
        reasonText = dailyState.lockReason || "Daily risk lock active";
      } else {
        const now = new Date();
        const utcTime = now.getTime() + now.getTimezoneOffset() * 60000;
        const istTime = new Date(utcTime + 330 * 60000);

        const day = istTime.getDay();
        const hours = istTime.getHours();
        const minutes = istTime.getMinutes();
        const totalMinutes = hours * 60 + minutes;

        if (day === 0 || day === 6) {
          calculatedState = "MARKET_CLOSED";
          isOpen = false;
          reasonText = "Market is closed on weekends";
        } else if (totalMinutes >= 540 && totalMinutes < 555) {
          calculatedState = "PRE_MARKET";
          isOpen = false;
          reasonText = "Pre-market session active (09:00 - 09:15 IST)";
        } else if (totalMinutes >= 555 && totalMinutes <= 930) {
          calculatedState = "ACTIVE";
          isOpen = true;
          reasonText = "Market is open for active paper trading (09:15 - 15:30 IST)";
        } else {
          calculatedState = "MARKET_CLOSED";
          isOpen = false;
          reasonText = "Market is closed outside trading hours (09:15 - 15:30 IST)";
        }
      }
    }

    if (currentSession) {
      currentSession.state = calculatedState;
    }

    return {
      state: calculatedState,
      isOpenForTrading: isOpen,
      reason: reasonText,
      symbol: "NIFTY",
      isPaperMode: true,
      isLiveTradingEnabled: false,
      isSimulationMode: this.isSimulationMode,
      sessionId,
      currentSession,
    };
  }

  /**
   * Updates session record trade execution metrics.
   */
  public recordTradeToSession(netPnl: number, grossPnl: number, totalCharges: number, slippage: number = 50) {
    const sessionId = this.initCurrentSession();
    const session = this.sessionsMap.get(sessionId);
    if (session) {
      session.totalTrades += 1;
      if (netPnl > 0) session.winningTrades += 1;
      else if (netPnl < 0) session.losingTrades += 1;

      session.grossPnl = Number((session.grossPnl + grossPnl).toFixed(2));
      session.charges = Number((session.charges + totalCharges).toFixed(2));
      session.slippage = Number((session.slippage + slippage).toFixed(2));
      session.netPnl = Number((session.netPnl + netPnl).toFixed(2));
      session.endingEquity = Number((session.startingEquity + session.netPnl).toFixed(2));
    }
  }

  /**
   * Returns history of paper trading sessions.
   */
  public getAllSessions(): PaperSessionRecord[] {
    this.initCurrentSession();
    return Array.from(this.sessionsMap.values());
  }
}

export const paperSessionManager = new PaperSessionManager();

