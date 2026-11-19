import { FastifyInstance, FastifyPluginAsync } from "fastify";
import { authenticateRequest, getVerifiedUser } from "../auth/middleware";
import {
  Strategy03DataIngestionService,
  strategy03DataIngestionService,
} from "../indian/swing/research/strategy03/Strategy03DataIngestionService";
import {
  Strategy03ResearchEvaluator,
  strategy03ResearchEvaluator,
} from "../indian/swing/research/strategy03/Strategy03ResearchPipeline";
import {
  Strategy03UniverseService,
  strategy03UniverseService,
} from "../indian/swing/research/strategy03/Strategy03UniverseService";

export function buildStrategy03DataRoutes(
  service: Strategy03DataIngestionService = strategy03DataIngestionService,
  evaluator: Strategy03ResearchEvaluator = strategy03ResearchEvaluator,
  universeSvc: Strategy03UniverseService = strategy03UniverseService
): FastifyPluginAsync {
  let lastIngestAtMs = 0;

  return async (fastify: FastifyInstance) => {
    fastify.get(
      "/api/indian/strategy03/data/coverage",
      { preHandler: [authenticateRequest] },
      async (request, reply) => {
        getVerifiedUser(request);
        const universe = await service.loadPaginatedUniverse();
        const nseEligible = universe.filter((u) => Boolean(u.nseSymbol));
        return reply.send({
          success: true,
          researchOnly: true,
          strategy03Active: false,
          totalUniverseRecords: universe.length,
          nseEligibleRecords: nseEligible.length,
        });
      }
    );

    fastify.post(
      "/api/indian/strategy03/data/ingest",
      { preHandler: [authenticateRequest] },
      async (request, reply) => {
        getVerifiedUser(request);
        const body = (request.body || {}) as {
          deliveryDateIso?: string;
          maxEnrichedSymbols?: number;
          persist?: boolean;
        };
        if (
          body.deliveryDateIso !== undefined &&
          !/^\d{4}-\d{2}-\d{2}$/.test(body.deliveryDateIso)
        ) {
          return reply.status(400).send({
            success: false,
            error: "Invalid deliveryDateIso; expected YYYY-MM-DD.",
          });
        }
        if (
          body.maxEnrichedSymbols !== undefined &&
          (typeof body.maxEnrichedSymbols !== "number" ||
            body.maxEnrichedSymbols < 0 ||
            body.maxEnrichedSymbols > 50)
        ) {
          return reply.status(400).send({
            success: false,
            error: "maxEnrichedSymbols must be between 0 and 50.",
          });
        }
        const now = Date.now();
        if (now - lastIngestAtMs < 5000) {
          return reply.status(429).send({
            success: false,
            error: "Rate limit: wait at least 5 seconds between ingestion runs.",
          });
        }
        lastIngestAtMs = now;
        try {
          const result = await service.runControlledIngestion({
            deliveryDateIso: body.deliveryDateIso,
            maxEnrichedSymbols: body.maxEnrichedSymbols ?? 10,
            persist: Boolean(body.persist),
          });
          return reply.send({
            success: true,
            researchOnly: true,
            strategy03Active: false,
            stats: result.stats,
          });
        } catch (err: any) {
          return reply.status(500).send({
            success: false,
            error: err?.message ?? "Ingestion failed",
          });
        }
      }
    );

    fastify.post(
      "/api/indian/strategy03/research/evaluate-symbol",
      { preHandler: [authenticateRequest] },
      async (request, reply) => {
        getVerifiedUser(request);
        const body = (request.body || {}) as {
          symbol?: string;
          companyName?: string;
          bseCode?: string | null;
          persist?: boolean;
        };
        if (!body.symbol || !body.symbol.trim()) {
          return reply.status(400).send({ success: false, error: "symbol is required." });
        }
        const evaluation = await evaluator.evaluateSymbol({
          symbol: body.symbol.trim().toUpperCase(),
          companyName: body.companyName,
          bseCode: body.bseCode ?? null,
          persist: Boolean(body.persist),
        });
        return reply.send({
          success: true,
          researchOnly: true,
          strategy03Active: false,
          evaluation,
        });
      }
    );

    fastify.post(
      "/api/indian/strategy03/research/run",
      { preHandler: [authenticateRequest] },
      async (request, reply) => {
        getVerifiedUser(request);
        const body = (request.body || {}) as { maxSymbols?: number; offset?: number; persist?: boolean };
        const maxSymbols = body.maxSymbols ?? 10;
        if (typeof maxSymbols !== "number" || maxSymbols < 1 || maxSymbols > 25) {
          return reply.status(400).send({ success: false, error: "maxSymbols must be between 1 and 25." });
        }
        const offset = Math.max(0, body.offset ?? 0);
        const all = await universeSvc.loadAllPaginated();
        const eligible = all.filter((u) => u.eligibleForNseResearch && u.nseSymbol);
        const slice = eligible.slice(offset, offset + maxSymbols);
        const results = [];
        for (const eq of slice) {
          const r = await evaluator.evaluateSymbol({
            symbol: eq.nseSymbol!,
            isin: eq.isin,
            companyName: eq.companyName,
            bseCode: eq.bseCode,
            persist: Boolean(body.persist),
          });
          results.push(r);
        }
        return reply.send({
          success: true,
          researchOnly: true,
          strategy03Active: false,
          totalEligible: eligible.length,
          evaluatedCount: results.length,
          results,
        });
      }
    );

    fastify.get(
      "/api/indian/strategy03/research/results",
      { preHandler: [authenticateRequest] },
      async (request, reply) => {
        getVerifiedUser(request);
        const q = (request.query || {}) as { limit?: string; offset?: string; decision?: string };
        const limit = Math.min(100, Math.max(1, Number(q.limit ?? 25)));
        const offset = Math.max(0, Number(q.offset ?? 0));
        const results = await evaluator.listResults({
          limit,
          offset,
          decision: q.decision,
        });
        return reply.send({
          success: true,
          researchOnly: true,
          strategy03Active: false,
          results,
        });
      }
    );

    fastify.get(
      "/api/indian/strategy03/research/results/:symbol",
      { preHandler: [authenticateRequest] },
      async (request, reply) => {
        getVerifiedUser(request);
        const { symbol } = request.params as { symbol: string };
        const history = await evaluator.getSymbolHistory(symbol);
        return reply.send({
          success: true,
          researchOnly: true,
          strategy03Active: false,
          symbol: symbol.toUpperCase(),
          history,
        });
      }
    );

    fastify.get(
      "/api/indian/strategy03/research/ownership/:symbol",
      { preHandler: [authenticateRequest] },
      async (request, reply) => {
        getVerifiedUser(request);
        const { symbol } = request.params as { symbol: string };
        const sym = symbol.toUpperCase();
        const sb = (await import("../db/supabaseClient")).getAdminSupabaseClient();
        const { data, error } = await sb
          .from("strategy03_institutional_ownership")
          .select("*")
          .eq("symbol", sym)
          .order("reporting_quarter", { ascending: false })
          .order("version", { ascending: false })
          .limit(12);

        if (error) {
          return reply.send({
            success: true,
            researchOnly: true,
            strategy03Active: false,
            symbol: sym,
            tableStatus: error.code === "PGRST205" ? "LOCAL_ONLY_NOT_APPLIED_REMOTELY" : "ERROR",
            records: [],
          });
        }
        return reply.send({
          success: true,
          researchOnly: true,
          strategy03Active: false,
          symbol: sym,
          tableStatus: "REMOTE_VERIFIED",
          records: data ?? [],
        });
      }
    );

    fastify.get(
      "/api/indian/strategy03/research/shadow",
      { preHandler: [authenticateRequest] },
      async (request, reply) => {
        getVerifiedUser(request);
        const fsMod = await import("node:fs");
        const pathMod = await import("node:path");
        const baseDir = pathMod.resolve(process.cwd(), "data/research/strategy03/phase69");
        const evalPath = pathMod.join(baseDir, "shadow_daily_evaluations.json");
        const covPath = pathMod.join(baseDir, "shadow_data_coverage.json");
        const healthPath = pathMod.resolve(process.cwd(), "data/research/strategy03/phase6107/operational_health_report.json");
        const watchlistPath = pathMod.resolve(process.cwd(), "data/research/strategy03/phase61012/momentum_watchlist.json");
        const preBreakoutPath = pathMod.resolve(process.cwd(), "data/research/strategy03/phase61019/prebreakout_watchlist.json");
        const monAlertsPath = pathMod.resolve(process.cwd(), "data/research/strategy03/phase610199/monitoring_alerts.json");
        const monStatesPath = pathMod.resolve(process.cwd(), "data/research/strategy03/phase610199/candidate_state_history.json");
        const monPersistStatusPath = pathMod.resolve(process.cwd(), "data/research/strategy03/phase6101910/persistence_status.json");
        const monReconcilePath = pathMod.resolve(process.cwd(), "data/research/strategy03/phase6101910/reconciliation_report.json");
        const fwdSummaryPath = pathMod.resolve(process.cwd(), "data/research/strategy03/phase6101911/forward_shadow_summary.json");
        const fwdSnapshotsPath = pathMod.resolve(process.cwd(), "data/research/strategy03/phase6101911/forward_signal_snapshots.json");
        const fwdOutcomesPath = pathMod.resolve(process.cwd(), "data/research/strategy03/phase6101911/forward_signal_outcomes.json");
        const fwdAuditPath = pathMod.resolve(process.cwd(), "data/research/strategy03/phase6101912/independent_forward_audit_report.json");
        const fwdMaturityDashPath = pathMod.resolve(process.cwd(), "data/research/strategy03/phase6101913/forward_maturity_dashboard.json");
        const persistActivationPath = pathMod.resolve(process.cwd(), "data/research/strategy03/phase6101914/persistence_activation_audit.json");
        const opHealth15Path = pathMod.resolve(process.cwd(), "data/research/strategy03/phase6101915/operational_health_dashboard.json");
        const deployHealth16Path = pathMod.resolve(process.cwd(), "data/research/strategy03/phase6101916/deployment_runtime_verification.json");
        const renderLive17Path = pathMod.resolve(process.cwd(), "data/research/strategy03/phase6101917/render_live_runtime_verification.json");
        const forwardMaturity18Path = pathMod.resolve(process.cwd(), "data/research/strategy03/phase6101918/phase6101918_forward_maturity_audit.json");
        const evalData = fsMod.existsSync(evalPath)
          ? JSON.parse(fsMod.readFileSync(evalPath, "utf8"))
          : null;
        const covData = fsMod.existsSync(covPath)
          ? JSON.parse(fsMod.readFileSync(covPath, "utf8"))
          : null;
        const healthData = fsMod.existsSync(healthPath)
          ? JSON.parse(fsMod.readFileSync(healthPath, "utf8"))
          : null;
        const watchlistData = fsMod.existsSync(watchlistPath)
          ? JSON.parse(fsMod.readFileSync(watchlistPath, "utf8"))
          : [];
        const preBreakoutWatchlist = fsMod.existsSync(preBreakoutPath)
          ? JSON.parse(fsMod.readFileSync(preBreakoutPath, "utf8"))
          : [];
        const monitoringAlerts = fsMod.existsSync(monAlertsPath)
          ? JSON.parse(fsMod.readFileSync(monAlertsPath, "utf8"))
          : [];
        const candidateStates = fsMod.existsSync(monStatesPath)
          ? JSON.parse(fsMod.readFileSync(monStatesPath, "utf8"))
          : [];
        const monitoringPersistence = fsMod.existsSync(monPersistStatusPath)
          ? JSON.parse(fsMod.readFileSync(monPersistStatusPath, "utf8"))
          : {
              status: "LOCAL_ONLY",
              remoteTablesAvailable: false,
              pendingWalCount: 0,
              blockerCode: "PGRST205",
              blockerMessage: "Could not find the table 'public.strategy03_monitoring_runs' in the schema cache",
            };
        const monitoringReconciliation = fsMod.existsSync(monReconcilePath)
          ? JSON.parse(fsMod.readFileSync(monReconcilePath, "utf8"))
          : null;
        const forwardShadowSummary = fsMod.existsSync(fwdSummaryPath)
          ? JSON.parse(fsMod.readFileSync(fwdSummaryPath, "utf8"))
          : null;
        const forwardSignalSnapshots = fsMod.existsSync(fwdSnapshotsPath)
          ? JSON.parse(fsMod.readFileSync(fwdSnapshotsPath, "utf8"))
          : [];
        const forwardSignalOutcomes = fsMod.existsSync(fwdOutcomesPath)
          ? JSON.parse(fsMod.readFileSync(fwdOutcomesPath, "utf8"))
          : [];
        const independentForwardAudit = fsMod.existsSync(fwdAuditPath)
          ? JSON.parse(fsMod.readFileSync(fwdAuditPath, "utf8"))
          : null;
        const forwardMaturityDashboard = fsMod.existsSync(fwdMaturityDashPath)
          ? JSON.parse(fsMod.readFileSync(fwdMaturityDashPath, "utf8"))
          : null;
        const persistenceActivationAudit = fsMod.existsSync(persistActivationPath)
          ? JSON.parse(fsMod.readFileSync(persistActivationPath, "utf8"))
          : null;
        const fourHourOperationalHealth = fsMod.existsSync(opHealth15Path)
          ? JSON.parse(fsMod.readFileSync(opHealth15Path, "utf8"))
          : null;
        const renderLiveVerification = fsMod.existsSync(renderLive17Path)
          ? JSON.parse(fsMod.readFileSync(renderLive17Path, "utf8"))
          : null;
        const phase6101918ForwardMaturityAudit = fsMod.existsSync(forwardMaturity18Path)
          ? JSON.parse(fsMod.readFileSync(forwardMaturity18Path, "utf8"))
          : null;
        const { strategy03ShadowService } = await import(
          "../indian/swing/research/strategy03/Strategy03ShadowService"
        );
        const { strategy03FourHourMonitoringService } = await import(
          "../indian/swing/research/strategy03/prebreakout/Strategy03FourHourMonitoringService"
        );
        const liveDeployHealth = strategy03FourHourMonitoringService.getDeploymentHealth();
        const savedDeployHealth = fsMod.existsSync(deployHealth16Path)
          ? JSON.parse(fsMod.readFileSync(deployHealth16Path, "utf8"))
          : null;
        const deploymentRuntimeHealth =
          liveDeployHealth.schedulerBootstrapStatus === "BOOTSTRAPPED_ACTIVE"
            ? liveDeployHealth
            : savedDeployHealth ?? liveDeployHealth;
        return reply.send({
          success: true,
          researchOnly: true,
          strategy03Active: false,
          executionEnabled: false,
          shadow: evalData,
          coverage: covData,
          operationalHealth: healthData,
          schedulerHealth: strategy03ShadowService.getHealthStatus(),
          watchlist: watchlistData,
          preBreakoutWatchlist,
          monitoringAlerts,
          candidateStates,
          monitoringPersistence,
          monitoringReconciliation,
          forwardShadowSummary,
          forwardSignalSnapshots,
          forwardSignalOutcomes,
          independentForwardAudit,
          forwardMaturityDashboard,
          persistenceActivationAudit,
          fourHourOperationalHealth,
          deploymentRuntimeHealth,
          renderLiveVerification,
          phase6101918ForwardMaturityAudit,
        });
      }
    );
  };
}

export default buildStrategy03DataRoutes();

