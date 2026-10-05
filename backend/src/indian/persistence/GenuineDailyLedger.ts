import { Phase25MarketSessionStatus } from "../types";

export interface DailyLedgerEntry {
  date: string;                     // YYYY-MM-DD IST
  marketSession: Phase25MarketSessionStatus;
  genuine: boolean;
  active: boolean;
  tradeCount: number;
  grossPnL: number;
  charges: number;
  slippage: number;
  netPnL: number;
  wins: number;
  losses: number;
  noTrade: boolean;
  blockedSignals: number;
  reconciliation: "PASS" | "FAIL";
  dataQuality: "REAL" | "SYNTHETIC" | "STALE" | "INVALID";
  providerHealth: "CONNECTED" | "DISCONNECTED" | "DEGRADED";
}

export interface DailyLedgerSummary {
  genuineTradingDays: number;
  activeDays: number;
  noTradeDays: number;
  positiveDays: number;
  negativeDays: number;
  zeroDays: number;
  averageNetPnL: number;
  medianNetPnL: number;
  bestDay: number;
  worstDay: number;
  dailyStandardDeviation: number;
  dailyMaxDrawdown: number;
  target1000Analysis: {
    daysAtOrAbove1000: number;
    daysBetween0And999: number;
    negativeDays: number;
    noTradeDays: number;
    percentageOfActiveDaysAtOrAbove1000: number;
  };
}

export class GenuineDailyLedger {
  private ledgerEntries: Map<string, DailyLedgerEntry> = new Map();

  /**
   * Records or updates a daily session ledger entry.
   */
  public recordDailySession(entry: DailyLedgerEntry): DailyLedgerEntry {
    this.ledgerEntries.set(entry.date, entry);
    return entry;
  }

  /**
   * Retrieves entry for a specific date.
   */
  public getEntry(date: string): DailyLedgerEntry | null {
    return this.ledgerEntries.get(date) || null;
  }

  /**
   * Returns all recorded daily ledger entries.
   */
  public getAllEntries(onlyGenuine: boolean = false): DailyLedgerEntry[] {
    const entries = Array.from(this.ledgerEntries.values()).sort((a, b) => a.date.localeCompare(b.date));
    return onlyGenuine ? entries.filter((e) => e.genuine) : entries;
  }

  /**
   * Computes statistical summary across genuine trading days.
   */
  public getSummary(onlyGenuine: boolean = true): DailyLedgerSummary {
    const entries = this.getAllEntries(onlyGenuine);

    const genuineTradingDays = entries.length;
    const activeDays = entries.filter((e) => e.active).length;
    const noTradeDays = entries.filter((e) => e.noTrade || e.tradeCount === 0).length;
    const positiveDays = entries.filter((e) => e.active && e.netPnL > 0).length;
    const negativeDays = entries.filter((e) => e.active && e.netPnL < 0).length;
    const zeroDays = entries.filter((e) => e.active && e.netPnL === 0).length;

    const netPnls = entries.filter((e) => e.active).map((e) => e.netPnL);
    const sortedNetPnls = [...netPnls].sort((a, b) => a - b);

    const bestDay = netPnls.length > 0 ? Math.max(...netPnls) : 0;
    const worstDay = netPnls.length > 0 ? Math.min(...netPnls) : 0;

    const sumNetPnL = netPnls.reduce((acc, val) => acc + val, 0);
    const averageNetPnL = netPnls.length > 0 ? Number((sumNetPnL / netPnls.length).toFixed(2)) : 0;

    let medianNetPnL = 0;
    if (sortedNetPnls.length > 0) {
      const mid = Math.floor(sortedNetPnls.length / 2);
      medianNetPnL =
        sortedNetPnls.length % 2 !== 0
          ? sortedNetPnls[mid]
          : Number(((sortedNetPnls[mid - 1] + sortedNetPnls[mid]) / 2).toFixed(2));
    }

    // Standard Deviation
    let dailyStandardDeviation = 0;
    if (netPnls.length > 1) {
      const variance = netPnls.reduce((acc, val) => acc + Math.pow(val - averageNetPnL, 2), 0) / netPnls.length;
      dailyStandardDeviation = Number(Math.sqrt(variance).toFixed(2));
    }

    // ₹1,000 Target Analysis (Observational Only)
    const daysAtOrAbove1000 = entries.filter((e) => e.active && e.netPnL >= 1000).length;
    const daysBetween0And999 = entries.filter((e) => e.active && e.netPnL >= 0 && e.netPnL < 1000).length;
    const percentageOfActiveDaysAtOrAbove1000 =
      activeDays > 0 ? Number(((daysAtOrAbove1000 / activeDays) * 100).toFixed(1)) : 0;

    // Daily Equity Peak Drawdown
    let peak = 0;
    let maxDd = 0;
    let cumulative = 0;
    for (const e of entries) {
      cumulative += e.netPnL;
      if (cumulative > peak) peak = cumulative;
      const dd = peak - cumulative;
      if (dd > maxDd) maxDd = dd;
    }

    return {
      genuineTradingDays,
      activeDays,
      noTradeDays,
      positiveDays,
      negativeDays,
      zeroDays,
      averageNetPnL,
      medianNetPnL,
      bestDay,
      worstDay,
      dailyStandardDeviation,
      dailyMaxDrawdown: Number(maxDd.toFixed(2)),
      target1000Analysis: {
        daysAtOrAbove1000,
        daysBetween0And999,
        negativeDays,
        noTradeDays,
        percentageOfActiveDaysAtOrAbove1000,
      },
    };
  }

  /**
   * Clears ledger for test resets.
   */
  public clearLedger(): void {
    this.ledgerEntries.clear();
  }
}

export const genuineDailyLedger = new GenuineDailyLedger();
