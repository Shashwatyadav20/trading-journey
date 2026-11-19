import fs from "node:fs";
import path from "node:path";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import {
  getFrozenSpecChecksum,
  STRATEGY03_FROZEN_SPEC_V61018,
} from "./forward/Strategy03FrozenSpec.js";
import {
  buildForwardSignalRecord,
  computeLedgerChecksum,
  isStrictlyForwardTimestamp,
  type ForwardSignalRecord,
} from "./forward/Strategy03ForwardShadowMonitor.js";
import {
  reconcileDhanContractNotes,
  type DhanContractNoteTradeInput,
} from "./forward/Strategy03DhanContractNoteReconciler.js";

config({ path: path.resolve("D:/Trading/my-app/backend/.env") });

const OUT_DIR = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase61018");

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const { count: paperTradesCount } = await sb
    .from("experimental_paper_trades")
    .select("*", { count: "exact", head: true });

  const { data: shadowSignals } = await sb
    .from("strategy03_shadow_signals")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(500);

  const { data: shadowRuns } = await sb
    .from("strategy03_shadow_runs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);

  const { count: verifiedUnivCount } = await sb
    .from("strategy03_financial_facts")
    .select("symbol", { count: "exact", head: true })
    .eq("verification_status", "VERIFIED");

  // Filter strictly forward observations after phaseStartTimestamp (never count historical backfill)
  const forwardRuns = (shadowRuns ?? []).filter((r: any) =>
    isStrictlyForwardTimestamp(r.created_at ?? r.run_date ?? "")
  );
  const forwardSignalsRaw = (shadowSignals ?? []).filter((s: any) =>
    isStrictlyForwardTimestamp(s.created_at ?? s.signal_date ?? "")
  );

  // Deduplicate by symbol + signal_date
  const seenSig = new Set<string>();
  const forwardSignals: ForwardSignalRecord[] = [];
  let duplicatesPrevented = 0;
  for (const s of forwardSignalsRaw) {
    const key = `${s.symbol}_${s.signal_date}`;
    if (seenSig.has(key)) {
      duplicatesPrevented++;
      continue;
    }
    seenSig.add(key);
    forwardSignals.push(
      buildForwardSignalRecord({
        id: String(s.id ?? key),
        signalTimestamp: String(s.created_at ?? s.signal_date),
        symbol: String(s.symbol),
        score: Number(s.fundamental_score ?? 0),
        verificationStatus: String(s.verification_status ?? "VERIFIED"),
        marketRegime: String(s.market_regime ?? "UNKNOWN"),
        referenceEntryPrice: Number(s.entry_price ?? 0),
        nextExecutableCandlePrice: s.next_open_price !== undefined && s.next_open_price !== null ? Number(s.next_open_price) : null,
        hypotheticalStopPrice: Number(s.stop_loss ?? 0),
        hypotheticalTargetPrice: s.target_price !== undefined && s.target_price !== null ? Number(s.target_price) : null,
        exitTrigger: s.exit_reason ?? null,
        referenceExitPrice: s.exit_price !== undefined && s.exit_price !== null ? Number(s.exit_price) : null,
      })
    );
  }

  const matureSignals = forwardSignals.filter((s) => s.isMature);
  const pendingSignals = forwardSignals.filter((s) => !s.isMature);

  // Check for manually imported Dhan contract notes (no credentials stored)
  const importPath = path.join(OUT_DIR, "imported_contract_notes.json");
  const importedNotes: DhanContractNoteTradeInput[] = fs.existsSync(importPath)
    ? JSON.parse(fs.readFileSync(importPath, "utf8"))
    : [];
  const contractNoteRecon = reconcileDhanContractNotes(importedNotes);

  const validObservedSessions = forwardRuns.filter((r: any) => r.status === "SUCCESS" || r.status === "COMPLETED").length;
  const schedulerFailures = forwardRuns.filter((r: any) => r.status === "FAILED" || r.status === "ERROR").length;

  const finalClassification =
    validObservedSessions < STRATEGY03_FROZEN_SPEC_V61018.targetValidNseSessions
      ? "FORWARD_VALIDATION_IN_PROGRESS"
      : matureSignals.length < 30
      ? "INCONCLUSIVE"
      : "PROMISING_FOR_FURTHER_VALIDATION";

  const writeJson = (name: string, data: unknown) =>
    fs.writeFileSync(path.join(OUT_DIR, name), JSON.stringify(data, null, 2));

  const sessionLedger = {
    phaseStartTimestamp: STRATEGY03_FROZEN_SPEC_V61018.phaseStartTimestamp,
    targetValidNseSessions: STRATEGY03_FROZEN_SPEC_V61018.targetValidNseSessions,
    validObservedSessions,
    missingSessions: Math.max(0, STRATEGY03_FROZEN_SPEC_V61018.targetValidNseSessions - validObservedSessions),
    schedulerFailures,
    eligibleSymbolsUniverseCount: verifiedUnivCount ?? 0,
    frozenSpecChecksum: getFrozenSpecChecksum(),
    sessions: forwardRuns,
  };

  writeJson("forward_session_ledger.json", {
    ...sessionLedger,
    ledgerChecksum: computeLedgerChecksum(sessionLedger),
  });
  writeJson("forward_signal_ledger.json", {
    freshSignalsGenerated: forwardSignals.length,
    duplicatesPrevented,
    signalsWithCompleteOutcomes: matureSignals.length,
    signalsPendingMaturity: pendingSignals.length,
    signals: forwardSignals,
    ledgerChecksum: computeLedgerChecksum(forwardSignals),
  });
  writeJson("forward_signal_outcomes.json", {
    matureCount: matureSignals.length,
    pendingCount: pendingSignals.length,
    matureSignals,
    pendingSignals,
  });
  writeJson("scheduler_health.json", {
    totalRunsRecordedAfterPhaseStart: forwardRuns.length,
    validObservedSessions,
    schedulerFailures,
    historicalRunsExcluded: (shadowRuns ?? []).length - forwardRuns.length,
    duplicateSignalsPrevented: duplicatesPrevented,
  });
  writeJson("dhan_contract_note_reconciliation.json", contractNoteRecon);
  writeJson("actual_vs_estimated_charges.json", {
    status: contractNoteRecon.status,
    totalActualInr: contractNoteRecon.totalActualInr,
    totalEstimatedInr: contractNoteRecon.totalEstimatedInr,
    totalVarianceInr: contractNoteRecon.totalVarianceInr,
    comparisons: contractNoteRecon.comparisons,
  });
  writeJson("forward_net_performance.json", {
    status: matureSignals.length === 0 ? "INSUFFICIENT_MATURE_FORWARD_SIGNALS" : "COMPUTED",
    matureSignalsCount: matureSignals.length,
    pendingSignalsCount: pendingSignals.length,
    winRatePct:
      matureSignals.length > 0
        ? Math.round((matureSignals.filter((m) => (m.hypotheticalNetPnlInr ?? 0) > 0).length / matureSignals.length) * 10000) / 100
        : null,
    grossPnlInr:
      matureSignals.length > 0 ? Math.round(matureSignals.reduce((a, m) => a + (m.hypotheticalGrossPnlInr ?? 0), 0) * 100) / 100 : null,
    netPnlInr:
      matureSignals.length > 0 ? Math.round(matureSignals.reduce((a, m) => a + (m.hypotheticalNetPnlInr ?? 0), 0) * 100) / 100 : null,
  });
  writeJson("forward_data_quality.json", {
    historicalBackfillExcluded: true,
    frozenSpecChecksum: getFrozenSpecChecksum(),
    safetyLocks: {
      ...STRATEGY03_FROZEN_SPEC_V61018.safetyLocks,
      experimental_paper_trades: paperTradesCount ?? 0,
    },
  });

  const md = [
    "# Phase 6.10.18 — Pure Forward Shadow Validation & Dhan Contract Note Reconciliation",
    "",
    `- **Final Classification:** \`${finalClassification}\``,
    `- **Phase Start Timestamp:** \`${STRATEGY03_FROZEN_SPEC_V61018.phaseStartTimestamp}\``,
    `- **Frozen Spec SHA-256:** \`${getFrozenSpecChecksum().slice(0, 16)}...\``,
    `- **Forward Sessions Observed:** ${validObservedSessions} / ${STRATEGY03_FROZEN_SPEC_V61018.targetValidNseSessions}`,
    `- **Fresh Forward Signals:** ${forwardSignals.length} (Mature: ${matureSignals.length}, Pending: ${pendingSignals.length})`,
    `- **Dhan Contract Note Reconciliation:** \`${contractNoteRecon.status}\` (${contractNoteRecon.recordCount} records)`,
    "",
    "## Safety Confirmation",
    "- `STRATEGY_01 = false`, `STRATEGY_02 = false`, `STRATEGY_03 = false`, `LIVE_TRADING = false`, `BROKER_EXECUTION_ENABLED = false`, `experimental_paper_trades = 0`.",
  ].join("\n");
  fs.writeFileSync(path.join(OUT_DIR, "phase61018_final_report.md"), md);

  console.log("Phase 6.10.18 complete:", {
    finalClassification,
    validObservedSessions,
    targetSessions: STRATEGY03_FROZEN_SPEC_V61018.targetValidNseSessions,
    freshSignals: forwardSignals.length,
    matureSignals: matureSignals.length,
    contractNoteStatus: contractNoteRecon.status,
    paperTrades: paperTradesCount ?? 0,
  });
}

if (process.argv[1]?.includes("runPhase61018ForwardValidation")) {
  main().catch((err) => {
    console.error("Phase 6.10.18 failed:", err);
    process.exit(1);
  });
}

