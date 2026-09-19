import { niftyMarketProvider } from "../market/NiftyMarketProvider";
import { dailyRiskController } from "../risk/DailyRiskController";
import { reconciliationEngine } from "../reconciliation/ReconciliationEngine";
import { systemHealthService } from "./SystemHealthService";
import { envValidator } from "../config/EnvValidator";

export type ComponentHealthState = "HEALTHY" | "DEGRADED" | "UNHEALTHY";

export interface ComponentHealthStatus {
  name: string;
  status: ComponentHealthState;
  details?: string;
}

export interface SystemHealthCheckReport {
  overallStatus: ComponentHealthState;
  isTradingAllowed: boolean;
  timestamp: string;
  components: ComponentHealthStatus[];
}

export class HealthCheckService {
  /**
   * Evaluates comprehensive health checks across all trading engine subsystems.
   */
  public getHealthCheckReport(): SystemHealthCheckReport {
    const timestamp = new Date().toISOString();
    const components: ComponentHealthStatus[] = [];

    // 1. Environment & Config Safety
    const envRes = envValidator.validateEnvironment();
    components.push({
      name: "Environment & Safety Lock",
      status: envRes.isValid ? "HEALTHY" : "UNHEALTHY",
      details: envRes.isValid ? "LIVE_TRADING = false hardcoded lock verified" : envRes.errors.join("; "),
    });

    // 2. Market Data Feed
    const marketHealth = niftyMarketProvider.getDataHealth();
    components.push({
      name: "Market Data Feed",
      status: marketHealth.isStale ? "UNHEALTHY" : "HEALTHY",
      details: marketHealth.errorMessage || "Fresh feeds active",
    });

    // 3. Option Chain Service
    const compHealth = niftyMarketProvider.getDataComponentHealthMap();
    components.push({
      name: "Option Chain Service",
      status: compHealth.optionChain === "STALE" ? "UNHEALTHY" : "HEALTHY",
      details: compHealth.overallDataQuality,
    });

    // 4. Daily Risk Controller
    const riskState = dailyRiskController.getState();
    components.push({
      name: "Risk Controller Engine",
      status: riskState.isTradeLocked ? "DEGRADED" : "HEALTHY",
      details: riskState.lockReason || "Normal operation",
    });

    // 5. Reconciliation Engine
    const reconReport = reconciliationEngine.runReconciliation();
    const isReconSafe = reconReport.isSafe;
    components.push({
      name: "Reconciliation Engine",
      status: isReconSafe ? "HEALTHY" : "UNHEALTHY",
      details: isReconSafe ? "State reconciled cleanly" : `${reconReport.discrepancies.length} discrepancy detected`,
    });


    // 6. Paper Broker Execution Engine
    components.push({
      name: "Paper Broker Adapter",
      status: "HEALTHY",
      details: "Isolated paper memory adapter operational",
    });

    // Compute Overall Health Status
    const hasUnhealthy = components.some((c) => c.status === "UNHEALTHY");
    const hasDegraded = components.some((c) => c.status === "DEGRADED");

    let overallStatus: ComponentHealthState = "HEALTHY";
    if (hasUnhealthy) overallStatus = "UNHEALTHY";
    else if (hasDegraded) overallStatus = "DEGRADED";

    const isTradingAllowed = overallStatus !== "UNHEALTHY" && !riskState.isTradeLocked;

    return {
      overallStatus,
      isTradingAllowed,
      timestamp,
      components,
    };
  }
}

export const healthCheckService = new HealthCheckService();
