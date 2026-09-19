import { NiftySpreadPosition, DailyRiskState } from "../types";
import { paperBrokerAdapter } from "../broker/PaperBrokerAdapter";
import { dailyRiskController } from "../risk/DailyRiskController";
import { paperJournalStore } from "../audit/PaperJournalStore";
import { paperPersistenceManager } from "../persistence/PaperPersistenceManager";
import { auditLogger } from "../audit/AuditLogger";

export interface ReconciliationDiscrepancy {
  type: "ORPHAN_POSITION" | "DUPLICATE_POSITION" | "PNL_MISMATCH" | "STATE_DISCREPANCY";
  entityId: string;
  description: string;
  severity: "WARN" | "ERROR" | "CRITICAL";
  timestamp: string;
}

export interface ReconciliationAuditReport {
  isSafe: boolean;
  lastRunTimestamp: string;
  totalOpenPositions: number;
  totalClosedPositions: number;
  calculatedDailyPnl: number;
  trackedDailyPnl: number;
  discrepancies: ReconciliationDiscrepancy[];
}

export class ReconciliationEngine {
  private isReconciliationSafe = true;
  private lastAuditReport: ReconciliationAuditReport | null = null;

  /**
   * Performs complete state reconciliation audit.
   */
  public runReconciliation(): ReconciliationAuditReport {
    const timestamp = new Date().toISOString();
    const discrepancies: ReconciliationDiscrepancy[] = [];

    const openPositions = paperBrokerAdapter.getOpenPositions();
    const closedPositions = paperBrokerAdapter.getClosedPositions();
    const dailyState = dailyRiskController.getState();
    const journalEntries = paperJournalStore.getJournalEntries(500);

    // 1. Duplicate Position ID Check
    const seenIds = new Set<string>();
    const allPositions = [...openPositions, ...closedPositions];
    for (const pos of allPositions) {
      if (seenIds.has(pos.id)) {
        discrepancies.push({
          type: "DUPLICATE_POSITION",
          entityId: pos.id,
          description: `Duplicate position ID detected: ${pos.id}`,
          severity: "CRITICAL",
          timestamp,
        });
      }
      seenIds.add(pos.id);
    }

    // 2. Orphan Position Check (Open position missing execution journal entry)
    const execJournalPositionIds = new Set(
      journalEntries.filter((j) => j.eventType === "ORDER_EXECUTED" && j.positionId).map((j) => j.positionId)
    );

    for (const openPos of openPositions) {
      if (!execJournalPositionIds.has(openPos.id)) {
        discrepancies.push({
          type: "ORPHAN_POSITION",
          entityId: openPos.id,
          description: `Open position ${openPos.id} is missing execution audit record in paper journal`,
          severity: "ERROR",
          timestamp,
        });
      }
    }

    // 3. P&L Sum Reconciliation
    const calculatedSumClosedNetPnl = Number(
      closedPositions.reduce((acc, pos) => acc + (pos.realizedNetPnl || 0), 0).toFixed(2)
    );

    if (Math.abs(calculatedSumClosedNetPnl - dailyState.dailyPnl) > 0.5) {
      discrepancies.push({
        type: "PNL_MISMATCH",
        entityId: "DAILY_PNL",
        description: `Sum of closed trades net P&L (₹${calculatedSumClosedNetPnl}) does not match DailyRiskController tracked P&L (₹${dailyState.dailyPnl})`,
        severity: "CRITICAL",
        timestamp,
      });
    }

    // 4. Evaluate Safety Verdict
    const hasCriticalDiscrepancy = discrepancies.some((d) => d.severity === "CRITICAL");
    this.isReconciliationSafe = !hasCriticalDiscrepancy;

    if (hasCriticalDiscrepancy) {
      auditLogger.log("RECONCILIATION_CRITICAL_FAILURE", "SYSTEM", {
        discrepanciesCount: discrepancies.length,
        discrepancies,
      });
    }

    const report: ReconciliationAuditReport = {
      isSafe: this.isReconciliationSafe,
      lastRunTimestamp: timestamp,
      totalOpenPositions: openPositions.length,
      totalClosedPositions: closedPositions.length,
      calculatedDailyPnl: calculatedSumClosedNetPnl,
      trackedDailyPnl: dailyState.dailyPnl,
      discrepancies,
    };

    this.lastAuditReport = report;
    return report;
  }

  public isTradingAllowed(): boolean {
    return this.isReconciliationSafe;
  }

  public getLastAuditReport(): ReconciliationAuditReport | null {
    if (!this.lastAuditReport) {
      this.runReconciliation();
    }
    return this.lastAuditReport;
  }
}

export const reconciliationEngine = new ReconciliationEngine();
