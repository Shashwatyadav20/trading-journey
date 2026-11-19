import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import {
  persistFinancialFactsIdempotent,
  validateOfficialSourceUrl,
  type ExtractedFinancialFactRecord,
} from "./BseXbrlBackfillService.js";

config({ path: path.resolve("D:/Trading/my-app/backend/.env") });
config({ path: path.resolve("D:/Trading/my-app/.env.local"), override: false });

const PHASE_641_DIR = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase641");
const OUT_DIR = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase6411");

const SAMPLE_20_SYMBOLS = [
  "RELIANCE",
  "TCS",
  "INFY",
  "HDFCBANK",
  "ICICIBANK",
  "SBIN",
  "BHARTIARTL",
  "ITC",
  "LT",
  "HINDUNILVR",
  "BAJFINANCE",
  "MARUTI",
  "SUNPHARMA",
  "TITAN",
  "TATAMOTORS",
  "ASIANPAINT",
  "ADANIENT",
  "NTPC",
  "POWERGRID",
  "WIPRO",
];

function validateFactDeterministically(f: ExtractedFinancialFactRecord): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!f.symbol || typeof f.symbol !== "string") reasons.push("Missing symbol");
  if (!["CONSOLIDATED", "STANDALONE"].includes(f.statementScope)) reasons.push("Invalid statementScope");
  if (!["Q1", "Q2", "Q3", "Q4", "H1", "M9", "ANNUAL"].includes(f.periodType)) reasons.push("Invalid periodType");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.reportingPeriod)) reasons.push("Invalid reportingPeriod ISO date");
  if (!f.idempotencyKey) reasons.push("Missing idempotencyKey");
  if (!f.sourceUrl || !validateOfficialSourceUrl(f.sourceUrl).ok) reasons.push("Invalid or untrusted sourceUrl");
  if (!f.retrievedAt) reasons.push("Missing retrievedAt");
  if (!["VERIFIED", "UNVERIFIED", "MISSING", "STALE", "CONFLICTED"].includes(f.verificationStatus)) {
    reasons.push("Invalid verificationStatus");
  }
  return { ok: reasons.length === 0, reasons };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  const adminSb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  // 1. Remote schema verification
  const tablesToCheck = ["strategy03_research_evaluations", "strategy03_financial_facts"] as const;
  const schemaResults: Record<string, unknown> = { checkedAt: new Date().toISOString(), tables: {} };
  let anyMissing = false;

  for (const tbl of tablesToCheck) {
    const { data, error, count } = await adminSb
      .from(tbl)
      .select("*", { count: "exact", head: true });
    if (error) {
      anyMissing = true;
      (schemaResults.tables as Record<string, unknown>)[tbl] = {
        exists: false,
        error: `${error.code}: ${error.message}`,
      };
    } else {
      (schemaResults.tables as Record<string, unknown>)[tbl] = {
        exists: true,
        existingRowCount: count ?? 0,
        dataPreview: data,
      };
    }
  }

  if (anyMissing) {
    fs.writeFileSync(path.join(OUT_DIR, "remote_schema_verification.json"), JSON.stringify(schemaResults, null, 2));
    console.error("BLOCKED: Remote tables are not yet applied:", schemaResults);
    process.exit(2);
  }

  // 2. Controlled persistence smoke test
  const smokeMarker = "SMOKE_TEST_6411";
  const smokeResults: Record<string, unknown> = { marker: smokeMarker, checks: {} };

  try {
    // Cleanup any leftover marker first
    await adminSb.from("strategy03_financial_facts").delete().eq("symbol", smokeMarker);
    await adminSb.from("strategy03_research_evaluations").delete().eq("symbol", smokeMarker);

    const baseFact = {
      idempotency_key: `${smokeMarker}|CONSOLIDATED|Q1|2025-06-30|v1`,
      symbol: smokeMarker,
      bse_code: "999999",
      statement_scope: "CONSOLIDATED",
      period_type: "Q1",
      financial_year: "2025-2026",
      reporting_period: "2025-06-30",
      filing_date: "2025-07-20",
      version: 1,
      is_restated: false,
      is_derived_quarterly: false,
      revenue_cr: 100.5,
      net_profit_cr: 12.25,
      source_name: "SMOKE_TEST",
      source_filing_id: "SMOKE-1",
      source_url: "https://nsearchives.nseindia.in/corporate/xbrl/smoke.xml",
      extraction_method: "XBRL_XML",
      verification_status: "VERIFIED",
      confidence: 0.99,
      raw_context_summary: { test: true },
      retrieved_at: new Date().toISOString(),
    };

    const ins1 = await adminSb.from("strategy03_financial_facts").insert(baseFact).select().single();
    const read1 = await adminSb
      .from("strategy03_financial_facts")
      .select("*")
      .eq("idempotency_key", baseFact.idempotency_key)
      .single();

    // Idempotent upsert on same idempotency_key
    const up1 = await adminSb
      .from("strategy03_financial_facts")
      .upsert({ ...baseFact, revenue_cr: 101.0 }, { onConflict: "idempotency_key" })
      .select()
      .single();

    // Historical version preservation (v2)
    const insV2 = await adminSb
      .from("strategy03_financial_facts")
      .insert({
        ...baseFact,
        idempotency_key: `${smokeMarker}|CONSOLIDATED|Q1|2025-06-30|v2`,
        version: 2,
        is_restated: true,
        revenue_cr: 102.0,
      })
      .select()
      .single();

    // Standalone separation
    const insStandalone = await adminSb
      .from("strategy03_financial_facts")
      .insert({
        ...baseFact,
        idempotency_key: `${smokeMarker}|STANDALONE|Q1|2025-06-30|v1`,
        statement_scope: "STANDALONE",
        revenue_cr: 80.0,
      })
      .select()
      .single();

    // Invalid verification_status rejection
    const invalidStatus = await adminSb.from("strategy03_financial_facts").insert({
      ...baseFact,
      idempotency_key: `${smokeMarker}|CONSOLIDATED|Q2|2025-09-30|v1`,
      reporting_period: "2025-09-30",
      period_type: "Q2",
      verification_status: "INVALID_STATUS_TEST",
    });

    // Smoke test on strategy03_research_evaluations
    const evalRow = {
      run_id: crypto.randomUUID(),
      idempotency_key: `${smokeMarker}|EVAL|1`,
      symbol: smokeMarker,
      company_name: "Smoke Test Ltd",
      decision: "WAIT",
      total_score: 55.5,
      decision_explanation: "Smoke test evaluation row",
    };
    const evalIns = await adminSb.from("strategy03_research_evaluations").insert(evalRow).select().single();
    const evalInvalid = await adminSb.from("strategy03_research_evaluations").insert({
      ...evalRow,
      idempotency_key: `${smokeMarker}|EVAL|BAD`,
      decision: "BUY_NOW_INVALID",
    });

    const versionsRead = await adminSb
      .from("strategy03_financial_facts")
      .select("version, statement_scope, revenue_cr")
      .eq("symbol", smokeMarker)
      .order("version", { ascending: true });

    smokeResults.checks = {
      insertFactOk: !ins1.error,
      readBackOk: !read1.error && read1.data?.symbol === smokeMarker,
      idempotentUpsertOk: !up1.error && Number(up1.data?.revenue_cr) === 101,
      versionPreservationOk: !insV2.error && (versionsRead.data?.length ?? 0) === 3,
      standaloneSeparationOk: !insStandalone.error,
      invalidVerificationStatusRejected: Boolean(invalidStatus.error),
      invalidVerificationStatusError: invalidStatus.error?.message ?? null,
      evalInsertOk: !evalIns.error,
      evalInvalidDecisionRejected: Boolean(evalInvalid.error),
      evalInvalidDecisionError: evalInvalid.error?.message ?? null,
    };
  } finally {
    await adminSb.from("strategy03_financial_facts").delete().eq("symbol", smokeMarker);
    await adminSb.from("strategy03_research_evaluations").delete().eq("symbol", smokeMarker);
    const { count: remFacts } = await adminSb
      .from("strategy03_financial_facts")
      .select("*", { count: "exact", head: true })
      .eq("symbol", smokeMarker);
    const { count: remEvals } = await adminSb
      .from("strategy03_research_evaluations")
      .select("*", { count: "exact", head: true })
      .eq("symbol", smokeMarker);
    smokeResults.cleanupVerified = (remFacts ?? 0) === 0 && (remEvals ?? 0) === 0;
  }

  // 3. Persist Phase 6.4.1 20-stock sample (76 facts)
  const rawFacts: ExtractedFinancialFactRecord[] = JSON.parse(
    fs.readFileSync(path.join(PHASE_641_DIR, "normalized_financial_facts.json"), "utf8")
  );
  const validatedFacts: ExtractedFinancialFactRecord[] = [];
  const validationFailures: Array<{ idempotencyKey: string; reasons: string[] }> = [];

  for (const f of rawFacts) {
    const v = validateFactDeterministically(f);
    if (v.ok) validatedFacts.push(f);
    else validationFailures.push({ idempotencyKey: f.idempotencyKey, reasons: v.reasons });
  }

  const persistRun1 = await persistFinancialFactsIdempotent(adminSb, validatedFacts);
  const { count: dbCountAfterRun1 } = await adminSb
    .from("strategy03_financial_facts")
    .select("*", { count: "exact", head: true });

  // 4. Second ingestion run to prove idempotency
  const persistRun2 = await persistFinancialFactsIdempotent(adminSb, validatedFacts);
  const { count: dbCountAfterRun2 } = await adminSb
    .from("strategy03_financial_facts")
    .select("*", { count: "exact", head: true });

  // Query actual DB rows for coverage report
  const { data: dbRows, error: dbRowsErr } = await adminSb
    .from("strategy03_financial_facts")
    .select("symbol, statement_scope, period_type, reporting_period, version, verification_status, extraction_method, source_filing_id, source_url, idempotency_key");

  if (dbRowsErr) throw dbRowsErr;

  const bySymbol = new Map<string, { total: number; verified: number; missing: number; periods: string[] }>();
  for (const sym of SAMPLE_20_SYMBOLS) {
    bySymbol.set(sym, { total: 0, verified: 0, missing: 0, periods: [] });
  }
  for (const r of dbRows ?? []) {
    const entry = bySymbol.get(r.symbol) ?? { total: 0, verified: 0, missing: 0, periods: [] };
    entry.total += 1;
    if (r.verification_status === "VERIFIED") entry.verified += 1;
    else entry.missing += 1;
    entry.periods.push(`${r.period_type}:${r.reporting_period}`);
    bySymbol.set(r.symbol, entry);
  }

  const verifiedSymbols = [...bySymbol.entries()].filter(([, v]) => v.verified > 0).map(([k]) => k);
  const incompleteSymbols = [...bySymbol.entries()].filter(([, v]) => v.verified === 0).map(([k]) => k);

  // 5. Security check using anon / publishable key
  const securityChecks: Record<string, unknown> = {
    anonKeyConfigured: Boolean(anonKey),
    authenticatedJwtProbeRun: false,
    authenticatedJwtNote: "No authenticated user JWT session available; only anon/publishable role probed.",
    anonProbes: {},
  };

  if (anonKey) {
    const anonSb = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    for (const tbl of tablesToCheck) {
      const sel = await anonSb.from(tbl).select("*").limit(1);
      const ins = await anonSb.from(tbl).insert({ symbol: "ANON_PROBE_DENIED" });
      (securityChecks.anonProbes as Record<string, unknown>)[tbl] = {
        selectBlockedOrEmpty: Boolean(sel.error) || (sel.data?.length ?? 0) === 0,
        selectError: sel.error ? `${sel.error.code}: ${sel.error.message}` : null,
        selectRowsReturned: sel.data?.length ?? 0,
        insertBlocked: Boolean(ins.error),
        insertError: ins.error ? `${ins.error.code}: ${ins.error.message}` : null,
      };
    }
  }

  schemaResults.securityChecks = securityChecks;

  const persistenceSummary = {
    inputFactsCount: rawFacts.length,
    validatedFactsCount: validatedFacts.length,
    validationFailures,
    run1: persistRun1,
    actualDbCountAfterRun1: dbCountAfterRun1 ?? 0,
  };

  const idempotencySummary = {
    run1Count: dbCountAfterRun1 ?? 0,
    run2Count: dbCountAfterRun2 ?? 0,
    idempotentNoDuplicates: (dbCountAfterRun1 ?? -1) === (dbCountAfterRun2 ?? -2),
    run2Status: persistRun2.status,
  };

  const coverageSummary = {
    generatedAt: new Date().toISOString(),
    actualDatabaseTotalRows: dbRows?.length ?? 0,
    verifiedFactsInDb: (dbRows ?? []).filter((r) => r.verification_status === "VERIFIED").length,
    nonVerifiedFactsInDb: (dbRows ?? []).filter((r) => r.verification_status !== "VERIFIED").length,
    targetSampleStocks: SAMPLE_20_SYMBOLS.length,
    verifiedStocksCount: verifiedSymbols.length,
    incompleteStocksCount: incompleteSymbols.length,
    verifiedSymbols,
    incompleteSymbols,
    perSymbolBreakdown: Object.fromEntries(bySymbol),
  };

  fs.writeFileSync(path.join(OUT_DIR, "remote_schema_verification.json"), JSON.stringify(schemaResults, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "persistence_smoke_test.json"), JSON.stringify(smokeResults, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "financial_fact_persistence.json"), JSON.stringify(persistenceSummary, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "idempotency_results.json"), JSON.stringify(idempotencySummary, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "sample_coverage_report.json"), JSON.stringify(coverageSummary, null, 2));

  const md = [
    "# Phase 6.4.1.1 — Remote Financial Persistence & Backfill Verification",
    "",
    `Generated: ${coverageSummary.generatedAt}`,
    "",
    "## 1. Remote Schema Verification",
    `- \`strategy03_research_evaluations\`: EXISTS (initial count=${(schemaResults.tables as any).strategy03_research_evaluations.existingRowCount})`,
    `- \`strategy03_financial_facts\`: EXISTS (initial count=${(schemaResults.tables as any).strategy03_financial_facts.existingRowCount})`,
    "",
    "## 2. Controlled Smoke Test",
    `- Cleanup verified: **${smokeResults.cleanupVerified}**`,
    `- Checks: \`${JSON.stringify(smokeResults.checks)}\``,
    "",
    "## 3. Sample Persistence & Idempotency (Actual DB Counts)",
    `- Validated Phase 6.4.1 facts: **${validatedFacts.length}/${rawFacts.length}**`,
    `- DB row count after Run 1: **${idempotencySummary.run1Count}**`,
    `- DB row count after Run 2: **${idempotencySummary.run2Count}** (idempotent: **${idempotencySummary.idempotentNoDuplicates}**)`,
    `- Verified stocks in DB: **${verifiedSymbols.length}/${SAMPLE_20_SYMBOLS.length}**; Incomplete stocks: **${incompleteSymbols.join(", ")}**`,
  ].join("\n");

  fs.writeFileSync(path.join(OUT_DIR, "phase6411_final_report.md"), md);
  console.log("Phase 6.4.1.1 verification complete. Actual DB rows:", coverageSummary.actualDatabaseTotalRows);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

