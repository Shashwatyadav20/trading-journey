import { AutoHedgeSignal, NiftySpreadPosition } from "../types";

export interface PaperJournalEntry {
  id: string;
  timestamp: string;
  signalId?: string;
  positionId?: string;
  eventType: "SIGNAL_GENERATED" | "ORDER_EXECUTED" | "POSITION_MONITORED" | "POSITION_CLOSED";
  symbol: string;
  regime: string;
  strategy: string;
  spotPrice: number;
  entryCredit: number;
  exitPrice?: number;
  grossPnl?: number;
  totalCharges?: number;
  netPnl?: number;
  exitReason?: string;
  details: Record<string, any>;
}

export class PaperJournalStore {
  private journalEntries: PaperJournalEntry[] = [];
  private maxEntries = 500;

  public recordSignal(signal: AutoHedgeSignal): PaperJournalEntry {
    const entry: PaperJournalEntry = {
      id: `jnl_sig_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: signal.timestamp,
      eventType: "SIGNAL_GENERATED",
      symbol: signal.symbol,
      regime: signal.regime,
      strategy: signal.action,
      spotPrice: signal.spotPrice,
      entryCredit: signal.netCredit,
      details: {
        score: signal.score,
        status: signal.status,
        reasons: signal.reasons,
        sellLeg: signal.sellLeg,
        buyLeg: signal.buyLeg,
        maxLoss: signal.maxLoss,
        expectedNetPnl: signal.expectedNetPnl,
      },
    };

    this.addEntry(entry);
    return entry;
  }

  public recordOrderExecution(position: NiftySpreadPosition): PaperJournalEntry {
    const entry: PaperJournalEntry = {
      id: `jnl_exec_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: position.entryTime,
      positionId: position.id,
      signalId: position.signalId,
      eventType: "ORDER_EXECUTED",
      symbol: position.symbol,
      regime: "EXECUTED",
      strategy: position.strategy,
      spotPrice: position.spotPriceAtEntry || 0,
      entryCredit: position.netCredit,
      totalCharges: position.totalCharges,
      details: {
        sellLeg: position.sellLeg,
        buyLeg: position.buyLeg,
        quantityLots: position.quantityLots,
        totalQuantity: position.totalQuantity,
        stopLossSpread: position.stopLossSpread,
        targetSpread: position.targetSpread,
      },
    };

    this.addEntry(entry);
    return entry;
  }

  public recordPositionClose(position: NiftySpreadPosition): PaperJournalEntry {
    const entry: PaperJournalEntry = {
      id: `jnl_exit_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: position.exitTime || new Date().toISOString(),
      positionId: position.id,
      signalId: position.signalId,
      eventType: "POSITION_CLOSED",
      symbol: position.symbol,
      regime: "CLOSED",
      strategy: position.strategy,
      spotPrice: position.currentSpotPrice || 0,
      entryCredit: position.netCredit,
      exitPrice: position.currentSpreadPrice,
      grossPnl: position.realizedGrossPnl,
      totalCharges: position.totalCharges,
      netPnl: position.realizedNetPnl,
      exitReason: position.exitReason,
      details: {
        timeInTradeSeconds: position.timeInTradeSeconds,
        exitReason: position.exitReason,
      },
    };

    this.addEntry(entry);
    return entry;
  }

  private addEntry(entry: PaperJournalEntry) {
    this.journalEntries.unshift(entry);
    if (this.journalEntries.length > this.maxEntries) {
      this.journalEntries = this.journalEntries.slice(0, this.maxEntries);
    }
  }

  public getJournalEntries(limit = 100): PaperJournalEntry[] {
    return this.journalEntries.slice(0, limit);
  }

  public clearJournal() {
    this.journalEntries = [];
  }

  public clear() {
    this.clearJournal();
  }

  public logSignal(signal: AutoHedgeSignal): PaperJournalEntry {
    return this.recordSignal(signal);
  }

  public logEntry(position: NiftySpreadPosition): PaperJournalEntry {
    return this.recordOrderExecution(position);
  }

  public logExit(position: NiftySpreadPosition): PaperJournalEntry {
    return this.recordPositionClose(position);
  }
}

export const paperJournalStore = new PaperJournalStore();
