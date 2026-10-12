import { getAdminSupabaseClient, isSupabaseConfigured } from "./supabaseClient";
import { SwingSignal } from "../indian/swing/types";
import { randomUUID } from "crypto";

export interface DailyScanRunRow {
  id: string;
  scan_date: string;
  scan_type: "scheduled" | "manual";
  status: "running" | "completed" | "partial" | "failed";
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  universe_size: number;
  scanned_count: number;
  success_count: number;
  failure_count: number;
  opportunities_found: number;
  market_data_timestamp: string | null;
  error_summary: string | null;
  created_at: string;
}

export interface DailyScanOpportunityRow {
  id: string;
  scan_run_id: string;
  trading_date: string;
  symbol: string;
  exchange: string;
  current_price: number;
  primary_strategy: string;
  matched_strategies: any[];
  signal_direction: "LONG" | "SHORT";
  entry_price: number | null;
  entry_zone: { min: number; max: number } | null;
  stop_loss: number;
  target_1: number;
  target_2: number | null;
  reward_risk_ratio: number;
  confluence_score: number;
  indicator_snapshot: Record<string, any>;
  signal_status: string;
  created_at: string;
}

export interface CreateScanRunParams {
  id?: string;
  scanDate: string;
  scanType: "scheduled" | "manual";
  universeSize: number;
  marketDataTimestamp?: string;
}

export interface CompleteScanRunParams {
  durationMs: number;
  scannedCount: number;
  successCount: number;
  failureCount: number;
  opportunitiesFound: number;
  errorSummary?: string | null;
  marketDataTimestamp?: string;
}

export interface PersistenceHealthResult {
  configured: boolean;
  reachable: boolean;
  mode: "supabase" | "in-memory";
  latencyMs?: number;
  tableCheck?: {
    daily_scan_runs: boolean;
    daily_scan_opportunities: boolean;
  };
  error?: string;
  timestamp: string;
}

export class DailyScanPersistenceService {
  // In-memory fallback stores when Supabase is unconfigured or in offline mode
  private memoryRuns: Map<string, DailyScanRunRow> = new Map();
  private memoryOpportunities: Map<string, DailyScanOpportunityRow[]> = new Map();

  /**
   * Returns true if backend Supabase connection is configured with real credentials.
   */
  public isDatabaseConfigured(): boolean {
    return isSupabaseConfigured();
  }

  /**
   * Safe persistence health check.
   * Reports whether Supabase is configured and reachable WITHOUT leaking credentials.
   */
  public async checkPersistenceHealth(): Promise<PersistenceHealthResult> {
    const timestamp = new Date().toISOString();

    if (!this.isDatabaseConfigured()) {
      return {
        configured: false,
        reachable: false,
        mode: "in-memory",
        timestamp,
      };
    }

    const startTime = Date.now();
    try {
      const supabase: any = getAdminSupabaseClient();

      // Check daily_scan_runs table reachability
      const { error: runsError } = await supabase
        .from("daily_scan_runs")
        .select("id")
        .limit(1);

      if (runsError) {
        return {
          configured: true,
          reachable: false,
          mode: "supabase",
          latencyMs: Date.now() - startTime,
          error: this.sanitizeErrorMessage(runsError.message),
          timestamp,
        };
      }

      // Check daily_scan_opportunities table reachability
      const { error: oppsError } = await supabase
        .from("daily_scan_opportunities")
        .select("id")
        .limit(1);

      if (oppsError) {
        return {
          configured: true,
          reachable: false,
          mode: "supabase",
          latencyMs: Date.now() - startTime,
          error: this.sanitizeErrorMessage(oppsError.message),
          timestamp,
        };
      }

      return {
        configured: true,
        reachable: true,
        mode: "supabase",
        latencyMs: Date.now() - startTime,
        tableCheck: {
          daily_scan_runs: true,
          daily_scan_opportunities: true,
        },
        timestamp,
      };
    } catch (err: any) {
      return {
        configured: true,
        reachable: false,
        mode: "supabase",
        latencyMs: Date.now() - startTime,
        error: this.sanitizeErrorMessage(err.message || String(err)),
        timestamp,
      };
    }
  }

  /**
   * Sanitizes database error messages to ensure credentials, JWT tokens, or API keys are never leaked.
   */
  private sanitizeErrorMessage(msg: string): string {
    if (!msg) return "Unknown database error";
    return msg
      .replace(/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, "[REDACTED_JWT]")
      .replace(/sbp_[a-zA-Z0-9_]+/g, "[REDACTED_KEY]")
      .replace(/https?:\/\/[^\s/@]+@/g, "https://[REDACTED]@")
      .slice(0, 300);
  }

  /**
   * Checks whether a completed or partial scheduled scan already exists in the database for the given date.
   * This provides durable, restart-safe idempotency.
   */
  public async findCompletedScheduledRunByDate(scanDate: string): Promise<DailyScanRunRow | null> {
    if (!this.isDatabaseConfigured()) {
      for (const run of this.memoryRuns.values()) {
        if (
          run.scan_date === scanDate &&
          run.scan_type === "scheduled" &&
          (run.status === "completed" || run.status === "partial")
        ) {
          return run;
        }
      }
      return null;
    }

    try {
      const supabase: any = getAdminSupabaseClient();
      const { data, error } = await supabase
        .from("daily_scan_runs")
        .select("*")
        .eq("scan_date", scanDate)
        .eq("scan_type", "scheduled")
        .in("status", ["completed", "partial"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error(`[DailyScanPersistenceService] Error checking scheduled run for date ${scanDate}:`, error.message);
        throw new Error(`Database check failed: ${error.message}`);
      }

      return (data as unknown as DailyScanRunRow) || null;
    } catch (err: any) {
      console.error(`[DailyScanPersistenceService] Exception in findCompletedScheduledRunByDate:`, err.message);
      throw err;
    }
  }

  /**
   * Creates a scan run record before scanning starts, with initial status 'running'.
   */
  public async createScanRun(params: CreateScanRunParams): Promise<DailyScanRunRow> {
    const runId = params.id || randomUUID();
    const nowIso = new Date().toISOString();

    const row: DailyScanRunRow = {
      id: runId,
      scan_date: params.scanDate,
      scan_type: params.scanType,
      status: "running",
      started_at: nowIso,
      completed_at: null,
      duration_ms: null,
      universe_size: params.universeSize,
      scanned_count: 0,
      success_count: 0,
      failure_count: 0,
      opportunities_found: 0,
      market_data_timestamp: params.marketDataTimestamp || nowIso,
      error_summary: null,
      created_at: nowIso,
    };

    if (!this.isDatabaseConfigured()) {
      console.warn(
        `[DailyScanPersistenceService] Supabase unconfigured. Storing scan run ${runId} in memory.`
      );
      this.memoryRuns.set(runId, row);
      return row;
    }

    try {
      const supabase: any = getAdminSupabaseClient();
      const { data, error } = await supabase
        .from("daily_scan_runs")
        .insert(row)
        .select()
        .single();

      if (error) {
        console.error(`[DailyScanPersistenceService] Failed to create scan run ${runId}:`, error.message);
        throw new Error(`Failed to create scan run: ${error.message}`);
      }

      return (data as unknown as DailyScanRunRow) || row;
    } catch (err: any) {
      console.error(`[DailyScanPersistenceService] Database write failed for createScanRun:`, err.message);
      throw err;
    }
  }

  /**
   * Persists detected opportunities for a scan run.
   * Uses idempotent upsert to prevent duplicate records on retries.
   */
  public async saveOpportunities(
    runId: string,
    tradingDate: string,
    opportunities: SwingSignal[]
  ): Promise<DailyScanOpportunityRow[]> {
    if (!opportunities || opportunities.length === 0) {
      return [];
    }

    const nowIso = new Date().toISOString();
    const rows: DailyScanOpportunityRow[] = opportunities.map((sig) => {
      const minZone = Number((sig.entryPrice * 0.995).toFixed(2));
      const maxZone = Number((sig.entryPrice * 1.005).toFixed(2));

      return {
        id: randomUUID(),
        scan_run_id: runId,
        trading_date: tradingDate,
        symbol: sig.symbol,
        exchange: "NSE",
        current_price: Number(sig.currentPrice.toFixed(2)),
        primary_strategy: sig.setupId,
        matched_strategies: [
          {
            strategyId: sig.setupId,
            setupTitle: sig.setupTitle,
            setupBadge: sig.setupBadge,
            confluenceScore: sig.confluenceScore,
          },
        ],
        signal_direction: "LONG",
        entry_price: Number(sig.entryPrice.toFixed(2)),
        entry_zone: { min: minZone, max: maxZone },
        stop_loss: Number(sig.stopLossPrice.toFixed(2)),
        target_1: Number(sig.target1Price.toFixed(2)),
        target_2: sig.target2Price ? Number(sig.target2Price.toFixed(2)) : null,
        reward_risk_ratio: Number(sig.rewardRiskRatio.toFixed(2)),
        confluence_score: Number(sig.confluenceScore.toFixed(2)),
        indicator_snapshot: {
          // EMA indicators (null when history is insufficient — never substitute zero)
          ema20: sig.ema20,
          ema50: sig.ema50,
          ema200: sig.ema200,
          // Volume and RS
          volumeMultiplier: sig.volumeMultiplier,
          relativeStrengthVsNifty: sig.relativeStrengthVsNifty,
          // Dashboard display metadata (persisted so route never needs to hardcode placeholders)
          companyName: sig.companyName,
          sector: sig.sector,
          marketCapCr: sig.marketCapCr,
          changePercent: sig.changePercent,
          rsi14: sig.rsi14 ?? null,
          trendStrength: sig.trendStrength || null,
          scoreBreakdown: sig.scoreBreakdown || null,
          // Price action metadata
          rejectionCandle: sig.rejectionCandle || null,
          retestLow: sig.retestLow || null,
          sweepLow: sig.sweepLow || null,
          pwh: sig.pwh || null,
          pwl: sig.pwl || null,
          liquiditySweep: sig.liquiditySweep || null,
          choch: sig.choch || null,
          marketStructure: sig.marketStructure
            ? {
                pwh: sig.marketStructure.pwh,
                pwl: sig.marketStructure.pwl,
                equalHighsCount: sig.marketStructure.equalHighs.length,
                equalLowsCount: sig.marketStructure.equalLows.length,
                equalHighs: sig.marketStructure.equalHighs,
                equalLows: sig.marketStructure.equalLows,
                currentMarketState: sig.marketStructure.currentMarketState,
                recentLiquiditySweep: sig.marketStructure.recentLiquiditySweep,
                recentChoch: sig.marketStructure.recentChoch,
              }
            : null,
          tradeRationale: sig.tradeRationale || [],
          fivePillarChecklist: sig.fivePillarChecklist,
        },
        signal_status: sig.status || "ACTIVE",
        created_at: nowIso,
      };
    });

    if (!this.isDatabaseConfigured()) {
      this.memoryOpportunities.set(runId, rows);
      return rows;
    }

    try {
      const supabase: any = getAdminSupabaseClient();
      // Upsert to handle retries idempotently based on unique index
      const { data, error } = await supabase
        .from("daily_scan_opportunities")
        .upsert(rows, { onConflict: "scan_run_id,symbol,primary_strategy" })
        .select();

      if (error) {
        console.error(`[DailyScanPersistenceService] Failed to persist opportunities for run ${runId}:`, error.message);
        throw new Error(`Failed to persist opportunities: ${error.message}`);
      }

      return (data as unknown as DailyScanOpportunityRow[]) || rows;
    } catch (err: any) {
      console.error(`[DailyScanPersistenceService] Error persisting opportunities:`, err.message);
      throw err;
    }
  }

  /**
   * Finalizes the scan run with completion status, duration, symbol metrics, and error summary.
   */
  public async completeScanRun(
    runId: string,
    params: CompleteScanRunParams
  ): Promise<DailyScanRunRow> {
    const completedAt = new Date().toISOString();

    let finalStatus: DailyScanRunRow["status"] = "completed";
    if (params.failureCount > 0 && params.successCount > 0) {
      finalStatus = "partial";
    } else if (params.failureCount > 0 && params.successCount === 0) {
      finalStatus = "failed";
    }

    const updates = {
      status: finalStatus,
      completed_at: completedAt,
      duration_ms: params.durationMs,
      scanned_count: params.scannedCount,
      success_count: params.successCount,
      failure_count: params.failureCount,
      opportunities_found: params.opportunitiesFound,
      error_summary: params.errorSummary || null,
      market_data_timestamp: params.marketDataTimestamp || completedAt,
    };

    if (!this.isDatabaseConfigured()) {
      const existing = this.memoryRuns.get(runId);
      if (existing) {
        Object.assign(existing, updates);
        return existing;
      }
      return {
        id: runId,
        scan_date: new Date().toISOString().split("T")[0],
        scan_type: "manual",
        started_at: completedAt,
        created_at: completedAt,
        universe_size: params.scannedCount,
        ...updates,
      };
    }

    try {
      const supabase: any = getAdminSupabaseClient();
      const { data, error } = await supabase
        .from("daily_scan_runs")
        .update(updates)
        .eq("id", runId)
        .select()
        .single();

      if (error) {
        console.error(`[DailyScanPersistenceService] Failed to complete scan run ${runId}:`, error.message);
        throw new Error(`Failed to complete scan run: ${error.message}`);
      }

      return data as unknown as DailyScanRunRow;
    } catch (err: any) {
      console.error(`[DailyScanPersistenceService] Error in completeScanRun:`, err.message);
      throw err;
    }
  }

  /**
   * Marks a scan run as failed with diagnostic summary.
   */
  public async failScanRun(
    runId: string,
    errorSummary: string,
    durationMs?: number
  ): Promise<void> {
    const completedAt = new Date().toISOString();
    const updates = {
      status: "failed" as const,
      completed_at: completedAt,
      duration_ms: durationMs || null,
      error_summary: errorSummary,
    };

    if (!this.isDatabaseConfigured()) {
      const existing = this.memoryRuns.get(runId);
      if (existing) {
        Object.assign(existing, updates);
      }
      return;
    }

    try {
      const supabase: any = getAdminSupabaseClient();
      await supabase
        .from("daily_scan_runs")
        .update(updates)
        .eq("id", runId);
    } catch (err: any) {
      console.error(`[DailyScanPersistenceService] Failed to update failed status for ${runId}:`, err.message);
    }
  }

  /**
   * Retrieves the latest completed or partial scan run with its opportunities.
   */
  public async getLatestScanRun(): Promise<{
    run: DailyScanRunRow;
    opportunities: DailyScanOpportunityRow[];
  } | null> {
    if (!this.isDatabaseConfigured()) {
      // Find latest completed/partial run from memory
      const validRuns = Array.from(this.memoryRuns.values())
        .filter((r) => r.status === "completed" || r.status === "partial")
        .sort((a, b) => b.created_at.localeCompare(a.created_at));

      if (validRuns.length === 0) return null;
      const latest = validRuns[0];
      const opps = this.memoryOpportunities.get(latest.id) || [];
      return { run: latest, opportunities: opps };
    }

    try {
      const supabase: any = getAdminSupabaseClient();
      const { data: run, error: runError } = await supabase
        .from("daily_scan_runs")
        .select("*")
        .in("status", ["completed", "partial"])
        .order("scan_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (runError) {
        throw new Error(`Failed to fetch latest scan run: ${runError.message}`);
      }

      if (!run) return null;

      const { data: opps, error: oppError } = await supabase
        .from("daily_scan_opportunities")
        .select("*")
        .eq("scan_run_id", (run as any).id)
        .order("confluence_score", { ascending: false });

      if (oppError) {
        throw new Error(`Failed to fetch scan opportunities: ${oppError.message}`);
      }

      return {
        run: run as unknown as DailyScanRunRow,
        opportunities: (opps as unknown as DailyScanOpportunityRow[]) || [],
      };
    } catch (err: any) {
      console.error(`[DailyScanPersistenceService] Error in getLatestScanRun:`, err.message);
      throw err;
    }
  }

  /**
   * Retrieves a scan run by date with its opportunities.
   */
  public async getScanRunByDate(scanDate: string): Promise<{
    run: DailyScanRunRow;
    opportunities: DailyScanOpportunityRow[];
  } | null> {
    if (!this.isDatabaseConfigured()) {
      for (const run of this.memoryRuns.values()) {
        if (run.scan_date === scanDate) {
          return {
            run,
            opportunities: this.memoryOpportunities.get(run.id) || [],
          };
        }
      }
      return null;
    }

    try {
      const supabase: any = getAdminSupabaseClient();
      const { data: run, error: runError } = await supabase
        .from("daily_scan_runs")
        .select("*")
        .eq("scan_date", scanDate)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (runError) throw new Error(runError.message);
      if (!run) return null;

      const { data: opps, error: oppError } = await supabase
        .from("daily_scan_opportunities")
        .select("*")
        .eq("scan_run_id", (run as any).id)
        .order("confluence_score", { ascending: false });

      if (oppError) throw new Error(oppError.message);

      return {
        run: run as unknown as DailyScanRunRow,
        opportunities: (opps as unknown as DailyScanOpportunityRow[]) || [],
      };
    } catch (err: any) {
      console.error(`[DailyScanPersistenceService] Error in getScanRunByDate:`, err.message);
      throw err;
    }
  }

  /**
   * Retrieves recent historical scan runs for dashboard history list.
   */
  public async getScanHistory(limit: number = 30): Promise<DailyScanRunRow[]> {
    if (!this.isDatabaseConfigured()) {
      return Array.from(this.memoryRuns.values())
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, limit);
    }

    try {
      const supabase: any = getAdminSupabaseClient();
      const { data, error } = await supabase
        .from("daily_scan_runs")
        .select("*")
        .order("scan_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) throw new Error(error.message);
      return (data as unknown as DailyScanRunRow[]) || [];
    } catch (err: any) {
      console.error(`[DailyScanPersistenceService] Error in getScanHistory:`, err.message);
      throw err;
    }
  }

  /**
   * Resets memory state for testing.
   */
  public resetMemoryStateForTesting(): void {
    this.memoryRuns.clear();
    this.memoryOpportunities.clear();
  }
}

export const dailyScanPersistenceService = new DailyScanPersistenceService();
