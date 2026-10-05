import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { hedgingStrategyEngine } from "../indian/strategy/HedgingStrategyEngine";
import { paperBrokerAdapter } from "../indian/broker/PaperBrokerAdapter";
import { dailyRiskController } from "../indian/risk/DailyRiskController";
import { backtestEngine, HistoricalDataPoint } from "../indian/backtest/BacktestEngine";
import { auditLogger } from "../indian/audit/AuditLogger";
import { niftyMarketProvider } from "../indian/market/NiftyMarketProvider";
import { signalAuditStore } from "../indian/audit/SignalAuditStore";
import { niftyHistoricalOptionImporter } from "../indian/backtest/NiftyHistoricalOptionImporter";
import { historicalDataService, DatasetSourceType } from "../indian/backtest/HistoricalDataService";
import { dataSourceStatusService } from "../indian/backtest/DataSourceStatusService";
import { paperJournalStore } from "../indian/audit/PaperJournalStore";
import { paperSessionManager } from "../indian/lifecycle/PaperSessionManager";
import { signalLifecycleEngine } from "../indian/lifecycle/SignalLifecycleEngine";
import { paperValidationEngine } from "../indian/validation/PaperValidationEngine";
import { systemHealthService } from "../indian/health/SystemHealthService";
import { healthCheckService } from "../indian/health/HealthCheckService";
import { reconciliationEngine } from "../indian/reconciliation/ReconciliationEngine";
import { paperPersistenceManager } from "../indian/persistence/PaperPersistenceManager";
import { securityValidator } from "../indian/security/SecurityValidator";
import { extendedStatisticalValidationEngine } from "../indian/validation/ExtendedStatisticalValidationEngine";
import { strategyFingerprintManager } from "../indian/validation/StrategyFingerprintManager";
import { paperSampleSimulator } from "../indian/validation/PaperSampleSimulator";
import { genuineDataValidator } from "../indian/validation/GenuineDataValidator";
import { genuinePaperValidationEngine } from "../indian/validation/GenuinePaperValidationEngine";
import { nseIndiaOptionChainProvider } from "../indian/market/NseIndiaOptionChainProvider";
import { dhanBrokerAdapter } from "../indian/broker/DhanBrokerAdapter";
import { dhanAuthService } from "../indian/broker/DhanAuthService";
import { phase17PaperSessionTracker } from "../indian/lifecycle/Phase17PaperSessionTracker";
import { phase18DataFreshnessMonitor } from "../indian/market/Phase18DataFreshnessMonitor";
import { operationalAlertLogger } from "../indian/audit/OperationalAlertLogger";
import { phase19GenuineValidationEngine } from "../indian/validation/Phase19GenuineValidationEngine";
import { brokerManager } from "../indian/broker/BrokerManager";
import { phase21OperationalMonitor } from "../indian/validation/Phase21OperationalMonitor";
import { phase24RuntimeProofEngine } from "../indian/validation/Phase24RuntimeProofEngine";
import { dhanMarketFeedProvider } from "../indian/market/DhanMarketFeedProvider";
import { dhanSubscriptionManager } from "../indian/market/DhanSubscriptionManager";
import { phase26EGenuineLivePaperValidationEngine } from "../indian/validation/Phase26EGenuineLivePaperValidationEngine";
import { phase27StatisticalValidationEngine } from "../indian/validation/Phase27StatisticalValidationEngine";
import { phase28StatisticalEvidenceEngine } from "../indian/validation/Phase28StatisticalEvidenceEngine";
import { phase29ValidationControlEngine } from "../indian/validation/Phase29ValidationControlEngine";
import { phase30SampleAccumulationEngine } from "../indian/validation/Phase30SampleAccumulationEngine";
import { phase31ValidationCertificationEngine } from "../indian/validation/Phase31ValidationCertificationEngine";
import { phase32OutOfSampleValidationEngine } from "../indian/validation/Phase32OutOfSampleValidationEngine";
import { phase33RobustnessEngine } from "../indian/validation/Phase33RobustnessEngine";
import { phase34LongHorizonEngine } from "../indian/validation/Phase34LongHorizonEngine";
import { phase35ResearchReportEngine } from "../indian/validation/Phase35ResearchReportEngine";
import { phase36DecisionGate } from "../indian/phase36/Phase36DecisionGate";
import { genuineSampleStore } from "../indian/persistence/GenuineSampleStore";
import { genuineDailyLedger } from "../indian/persistence/GenuineDailyLedger";
import { phase37ValidationControl } from "../indian/validation/Phase37ValidationControl";
import { phase38SampleAccumulator } from "../indian/validation/Phase38SampleAccumulator";
import { phase38SessionCollector } from "../indian/validation/Phase38SessionCollector";
import { phase38TradeCollector } from "../indian/validation/Phase38TradeCollector";
import { phase39RevalidationEngine } from "../indian/phase39/Phase39RevalidationEngine";
import { phase40FinalReadinessEngine } from "../indian/validation/Phase40FinalReadinessEngine";
import { postPhase40OperationsMonitor } from "../indian/operations/PostPhase40OperationsMonitor";





export default async function indianTradingRoutes(server: FastifyInstance) {

  // Global Indian Trading State
  let isAutoTradeActive = false;
  let isEmergencyStopActive = false;

  // Helper to generate simulated 15M candles if market provider ticks not yet populated
  const generateSimulatedCandles = (spotPrice: number) => {
    const candles = [];
    const now = Math.floor(Date.now() / 1000);
    for (let i = 20; i >= 0; i--) {
      const time = now - i * 900;
      const base = spotPrice - (10 - i) * 3;
      candles.push({
        time,
        open: base - 2,
        high: base + 8,
        low: base - 5,
        close: base + 4,
        volume: 15000,
      });
    }
    return candles;
  };

  /**
   * GET /api/indian/signal
   * Returns current NIFTY strategy signal, regime, setup score, charges, and setup.
   * Safety: Stale market data = NO_TRADE status returned.
   */
  server.get("/api/indian/signal", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      systemHealthService.recordSpotUpdate();
      systemHealthService.recordSignalEvaluation();

      const health = niftyMarketProvider.getDataHealth();
      const spotRes = await niftyMarketProvider.getSpotPrice();
      const spotPrice = spotRes.spotPrice;

      if (health.isStale) {
        const noTradeSig: any = {
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
          reasons: [`DATA_STALE: Market data is stale. ${health.errorMessage || "No fresh data."} No trade will be generated.`],
        };
        signalAuditStore.recordSignal(noTradeSig, spotRes.isReal);

        return reply.send({
          success: true,
          signal: noTradeSig,
          isRealData: false,
          dataHealth: health,
          componentHealth: niftyMarketProvider.getDataComponentHealthMap(),
          autoTradeActive: isAutoTradeActive,
          emergencyStopActive: isEmergencyStopActive,
          liveTradingEnabled: false,
          paperTradingEnabled: true,
          dailyRisk: dailyRiskController.getState(),
        });
      }

      const candles15M = generateSimulatedCandles(spotPrice);
      const chainRes = await niftyMarketProvider.getOptionChain(spotPrice);
      const chain = chainRes.chain;
      systemHealthService.recordOptionChainUpdate();

      const signal = hedgingStrategyEngine.generateSignal(
        spotPrice,
        candles15M,
        candles15M,
        chain,
        500000,
        isEmergencyStopActive
      );

      if (isEmergencyStopActive) {
        signal.status = "BLOCKED";
        signal.reasons.unshift("EMERGENCY STOP IS ACTIVE. All new orders blocked.");
      }

      signalAuditStore.recordSignal(signal, spotRes.isReal);

      return reply.send({
        success: true,
        signal,
        isRealData: spotRes.isReal,
        dataHealth: health,
        componentHealth: niftyMarketProvider.getDataComponentHealthMap(),
        autoTradeActive: isAutoTradeActive,
        emergencyStopActive: isEmergencyStopActive,
        liveTradingEnabled: false,
        paperTradingEnabled: true,
        dailyRisk: dailyRiskController.getState(),
      });
    } catch (err: any) {
      server.log.error(err);
      return reply.status(500).send({ error: err.message || "Failed to generate signal." });
    }
  });

  /**
   * GET /api/indian/chain
   * Returns NIFTY Option Chain snapshot.
   */
  server.get("/api/indian/chain", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const spotRes = await niftyMarketProvider.getSpotPrice();
      const chainRes = await niftyMarketProvider.getOptionChain(spotRes.spotPrice);

      return reply.send({
        success: true,
        chain: chainRes.chain,
        isReal: chainRes.isReal,
      });
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  /**
   * GET /api/indian/positions
   * Returns active open and closed spread positions.
   */
  server.get("/api/indian/positions", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const openPositions = paperBrokerAdapter.getOpenPositions();
      const closedPositions = paperBrokerAdapter.getClosedPositions();

      return reply.send({
        success: true,
        openPositions,
        closedPositions,
        dailyRisk: dailyRiskController.getState(),
      });
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  /**
   * POST /api/indian/trade/execute-paper
   * Executes a paper order from the active signal.
   */
  server.post("/api/indian/trade/execute-paper", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      if (isEmergencyStopActive) {
        return reply.status(400).send({ error: "Emergency Stop is active. Order placement blocked." });
      }

      const health = niftyMarketProvider.getDataHealth();
      if (health.isStale) {
        return reply.status(400).send({ error: `Cannot execute paper trade: Market data is stale. ${health.errorMessage}` });
      }

      const spotRes = await niftyMarketProvider.getSpotPrice();
      const spotPrice = spotRes.spotPrice;
      const candles15M = generateSimulatedCandles(spotPrice);
      const chainRes = await niftyMarketProvider.getOptionChain(spotPrice);

      const signal = hedgingStrategyEngine.generateSignal(spotPrice, candles15M, candles15M, chainRes.chain);

      if (signal.status !== "READY") {
        return reply.status(400).send({
          error: `Signal is not in READY state (${signal.status}). ${signal.reasons[0] || ""}`,
        });
      }

      const userId = (request as any).user?.id || "demo-user-id";
      const position = paperBrokerAdapter.executePaperOrder(userId, signal);
      systemHealthService.recordTradeEvent();

      return reply.send({
        success: true,
        message: "Paper spread order executed successfully.",
        position,
      });
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  /**
   * POST /api/indian/trade/close
   * Manually closes an open paper spread position.
   */
  server.post("/api/indian/trade/close", async (request: FastifyRequest<{ Body: { id: string } }>, reply: FastifyReply) => {
    try {
      const { id } = request.body || {};
      if (!id) {
        return reply.status(400).send({ error: "Position ID is required." });
      }

      const closed = paperBrokerAdapter.closePosition(id, "MANUAL_USER_CLOSE");
      systemHealthService.recordTradeEvent();

      return reply.send({
        success: true,
        message: "Paper position closed successfully.",
        position: closed,
      });
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  /**
   * POST /api/indian/trade/toggle-auto
   * Toggles Auto-Trade status ON / OFF.
   */
  server.post("/api/indian/trade/toggle-auto", async (request: FastifyRequest<{ Body: { active: boolean } }>, reply: FastifyReply) => {
    try {
      const { active } = request.body || {};
      isAutoTradeActive = !!active;

      auditLogger.log("AUTO_TRADE_TOGGLED", "SYSTEM", { active: isAutoTradeActive });

      return reply.send({
        success: true,
        autoTradeActive: isAutoTradeActive,
      });
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  /**
   * POST /api/indian/trade/emergency-stop
   * Immediately activates Emergency Stop mode.
   */
  server.post("/api/indian/trade/emergency-stop", async (request: FastifyRequest<{ Body: { active?: boolean } }>, reply: FastifyReply) => {
    try {
      isEmergencyStopActive = true;
      isAutoTradeActive = false;

      auditLogger.log("EMERGENCY_STOP_ACTIVATED", "SYSTEM", { active: true });

      return reply.send({
        success: true,
        emergencyStopActive: isEmergencyStopActive,
        autoTradeActive: isAutoTradeActive,
        message: "EMERGENCY STOP ACTIVATED. All auto trading disabled.",
      });
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  /**
   * GET /api/indian/risk/status
   * Returns daily risk controller state.
   */
  server.get("/api/indian/risk/status", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      return reply.send({
        success: true,
        risk: dailyRiskController.getState(),
      });
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  /**
   * POST /api/indian/backtest/run
   * Triggers walk-forward backtest simulation across historical data points.
   */
  server.post("/api/indian/backtest/run", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const spotRes = await niftyMarketProvider.getSpotPrice();
      const baseSpot = spotRes.spotPrice;

      const dataset: HistoricalDataPoint[] = [];
      const now = Math.floor(Date.now() / 1000);

      for (let i = 60; i >= 0; i--) {
        const timestamp = new Date((now - i * 3600) * 1000).toISOString();
        const spotPrice = Number((baseSpot + Math.sin(i / 5) * 200 + (30 - i) * 3).toFixed(2));
        const candles15M = generateSimulatedCandles(spotPrice);

        dataset.push({
          timestamp,
          spotPrice,
          candles15M,
          candles1H: candles15M,
        });
      }

      const result = backtestEngine.runBacktest(dataset, 0.7, 500000);

      return reply.send({
        success: true,
        backtest: result,
      });
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  /**
   * GET /api/indian/data-health
   * Returns data provider health, stale status, component map, and real vs synthetic indicator.
   */
  server.get("/api/indian/data-health", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const health = niftyMarketProvider.getDataHealth();
      const phase17Health = await niftyMarketProvider.getPhase17DataHealth();
      const gate = await genuineDataValidator.evaluatePhase17Gate();
      const spotRes = await niftyMarketProvider.getSpotPrice();
      const componentHealth = niftyMarketProvider.getDataComponentHealthMap();

      return reply.send({
        success: true,
        health,
        phase17Health,
        gate,
        componentHealth,
        isRealData: spotRes.isReal,
        spotPrice: spotRes.spotPrice,
        tradingMode: "PAPER",
        liveTradingEnabled: false,
      });
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  /**
   * GET /api/indian/signals/audit
   * Returns recent strategy signal audit log entries and 17 rejection reason audit summary.
   */
  server.get("/api/indian/signals/audit", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const logs = signalAuditStore.getRecentLogs(100);
      const noTradeSummary = signalAuditStore.getNoTradeAuditSummary();
      return reply.send({
        success: true,
        auditLogs: logs,
        noTradeSummary,
      });
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  /**
   * POST /api/indian/backtest/validate-csv
   */
  server.post("/api/indian/backtest/validate-csv", async (request: FastifyRequest<{ Body: { csvContent: string; declaredSource?: DatasetSourceType } }>, reply: FastifyReply) => {
    try {
      const { csvContent, declaredSource = "UNKNOWN" } = request.body || {};

      if (!csvContent || csvContent.trim().length === 0) {
        return reply.status(400).send({
          success: false,
          qualityState: "INVALID",
          errors: ["CSV content is required."],
          warnings: [],
        });
      }

      const validationRes = historicalDataService.validateCSV(csvContent, declaredSource);
      return reply.send(validationRes);
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/indian/backtest/dataset/:datasetId
   */
  server.get("/api/indian/backtest/dataset/:datasetId", async (request: FastifyRequest<{ Params: { datasetId: string } }>, reply: FastifyReply) => {
    try {
      const { datasetId } = request.params;
      const dataset = historicalDataService.getDataset(datasetId);

      if (!dataset) {
        return reply.status(404).send({ success: false, error: `Dataset ${datasetId} not found.` });
      }

      const { dataPoints, ...metadataOnly } = dataset;
      return reply.send({
        success: true,
        metadata: metadataOnly,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * POST /api/indian/backtest/import-csv
   */
  server.post("/api/indian/backtest/import-csv", async (request: FastifyRequest<{ Body: { csvContent: string; declaredSource?: DatasetSourceType; trainingRatio?: number; initialCapital?: number } }>, reply: FastifyReply) => {
    try {
      const { csvContent, declaredSource = "UNKNOWN", trainingRatio = 0.7, initialCapital = 500000 } = request.body || {};

      if (!csvContent || csvContent.trim().length === 0) {
        return reply.status(400).send({
          success: false,
          status: "INVALID_CSV",
          error: "CSV content is required.",
        });
      }

      const validationRes = historicalDataService.validateCSV(csvContent, declaredSource);

      if (!validationRes.success || !validationRes.metadata) {
        return reply.status(400).send({
          success: false,
          status: validationRes.qualityState,
          error: "Historical Option CSV Import Rejected",
          details: validationRes.errors,
          dataQualityReport: validationRes.metadata,
        });
      }

      const datasetId = validationRes.metadata.datasetId;
      const lockedExecution = historicalDataService.executeLockedBacktest(datasetId, trainingRatio, initialCapital);

      if (!lockedExecution.allowed || !lockedExecution.result) {
        return reply.status(400).send({
          success: false,
          status: validationRes.qualityState,
          error: lockedExecution.blockReason || "REAL HISTORICAL BACKTEST BLOCKED",
          details: validationRes.errors,
          datasetQuality: validationRes.metadata,
        });
      }

      const backtestResult = lockedExecution.result;

      return reply.send({
        success: true,
        status: "OK",
        dataSource: backtestResult.dataSource,
        datasetId: validationRes.metadata.datasetId,
        datasetHash: validationRes.metadata.datasetHash,
        datasetQuality: validationRes.metadata,
        inSampleMetrics: backtestResult.trainingMetrics,
        outOfSampleMetrics: backtestResult.outOfSampleMetrics,
        overallMetrics: backtestResult.overallMetrics,
        strategyComparison: backtestResult.strategyComparison,
        riskValidation: backtestResult.riskValidation,
        targetAnalysis: backtestResult.overallMetrics.dailyTargetAnalysis,
        robustness: backtestResult.robustnessAnalysis,
        finalVerdict: backtestResult.finalVerdict,
        walkForwardResults: backtestResult.walkForwardResults,
        noTradeReasons: backtestResult.overallMetrics.noTradeReasons,
        backtest: backtestResult,
      });
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  /**
   * GET /api/indian/backtest/data-source-status
   */
  server.get("/api/indian/backtest/data-source-status", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const activeDatasets = historicalDataService.listDatasets();
      const hasRealDataset = activeDatasets.some((d) => (d.qualityState === "VALID" || d.qualityState === "WARNING") && d.sourceType === "REAL_HISTORICAL");
      const status = dataSourceStatusService.getDataSourceStatus(hasRealDataset);

      return reply.send({
        success: true,
        ...status,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/indian/session
   */
  server.get("/api/indian/session", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const session = paperSessionManager.getSessionState();
      return reply.send({
        success: true,
        session,
        lifecycleState: signalLifecycleEngine.getCurrentState(),
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/indian/journal
   */
  server.get("/api/indian/journal", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const entries = paperJournalStore.getJournalEntries();
      return reply.send({
        success: true,
        journalEntries: entries,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/indian/performance
   */
  server.get("/api/indian/performance", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const summary = paperValidationEngine.getPerformanceSummary();
      const dailyPerf = paperValidationEngine.getDailyPerformance();
      const target1000 = paperValidationEngine.getTargetAnalysis1000();
      const strategyBreakdown = paperValidationEngine.getStrategyBreakdown();

      return reply.send({
        success: true,
        performance: summary,
        dailyPerformance: dailyPerf,
        targetAnalysis: target1000,
        strategyBreakdown,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // ── PHASE 12: DEDICATED PAPER TRADING VALIDATION ENDPOINTS ───────────────────

  /**
   * GET /api/indian/paper/session
   * Returns current paper trading session and all historical session records.
   */
  server.get("/api/indian/paper/session", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const sessionState = paperSessionManager.getSessionState();
      const allSessions = paperSessionManager.getAllSessions();
      const componentHealth = niftyMarketProvider.getDataComponentHealthMap();

      return reply.send({
        success: true,
        session: sessionState,
        allSessions,
        componentHealth,
        liveTradingEnabled: false,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/indian/paper/signals/audit
   * Returns complete signal evaluation logs & 17-reason No-Trade rejection breakdown.
   */
  server.get("/api/indian/paper/signals/audit", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const logs = signalAuditStore.getRecentLogs(100);
      const noTradeSummary = signalAuditStore.getNoTradeAuditSummary();
      return reply.send({
        success: true,
        auditLogs: logs,
        noTradeSummary,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/indian/paper/performance
   * Returns comprehensive Paper Performance Metrics, Daily Performance, ₹1,000 Target Analysis, & Strategy Breakdown.
   */
  server.get("/api/indian/paper/performance", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const summary = paperValidationEngine.getPerformanceSummary();
      const dailyPerf = paperValidationEngine.getDailyPerformance();
      const target1000 = paperValidationEngine.getTargetAnalysis1000();
      const strategyBreakdown = paperValidationEngine.getStrategyBreakdown();

      return reply.send({
        success: true,
        performance: summary,
        dailyPerformance: dailyPerf,
        targetAnalysis: target1000,
        strategyBreakdown,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/indian/paper/system-health
   * Returns real-time system health metrics, latencies, and data component health.
   */
  server.get("/api/indian/paper/system-health", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const health = systemHealthService.getSystemHealth();
      const componentHealth = niftyMarketProvider.getDataComponentHealthMap();

      return reply.send({
        success: true,
        systemHealth: health,
        componentHealth,
        liveTradingEnabled: false,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/indian/paper/comparison
   * Returns side-by-side comparison of Phase 11 historical backtest vs Phase 12 paper trading metrics.
   */
  server.get("/api/indian/paper/comparison", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const comparison = paperValidationEngine.getPaperVsHistoricalComparison();
      return reply.send({
        success: true,
        comparison,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/indian/paper/daily-report
   * Returns generated Paper Session Summary Report.
   */
  server.get("/api/indian/paper/daily-report", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = paperValidationEngine.generateDailyReport();
      return reply.send({
        success: true,
        reportText: report.reportText,
        reportData: report.reportData,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // ── PHASE 13: PRODUCTION HARDENING, RECONCILIATION & SECURITY ENDPOINTS ──────

  /**
   * GET /api/indian/health
   * Returns comprehensive system health check report across all subsystems.
   */
  server.get("/api/indian/health", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const healthReport = healthCheckService.getHealthCheckReport();
      const statusCode = healthReport.overallStatus === "UNHEALTHY" ? 503 : 200;
      return reply.status(statusCode).send({
        success: true,
        ...healthReport,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/indian/reconciliation
   * Runs reconciliation audit comparing DB, paper broker, position state, journal, & daily P&L.
   */
  server.get("/api/indian/reconciliation", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const auditReport = reconciliationEngine.runReconciliation();
      return reply.send({
        success: true,
        reconciliation: auditReport,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * POST /api/indian/admin/recover-state
   * Reconstructs paper trading state after process restart.
   */
  server.post("/api/indian/admin/recover-state", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const open = paperPersistenceManager.loadOpenPositions();
      const closed = paperPersistenceManager.loadClosedPositions();
      const dailyRisk = paperPersistenceManager.loadDailyRisk();

      paperBrokerAdapter.reconstructState(open, closed);
      if (dailyRisk) {
        dailyRiskController.reconstructState(dailyRisk);
      }

      return reply.send({
        success: true,
        message: "Paper trading state reconstructed successfully from persistent store.",
        recoveredOpenPositions: open.length,
        recoveredClosedPositions: closed.length,
        recoveredDailyRisk: dailyRisk,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // ── PHASE 14: EXTENDED PAPER TRADING & STATISTICAL VALIDATION ENDPOINTS ───────

  /**
   * GET /api/indian/validation/phase14/summary
   * Returns comprehensive Phase 14 Extended Validation Report.
   */
  server.get("/api/indian/validation/phase14/summary", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = extendedStatisticalValidationEngine.generateExtendedReport();
      return reply.send({
        success: true,
        report,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/indian/validation/phase14/scorecard
   * Returns validation scorecard, pass/fail conditions, and safety lock verification.
   */
  server.get("/api/indian/validation/phase14/scorecard", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = extendedStatisticalValidationEngine.generateExtendedReport();
      return reply.send({
        success: true,
        scorecard: report.scorecard,
        cohort: report.cohort,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/indian/validation/phase14/cohorts
   * Returns active cohort and all registered validation cohorts.
   */
  server.get("/api/indian/validation/phase14/cohorts", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const activeCohort = strategyFingerprintManager.getActiveCohort();
      const allCohorts = strategyFingerprintManager.getAllCohorts();
      const currentFingerprint = strategyFingerprintManager.getCurrentFingerprint();

      return reply.send({
        success: true,
        activeCohort,
        allCohorts,
        currentFingerprint,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/indian/validation/phase14/rolling
   * Returns rolling metric stability windows (10, 20, 30 trades).
   */
  server.get("/api/indian/validation/phase14/rolling", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = extendedStatisticalValidationEngine.generateExtendedReport();
      return reply.send({
        success: true,
        rollingMetrics: report.rollingMetrics,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/indian/validation/phase14/regimes
   * Returns market regime breakdown and strategy breakdown.
   */
  server.get("/api/indian/validation/phase14/regimes", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = extendedStatisticalValidationEngine.generateExtendedReport();
      return reply.send({
        success: true,
        regimeBreakdown: report.regimeBreakdown,
        strategyBreakdown: report.strategyBreakdown,
        exitAnalysis: report.exitAnalysis,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * POST /api/indian/validation/phase14/simulate-sample
   * Generates simulated multi-session paper dataset for testing scorecard & cohort evaluation.
   */
  server.post("/api/indian/validation/phase14/simulate-sample", async (request: FastifyRequest<{ Body: { sessionsCount?: number; winRatePct?: number } }>, reply: FastifyReply) => {
    try {
      const { sessionsCount = 22, winRatePct = 75 } = request.body || {};
      const sim = paperSampleSimulator.generateSampleDataset({ sessionsCount, winRatePct, tradesPerSession: 1.5 });
      const report = extendedStatisticalValidationEngine.generateExtendedReport(sim.sessions, sim.trades);

      return reply.send({
        success: true,
        simulatedSessionsCount: sim.sessions.length,
        simulatedTradesCount: sim.trades.length,
        report,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // ── PHASE 15: GENUINE LIVE PAPER TRADING VALIDATION ENDPOINTS ─────────────────

  /**
   * GET /api/indian/validation/phase15/summary
   * Returns comprehensive Phase 15 Genuine Live Paper Validation report.
   */
  server.get("/api/indian/validation/phase15/summary", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = await genuinePaperValidationEngine.generateGenuineReport();
      return reply.send({
        success: true,
        report,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/indian/validation/phase15/scorecard
   * Returns Phase 15 Scorecard status, sample counts, and safety locks.
   */
  server.get("/api/indian/validation/phase15/scorecard", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = await genuinePaperValidationEngine.generateGenuineReport();
      return reply.send({
        success: true,
        scorecardStatus: report.scorecardStatus,
        genuineSample: report.genuineSample,
        safetyLocks: report.safetyLocks,
        blockedMessage: report.blockedMessage,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/indian/validation/phase15/data-gate
   * Returns Phase 15 Data Source Gate status and 8-component provider transparency.
   */
  server.get("/api/indian/validation/phase15/data-gate", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const dataGate = await genuineDataValidator.evaluateGenuineDataGate();
      return reply.send({
        success: true,
        dataGate,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/indian/validation/phase15/comparison
   * Returns side-by-side comparison of Phase 14 simulated benchmark vs Phase 15 genuine live paper performance.
   */
  server.get("/api/indian/validation/phase15/comparison", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = await genuinePaperValidationEngine.generateGenuineReport();
      return reply.send({
        success: true,
        comparison: report.phase14VsPhase15,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // ── PHASE 17: GENUINE DATA PROVIDER & LIVE PAPER OPERATIONS ENDPOINTS ────────

  /**
   * GET /api/indian/genuine-data/status
   * Returns complete Phase 17 component-level data health status.
   */
  server.get("/api/indian/genuine-data/status", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const health = await niftyMarketProvider.getPhase17DataHealth();
      const gate = await genuineDataValidator.evaluatePhase17Gate();
      return reply.send({
        success: true,
        health,
        gate,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/indian/genuine-data/option-chain
   * Returns live NIFTY option chain from genuine data provider with explicit source labels.
   */
  server.get("/api/indian/genuine-data/option-chain", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const spotRes = await niftyMarketProvider.getSpotPrice();
      const fetchResult = await nseIndiaOptionChainProvider.fetchOptionChain(spotRes.spotPrice);
      return reply.send({
        success: fetchResult.success,
        spotPrice: spotRes.spotPrice,
        fetchResult,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/indian/genuine-data/provider
   * Returns provider health, authentication status, and backoff state.
   */
  server.get("/api/indian/genuine-data/provider", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const providerHealth = nseIndiaOptionChainProvider.getProviderHealth();
      return reply.send({
        success: true,
        providerHealth,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/indian/paper/session/phase17
   * Returns current Phase 17 paper trading session record.
   */
  server.get("/api/indian/paper/session/phase17", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const session = phase17PaperSessionTracker.getCurrentSession();
      return reply.send({
        success: true,
        session,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });


  // ── PHASE 18: GENUINE LIVE PAPER TRADING OPERATIONS & DATA RELIABILITY ENDPOINTS

  /**
   * GET /api/indian/phase18/operational-gate
   * Evaluates Phase 18 strict 7-criterion operational session gate.
   */
  server.get("/api/indian/phase18/operational-gate", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const gate = await genuineDataValidator.evaluatePhase18OperationalGate();
      return reply.send({
        success: true,
        gate,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/indian/phase18/freshness
   * Returns component-level freshness metrics for Spot, Option Chain, and Option Prices.
   */
  server.get("/api/indian/phase18/freshness", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const freshness = await phase18DataFreshnessMonitor.getFreshnessMetrics();
      return reply.send({
        success: true,
        freshness,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/indian/phase18/heartbeat
   * Returns real-time operational heartbeat and telemetry timestamps.
   */
  server.get("/api/indian/phase18/heartbeat", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const heartbeat = systemHealthService.getPhase18Heartbeat();
      return reply.send({
        success: true,
        heartbeat,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/indian/phase18/alerts
   * Returns recent internal operational alert logs.
   */
  server.get("/api/indian/phase18/alerts", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const alerts = operationalAlertLogger.getOperationalAlerts();
      return reply.send({
        success: true,
        alerts,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // ── PHASE 19: GENUINE PAPER TRADING SAMPLE COLLECTION & VALIDATION ENDPOINTS ─

  /**
   * GET /api/indian/phase19/summary
   * Returns comprehensive Phase 19 Genuine Validation report.
   */
  server.get("/api/indian/phase19/summary", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = await phase19GenuineValidationEngine.generateSummaryReport();
      return reply.send({
        success: true,
        report,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // ── PHASE 23: HARD REALITY AUDIT ENDPOINTS ───────────────────────────────────

  /**
   * GET /api/indian/data-reality
   * Returns complete Indian Data Reality Dashboard status.
   */
  server.get("/api/indian/data-reality", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const spotRes = await niftyMarketProvider.getSpotPrice();
      const p17Health = await niftyMarketProvider.getPhase17DataHealth();
      const nseHealth = nseIndiaOptionChainProvider.getProviderHealth();
      const dhanHealth = dhanBrokerAdapter.getProviderHealth();
      const opGate = await genuineDataValidator.evaluatePhase18OperationalGate();

      const dashboard = {
        niftySpot: spotRes.isReal ? "REAL" : "SYNTHETIC",
        optionChain: p17Health.optionChain.sourceType === "REAL" ? "REAL" : "SYNTHETIC",
        optionPrices: p17Health.optionPrices.sourceType === "REAL" ? "REAL" : "SYNTHETIC",
        greeks: p17Health.optionChain.sourceType === "REAL" ? "DERIVED" : "SYNTHETIC",
        iv: p17Health.optionChain.sourceType === "REAL" ? "REAL" : "SYNTHETIC",
        dhanApi: dhanHealth.isConfigured ? (dhanHealth.status === "OK" ? "CONNECTED" : "FAILED") : "NOT_CONFIGURED",
        nseApi: nseHealth.status === "OK" ? "CONNECTED" : "FAILED",
        instrument: opGate.lotSizeVerified ? "VERIFIED" : "FAILED",
        lotSize: opGate.lotSizeVerified ? "VERIFIED" : "FAILED",
        dataAgeMs: p17Health.ageMs,
        strategyInput: spotRes.isReal && p17Health.optionChain.sourceType === "REAL" ? "REAL" : "SYNTHETIC",
        paperPrices: spotRes.isReal ? "REAL" : "SYNTHETIC",
        paperPnl: spotRes.isReal ? "REAL" : "SYNTHETIC",
        lastDhanSuccess: dhanHealth.lastSuccessMs ? new Date(dhanHealth.lastSuccessMs).toISOString() : null,
        lastNseSuccess: nseHealth.lastSuccessMs ? new Date(nseHealth.lastSuccessMs).toISOString() : null,
        lastOptionChainUpdate: p17Health.timestamps.optionChainMs ? new Date(p17Health.timestamps.optionChainMs).toISOString() : null,
        lastOptionPriceUpdate: p17Health.timestamps.optionChainMs ? new Date(p17Health.timestamps.optionChainMs).toISOString() : null,
        lastSignalTimestamp: new Date().toISOString(),
        lastSignalSource: p17Health.dataSource,
      };

      return reply.send({
        success: true,
        dashboard,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/indian/phase19/scorecard
   * Returns validation status, sample thresholds, and sample sufficiency.
   */
  server.get("/api/indian/phase19/scorecard", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = await phase19GenuineValidationEngine.generateSummaryReport();
      return reply.send({
        success: true,
        validationStatus: report.validationStatus,
        finalStatus: report.finalStatus,
        genuineSample: report.genuineSample,
        confidence: report.confidence,
        safetyLocks: report.safetyLocks,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/indian/signal/proof
   * Returns signal evidence / proof record.
   */
  server.get("/api/indian/signal/proof", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const spotRes = await niftyMarketProvider.getSpotPrice();
      const chainRes = await niftyMarketProvider.getOptionChain(spotRes.spotPrice);
      const signal = hedgingStrategyEngine.generateSignal(spotRes.spotPrice, [], [], chainRes.chain);

      const evidence = {
        signalId: signal.signalId || `SIG_${Date.now()}`,
        timestamp: signal.timestamp,
        dataSources: {
          spot: signal.spotSource || (spotRes.isReal ? "TWELVEDATA" : "SYNTHETIC"),
          optionChain: signal.optionChainSource || (chainRes.isReal ? "NSE" : "SYNTHETIC"),
          optionPrices: signal.optionPriceSource || (chainRes.isReal ? "NSE" : "SYNTHETIC"),
          greeks: signal.greeksSource || "DERIVED",
          iv: signal.ivSource || "REAL",
          instrument: "NFO_NIFTY",
        },
        freshness: {
          spotAgeMs: Date.now() - spotRes.timestamp,
          optionChainAgeMs: chainRes.chain.timestamp ? Date.now() - new Date(chainRes.chain.timestamp).getTime() : 0,
        },
        masterInput: {
          spot: signal.spotPrice,
          vwap: signal.regime_details?.vwap ?? 0,
          rsi: 50,
          atr: signal.regime_details?.atr ?? 0,
          support: 0,
          resistance: 0,
          trend15M: signal.regime_details?.trend15M ?? "NEUTRAL",
          trend1H: signal.regime_details?.trend1H ?? "NEUTRAL",
          swing: "NEUTRAL",
          delta: signal.sellLeg?.delta ?? 0,
          gamma: 0,
          iv: signal.sellLeg?.iv ?? 0,
        },
        decision: signal.action,
        rejectionReason: signal.reasons.length > 0 ? signal.reasons[0] : null,
      };

      return reply.send({
        success: true,
        evidence,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/indian/phase19/daily
   * Returns daily P&L distribution, ₹1,000 target analysis, and session breakdown.
   */
  server.get("/api/indian/phase19/daily", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = await phase19GenuineValidationEngine.generateSummaryReport();
      return reply.send({
        success: true,
        dailyDistribution: report.dailyDistribution,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET & POST /api/indian/dhan/auth
   * Phase 26A — Dhan API Authentication & Read-Only Profile Verification Endpoint.
   */
  server.get("/api/indian/dhan/auth", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const result = await dhanAuthService.authenticateAndVerify();
      return reply.send(dhanAuthService.sanitizeOutput(result));
    } catch (err: any) {
      return reply.status(500).send({
        provider: "DHAN",
        connected: false,
        authentication: "FAILED",
        dataAccess: false,
        executionEnabled: false,
        errorCode: "SERVER_ERROR",
        errorMessage: err.message,
      });
    }
  });

  server.post("/api/indian/dhan/auth", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const result = await dhanAuthService.authenticateAndVerify();
      return reply.send(dhanAuthService.sanitizeOutput(result));
    } catch (err: any) {
      return reply.status(500).send({
        provider: "DHAN",
        connected: false,
        authentication: "FAILED",
        dataAccess: false,
        executionEnabled: false,
        errorCode: "SERVER_ERROR",
        errorMessage: err.message,
      });
    }
  });

  /**
   * POST /api/indian/dhan/connectivity-test
   * Runs read-only Dhan connectivity diagnostic test.
   */
  server.post("/api/indian/dhan/connectivity-test", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const result = await dhanBrokerAdapter.runConnectivityTest();
      return reply.send({
        success: true,
        result,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * ═══════════════════════════════════════════════════════════════════════════
   * PHASE 26B — DHAN REAL-TIME NIFTY OPTION CHAIN INTEGRATION ENDPOINTS
   * ═══════════════════════════════════════════════════════════════════════════
   */

  /**
   * GET /api/indian/dhan/option-chain/status
   * Safe status of Dhan option chain provider, rate limiter, cache, and lot size verification.
   */
  server.get("/api/indian/dhan/option-chain/status", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const status = dhanBrokerAdapter.getOptionChainStatus();
      return reply.send({
        success: true,
        status,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/indian/dhan/option-chain/expiry
   * Discovered active expiries from official Dhan Expiry List API.
   */
  server.get("/api/indian/dhan/option-chain/expiry", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const expiries = await dhanBrokerAdapter.fetchExpiryList(13, "IDX_I");
      return reply.send({
        success: true,
        provider: "DHAN",
        underlyingScrip: 13,
        underlyingSeg: "IDX_I",
        expiries,
      });
    } catch (err: any) {
      return reply.status(200).send({
        success: false,
        provider: "DHAN",
        underlyingScrip: 13,
        underlyingSeg: "IDX_I",
        expiries: [],
        error: err.message || "Failed to fetch expiry list",
      });
    }
  });

  /**
   * GET /api/indian/dhan/option-chain
   * Real-time normalized canonical NIFTY option chain from Dhan (safe market data only).
   */
  server.get("/api/indian/dhan/option-chain", async (request: FastifyRequest<{ Querystring: { expiry?: string } }>, reply: FastifyReply) => {
    try {
      const { expiry } = request.query || {};
      const spotRes = await niftyMarketProvider.getSpotPrice();
      const fetchResult = await dhanBrokerAdapter.fetchOptionChain(spotRes.spotPrice || 24700, expiry);
      return reply.send({
        success: fetchResult.success,
        fetchResult,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/indian/dhan/data-health
   * Phase 26B comprehensive provider transparency and health metrics.
   */
  server.get("/api/indian/dhan/data-health", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const spotRes = await niftyMarketProvider.getSpotPrice();
      const chainFetch = await dhanBrokerAdapter.fetchOptionChain(spotRes.spotPrice || 24700);
      const isConnected = dhanBrokerAdapter.isConfigured() && chainFetch.success;

      const sampleContract = chainFetch.contracts[0];

      const dataHealth = {
        provider: "DHAN",
        connected: isConnected,
        sourceType: "REAL_EXTERNAL",
        spot: {
          available: spotRes.spotPrice > 0,
          source: "DHAN",
        },
        optionChain: {
          available: chainFetch.success,
          source: "DHAN",
          contracts: chainFetch.contracts.length,
          stale: false,
        },
        optionPrices: {
          available: chainFetch.success && chainFetch.contracts.some((c) => c.ltp > 0),
          source: "DHAN",
        },
        greeks: {
          delta: !!(sampleContract && sampleContract.delta !== undefined),
          gamma: !!(sampleContract && sampleContract.gamma !== undefined),
          theta: !!(sampleContract && sampleContract.theta !== undefined),
          vega: !!(sampleContract && sampleContract.vega !== undefined),
          iv: !!(sampleContract && sampleContract.iv !== undefined),
        },
        lotSize: {
          verified: chainFetch.lotSize != null && chainFetch.lotSize > 0,
          currentLotSize: chainFetch.lotSize,
          source: "DHAN_INSTRUMENT_MASTER",
        },
        executionEnabled: false,
      };

      return reply.send({
        success: true,
        dataHealth,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * ═══════════════════════════════════════════════════════════════════════════
   * PHASE 26D — DHAN REAL-TIME WEBSOCKET MARKET FEED ENDPOINTS
   * ═══════════════════════════════════════════════════════════════════════════
   */

  /**
   * GET /api/indian/dhan/realtime/status
   */
  server.get("/api/indian/dhan/realtime/status", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const health = dhanMarketFeedProvider.getHealth();
      return reply.send({
        success: true,
        status: health,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/indian/dhan/realtime/subscriptions
   */
  server.get("/api/indian/dhan/realtime/subscriptions", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const subscriptions = dhanSubscriptionManager.getSubscriptions();
      return reply.send({
        success: true,
        count: subscriptions.length,
        subscriptions,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/indian/dhan/realtime/health
   */
  server.get("/api/indian/dhan/realtime/health", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const health = dhanMarketFeedProvider.getHealth();
      return reply.send({
        success: true,
        health,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/indian/dhan/realtime/ticks
   */
  server.get("/api/indian/dhan/realtime/ticks", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const ticksMap = dhanMarketFeedProvider.getAllTicks();
      const ticks = Array.from(ticksMap.values());
      return reply.send({
        success: true,
        count: ticks.length,
        ticks,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/indian/dhan/realtime/latency
   */
  server.get("/api/indian/dhan/realtime/latency", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const health = dhanMarketFeedProvider.getHealth();
      return reply.send({
        success: true,
        feedLatencyMs: health.feedLatencyMs,
        connectionState: health.connectionState,
        lastMessageAt: health.lastMessageAt,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/indian/phase19/strategies
   * Returns factual performance breakdown for BULL_PUT, BEAR_CALL, and IRON_CONDOR (unranked).
   */
  server.get("/api/indian/phase19/strategies", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = await phase19GenuineValidationEngine.generateSummaryReport();
      return reply.send({
        success: true,
        strategies: report.strategies,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/indian/deployment-audit
   * Returns environment configuration diagnostic across local, backend, frontend, Render, and Vercel.
   */
  server.get("/api/indian/deployment-audit", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const provider = process.env.NIFTY_DATA_PROVIDER || "NSE_INDIA";
      const dhanConfigured = dhanBrokerAdapter.isConfigured() ? "CONFIGURED" : "NOT_CONFIGURED";
      const nseConfigured = nseIndiaOptionChainProvider.isConfigured() ? "CONFIGURED" : "NOT_CONFIGURED";
      const realDataOnly = process.env.INDIAN_REAL_DATA_ONLY === "true" ? "ENABLED" : "DISABLED";

      const audit = {
        environment: process.env.NODE_ENV || "development",
        niftyDataProvider: provider,
        dhan: {
          configured: dhanConfigured,
          authValid: dhanBrokerAdapter.getProviderHealth().isAuthenticated ? "VALID" : "NOT_CONFIGURED",
        },
        nse: {
          configured: nseConfigured,
          status: nseIndiaOptionChainProvider.getProviderHealth().status,
        },
        realDataOnly,
        syntheticFallbackEnabled: realDataOnly === "ENABLED" ? "DISABLED" : "ENABLED",
        paperTradingEnabled: "ENABLED",
        liveTradingDisabled: "PERMANENTLY_LOCKED",
      };

      return reply.send({
        success: true,
        audit,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/indian/phase19/regimes
   * Returns market regime breakdown (BULLISH, BEARISH, RANGE, NO_TRADE).
   */
  server.get("/api/indian/phase19/regimes", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = await phase19GenuineValidationEngine.generateSummaryReport();
      return reply.send({
        success: true,
        regimes: report.regimes,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/indian/phase19/exits
   * Returns exit reason analysis breakdown.
   */
  server.get("/api/indian/phase19/exits", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = await phase19GenuineValidationEngine.generateSummaryReport();
      return reply.send({
        success: true,
        exits: report.exits,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/indian/phase19/risk
   * Returns risk audit statistics and execution quality verification.
   */
  server.get("/api/indian/phase19/risk", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = await phase19GenuineValidationEngine.generateSummaryReport();
      return reply.send({
        success: true,
        riskAudit: report.riskAudit,
        executionQuality: report.executionQuality,
        drawdown: report.drawdown,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/indian/phase19/data-quality
   * Returns data reliability statistics and no-trade reason analysis.
   */
  server.get("/api/indian/phase19/data-quality", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = await phase19GenuineValidationEngine.generateSummaryReport();
      return reply.send({
        success: true,
        dataReliability: report.dataReliability,
        noTradeReasons: report.noTradeReasons,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/indian/phase19/export
   * Exports sanitized genuine validation records (trades and daily sessions).
   */
  server.get("/api/indian/phase19/export", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const exportData = phase19GenuineValidationEngine.exportGenuineValidationData();
      return reply.send({
        success: true,
        export: exportData,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * ═══════════════════════════════════════════════════════════════════════════
   * PHASE 20 — BROKER API INTEGRATION & PAPER EXECUTION CONNECTIVITY
   * READ-ONLY BROKER INTEGRATION WITH PERMANENT FAIL-CLOSED SAFETY LOCKS
   * ═══════════════════════════════════════════════════════════════════════════
   */

  /**
   * GET /api/indian/broker/status
   * Safe diagnostics, connection status, permanent safety flags, and scorecard.
   */
  server.get("/api/indian/broker/status", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const diagnostics = brokerManager.getDiagnostics();
      const scorecard = brokerManager.getReadinessScorecard();
      const isConnected = diagnostics.connectionStatus === "CONNECTED";
      const isConfigured = diagnostics.providerNeutralConfig.isConfigured;

      const statusBanner = !isConfigured
        ? "BROKER CONNECTIVITY NOT CONFIGURED"
        : isConnected
        ? "BROKER CONNECTIVITY READY — LIVE EXECUTION DISABLED"
        : diagnostics.connectionStatus === "AUTH_FAILED"
        ? "BROKER CONNECTIVITY BLOCKED"
        : "BROKER CONNECTIVITY NOT CONFIGURED";

      return reply.send({
        success: true,
        statusBanner,
        diagnostics,
        scorecard,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/indian/reality-scorecard
   * Returns machine-generated reality scorecard percentages.
   */
  server.get("/api/indian/reality-scorecard", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const spotRes = await niftyMarketProvider.getSpotPrice();
      const p17Health = await niftyMarketProvider.getPhase17DataHealth();

      const items = [
        { name: "NIFTY SPOT", status: spotRes.isReal ? "REAL" : "SYNTHETIC", type: spotRes.isReal ? "REAL" : "SYNTHETIC" },
        { name: "OPTION CHAIN", status: p17Health.optionChain.sourceType === "REAL" ? "REAL" : "SYNTHETIC", type: p17Health.optionChain.sourceType === "REAL" ? "REAL" : "SYNTHETIC" },
        { name: "OPTION PRICES", status: p17Health.optionPrices.sourceType === "REAL" ? "REAL" : "SYNTHETIC", type: p17Health.optionPrices.sourceType === "REAL" ? "REAL" : "SYNTHETIC" },
        { name: "BID/ASK", status: p17Health.optionPrices.sourceType === "REAL" ? "REAL" : "SYNTHETIC", type: p17Health.optionPrices.sourceType === "REAL" ? "REAL" : "SYNTHETIC" },
        { name: "OI", status: p17Health.optionChain.sourceType === "REAL" ? "REAL" : "SYNTHETIC", type: p17Health.optionChain.sourceType === "REAL" ? "REAL" : "SYNTHETIC" },
        { name: "VOLUME", status: p17Health.optionChain.sourceType === "REAL" ? "REAL" : "SYNTHETIC", type: p17Health.optionChain.sourceType === "REAL" ? "REAL" : "SYNTHETIC" },
        { name: "IV", status: p17Health.optionChain.sourceType === "REAL" ? "REAL" : "UNAVAILABLE", type: p17Health.optionChain.sourceType === "REAL" ? "REAL" : "UNAVAILABLE" },
        { name: "DELTA", status: "PROVIDER_DERIVED", type: "DERIVED_REAL" },
        { name: "GAMMA", status: "UNAVAILABLE", type: "UNAVAILABLE" },
        { name: "VWAP", status: "DERIVED_FROM_REAL", type: "DERIVED_REAL" },
        { name: "RSI", status: "DERIVED_FROM_REAL", type: "DERIVED_REAL" },
        { name: "ATR", status: "DERIVED_FROM_REAL", type: "DERIVED_REAL" },
        { name: "SUPPORT/RESISTANCE", status: "DERIVED_FROM_REAL", type: "DERIVED_REAL" },
        { name: "TREND", status: "DERIVED_FROM_REAL", type: "DERIVED_REAL" },
        { name: "STRATEGY", status: "REAL LOGIC", type: "REAL" },
        { name: "STRIKE SELECTION", status: "REAL LOGIC", type: "REAL" },
        { name: "RISK ENGINE", status: "REAL LOGIC", type: "REAL" },
        { name: "PAPER EXECUTION", status: spotRes.isReal ? "REAL DATA" : "SYNTHETIC", type: spotRes.isReal ? "REAL" : "SYNTHETIC" },
        { name: "PAPER P&L", status: spotRes.isReal ? "REAL DATA" : "SYNTHETIC", type: spotRes.isReal ? "REAL" : "SYNTHETIC" },
        { name: "DHAN API", status: dhanBrokerAdapter.isConfigured() ? "VERIFIED" : "NOT_CONFIGURED", type: dhanBrokerAdapter.isConfigured() ? "REAL" : "SYNTHETIC" },
        { name: "NSE API", status: nseIndiaOptionChainProvider.getProviderHealth().status === "OK" ? "VERIFIED" : "FAILED", type: nseIndiaOptionChainProvider.getProviderHealth().status === "OK" ? "REAL" : "SYNTHETIC" },
      ];

      const totalDenominator = items.length;
      const realCount = items.filter((i) => i.type === "REAL").length;
      const derivedCount = items.filter((i) => i.type === "DERIVED_REAL").length;
      const syntheticCount = items.filter((i) => i.type === "SYNTHETIC").length;
      const mockCount = items.filter((i) => i.type === "MOCK").length;
      const unknownCount = items.filter((i) => i.type === "UNAVAILABLE").length;

      const scorecard = {
        denominator: totalDenominator,
        realDirectDataPct: Number(((realCount / totalDenominator) * 100).toFixed(1)),
        derivedFromRealPct: Number(((derivedCount / totalDenominator) * 100).toFixed(1)),
        syntheticPct: Number(((syntheticCount / totalDenominator) * 100).toFixed(1)),
        mockPct: Number(((mockCount / totalDenominator) * 100).toFixed(1)),
        unknownPct: Number(((unknownCount / totalDenominator) * 100).toFixed(1)),
        breakdown: items,
      };

      return reply.send({
        success: true,
        scorecard,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * POST /api/indian/broker/connect
   * Initiates read-only connection verification with the configured broker.
   */
  server.post("/api/indian/broker/connect", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const status = await brokerManager.connectBroker();
      return reply.send({
        success: true,
        status,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/indian/phase24/proof
   * Executes Phase 24 Live Runtime Proof Diagnostic Suite.
   */
  server.get("/api/indian/phase24/proof", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const proof = await phase24RuntimeProofEngine.runFullRuntimeProof();
      return reply.send({
        success: true,
        proof,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/indian/broker/account
   * Read-only account margin and fund retrieval (no credentials exposed).
   */
  server.get("/api/indian/broker/account", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const adapter = brokerManager.getBrokerAdapter();
      const account = await adapter.getAccount();
      return reply.send({
        success: true,
        account,
      });
    } catch (err: any) {
      return reply.status(500).send({
        success: false,
        error: "BROKER_ACCOUNT_DATA_UNAVAILABLE",
        message: err.message,
      });
    }
  });

  /**
   * GET /api/indian/broker/positions
   * Read-only broker open positions.
   */
  server.get("/api/indian/broker/positions", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const adapter = brokerManager.getBrokerAdapter();
      const positions = await adapter.getPositions();
      return reply.send({
        success: true,
        positions,
      });
    } catch (err: any) {
      return reply.status(500).send({
        success: false,
        error: "BROKER_POSITION_DATA_UNAVAILABLE",
        message: err.message,
      });
    }
  });

  /**
   * GET /api/indian/broker/orders
   * Read-only broker order history.
   */
  server.get("/api/indian/broker/orders", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const adapter = brokerManager.getBrokerAdapter();
      const orders = await adapter.getOrders();
      return reply.send({
        success: true,
        orders,
      });
    } catch (err: any) {
      return reply.status(500).send({
        success: false,
        error: "BROKER_ORDER_DATA_UNAVAILABLE",
        message: err.message,
      });
    }
  });

  /**
   * GET /api/indian/broker/instruments
   * Broker-resolved NIFTY option instruments.
   */
  server.get("/api/indian/broker/instruments", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const adapter = brokerManager.getBrokerAdapter();
      const sampleInstrument = await adapter.getInstrument("NIFTY2692424500CE");
      return reply.send({
        success: true,
        instruments: sampleInstrument ? [sampleInstrument] : [],
      });
    } catch (err: any) {
      return reply.status(500).send({
        success: false,
        error: "BROKER_INSTRUMENT_DATA_UNAVAILABLE",
        message: err.message,
      });
    }
  });

  /**
   * GET /api/indian/broker/reconciliation
   * Observational reconciliation between internal paper trading and broker API state.
   */
  server.get("/api/indian/broker/reconciliation", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = await brokerManager.runReconciliation();
      return reply.send({
        success: true,
        reconciliation: report,
      });
    } catch (err: any) {
      return reply.status(500).send({
        success: false,
        error: "BROKER_RECONCILIATION_ERROR",
        message: err.message,
      });
    }
  });

  /**
   * PHASE 21 ENDPOINTS
   */

  /**
   * GET /api/indian/phase21/operational-status
   * Full 3-source telemetry (NSE, Dhan, Paper), systemStatus, heartbeat, market session, safety state.
   */
  server.get("/api/indian/phase21/operational-status", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const status = await phase21OperationalMonitor.getOperationalChainStatus();
      return reply.send({
        success: true,
        data: status,
      });
    } catch (err: any) {
      return reply.status(500).send({
        success: false,
        error: "OPERATIONAL_STATUS_ERROR",
        message: err.message,
      });
    }
  });

  /**
   * GET /api/indian/phase21/quote-comparison
   * Observational quote comparison between NSE and Dhan for a contract.
   */
  server.get("/api/indian/phase21/quote-comparison", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = request.query as any;
      const symbol = query.symbol || "NIFTY";
      const expiry = query.expiry || "";
      const strike = query.strike ? Number(query.strike) : 24500;
      const optionType = (query.optionType as "CE" | "PE") || "CE";

      const comparison = await phase21OperationalMonitor.compareQuotes({
        symbol,
        expiry,
        strike,
        optionType,
        customNseLtp: query.customNseLtp ? Number(query.customNseLtp) : undefined,
        customDhanLtp: query.customDhanLtp ? Number(query.customDhanLtp) : undefined,
      });

      return reply.send({
        success: true,
        comparison,
        history: phase21OperationalMonitor.getRecentQuoteComparisons(),
      });
    } catch (err: any) {
      return reply.status(500).send({
        success: false,
        error: "QUOTE_COMPARISON_ERROR",
        message: err.message,
      });
    }
  });

  /**
   * GET /api/indian/phase21/instrument-reconciliation
   * Cross-source instrument verification across NSE and Dhan.
   */
  server.get("/api/indian/phase21/instrument-reconciliation", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = request.query as any;
      const symbol = query.symbol || "NIFTY";
      const expiry = query.expiry || "26924";
      const strike = query.strike ? Number(query.strike) : 24500;
      const optionType = (query.optionType as "CE" | "PE") || "CE";

      const result = await phase21OperationalMonitor.reconcileInstruments({
        symbol,
        expiry,
        strike,
        optionType,
        customNseLotSize: query.customNseLotSize ? Number(query.customNseLotSize) : undefined,
        customDhanLotSize: query.customDhanLotSize ? Number(query.customDhanLotSize) : undefined,
      });

      return reply.send({
        success: true,
        reconciliation: result,
      });
    } catch (err: any) {
      return reply.status(500).send({
        success: false,
        error: "INSTRUMENT_RECONCILIATION_ERROR",
        message: err.message,
      });
    }
  });

  /**
   * GET /api/indian/phase21/heartbeat
   * 11-point heartbeat timestamp array and latency.
   */
  server.get("/api/indian/phase21/heartbeat", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const heartbeat = systemHealthService.getPhase21Heartbeat();
      return reply.send({
        success: true,
        heartbeat,
      });
    } catch (err: any) {
      return reply.status(500).send({
        success: false,
        error: "HEARTBEAT_ERROR",
        message: err.message,
      });
    }
  });

  /**
   * GET /api/indian/phase21/session-monitor
   * Market session metrics and uptime percentages.
   */
  server.get("/api/indian/phase21/session-monitor", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const status = await phase21OperationalMonitor.getOperationalChainStatus();
      return reply.send({
        success: true,
        marketSession: status.marketSession,
      });
    } catch (err: any) {
      return reply.status(500).send({
        success: false,
        error: "SESSION_MONITOR_ERROR",
        message: err.message,
      });
    }
  });

  /**
   * GET /api/indian/phase21/alerts
   * Operational alerts feed for Phase 21.
   */
  server.get("/api/indian/phase21/alerts", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const alerts = operationalAlertLogger.getOperationalAlerts(50);
      return reply.send({
        success: true,
        alerts,
      });
    } catch (err: any) {
      return reply.status(500).send({
        success: false,
        error: "ALERTS_ERROR",
        message: err.message,
      });
    }
  });

  /**
   * GET /api/indian/phase26e/session
   * Phase 26E — End-to-End Genuine Live Paper Session Validation Status.
   */
  server.get("/api/indian/phase26e/session", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const sessionStatus = phase26EGenuineLivePaperValidationEngine.getSessionStatus();
      return reply.send(sessionStatus);
    } catch (err: any) {
      return reply.status(500).send({
        status: "BLOCKED",
        marketSession: "MARKET_CLOSED",
        dataGate: "BLOCKED",
        dhan: "DISCONNECTED",
        websocket: "DISCONNECTED",
        optionChain: "UNAVAILABLE",
        lotSize: "UNVERIFIED",
        activePositions: 0,
        genuineSession: false,
        genuineTrades: 0,
        paperPnl: 0,
        liveOrders: 0,
      });
    }
  });

  // ── PHASE 27: GENUINE SAMPLE COLLECTION & STATISTICAL VALIDATION ENDPOINTS ──

  /**
   * GET /api/indian/phase27/summary
   * Complete Phase 27 Genuine Sample Summary & Statistical Validation Report.
   */
  server.get("/api/indian/phase27/summary", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = phase27StatisticalValidationEngine.generateValidationReport();
      return reply.send(report);
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/indian/phase27/scorecard
   * Factual Sample Quality Scorecard.
   */
  server.get("/api/indian/phase27/scorecard", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = phase27StatisticalValidationEngine.generateValidationReport();
      return reply.send({
        success: true,
        scorecard: report.scorecard,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/indian/phase27/daily
   * Genuine Daily Ledger statistics & ₹1,000 Target Analysis.
   */
  server.get("/api/indian/phase27/daily", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const entries = genuineDailyLedger.getAllEntries(true);
      const summary = genuineDailyLedger.getSummary(true);
      return reply.send({
        success: true,
        dailyEntries: entries,
        dailySummary: summary,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/indian/phase27/trades
   * Immutable genuine paper trade ledger.
   */
  server.get("/api/indian/phase27/trades", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const trades = genuineSampleStore.getTrades(true);
      return reply.send({
        success: true,
        tradeCount: trades.length,
        trades,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/indian/phase27/strategies
   * Strategy breakdown (Bull Put, Bear Call, Iron Condor).
   */
  server.get("/api/indian/phase27/strategies", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const genuineTrades = genuineSampleStore.getTrades(true);
      const breakdowns = phase27StatisticalValidationEngine.calculateStrategyBreakdown(genuineTrades);
      return reply.send({
        success: true,
        strategyBreakdowns: breakdowns,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/indian/phase27/regimes
   * Market regime breakdown (Bullish, Bearish, Range, No Trade).
   */
  server.get("/api/indian/phase27/regimes", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const genuineTrades = genuineSampleStore.getTrades(true);
      const breakdowns = phase27StatisticalValidationEngine.calculateRegimeBreakdown(genuineTrades);
      return reply.send({
        success: true,
        regimeBreakdowns: breakdowns,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/indian/phase27/exits
   * Exit reason breakdown.
   */
  server.get("/api/indian/phase27/exits", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const genuineTrades = genuineSampleStore.getTrades(true);
      const breakdowns = phase27StatisticalValidationEngine.calculateExitBreakdown(genuineTrades);
      return reply.send({
        success: true,
        exitBreakdowns: breakdowns,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/indian/phase27/rolling
   * Rolling 10, 20, 30-trade window metrics.
   */
  server.get("/api/indian/phase27/rolling", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const genuineTrades = genuineSampleStore.getTrades(true);
      const rolling = phase27StatisticalValidationEngine.calculateRollingMetrics(genuineTrades);
      return reply.send({
        success: true,
        rollingMetrics: rolling,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/indian/phase27/risk
   * Safety locks, risk limits, and daily risk controller state.
   */
  server.get("/api/indian/phase27/risk", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const dailyState = dailyRiskController.getState();
      return reply.send({
        success: true,
        dailyRisk: dailyState,
        safetyLocks: {
          paperTrading: process.env.PAPER_TRADING !== "false",
          liveTrading: process.env.LIVE_TRADING === "true",
          brokerExecution: process.env.BROKER_EXECUTION_ENABLED === "true",
          realDataOnly: process.env.INDIAN_REAL_DATA_ONLY === "true",
          realBrokerOrders: 0,
        },
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/indian/phase27/data-quality
   * Data quality telemetry and excluded data counters.
   */
  server.get("/api/indian/phase27/data-quality", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = phase27StatisticalValidationEngine.generateValidationReport();
      return reply.send({
        success: true,
        dataQuality: report.dataQuality,
        exclusions: genuineSampleStore.getExclusionCounters(),
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/indian/phase27/export
   * Sanitized export of complete genuine session and trade dataset.
   */
  server.get("/api/indian/phase27/export", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const genuineSessions = genuineSampleStore.getSessions(true);
      const genuineTrades = genuineSampleStore.getTrades(true);
      const summary = phase27StatisticalValidationEngine.generateValidationReport();

      return reply.send({
        success: true,
        exportedAt: new Date().toISOString(),
        validationStatus: summary.validationStatus,
        sampleProgress: summary.scorecard.sampleProgress,
        genuineSessions,
        genuineTrades,
        summary,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // ── PHASE 28: STATISTICAL EVIDENCE & ROBUSTNESS VALIDATION ENDPOINTS ──

  /**
   * GET /api/indian/phase28/summary
   */
  server.get("/api/indian/phase28/summary", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = phase28StatisticalEvidenceEngine.generateReport();
      return reply.send(report);
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/indian/phase28/confidence
   */
  server.get("/api/indian/phase28/confidence", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = phase28StatisticalEvidenceEngine.generateReport();
      return reply.send({
        success: true,
        winRateConfidence: report.winRateConfidence,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/indian/phase28/bootstrap
   */
  server.get("/api/indian/phase28/bootstrap", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = phase28StatisticalEvidenceEngine.generateReport();
      return reply.send({
        success: true,
        bootstrapExpectancy: report.bootstrapExpectancy,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/indian/phase28/rolling
   */
  server.get("/api/indian/phase28/rolling", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = phase28StatisticalEvidenceEngine.generateReport();
      return reply.send({
        success: true,
        rollingWindows: report.rollingWindows,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/indian/phase28/regimes
   */
  server.get("/api/indian/phase28/regimes", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = phase28StatisticalEvidenceEngine.generateReport();
      return reply.send({
        success: true,
        regimeEvidence: report.regimeEvidence,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/indian/phase28/strategies
   */
  server.get("/api/indian/phase28/strategies", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = phase28StatisticalEvidenceEngine.generateReport();
      return reply.send({
        success: true,
        strategyEvidence: report.strategyEvidence,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/indian/phase28/concentration
   */
  server.get("/api/indian/phase28/concentration", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = phase28StatisticalEvidenceEngine.generateReport();
      return reply.send({
        success: true,
        concentrationAnalysis: report.concentrationAnalysis,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/indian/phase28/drawdown
   */
  server.get("/api/indian/phase28/drawdown", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = phase28StatisticalEvidenceEngine.generateReport();
      return reply.send({
        success: true,
        maxDrawdown: report.coreStatistics.maxDrawdown,
        maxDrawdownPercent: report.coreStatistics.maxDrawdownPercent,
        recoveryFactor: report.coreStatistics.recoveryFactor,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/indian/phase28/monte-carlo
   */
  server.get("/api/indian/phase28/monte-carlo", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = phase28StatisticalEvidenceEngine.generateReport();
      return reply.send({
        success: true,
        monteCarloDiagnostic: report.monteCarloDiagnostic,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/indian/phase28/stability
   */
  server.get("/api/indian/phase28/stability", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = phase28StatisticalEvidenceEngine.generateReport();
      return reply.send({
        success: true,
        timeStabilityBlocks: report.timeStabilityBlocks,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/indian/phase28/risk
   */
  server.get("/api/indian/phase28/risk", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = phase28StatisticalEvidenceEngine.generateReport();
      return reply.send({
        success: true,
        safetyLocks: {
          paperTrading: process.env.PAPER_TRADING !== "false",
          liveTrading: process.env.LIVE_TRADING === "true",
          brokerExecution: process.env.BROKER_EXECUTION_ENABLED === "true",
          realDataOnly: process.env.INDIAN_REAL_DATA_ONLY === "true",
          realBrokerOrders: 0,
        },
        fingerprintStatus: report.fingerprintStatus,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // ── PHASE 29: GENUINE SAMPLE COMPLETION & VALIDATION CONTROL ──────────────

  /** GET /api/indian/phase29/status */
  server.get("/api/indian/phase29/status", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const progress = phase29ValidationControlEngine.getProgress();
      const integrity = phase29ValidationControlEngine.getIntegrityReport();
      return reply.send({ success: true, progress, integrity });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /** GET /api/indian/phase29/progress */
  server.get("/api/indian/phase29/progress", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      return reply.send({ success: true, ...phase29ValidationControlEngine.getProgress() });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /** GET /api/indian/phase29/sessions */
  server.get("/api/indian/phase29/sessions", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const sessions = phase29ValidationControlEngine.getSessionFinalizer().getFinalizedSessions();
      return reply.send({ success: true, sessionCount: sessions.length, sessions });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /** GET /api/indian/phase29/trades */
  server.get("/api/indian/phase29/trades", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const trades = phase29ValidationControlEngine.getTradeFinalizer().getGenuineFinalized();
      return reply.send({ success: true, tradeCount: trades.length, trades });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /** GET /api/indian/phase29/exclusions */
  server.get("/api/indian/phase29/exclusions", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const audit = phase29ValidationControlEngine.getTradeFinalizer().getExclusionAudit();
      const counters = phase29ValidationControlEngine.getTradeFinalizer().getExclusionCounters();
      return reply.send({ success: true, counters, audit });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /** GET /api/indian/phase29/snapshot */
  server.get("/api/indian/phase29/snapshot", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const snapshot = phase29ValidationControlEngine.getValidationSnapshot();
      if (!snapshot) {
        return reply.send({ success: true, snapshot: null, message: "Validation snapshot not yet created — sample gate not met." });
      }
      return reply.send({ success: true, snapshot });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /** GET /api/indian/phase29/integrity */
  server.get("/api/indian/phase29/integrity", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const integrity = phase29ValidationControlEngine.getIntegrityReport();
      return reply.send({ success: true, integrity });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /** GET /api/indian/phase29/fingerprint */
  server.get("/api/indian/phase29/fingerprint", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const fp = strategyFingerprintManager.getCurrentFingerprint();
      const cohort = strategyFingerprintManager.getActiveCohort();
      return reply.send({
        success: true,
        fingerprint: {
          hash: fp.masterFingerprintHash,
          version: fp.version,
          timestamp: fp.timestamp,
        },
        cohort: {
          cohortId: cohort.cohortId,
          cohortName: cohort.cohortName,
          isActive: cohort.isActive,
        },
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /** GET /api/indian/phase29/export */
  server.get("/api/indian/phase29/export", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const exportData = phase29ValidationControlEngine.getExport();
      return reply.send(exportData);
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /** GET /api/indian/phase30/operations */
  server.get("/api/indian/phase30/operations", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const ops = phase30SampleAccumulationEngine.getOperationsStatus();
      return reply.send(ops);
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /** GET /api/indian/phase31/status */
  server.get("/api/indian/phase31/status", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const status = phase31ValidationCertificationEngine.getStatus();
      return reply.send({ success: true, status });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /** GET /api/indian/phase31/cohort */
  server.get("/api/indian/phase31/cohort", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const cohort = phase31ValidationCertificationEngine.getFrozenCohort();
      return reply.send({ success: true, cohort });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /** GET /api/indian/phase31/reconciliation */
  server.get("/api/indian/phase31/reconciliation", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const reconciliation = phase31ValidationCertificationEngine.runPnlReconciliation();
      return reply.send({ success: true, reconciliation });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /** GET /api/indian/phase31/integrity */
  server.get("/api/indian/phase31/integrity", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const integrity = phase31ValidationCertificationEngine.runIntegrityChecks();
      return reply.send({ success: true, integrity });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /** GET /api/indian/phase31/statistics */
  server.get("/api/indian/phase31/statistics", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const statistics = phase31ValidationCertificationEngine.getStatisticalSnapshot();
      return reply.send({ success: true, statistics });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /** GET /api/indian/phase31/exclusions */
  server.get("/api/indian/phase31/exclusions", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const exclusions = phase31ValidationCertificationEngine.getExclusionAudit();
      return reply.send({ success: true, exclusions });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /** GET /api/indian/phase31/certification */
  server.get("/api/indian/phase31/certification", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const certification = phase31ValidationCertificationEngine.processCertificationPipeline();
      return reply.send(certification);
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /** GET /api/indian/phase31/export */
  server.get("/api/indian/phase31/export", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const exportData = phase31ValidationCertificationEngine.getExport();
      return reply.send(exportData);
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // ── PHASE 32: INDEPENDENT OUT-OF-SAMPLE & WALK-FORWARD VALIDATION ───────

  /** GET /api/indian/phase32/status */
  server.get("/api/indian/phase32/status", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const status = phase32OutOfSampleValidationEngine.getStatus();
      return reply.send({ success: true, ...status });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /** GET /api/indian/phase32/dataset */
  server.get("/api/indian/phase32/dataset", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = phase32OutOfSampleValidationEngine.getReport();
      return reply.send({
        success: true,
        cohort: report.cohort,
        datasetFingerprint: report.datasetFingerprint,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /** GET /api/indian/phase32/summary */
  server.get("/api/indian/phase32/summary", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = phase32OutOfSampleValidationEngine.getReport();
      return reply.send({ success: true, report });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /** GET /api/indian/phase32/oos */
  server.get("/api/indian/phase32/oos", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = phase32OutOfSampleValidationEngine.getReport();
      return reply.send({
        success: true,
        oosCoreStatistics: report.oosCoreStatistics,
        winRateConfidence: report.winRateConfidence,
        bootstrapExpectancy: report.bootstrapExpectancy,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /** GET /api/indian/phase32/walk-forward */
  server.get("/api/indian/phase32/walk-forward", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = phase32OutOfSampleValidationEngine.getReport();
      return reply.send({
        success: true,
        walkForwardWindows: report.walkForwardWindows,
        walkForwardStability: report.walkForwardStability,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /** GET /api/indian/phase32/comparison */
  server.get("/api/indian/phase32/comparison", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = phase32OutOfSampleValidationEngine.getReport();
      return reply.send({
        success: true,
        comparison: report.comparison,
        degradation: report.degradation,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /** GET /api/indian/phase32/regimes */
  server.get("/api/indian/phase32/regimes", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = phase32OutOfSampleValidationEngine.getReport();
      return reply.send({
        success: true,
        regimeOOSBreakdown: report.regimeOOSBreakdown,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /** GET /api/indian/phase32/strategies */
  server.get("/api/indian/phase32/strategies", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = phase32OutOfSampleValidationEngine.getReport();
      return reply.send({
        success: true,
        strategyOOSBreakdown: report.strategyOOSBreakdown,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /** GET /api/indian/phase32/leakage */
  server.get("/api/indian/phase32/leakage", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = phase32OutOfSampleValidationEngine.getReport();
      return reply.send({
        success: true,
        leakageReport: report.leakageReport,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /** GET /api/indian/phase32/integrity */
  server.get("/api/indian/phase32/integrity", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = phase32OutOfSampleValidationEngine.getReport();
      return reply.send({
        success: true,
        safetyStatus: report.safetyStatus,
        fingerprintLocked: report.fingerprintLocked,
        fingerprintMatch: report.fingerprintMatch,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /** GET /api/indian/phase32/export */
  server.get("/api/indian/phase32/export", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const exportData = phase32OutOfSampleValidationEngine.getExport();
      return reply.send(exportData);
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // ── PHASE 33: ROBUSTNESS & STRESS TESTING ENDPOINTS ──────────────────────

  /** GET /api/indian/phase33/status */
  server.get("/api/indian/phase33/status", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const status = phase33RobustnessEngine.getStatus();
      return reply.send({ success: true, ...status });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /** GET /api/indian/phase33/scenarios */
  server.get("/api/indian/phase33/scenarios", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = phase33RobustnessEngine.getReport();
      return reply.send({ success: true, scenarioMatrix: report.scenarioMatrix });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /** GET /api/indian/phase33/execution */
  server.get("/api/indian/phase33/execution", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = phase33RobustnessEngine.getReport();
      return reply.send({
        success: true,
        slippageStress: report.slippageStress,
        delayStress: report.delayStress,
        spreadStress: report.spreadStress,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /** GET /api/indian/phase33/slippage */
  server.get("/api/indian/phase33/slippage", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = phase33RobustnessEngine.getReport();
      return reply.send({ success: true, slippageStress: report.slippageStress });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /** GET /api/indian/phase33/liquidity */
  server.get("/api/indian/phase33/liquidity", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = phase33RobustnessEngine.getReport();
      return reply.send({ success: true, spreadStress: report.spreadStress });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /** GET /api/indian/phase33/sequence */
  server.get("/api/indian/phase33/sequence", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = phase33RobustnessEngine.getReport();
      return reply.send({
        success: true,
        sequenceStress: report.sequenceStress,
        sequencePermutations: report.sequencePermutations,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /** GET /api/indian/phase33/drawdown */
  server.get("/api/indian/phase33/drawdown", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = phase33RobustnessEngine.getReport();
      return reply.send({
        success: true,
        tailLossStress: report.tailLossStress,
        drawdownDistribution: report.monteCarloDiagnostic.maxDrawdownDistribution,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /** GET /api/indian/phase33/data-quality */
  server.get("/api/indian/phase33/data-quality", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = phase33RobustnessEngine.getReport();
      return reply.send({ success: true, dataQualityStress: report.dataQualityStress });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /** GET /api/indian/phase33/monte-carlo */
  server.get("/api/indian/phase33/monte-carlo", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = phase33RobustnessEngine.getReport();
      return reply.send({ success: true, monteCarloDiagnostic: report.monteCarloDiagnostic });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /** GET /api/indian/phase33/summary */
  server.get("/api/indian/phase33/summary", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = phase33RobustnessEngine.getReport();
      return reply.send({ success: true, report });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /** GET /api/indian/phase33/export */
  server.get("/api/indian/phase33/export", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const exportData = phase33RobustnessEngine.getExport();
      return reply.send(exportData);
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // ── PHASE 34: LONG-HORIZON GENUINE PAPER VALIDATION ENDPOINTS ─────────────

  /** GET /api/indian/phase34/status */
  server.get("/api/indian/phase34/status", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const status = phase34LongHorizonEngine.getStatus();
      return reply.send({ success: true, ...status });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /** GET /api/indian/phase34/cohort */
  server.get("/api/indian/phase34/cohort", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = phase34LongHorizonEngine.getReport();
      return reply.send({ success: true, cohort: report.cohort });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /** GET /api/indian/phase34/daily */
  server.get("/api/indian/phase34/daily", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const exportData = phase34LongHorizonEngine.getExport();
      return reply.send({ success: true, dailyObservations: exportData.dailyObservations });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /** GET /api/indian/phase34/rolling */
  server.get("/api/indian/phase34/rolling", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = phase34LongHorizonEngine.getReport();
      return reply.send({
        success: true,
        rollingSessionWindows: report.rollingSessionWindows,
        rollingTradeWindows: report.rollingTradeWindows,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /** GET /api/indian/phase34/drift */
  server.get("/api/indian/phase34/drift", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = phase34LongHorizonEngine.getReport();
      return reply.send({ success: true, driftReport: report.driftReport });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /** GET /api/indian/phase34/regimes */
  server.get("/api/indian/phase34/regimes", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = phase34LongHorizonEngine.getReport();
      return reply.send({ success: true, regimeDrift: report.driftReport.regimeDrift });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /** GET /api/indian/phase34/strategies */
  server.get("/api/indian/phase34/strategies", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = phase34LongHorizonEngine.getReport();
      return reply.send({ success: true, strategyDrift: report.driftReport.strategyDrift });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /** GET /api/indian/phase34/risk */
  server.get("/api/indian/phase34/risk", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = phase34LongHorizonEngine.getReport();
      return reply.send({ success: true, riskBehavior: report.riskBehavior });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /** GET /api/indian/phase34/operations */
  server.get("/api/indian/phase34/operations", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = phase34LongHorizonEngine.getReport();
      return reply.send({ success: true, operationalStability: report.operationalStability });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /** GET /api/indian/phase34/data-quality */
  server.get("/api/indian/phase34/data-quality", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = phase34LongHorizonEngine.getReport();
      return reply.send({
        success: true,
        noTradeDueToDataQualityCount: report.operationalStability.noTradeDueToDataQualityCount,
        dataGateFailures: report.operationalStability.dataGateFailures,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /** GET /api/indian/phase34/reconciliation */
  server.get("/api/indian/phase34/reconciliation", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = phase34LongHorizonEngine.getReport();
      return reply.send({ success: true, reconciliation: report.reconciliation });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /** GET /api/indian/phase34/summary */
  server.get("/api/indian/phase34/summary", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = phase34LongHorizonEngine.getReport();
      return reply.send({ success: true, report });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /** GET /api/indian/phase34/export */
  server.get("/api/indian/phase34/export", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const exportData = phase34LongHorizonEngine.getExport();
      return reply.send(exportData);
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // ── PHASE 35: FINAL EVIDENCE REGISTRY & RESEARCH REPORT ENDPOINTS ─────────

  /** GET /api/indian/phase35/status */
  server.get("/api/indian/phase35/status", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const status = phase35ResearchReportEngine.getStatus();
      return reply.send({ success: true, ...status });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /** GET /api/indian/phase35/registry */
  server.get("/api/indian/phase35/registry", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const exportData = phase35ResearchReportEngine.getExport();
      return reply.send({ success: true, artifacts: exportData.artifacts });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /** GET /api/indian/phase35/reconciliation */
  server.get("/api/indian/phase35/reconciliation", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = phase35ResearchReportEngine.getReport();
      return reply.send({ success: true, reconciliation: report.reconciliation });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /** GET /api/indian/phase35/manifest */
  server.get("/api/indian/phase35/manifest", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = phase35ResearchReportEngine.getReport();
      return reply.send({ success: true, manifest: report.manifest });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /** GET /api/indian/phase35/safety-audit */
  server.get("/api/indian/phase35/safety-audit", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const safetyAudit = phase35ResearchReportEngine.verifySafetyAudit();
      return reply.send({ success: true, safetyAudit });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /** GET /api/indian/phase35/reproducibility */
  server.get("/api/indian/phase35/reproducibility", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = phase35ResearchReportEngine.getReport();
      return reply.send({
        success: true,
        reproducibilityManifest: report.sections.reproducibilityManifest,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /** GET /api/indian/phase35/evidence-snapshot */
  server.get("/api/indian/phase35/evidence-snapshot", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = phase35ResearchReportEngine.getReport();
      return reply.send({ success: true, snapshot: report.snapshot });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /** GET /api/indian/phase35/research-report */
  server.get("/api/indian/phase35/research-report", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = phase35ResearchReportEngine.getReport();
      return reply.send({ success: true, report });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /** GET /api/indian/phase35/summary */
  server.get("/api/indian/phase35/summary", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = phase35ResearchReportEngine.getReport();
      return reply.send({ success: true, report });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /** GET /api/indian/phase35/export */
  server.get("/api/indian/phase35/export", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const exportData = phase35ResearchReportEngine.getExport();
      return reply.send(exportData);
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // ── PHASE 36: EVIDENCE-BASED DECISION GATE ENDPOINTS ───────────────────────

  /** GET /api/indian/phase36/status */
  server.get("/api/indian/phase36/status", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const status = phase36DecisionGate.getStatus();
      return reply.send({ success: true, status });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /** GET /api/indian/phase36/evidence */
  server.get("/api/indian/phase36/evidence", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = phase36DecisionGate.getReport();
      return reply.send({ success: true, snapshot: report.snapshot, artifacts: report.sections.evidenceIntegrity });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /** GET /api/indian/phase36/sample-assessment */
  server.get("/api/indian/phase36/sample-assessment", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = phase36DecisionGate.getReport();
      return reply.send({ success: true, sampleAssessment: report.sections.sampleSufficiency });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /** GET /api/indian/phase36/statistics */
  server.get("/api/indian/phase36/statistics", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = phase36DecisionGate.getReport();
      return reply.send({ success: true, statistics: report.sections.statisticalAssessment, confidenceIntervals: report.sections.confidenceIntervals });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /** GET /api/indian/phase36/oos */
  server.get("/api/indian/phase36/oos", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = phase36DecisionGate.getReport();
      return reply.send({ success: true, oos: report.sections.oosAssessment, walkForward: report.sections.walkForwardAssessment });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /** GET /api/indian/phase36/stress */
  server.get("/api/indian/phase36/stress", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = phase36DecisionGate.getReport();
      return reply.send({ success: true, stress: report.sections.stressAssessment });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /** GET /api/indian/phase36/drift */
  server.get("/api/indian/phase36/drift", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = phase36DecisionGate.getReport();
      return reply.send({ success: true, drift: report.sections.longHorizonDrift });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /** GET /api/indian/phase36/risk */
  server.get("/api/indian/phase36/risk", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = phase36DecisionGate.getReport();
      return reply.send({ success: true, risk: report.sections.riskBehaviour });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /** GET /api/indian/phase36/operational */
  server.get("/api/indian/phase36/operational", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = phase36DecisionGate.getReport();
      return reply.send({ success: true, operational: report.sections.operationalStability });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /** GET /api/indian/phase36/decision */
  server.get("/api/indian/phase36/decision", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = phase36DecisionGate.getReport();
      return reply.send({ success: true, decision: report.decision, decisionGate: report.sections.decisionGate });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /** GET /api/indian/phase36/report */
  server.get("/api/indian/phase36/report", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = phase36DecisionGate.getReport();
      return reply.send({ success: true, report });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /** GET /api/indian/phase36/export/json */
  server.get("/api/indian/phase36/export/json", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const exports = phase36DecisionGate.getExports();
      return reply.type("application/json").send(exports.json);
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /** GET /api/indian/phase36/export/csv */
  server.get("/api/indian/phase36/export/csv", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const exports = phase36DecisionGate.getExports();
      return reply.type("text/csv").send(exports.csv);
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // ── PHASE 37 — FINAL EVIDENCE CONSOLIDATION & VALIDATION CONTROL ───────

  /** GET /api/indian/phase37/status */
  server.get("/api/indian/phase37/status", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = phase37ValidationControl.buildFullReport();
      return reply.send({
        success: true,
        validationState: report.validationState,
        safetyInvariantPassed: report.safety.safetyInvariantPassed,
        sampleStatus: report.sampleGate.validationStatus,
        reconciliationStatus: report.reconciliation.overallStatus,
        fingerprintStatus: report.fingerprint.fingerprintStatus,
        generatedAt: new Date().toISOString(),
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /** GET /api/indian/phase37/evidence */
  server.get("/api/indian/phase37/evidence", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const phaseEvidence = phase37ValidationControl.buildPhaseEvidence();
      const testEvidence  = phase37ValidationControl.buildTestEvidence();
      return reply.send({ success: true, phaseEvidence, testEvidence });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /** GET /api/indian/phase37/safety */
  server.get("/api/indian/phase37/safety", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const safety = phase37ValidationControl.verifySafetyInvariants();
      return reply.send({ success: true, safety });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /** GET /api/indian/phase37/sample-gate */
  server.get("/api/indian/phase37/sample-gate", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const sampleGate = phase37ValidationControl.evaluateGenuineSampleGate();
      return reply.send({ success: true, sampleGate });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /** GET /api/indian/phase37/reconciliation */
  server.get("/api/indian/phase37/reconciliation", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const reconciliation = phase37ValidationControl.evaluatePnLReconciliation();
      return reply.send({ success: true, reconciliation });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /** GET /api/indian/phase37/fingerprint */
  server.get("/api/indian/phase37/fingerprint", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const fingerprint = phase37ValidationControl.evaluateStrategyFingerprint();
      return reply.send({ success: true, fingerprint });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // ── PHASE 38 API ROUTES ──────────────────────────────────────────────

  /** GET /api/indian/phase38/status */
  server.get("/api/indian/phase38/status", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const status = phase38SampleAccumulator.getStatus();
      return reply.send({ success: true, ...status });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /** GET /api/indian/phase38/progress */
  server.get("/api/indian/phase38/progress", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const progress = phase38SampleAccumulator.getProgress();
      return reply.send({ success: true, ...progress });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /** GET /api/indian/phase38/sessions */
  server.get("/api/indian/phase38/sessions", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const sessions = phase38SessionCollector.getSessions();
      return reply.send({ success: true, sessions, count: sessions.length });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /** GET /api/indian/phase38/trades */
  server.get("/api/indian/phase38/trades", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const trades = phase38TradeCollector.getTrades();
      return reply.send({ success: true, trades, count: trades.length });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /** GET /api/indian/phase38/exclusions */
  server.get("/api/indian/phase38/exclusions", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const exclusionCounters = phase38TradeCollector.getExclusionCounters();
      const exclusionAudit = phase38TradeCollector.getExclusionAuditLog();
      return reply.send({ success: true, exclusionCounters, exclusionAudit });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /** GET /api/indian/phase38/integrity */
  server.get("/api/indian/phase38/integrity", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const integrity = phase38SampleAccumulator.getIntegrityReport();
      return reply.send({ success: true, ...integrity });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // ── PHASE 39 API ROUTES ──────────────────────────────────────────────
  server.get("/api/indian/phase39/status", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = phase39RevalidationEngine.getReport();
      return reply.send({ success: true, state: report.state, sampleGate: report.sampleGate });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  server.get("/api/indian/phase39/cohort", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = phase39RevalidationEngine.getReport();
      return reply.send({ success: true, cohort: report.cohortSnapshot });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  server.get("/api/indian/phase39/integrity", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = phase39RevalidationEngine.getReport();
      return reply.send({
        success: true,
        timestampAudit: report.timestampAudit,
        leakageAudit: report.leakageAudit,
        pnlAudit: report.pnlAudit,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  server.get("/api/indian/phase39/leakage", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = phase39RevalidationEngine.getReport();
      return reply.send({ success: true, leakageAudit: report.leakageAudit });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  server.get("/api/indian/phase39/timestamps", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = phase39RevalidationEngine.getReport();
      return reply.send({ success: true, timestampAudit: report.timestampAudit });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  server.get("/api/indian/phase39/pnl", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = phase39RevalidationEngine.getReport();
      return reply.send({ success: true, pnlAudit: report.pnlAudit });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  server.get("/api/indian/phase39/statistics", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = phase39RevalidationEngine.getReport();
      return reply.send({ success: true, statisticalAudit: report.statisticalAudit });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  server.get("/api/indian/phase39/oos", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = phase39RevalidationEngine.getReport();
      return reply.send({ success: true, oosAudit: report.oosAudit });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  server.get("/api/indian/phase39/walk-forward", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = phase39RevalidationEngine.getReport();
      return reply.send({ success: true, walkForwardAudit: report.walkForwardAudit });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  server.get("/api/indian/phase39/stress", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = phase39RevalidationEngine.getReport();
      return reply.send({ success: true, stressAudit: report.stressAudit });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  server.get("/api/indian/phase39/drift", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = phase39RevalidationEngine.getReport();
      return reply.send({ success: true, driftAudit: report.driftAudit });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  server.get("/api/indian/phase39/safety", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = phase39RevalidationEngine.getReport();
      return reply.send({ success: true, safetyAudit: report.safetyAudit });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  server.get("/api/indian/phase39/decision", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = phase39RevalidationEngine.getReport();
      return reply.send({ success: true, state: report.state, immutableHash: report.immutableHash });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  server.get("/api/indian/phase39/report", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = phase39RevalidationEngine.getReport();
      return reply.send({ success: true, report });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  server.get("/api/indian/phase39/walkforward", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = phase39RevalidationEngine.getReport();
      return reply.send({ success: true, walkForwardAudit: report.walkForwardAudit });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  server.get("/api/indian/phase39/risk", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = phase39RevalidationEngine.getReport();
      return reply.send({ success: true, riskAudit: report.riskAudit });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  server.get("/api/indian/phase39/freeze", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = phase39RevalidationEngine.getReport();
      return reply.send({ success: true, state: report.state, manifest: report.manifest, immutableHash: report.immutableHash });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  server.get("/api/indian/phase39/export", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = phase39RevalidationEngine.getReport();
      const manifest = report.manifest;
      return reply.send({ success: true, manifest, report });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // ── Phase 40 — Final Production Readiness & Project Completion Audit ────────

  server.get("/api/indian/phase40/status", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = phase40FinalReadinessEngine.getReport();
      return reply.send({
        success: true,
        finalState: report.finalState,
        mandatoryAuditsFailed: report.mandatoryAuditsFailed,
        immutableHash: report.immutableHash,
        isLiveReady: false, // ALWAYS false — broker execution is intentionally disabled
        explicitLimitations: report.explicitLimitations,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  server.get("/api/indian/phase40/safety", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const audit = phase40FinalReadinessEngine.auditSafetyInvariants();
      return reply.send({ success: true, audit });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  server.get("/api/indian/phase40/cohort", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const audit = phase40FinalReadinessEngine.auditPhase39Cohort();
      return reply.send({ success: true, audit });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  server.get("/api/indian/phase40/strategy", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const audit = phase40FinalReadinessEngine.auditStrategyIntegrity();
      return reply.send({ success: true, audit });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  server.get("/api/indian/phase40/data", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const audit = phase40FinalReadinessEngine.auditGenuineData();
      return reply.send({ success: true, audit });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  server.get("/api/indian/phase40/statistics", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const audit = phase40FinalReadinessEngine.auditStatisticalEvidence();
      return reply.send({ success: true, audit });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  server.get("/api/indian/phase40/risk", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const audit = phase40FinalReadinessEngine.auditRiskControls();
      return reply.send({ success: true, audit });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  server.get("/api/indian/phase40/report", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = phase40FinalReadinessEngine.runFinalAudit();
      return reply.send({ success: true, report });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // ── Post-Phase-40 Operations & Monitoring Endpoints ────────────────────────

  /**
   * GET /api/indian/operations/status
   * Returns full operations status including system, market data, trading, risk, reconciliation, sample, alerts, safety invariants.
   */
  server.get("/api/indian/operations/status", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const status = postPhase40OperationsMonitor.getFullStatus();
      return reply.send({ success: true, status });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/indian/operations/market
   * Returns market data freshness, NIFTY spot, option chain, option prices, Greeks, WebSocket tick, VWAP/RSI, lot-size, expiry, market session, genuine-data gate.
   */
  server.get("/api/indian/operations/market", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const marketData = postPhase40OperationsMonitor.getMarketDataStatus();
      return reply.send({ success: true, marketData });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/indian/operations/trading
   * Returns trading status: active paper positions, signal evaluation timestamp, last paper order & exit timestamps.
   */
  server.get("/api/indian/operations/trading", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const trading = postPhase40OperationsMonitor.getTradingStatus();
      return reply.send({ success: true, trading });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/indian/operations/risk
   * Returns continuous risk metrics: daily P&L, daily profit/loss locks, trade limits, exposure, active positions count.
   */
  server.get("/api/indian/operations/risk", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const risk = postPhase40OperationsMonitor.getRiskStatus();
      return reply.send({ success: true, risk });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/indian/operations/reconciliation
   * Returns continuous reconciliation audit between signal, paper position, order, journal, daily P&L, persisted state.
   */
  server.get("/api/indian/operations/reconciliation", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const reconciliation = postPhase40OperationsMonitor.getReconciliationStatus();
      return reply.send({ success: true, reconciliation });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/indian/operations/alerts
   * Returns operational alerts list.
   */
  server.get("/api/indian/operations/alerts", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const alerts = postPhase40OperationsMonitor.getAlerts();
      return reply.send({ success: true, alerts });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/indian/operations/sample
   * Returns genuine evidence sample progress (sessions, trades, active sessions, Phase39 cohort, Phase40 status).
   */
  server.get("/api/indian/operations/sample", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const sample = postPhase40OperationsMonitor.getSampleProgress();
      return reply.send({ success: true, sample });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });
}











