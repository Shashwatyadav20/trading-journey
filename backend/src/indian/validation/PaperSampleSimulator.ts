import { NiftySpreadPosition, PaperSessionRecord, StrategyType } from "../types";

export interface SimulationOptions {
  sessionsCount: number;
  winRatePct: number;
  tradesPerSession: number;
  startEquity?: number;
  isSyntheticData?: boolean;
}

export class PaperSampleSimulator {
  /**
   * Generates deterministic Paper Trading sessions and closed trade records.
   */
  public generateSampleDataset(options: SimulationOptions = { sessionsCount: 22, winRatePct: 75, tradesPerSession: 1.5 }): {
    sessions: PaperSessionRecord[];
    trades: NiftySpreadPosition[];
  } {
    const sessionsCount = options.sessionsCount;
    const winRate = options.winRatePct / 100;
    const tradesPerSession = options.tradesPerSession;
    const isSynthetic = options.isSyntheticData !== undefined ? options.isSyntheticData : true;

    const sessions: PaperSessionRecord[] = [];
    const trades: NiftySpreadPosition[] = [];

    let currentEquity = options.startEquity || 500000;
    let tradeIndex = 1;

    const startDate = new Date(2026, 8, 1); // Sept 1, 2026

    const strategies: StrategyType[] = ["BULL_PUT_SPREAD", "BEAR_CALL_SPREAD", "IRON_CONDOR"];

    for (let s = 1; s <= sessionsCount; s++) {
      const date = new Date(startDate.getTime() + (s - 1) * 86400000);
      const dateStr = date.toISOString().split("T")[0];

      // Determine trade count for this session (e.g. 0, 1, 2)
      const isNoTradeDay = s % 5 === 0; // Every 5th day is a no-trade day
      const sessionTradeCount = isNoTradeDay ? 0 : Math.min(3, Math.max(1, Math.round(tradesPerSession)));

      let sessionGrossPnl = 0;
      let sessionCharges = 0;
      let sessionSlippage = 0;
      let sessionWinners = 0;
      let sessionLosers = 0;

      for (let t = 0; t < sessionTradeCount; t++) {
        const isWinner = (tradeIndex * 0.73) % 1 < winRate;
        const strategy = strategies[tradeIndex % strategies.length];

        const netCredit = 21.46; // ₹1,073 per lot (50 qty)
        const grossPnl = isWinner ? 1073 : -1000; // Cap max loss at ₹1,000 per trade
        const charges = 150;
        const slippage = 50;
        const netPnl = grossPnl - charges - slippage;

        if (isWinner) {
          sessionWinners++;
        } else {
          sessionLosers++;
        }

        sessionGrossPnl += grossPnl;
        sessionCharges += charges;
        sessionSlippage += slippage;

        const trade: NiftySpreadPosition = {
          id: `sim_trade_${s}_${t}_${tradeIndex}`,
          userId: "sim-user",
          symbol: "NIFTY",
          strategy,
          expiry: "2026-09-26",
          sellLeg: {
            symbol: `NIFTY26SEP25100PE`,
            strike: 25100,
            optionType: "PE",
            side: "SELL",
            entryPrice: 120.5,
            currentPrice: isWinner ? 0 : 140.5,
            quantity: 50,
          },
          buyLeg: {
            symbol: `NIFTY26SEP25050PE`,
            strike: 25050,
            optionType: "PE",
            side: "BUY",
            entryPrice: 99.04,
            currentPrice: isWinner ? 0 : 99.04,
            quantity: 50,
          },
          quantityLots: 1,
          totalQuantity: 50,
          netCredit,
          maxLoss: 1000,
          stopLossSpread: 41.46,
          targetSpread: 4.29,
          status: "CLOSED",
          mode: "PAPER",
          entryTime: `${dateStr}T09:30:00.000Z`,
          exitTime: `${dateStr}T14:30:00.000Z`,
          currentSpreadPrice: isWinner ? 0 : 41.46,
          unrealizedGrossPnl: 0,
          unrealizedNetPnl: 0,
          realizedGrossPnl: grossPnl,
          totalCharges: charges,
          realizedNetPnl: netPnl,
          exitReason: isWinner ? "PROFIT_TARGET_CAPTURED" : "STOP_LOSS_HIT",
          timeInTradeSeconds: 18000,
          createdAt: `${dateStr}T09:30:00.000Z`,
          updatedAt: `${dateStr}T14:30:00.000Z`,
        };

        trades.push(trade);
        tradeIndex++;
      }

      const sessionNetPnl = sessionGrossPnl - sessionCharges - sessionSlippage;
      const startEq = currentEquity;
      currentEquity += sessionNetPnl;

      const sessionState = isNoTradeDay
        ? "MARKET_CLOSED"
        : sessionNetPnl >= 1000 || sessionNetPnl <= -5000
        ? "RISK_LOCKED"
        : "MARKET_CLOSED";

      sessions.push({
        sessionId: `sim_session_${dateStr}`,
        date: dateStr,
        marketOpen: `${dateStr}T09:15:00.000Z`,
        marketClose: `${dateStr}T15:30:00.000Z`,
        dataSource: "SIMULATED_NIFTY_PROVIDER",
        dataQuality: isSynthetic ? "SYNTHETIC OPTION DATA — PAPER ESTIMATION" : "REAL LIVE PERFORMANCE",
        isSyntheticOptionData: isSynthetic,
        startingEquity: startEq,
        endingEquity: currentEquity,
        totalTrades: sessionTradeCount,
        winningTrades: sessionWinners,
        losingTrades: sessionLosers,
        grossPnl: sessionGrossPnl,
        charges: sessionCharges,
        slippage: sessionSlippage,
        netPnl: sessionNetPnl,
        state: sessionState,
      });
    }

    return { sessions, trades };
  }
}

export const paperSampleSimulator = new PaperSampleSimulator();
