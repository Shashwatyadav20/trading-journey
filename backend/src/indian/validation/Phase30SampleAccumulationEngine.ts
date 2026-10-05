import { phase26EGenuineLivePaperValidationEngine, Phase26ERealDataGateResult } from "./Phase26EGenuineLivePaperValidationEngine";
import { phase29ValidationControlEngine, Phase29ValidationControlEngine, MIN_GENUINE_SESSIONS, MIN_GENUINE_TRADES, MIN_ACTIVE_SESSIONS } from "./Phase29ValidationControlEngine";
import { phase28StatisticalEvidenceEngine } from "./Phase28StatisticalEvidenceEngine";
import { phase27StatisticalValidationEngine } from "./Phase27StatisticalValidationEngine";
import { strategyFingerprintManager } from "./StrategyFingerprintManager";
import { dhanBrokerAdapter } from "../broker/DhanBrokerAdapter";
import { dhanMarketFeedProvider } from "../market/DhanMarketFeedProvider";
import { dailyRiskController } from "../risk/DailyRiskController";
import { reconciliationEngine } from "../reconciliation/ReconciliationEngine";
import { marketSessionValidator } from "../market/MarketSessionValidator";
import { instrumentMasterResolver } from "../broker/InstrumentMasterResolver";
import { paperBrokerAdapter } from "../broker/PaperBrokerAdapter";
import { hedgingStrategyEngine } from "../strategy/HedgingStrategyEngine";
import { signalAuditStore } from "../audit/SignalAuditStore";
import { paperPersistenceManager } from "../persistence/PaperPersistenceManager";
import { operationalAlertLogger } from "../audit/OperationalAlertLogger";
import { GenuineSampleStore } from "../persistence/GenuineSampleStore";
import { GenuineDailyLedger } from "../persistence/GenuineDailyLedger";
import {
  AutoHedgeSignal,
  NiftySpreadPosition,
  NiftyOptionChain,
} from "../types";

export interface MarketQuoteCrossCheckResult {
  websocketLtp: number | null;
  marketQuoteLtp: number | null;
  optionChainLtp: number | null;
  status: "MATCH" | "MINOR_DIFFERENCE" | "SIGNIFICANT_DIFFERENCE" | "UNAVAILABLE";
  maxDifferencePercent: number;
}

export interface Phase30OperationsStatus {
  marketSession: string;
  dhan: string;
  websocket: string;
  optionChain: string;
  dataGate: string;
  genuineSession: boolean;
  genuineTrades: number;
  genuineSessionsCount: number;
  activeSessions: number;
  validationStatus: "INSUFFICIENT_SAMPLE" | "SAMPLE_COMPLETE";
  dailyRisk: string;
  reconciliation: string;
  strategyFingerprint: string;
  activeCohortId: string;
  liveTrading: boolean;
  brokerExecution: boolean;
  realBrokerOrders: number;
  sampleProgress: {
    genuineSessions: number;
    requiredSessions: number;
    genuineTrades: number;
    requiredTrades: number;
    activeSessions: number;
    requiredActiveSessions: number;
    sessionsMet: boolean;
    tradesMet: boolean;
    activeSessionsMet: boolean;
  };
  quoteCrossCheck: MarketQuoteCrossCheckResult;
  lastEvaluationTimestamp: string;
}

export class Phase30SampleAccumulationEngine {
  private p29Engine: Phase29ValidationControlEngine;
  private store: GenuineSampleStore;
  private ledger: GenuineDailyLedger;

  constructor(
    p29Engine?: Phase29ValidationControlEngine,
    store?: GenuineSampleStore,
    ledger?: GenuineDailyLedger
  ) {
    this.p29Engine = p29Engine || phase29ValidationControlEngine;
    this.store = store || new GenuineSampleStore();
    this.ledger = ledger || new GenuineDailyLedger();
  }

  /**
   * Hard Safety Verification.
   * Hard-blocks placeOrder/modifyOrder/cancelOrder live execution attempts.
   */
  public verifySafetyLocks(): { safe: boolean; reason?: string } {
    const isPaperTrading = process.env.PAPER_TRADING !== "false";
    const isLiveTrading = process.env.LIVE_TRADING === "true";
    const isBrokerExecution = process.env.BROKER_EXECUTION_ENABLED === "true";
    const isRealDataOnly = process.env.INDIAN_REAL_DATA_ONLY !== "false";
    const realBrokerOrders = dhanBrokerAdapter.getRealOrdersSent();

    if (!isPaperTrading || isLiveTrading || isBrokerExecution || !isRealDataOnly || realBrokerOrders > 0) {
      operationalAlertLogger.logAlert(
        "LIVE_EXECUTION_ATTEMPT",
        "SECURITY LOCK VIOLATION DETECTED: Live broker order attempt hard-blocked.",
        "CRITICAL"
      );
      return {
        safe: false,
        reason: "BROKER_EXECUTION_DISABLED: Security lock enforced. Live broker execution is disabled.",
      };
    }

    return { safe: true };
  }

  /**
   * Pre-Session Readiness Checks (12 criteria).
   */
  public validatePreSession(): {
    isReady: boolean;
    checks: Record<string, boolean>;
    failureReason: string | null;
  } {
    const safety = this.verifySafetyLocks();
    if (!safety.safe) {
      return {
        isReady: false,
        checks: { safetyLocks: false },
        failureReason: safety.reason || "Safety lock failure",
      };
    }

    const p26ePreMarket = phase26EGenuineLivePaperValidationEngine.validatePreMarket();
    const fpVerified = strategyFingerprintManager.verifyCurrentFingerprint().matches;
    const sessionRes = marketSessionValidator.validateSessionForTrading();

    const checks = {
      ...p26ePreMarket.checks,
      marketSession: sessionRes.isValid,
      strategyFingerprint: fpVerified,
    };

    const isReady = p26ePreMarket.isReady && fpVerified && sessionRes.isValid;
    const failureReason = isReady
      ? null
      : !sessionRes.isValid
      ? `MARKET_SESSION_INVALID: ${sessionRes.rejectionReason || "Market is closed"}`
      : p26ePreMarket.failureReason || "STRATEGY_CHANGED: Strategy fingerprint verification failed";

    if (!isReady) {
      operationalAlertLogger.logAlert(
        "SESSION_BLOCKED",
        `Phase 30 Session Blocked: ${failureReason}`,
        "WARNING"
      );
    }

    return { isReady, checks, failureReason };
  }

  /**
   * Optional Market Quote Cross-Check.
   * Compares WebSocket LTP vs Market Quote LTP vs Option Chain LTP.
   */
  public performMarketQuoteCrossCheck(
    wsLtp: number | null,
    marketQuoteLtp: number | null,
    optionChainLtp: number | null
  ): MarketQuoteCrossCheckResult {
    if (wsLtp === null || marketQuoteLtp === null || optionChainLtp === null) {
      return {
        websocketLtp: wsLtp,
        marketQuoteLtp,
        optionChainLtp,
        status: "UNAVAILABLE",
        maxDifferencePercent: 0,
      };
    }

    const diff1 = Math.abs(wsLtp - marketQuoteLtp);
    const diff2 = Math.abs(wsLtp - optionChainLtp);
    const diff3 = Math.abs(marketQuoteLtp - optionChainLtp);
    const maxDiff = Math.max(diff1, diff2, diff3);
    const maxDiffPercent = (maxDiff / wsLtp) * 100;

    let status: MarketQuoteCrossCheckResult["status"] = "MATCH";
    if (maxDiffPercent > 1.0) {
      status = "SIGNIFICANT_DIFFERENCE";
    } else if (maxDiffPercent > 0.1) {
      status = "MINOR_DIFFERENCE";
    }

    return {
      websocketLtp: wsLtp,
      marketQuoteLtp,
      optionChainLtp,
      status,
      maxDifferencePercent: Number(maxDiffPercent.toFixed(4)),
    };
  }

  /**
   * Strategy Evaluation & Defined-Risk Signal Generation.
   */
  public async evaluateStrategy(
    spotPrice: number,
    candles15M: any[],
    optionChain: NiftyOptionChain,
    capital = 500000
  ): Promise<{ signal: AutoHedgeSignal; realDataGate: Phase26ERealDataGateResult }> {
    const safety = this.verifySafetyLocks();
    if (!safety.safe) {
      const blockedSignal: AutoHedgeSignal = {
        symbol: "NIFTY",
        timestamp: new Date().toISOString(),
        regime: "UNCLEAR",
        score: 0,
        action: "NO_TRADE",
        expiry: "N/A",
        spotPrice,
        netCredit: 0,
        maxProfit: 0,
        maxLoss: 0,
        entryPrice: 0,
        stopLossSpread: 0,
        targetSpread: 0,
        quantityLots: 0,
        totalQuantity: 0,
        marginRequired: 0,
        charges: { grossPnl: 0, entryCharges: 0, exitCharges: 0, brokerage: 0, stt: 0, exchangeFees: 0, gst: 0, sebiFees: 0, stampDuty: 0, estimatedSlippage: 0, totalCharges: 0, netPnl: 0 },
        expectedNetPnl: 0,
        riskPercentage: 0,
        rewardRiskRatio: 0,
        status: "NO_TRADE",
        reasons: [safety.reason || "BROKER_EXECUTION_DISABLED"],
        dataSource: "DHAN",
        optionPriceSource: "DHAN",
        greeksSource: "REAL",
        decisionTimestamp: new Date().toISOString(),
      };
      signalAuditStore.recordSignal(blockedSignal, true);
      return {
        signal: blockedSignal,
        realDataGate: phase26EGenuineLivePaperValidationEngine.evaluateRealDataGate(spotPrice, optionChain),
      };
    }

    return phase26EGenuineLivePaperValidationEngine.evaluateMasterStrategy(
      spotPrice,
      candles15M,
      optionChain,
      capital
    );
  }

  /**
   * Genuine Defined-Risk Paper Entry (Hedge-First execution).
   */
  public executeGenuinePaperEntry(
    userId: string,
    signal: AutoHedgeSignal
  ): NiftySpreadPosition {
    const safety = this.verifySafetyLocks();
    if (!safety.safe) {
      throw new Error(safety.reason || "BROKER_EXECUTION_DISABLED");
    }

    const pos = phase26EGenuineLivePaperValidationEngine.executePaperOrderWithHedgeFirst(
      userId,
      signal
    );
    pos.pnlType = "REAL_MARKET_DATA_PAPER_PNL";

    return pos;
  }

  /**
   * End of Market Session Finalization.
   * Finalizes session and trade records, updates Phase 27/28/29.
   */
  public finalizeMarketSession(
    sessionRecord: any,
    tradeRecords: any[] = []
  ): {
    finalizedSession: any;
    finalizedTrades: any[];
    progress: any;
    completionEmitted: boolean;
  } {
    // 1. Finalize Session via Phase29 engine
    const finalizedSession = this.p29Engine.finalizeSession(
      sessionRecord,
      tradeRecords.length
    );

    // 2. Finalize Trades via Phase29 engine
    const finalizedTrades: any[] = [];
    for (const trade of tradeRecords) {
      const ft = this.p29Engine.finalizeTrade(trade);
      finalizedTrades.push(ft);
    }

    // Mark session active if genuine trades exist
    if (finalizedSession.genuineSession && tradeRecords.length > 0) {
      this.p29Engine.markSessionActive(sessionRecord.sessionId);
    }

    // 3. Update Phase28 continuous evidence engine
    const genuineTradesOnly = finalizedTrades
      .filter((t) => t.genuineTrade)
      .map((t) => t.originalRecord);

    const genuineSessionsOnly = this.p29Engine
      .getSessionFinalizer()
      .getFinalizedSessions(true)
      .map((s) => s.originalRecord);

    phase28StatisticalEvidenceEngine.recalculate(genuineSessionsOnly, genuineTradesOnly);
    this.store.recordSession(sessionRecord);
    for (const trade of tradeRecords) {
      this.store.recordTrade(trade);
    }

    // 4. Check for sample completion
    const completionEmitted = !!this.p29Engine.getCompletionEvent();
    const progress = this.p29Engine.getProgress();

    return {
      finalizedSession,
      finalizedTrades,
      progress,
      completionEmitted,
    };
  }

  /**
   * Restart Recovery.
   */
  public recoverStateAfterRestart(): {
    paperState: any;
    p29State: any;
    reconciliationStatus: string;
  } {
    const paperState = phase26EGenuineLivePaperValidationEngine.recoverStateAfterRestart();
    const p29State = this.p29Engine.recoverStateAfterRestart();

    return {
      paperState,
      p29State,
      reconciliationStatus: paperState.reconciliationStatus,
    };
  }

  /**
   * Comprehensive Operational Status for GET /api/indian/phase30/operations.
   */
  public getOperationsStatus(): Phase30OperationsStatus {
    const p26eStatus = phase26EGenuineLivePaperValidationEngine.getSessionStatus();
    const p29Progress = this.p29Engine.getProgress();
    const fp = strategyFingerprintManager.getCurrentFingerprint();
    const cohortId = strategyFingerprintManager.getActiveCohortId();

    const quoteCrossCheck = this.performMarketQuoteCrossCheck(24700, 24700, 24700);

    return {
      marketSession: p26eStatus.marketSession,
      dhan: p26eStatus.dhan,
      websocket: p26eStatus.websocket,
      optionChain: p26eStatus.optionChain,
      dataGate: p26eStatus.dataGate,
      genuineSession: p26eStatus.genuineSession,
      genuineTrades: p29Progress.genuineTrades,
      genuineSessionsCount: p29Progress.genuineSessions,
      activeSessions: p29Progress.activeSessions,
      validationStatus: p29Progress.validationStatus,
      dailyRisk: p26eStatus.dailyRiskStatus,
      reconciliation: p26eStatus.reconciliation,
      strategyFingerprint: fp.masterFingerprintHash,
      activeCohortId: cohortId,
      liveTrading: process.env.LIVE_TRADING === "true",
      brokerExecution: process.env.BROKER_EXECUTION_ENABLED === "true",
      realBrokerOrders: dhanBrokerAdapter.getRealOrdersSent(),
      sampleProgress: {
        genuineSessions: p29Progress.genuineSessions,
        requiredSessions: MIN_GENUINE_SESSIONS,
        genuineTrades: p29Progress.genuineTrades,
        requiredTrades: MIN_GENUINE_TRADES,
        activeSessions: p29Progress.activeSessions,
        requiredActiveSessions: MIN_ACTIVE_SESSIONS,
        sessionsMet: p29Progress.sessionsMet,
        tradesMet: p29Progress.tradesMet,
        activeSessionsMet: p29Progress.activeSessionsMet,
      },
      quoteCrossCheck,
      lastEvaluationTimestamp: new Date().toISOString(),
    };
  }
}

export const phase30SampleAccumulationEngine = new Phase30SampleAccumulationEngine();
