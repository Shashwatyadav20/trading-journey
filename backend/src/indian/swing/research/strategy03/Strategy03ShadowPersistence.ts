import type { SupabaseClient } from "@supabase/supabase-js";
import type { DailyObservationRecord } from "./Strategy03ShadowScheduler.js";
import type { ShadowSignalRecord } from "./Strategy03ShadowRunner.js";

export interface PersistenceOutcome {
  persisted: boolean;
  runsPersisted: number;
  signalsPersisted: number;
  error: string | null;
}

export class Strategy03ShadowPersistence {
  constructor(private readonly getClient: () => SupabaseClient | null) {}

  public async persistRunAndSignals(params: {
    run: DailyObservationRecord;
    signals: ShadowSignalRecord[];
    frozenSpecChecksum: string;
  }): Promise<PersistenceOutcome> {
    const sb = this.getClient();
    if (!sb) {
      return { persisted: false, runsPersisted: 0, signalsPersisted: 0, error: "SUPABASE_CLIENT_UNAVAILABLE" };
    }

    const freshSignals = params.signals.filter((s) => s.decision === "BUY_CANDIDATE");
    const dataQualityFailures = params.run.failedSymbols.length;

    const { error: runErr } = await sb.from("strategy03_shadow_runs").upsert(
      {
        run_id: params.run.runId,
        observation_date: params.run.observationDate,
        scheduled_time_ist: params.run.scheduledTimeIst,
        actual_start_time: params.run.actualStartTime,
        completion_time: params.run.completionTime,
        status: params.run.status,
        universe_count: params.run.universeCount,
        evaluated_symbols_count: params.run.evaluatedSymbolsCount,
        fresh_signals_count: freshSignals.length,
        mature_signals_count: 0,
        pending_signals_count: freshSignals.length,
        data_quality_failures: dataQualityFailures,
        frozen_spec_checksum: params.frozenSpecChecksum,
        run_checksum: params.run.runChecksum,
        error_message: params.run.errorMessage ?? null,
      },
      { onConflict: "observation_date", ignoreDuplicates: true }
    );

    if (runErr) {
      return { persisted: false, runsPersisted: 0, signalsPersisted: 0, error: runErr.message };
    }

    let signalsPersisted = 0;
    if (params.signals.length > 0) {
      const rows = params.signals.map((s) => ({
        idempotency_key: s.idempotencyKey,
        signal_date: s.signalDate,
        symbol: s.symbol,
        sector: s.sector,
        decision: s.decision,
        score: s.score,
        confidence: s.confidence,
        verification_status: s.verificationStatus,
        reference_price: s.referencePrice,
        missing_fields: s.missingFields,
        evidence_summary: s.evidenceSummary,
        market_data_timestamp: s.marketDataTimestamp,
        evaluation_timestamp: s.evaluationTimestamp,
        frozen_spec_checksum: params.frozenSpecChecksum,
      }));
      const { error: sigErr } = await sb
        .from("strategy03_shadow_signals")
        .upsert(rows, { onConflict: "idempotency_key", ignoreDuplicates: true });
      if (sigErr) {
        return { persisted: false, runsPersisted: 1, signalsPersisted: 0, error: sigErr.message };
      }
      signalsPersisted = rows.length;
    }

    return { persisted: true, runsPersisted: 1, signalsPersisted, error: null };
  }

  public async persistMissedSession(params: {
    observationDate: string;
    reason: string;
    frozenSpecChecksum: string;
  }): Promise<PersistenceOutcome> {
    const sb = this.getClient();
    if (!sb) {
      return { persisted: false, runsPersisted: 0, signalsPersisted: 0, error: "SUPABASE_CLIENT_UNAVAILABLE" };
    }
    const nowIso = new Date().toISOString();
    const { error } = await sb.from("strategy03_shadow_runs").upsert(
      {
        run_id: `missed_${params.observationDate}`,
        observation_date: params.observationDate,
        scheduled_time_ist: `${params.observationDate}T15:45:00+05:30`,
        actual_start_time: nowIso,
        completion_time: nowIso,
        status: "MISSED",
        universe_count: 0,
        evaluated_symbols_count: 0,
        fresh_signals_count: 0,
        mature_signals_count: 0,
        pending_signals_count: 0,
        data_quality_failures: 0,
        frozen_spec_checksum: params.frozenSpecChecksum,
        run_checksum: `missed_${params.observationDate}`,
        error_message: params.reason,
      },
      { onConflict: "observation_date", ignoreDuplicates: true }
    );
    if (error) {
      return { persisted: false, runsPersisted: 0, signalsPersisted: 0, error: error.message };
    }
    return { persisted: true, runsPersisted: 1, signalsPersisted: 0, error: null };
  }
}

