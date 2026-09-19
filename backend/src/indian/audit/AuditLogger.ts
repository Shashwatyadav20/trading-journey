import { getAdminSupabaseClient } from "../../db/supabaseClient";

export interface AuditLogEntry {
  eventType: string;
  traceId: string;
  details: Record<string, any>;
}

export class AuditLogger {
  private logsInMemory: AuditLogEntry[] = [];

  /**
   * Logs an immutable trace audit record for strategy decisions and order executions.
   */
  public log(eventType: string, traceId: string, details: Record<string, any>): void {
    const entry: AuditLogEntry = {
      eventType,
      traceId,
      details: this.sanitizeDetails(details),
    };

    this.logsInMemory.push(entry);
    if (this.logsInMemory.length > 500) {
      this.logsInMemory.shift();
    }

    console.log(
      `[AUDIT:${eventType}] trace=${traceId} details=${JSON.stringify(
        entry.details
      )}`
    );

    // Asynchronously persist to Supabase if configured
    this.persistToDb(entry).catch((err) => {
      // Non-blocking catch to ensure logging never breaks trade execution
    });
  }

  private sanitizeDetails(obj: Record<string, any>): Record<string, any> {
    const copy = { ...obj };
    // Never log sensitive API secrets or keys
    delete copy.apiKey;
    delete copy.apiSecret;
    delete copy.accessToken;
    delete copy.password;
    delete copy.jwt;
    return copy;
  }

  private async persistToDb(entry: AuditLogEntry): Promise<void> {
    try {
      const supabase = getAdminSupabaseClient();
      if (!supabase) return;

      await (supabase.from("nifty_audit_logs") as any).insert({
        event_type: entry.eventType,
        trace_id: entry.traceId,
        details: entry.details,
      });
    } catch {
      // DB persistence failure handled gracefully
    }
  }

  public getRecentLogs(): AuditLogEntry[] {
    return [...this.logsInMemory];
  }
}

export const auditLogger = new AuditLogger();
