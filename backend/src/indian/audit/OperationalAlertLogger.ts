export type OperationalEventType =
  | "PROVIDER_DISCONNECTED"
  | "DATA_STALE"
  | "DATA_GATE_BLOCKED"
  | "LOT_SIZE_UNVERIFIED"
  | "AUTHENTICATION_FAILURE"
  | "RATE_LIMIT"
  | "RECONCILIATION_MISMATCH"
  | "PAPER_EXECUTION_FAILURE"
  | "DAILY_RISK_LOCK"
  | "SAFETY_LOCK_ENFORCED"
  | "NSE_DISCONNECTED"
  | "DHAN_DISCONNECTED"
  | "DATA_SOURCE_MISMATCH"
  | "INSTRUMENT_MISMATCH"
  | "TOKEN_EXPIRED"
  | "PAPER_STATE_MISMATCH"
  | "PNL_MISMATCH"
  | "RECONCILIATION_FAILURE"
  | "UNEXPECTED_EXTERNAL_ORDER";

export interface OperationalAlertRecord {
  id: string;
  eventType: OperationalEventType;
  timestamp: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
  message: string;
  metadata?: Record<string, any>;
}

export class OperationalAlertLogger {
  private alerts: OperationalAlertRecord[] = [];
  private readonly maxAlerts = 200;

  public logAlert(
    eventType: OperationalEventType,
    message: string,
    severity: "INFO" | "WARNING" | "CRITICAL" = "WARNING",
    metadata?: Record<string, any>,
  ): OperationalAlertRecord {
    const alert: OperationalAlertRecord = {
      id: `op_alert_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      eventType,
      timestamp: new Date().toISOString(),
      severity,
      message,
      metadata,
    };

    this.alerts.unshift(alert);
    if (this.alerts.length > this.maxAlerts) {
      this.alerts = this.alerts.slice(0, this.maxAlerts);
    }

    return alert;
  }

  public getOperationalAlerts(limit: number = 50): OperationalAlertRecord[] {
    return this.alerts.slice(0, limit);
  }

  public clearAlerts(): void {
    this.alerts = [];
  }
}

export const operationalAlertLogger = new OperationalAlertLogger();
