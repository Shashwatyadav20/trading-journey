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
import { phase17PaperSessionTracker } from "../indian/lifecycle/Phase17PaperSessionTracker";
import { phase18DataFreshnessMonitor } from "../indian/market/Phase18DataFreshnessMonitor";
import { operationalAlertLogger } from "../indian/audit/OperationalAlertLogger";
import { phase19GenuineValidationEngine } from "../indian/validation/Phase19GenuineValidationEngine";
import { brokerManager } from "../indian/broker/BrokerManager";
import { dhanBrokerAdapter } from "../indian/broker/DhanBrokerAdapter";
import { phase21OperationalMonitor } from "../indian/validation/Phase21OperationalMonitor";





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
}









