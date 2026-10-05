export interface OperationalIncidentRecord {
  incidentId: string;
  type:
    | "DHAN_CONNECTION_FAILURE"
    | "WEBSOCKET_DISCONNECT"
    | "OPTION_CHAIN_FAILURE"
    | "STALE_DATA"
    | "PRICE_MISMATCH"
    | "RESTART_RECOVERY"
    | "DUPLICATE_SUPPRESSION"
    | "DATA_GATE_FAILURE";
  timestamp: string;
  sessionId?: string;
  recovered: boolean;
  recoveryDurationMs?: number;
  details: string;
}

export interface Phase34OperationalStabilitySummary {
  totalSessionsEvaluated: number;
  dhanConnectionFailures: number;
  webSocketDisconnects: number;
  webSocketRecoveries: number;
  optionChainFailures: number;
  staleDataEvents: number;
  priceMismatchEvents: number;
  restartRecoveryEvents: number;
  duplicateSuppressionEvents: number;
  dataGateFailures: number;
  noTradeDueToDataQualityCount: number;
  unresolvedIncidentsCount: number;
  recoveryStatus: "ALL_RECOVERED" | "UNRESOLVED_INCIDENTS";
}

export class Phase34OperationalStabilityEngine {
  private incidents: OperationalIncidentRecord[] = [];

  public logIncident(incident: Omit<OperationalIncidentRecord, "incidentId" | "timestamp">): OperationalIncidentRecord {
    const record: OperationalIncidentRecord = {
      ...incident,
      incidentId: `INC_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      timestamp: new Date().toISOString(),
    };
    this.incidents.push(record);
    return record;
  }

  public getIncidents(): readonly OperationalIncidentRecord[] {
    return this.incidents;
  }

  public getStabilitySummary(totalSessions: number = 0): Phase34OperationalStabilitySummary {
    let dhanFailures = 0;
    let wsDisconnects = 0;
    let wsRecoveries = 0;
    let optionChainFailures = 0;
    let staleDataEvents = 0;
    let priceMismatchEvents = 0;
    let restartRecoveryEvents = 0;
    let duplicateSuppressionEvents = 0;
    let dataGateFailures = 0;
    let unresolvedCount = 0;

    for (const inc of this.incidents) {
      if (inc.type === "DHAN_CONNECTION_FAILURE") dhanFailures++;
      else if (inc.type === "WEBSOCKET_DISCONNECT") {
        wsDisconnects++;
        if (inc.recovered) wsRecoveries++;
      } else if (inc.type === "OPTION_CHAIN_FAILURE") optionChainFailures++;
      else if (inc.type === "STALE_DATA") staleDataEvents++;
      else if (inc.type === "PRICE_MISMATCH") priceMismatchEvents++;
      else if (inc.type === "RESTART_RECOVERY") restartRecoveryEvents++;
      else if (inc.type === "DUPLICATE_SUPPRESSION") duplicateSuppressionEvents++;
      else if (inc.type === "DATA_GATE_FAILURE") dataGateFailures++;

      if (!inc.recovered) unresolvedCount++;
    }

    const noTradeDueToDataQualityCount = optionChainFailures + staleDataEvents + priceMismatchEvents + dataGateFailures;

    return {
      totalSessionsEvaluated: totalSessions,
      dhanConnectionFailures: dhanFailures,
      webSocketDisconnects: wsDisconnects,
      webSocketRecoveries: wsRecoveries,
      optionChainFailures,
      staleDataEvents,
      priceMismatchEvents,
      restartRecoveryEvents,
      duplicateSuppressionEvents,
      dataGateFailures,
      noTradeDueToDataQualityCount,
      unresolvedIncidentsCount: unresolvedCount,
      recoveryStatus: unresolvedCount === 0 ? "ALL_RECOVERED" : "UNRESOLVED_INCIDENTS",
    };
  }

  public clearAllForTesting(): void {
    this.incidents = [];
  }
}

export const phase34OperationalStabilityEngine = new Phase34OperationalStabilityEngine();
