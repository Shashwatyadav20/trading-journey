import { AutoHedgeSignal, CandidateSpread, RegimeType, RejectionCategory, NoTradeReasonStat } from "../types";

export interface SignalAuditEntry {
  id: string;
  timestamp: string;
  spotPrice: number;
  regime: RegimeType;
  support?: number;
  resistance?: number;
  swingHigh?: number;
  swingLow?: number;
  structure?: string;
  trend1H: string;
  trend15M: string;
  vwap: number;
  rsi?: number;
  iv?: number;
  delta?: number;
  gamma?: number;
  volatility?: string;
  srDistance?: number;
  atr: number;
  score: number;
  strategyCandidate?: string;
  status: "READY" | "WAIT" | "NO_TRADE" | "BLOCKED";
  reasons: string[];
  rejectionCategories: RejectionCategory[];
  selectedSpread: CandidateSpread | null;
  entryCredit: number;
  stopLossSpread: number;
  targetSpread: number;
  quantityLots: number;
  expectedNetPnl: number;
  totalCharges: number;
  isRealData: boolean;
}

export const ALL_REJECTION_CATEGORIES: RejectionCategory[] = [
  "DATA_INVALID",
  "DATA_STALE",
  "TREND_CONFLICT",
  "NO_CLEAR_STRUCTURE",
  "VWAP_INVALID",
  "RSI_FAILED",
  "DELTA_FAILED",
  "GAMMA_FAILED",
  "S/R_DISTANCE_FAILED",
  "MAX_LOSS_EXCEEDED",
  "VOLATILITY_FAILED",
  "EVENT_RISK",
  "DAILY_PROFIT_LOCK",
  "DAILY_LOSS_LOCK",
  "MAX_TRADES",
  "CONSECUTIVE_LOSS_LOCK",
  "NO_VALID_OPTION",
];

export class SignalAuditStore {
  private auditLogs: SignalAuditEntry[] = [];
  private maxLogs = 500;

  private mapReasonsToCategories(reasons: string[]): RejectionCategory[] {
    const categories: RejectionCategory[] = [];
    const text = reasons.join(" ").toUpperCase();

    if (text.includes("INVALID_DATA") || text.includes("DATA_UNAVAILABLE")) categories.push("DATA_INVALID");
    if (text.includes("STALE") || text.includes("EXPIRED_DATA")) categories.push("DATA_STALE");
    if (text.includes("TREND_CONFLICT") || text.includes("TREND_MISALIGNMENT")) categories.push("TREND_CONFLICT");
    if (text.includes("UNCLEAR_STRUCTURE") || text.includes("NO_CLEAR_STRUCTURE")) categories.push("NO_CLEAR_STRUCTURE");
    if (text.includes("VWAP")) categories.push("VWAP_INVALID");
    if (text.includes("RSI")) categories.push("RSI_FAILED");
    if (text.includes("DELTA")) categories.push("DELTA_FAILED");
    if (text.includes("GAMMA")) categories.push("GAMMA_FAILED");
    if (text.includes("S/R_DISTANCE") || text.includes("SUPPORT_DISTANCE")) categories.push("S/R_DISTANCE_FAILED");
    if (text.includes("MAX_LOSS") || text.includes("CAPITAL")) categories.push("MAX_LOSS_EXCEEDED");
    if (text.includes("VOLATILITY")) categories.push("VOLATILITY_FAILED");
    if (text.includes("EVENT_RISK")) categories.push("EVENT_RISK");
    if (text.includes("DAILY_PROFIT_LOCK") || text.includes("PROFIT_TARGET")) categories.push("DAILY_PROFIT_LOCK");
    if (text.includes("DAILY_LOSS") || text.includes("LOSS_LIMIT")) categories.push("DAILY_LOSS_LOCK");
    if (text.includes("MAX_TRADES")) categories.push("MAX_TRADES");
    if (text.includes("CONSECUTIVE_LOSS")) categories.push("CONSECUTIVE_LOSS_LOCK");
    if (text.includes("NO_VALID_OPTION") || text.includes("NO_OPTION_CONTRACT")) categories.push("NO_VALID_OPTION");

    if (categories.length === 0 && reasons.length > 0) {
      categories.push("DATA_INVALID");
    }

    return categories;
  }

  public recordSignal(signal: AutoHedgeSignal, isRealData = false): SignalAuditEntry {
    const regime = signal.regime_details;
    const categories = this.mapReasonsToCategories(signal.reasons);

    const entry: SignalAuditEntry = {
      id: `sig_audit_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      timestamp: signal.timestamp,
      spotPrice: signal.spotPrice,
      regime: signal.regime,
      trend1H: regime?.trend1H ?? "UNKNOWN",
      trend15M: regime?.trend15M ?? "UNKNOWN",
      vwap: regime?.vwap ?? signal.spotPrice,
      atr: regime?.atr ?? 0,
      score: signal.score,
      strategyCandidate: signal.action,
      status: signal.status as "READY" | "WAIT" | "NO_TRADE" | "BLOCKED",
      reasons: [...signal.reasons],
      rejectionCategories: categories,
      selectedSpread: signal.candidateSpread ?? null,
      entryCredit: signal.netCredit,
      stopLossSpread: signal.stopLossSpread,
      targetSpread: signal.targetSpread,
      quantityLots: signal.quantityLots,
      expectedNetPnl: signal.expectedNetPnl,
      totalCharges: signal.charges?.totalCharges ?? 0,
      isRealData,
    };

    this.auditLogs.unshift(entry);
    if (this.auditLogs.length > this.maxLogs) {
      this.auditLogs = this.auditLogs.slice(0, this.maxLogs);
    }

    return entry;
  }

  public getNoTradeAuditSummary(): NoTradeReasonStat[] {
    const counts: Record<RejectionCategory, number> = {} as any;
    const firstSeen: Record<RejectionCategory, string | null> = {} as any;
    const lastSeen: Record<RejectionCategory, string | null> = {} as any;

    for (const cat of ALL_REJECTION_CATEGORIES) {
      counts[cat] = 0;
      firstSeen[cat] = null;
      lastSeen[cat] = null;
    }

    let totalNoTradeEvaluations = 0;

    for (const log of this.auditLogs) {
      if (log.status === "NO_TRADE" || log.status === "BLOCKED" || log.status === "WAIT") {
        totalNoTradeEvaluations++;
        for (const cat of log.rejectionCategories) {
          counts[cat] = (counts[cat] || 0) + 1;
          if (!firstSeen[cat] || new Date(log.timestamp) < new Date(firstSeen[cat]!)) {
            firstSeen[cat] = log.timestamp;
          }
          if (!lastSeen[cat] || new Date(log.timestamp) > new Date(lastSeen[cat]!)) {
            lastSeen[cat] = log.timestamp;
          }
        }
      }
    }

    return ALL_REJECTION_CATEGORIES.map((cat) => {
      const count = counts[cat] || 0;
      const percentage = totalNoTradeEvaluations > 0 ? Number(((count / totalNoTradeEvaluations) * 100).toFixed(1)) : 0;
      return {
        reason: cat,
        count,
        percentage,
        firstOccurrence: firstSeen[cat],
        lastOccurrence: lastSeen[cat],
      };
    });
  }

  public getRecentLogs(limit = 50): SignalAuditEntry[] {
    return this.auditLogs.slice(0, limit);
  }

  public clearLogs() {
    this.auditLogs = [];
  }
}

export const signalAuditStore = new SignalAuditStore();

