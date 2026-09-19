import { KillSwitchState } from "../broker/IBrokerAdapter";

export interface FailClosedDependencyStatus {
  brokerConnection: boolean;
  marketData: boolean;
  database: boolean;
  riskEngine: boolean;
  reconciliation: boolean;
  instrumentResolver: boolean;
  authentication: boolean;
}

export interface SafetyCheckResult {
  allowed: boolean;
  reason: string | null;
  errorCode: string | null;
  dependencies: FailClosedDependencyStatus;
}

export class BrokerSafetyLock {
  public readonly PAPER_TRADING = true;
  public readonly LIVE_TRADING = false;
  public readonly BROKER_EXECUTION_ENABLED = false;
  private liveBrokerOrderCount = 0;
  private killSwitchState: KillSwitchState = "DISABLED";

  /**
   * Evaluates all independent safety layers before allowing any order execution request.
   * Fails CLOSED if any lock or dependency fails.
   */
  public validateExecutionSafety(dependencies?: Partial<FailClosedDependencyStatus>): SafetyCheckResult {
    const deps: FailClosedDependencyStatus = {
      brokerConnection: dependencies?.brokerConnection ?? true,
      marketData: dependencies?.marketData ?? true,
      database: dependencies?.database ?? true,
      riskEngine: dependencies?.riskEngine ?? true,
      reconciliation: dependencies?.reconciliation ?? true,
      instrumentResolver: dependencies?.instrumentResolver ?? true,
      authentication: dependencies?.authentication ?? true,
    };

    // Rule 1: Server-Side Emergency Kill Switch
    if (this.killSwitchState === "TRADING_HALTED") {
      return {
        allowed: false,
        reason: "EMERGENCY KILL SWITCH ACTIVE: Trading is currently HALTED by server administrator.",
        errorCode: "KILL_SWITCH_HALTED",
        dependencies: deps,
      };
    }

    // Rule 2: Permanent Hard-Locked Safety Flags
    if (this.PAPER_TRADING !== true || this.LIVE_TRADING !== false || this.BROKER_EXECUTION_ENABLED !== false) {
      return {
        allowed: false,
        reason: "SAFETY LOCK VIOLATION: Hard-locked safety constants tampered. System forced to FAIL CLOSED.",
        errorCode: "LIVE_EXECUTION_PERMANENTLY_DISABLED",
        dependencies: deps,
      };
    }

    // Live broker execution is hard-disabled
    if (!this.BROKER_EXECUTION_ENABLED || !this.LIVE_TRADING) {
      return {
        allowed: false,
        reason: "LIVE EXECUTION DISABLED: PAPER_TRADING=true, LIVE_TRADING=false, BROKER_EXECUTION_ENABLED=false.",
        errorCode: "LIVE_EXECUTION_PERMANENTLY_DISABLED",
        dependencies: deps,
      };
    }

    // Rule 3: Fail-Closed Dependency Check
    const failedDeps: string[] = [];
    if (!deps.brokerConnection) failedDeps.push("Broker Connection");
    if (!deps.marketData) failedDeps.push("Market Data");
    if (!deps.database) failedDeps.push("Database");
    if (!deps.riskEngine) failedDeps.push("Risk Engine");
    if (!deps.reconciliation) failedDeps.push("Reconciliation Engine");
    if (!deps.instrumentResolver) failedDeps.push("Instrument Resolver");
    if (!deps.authentication) failedDeps.push("Authentication System");

    if (failedDeps.length > 0) {
      return {
        allowed: false,
        reason: `FAIL CLOSED: Critical dependencies unavailable (${failedDeps.join(", ")})`,
        errorCode: "FAIL_CLOSED_DEPENDENCY_UNAVAILABLE",
        dependencies: deps,
      };
    }

    return {
      allowed: true,
      reason: null,
      errorCode: null,
      dependencies: deps,
    };
  }

  /**
   * Sets the server-side emergency kill switch state.
   */
  public setKillSwitchState(state: KillSwitchState): void {
    this.killSwitchState = state;
  }

  public getKillSwitchState(): KillSwitchState {
    return this.killSwitchState;
  }

  public getLiveBrokerOrderCount(): number {
    return this.liveBrokerOrderCount;
  }

  /**
   * Sanitizes object payloads to guarantee credentials or tokens are never logged or exposed.
   */
  public sanitizeCredentials(payload: any): any {
    if (!payload || typeof payload !== "object") return payload;
    const clean = Array.isArray(payload) ? [...payload] : { ...payload };

    const SENSITIVE_KEYS = [
      "apiKey",
      "api_key",
      "apiSecret",
      "api_secret",
      "accessToken",
      "access_token",
      "password",
      "token",
      "TELEGRAM_BOT_TOKEN",
      "TELEGRAM_CHAT_ID",
      "SUPABASE_SERVICE_ROLE_KEY",
      "jwt",
      "bearer",
    ];

    for (const key of Object.keys(clean)) {
      if (SENSITIVE_KEYS.some((s) => key.toLowerCase().includes(s.toLowerCase()))) {
        clean[key] = "[REDACTED_CREDENTIAL]";
      } else if (typeof clean[key] === "object" && clean[key] !== null) {
        clean[key] = this.sanitizeCredentials(clean[key]);
      }
    }

    return clean;
  }
}

export const brokerSafetyLock = new BrokerSafetyLock();
