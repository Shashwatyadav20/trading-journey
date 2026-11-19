import fs from "node:fs";
import path from "node:path";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import {
  persistInstitutionalOwnershipIdempotent,
  type NormalizedShareholdingRecord,
} from "./OfficialShareholdingIntelligenceEngine.js";
import { Strategy03InstitutionalResearchService } from "./Strategy03ResearchPipeline.js";

config({ path: path.resolve("D:/Trading/my-app/backend/.env") });
config({ path: path.resolve("D:/Trading/my-app/.env.local"), override: false });

const PHASE_642_DIR = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase642");
const OUT_DIR = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase6421");

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  const adminSb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  // 1. Remote schema check
  const schemaCheck = await adminSb
    .from("strategy03_institutional_ownership")
    .select("*", { count: "exact", head: true });
  if (schemaCheck.error) {
    console.error("BLOCKED: strategy03_institutional_ownership missing:", schemaCheck.error);
    process.exit(2);
  }

  // 2. Controlled smoke test
  const marker = "SMOKE_TEST_6421";
  const smokeChecks: Record<string, unknown> = { marker };
  try {
    await adminSb.from("strategy03_institutional_ownership").delete().eq("symbol", marker);

    const baseRow = {
      idempotency_key: `${marker}|NSE|2026-09-30|v1`,
      symbol: marker,
      isin: "INE999A01011",
      exchange: "NSE",
      reporting_quarter: "2026-09-30",
      filing_date: "2026-10-21",
      source_name: "NSE_BSE_SHP_XBRL",
      source_url: "https://nsearchives.nseindia.in/corporate/xbrl/SHP_SMOKE.xml",
      version: 1,
      is_restated: false,
      promoter_pct: 50.0,
      promoter_pledged_pct: 0,
      fii_pct: 20.0,
      dii_pct: 15.0,
      mutual_fund_pct: 8.0,
      public_pct: 50.0,
      total_reported_pct: 100.0,
      is_total_reconciled: true,
      verification_status: "VERIFIED",
      confidence: 0.96,
    };

    const ins1 = await adminSb.from("strategy03_institutional_ownership").insert(baseRow).select().single();
    const read1 = await adminSb
      .from("strategy03_institutional_ownership")
      .select("*")
      .eq("idempotency_key", baseRow.idempotency_key)
      .single();
    const upsert1 = await adminSb
      .from("strategy03_institutional_ownership")
      .upsert({ ...baseRow, fii_pct: 20.5 }, { onConflict: "idempotency_key" })
      .select()
      .single();
    // Duplicate versioned key with different idempotency_key -> must reject via strategy03_inst_own_versioned_uk
    const dupUk = await adminSb.from("strategy03_institutional_ownership").insert({
      ...baseRow,
      idempotency_key: `${marker}|ALT_KEY_SHOULD_FAIL_UK`,
    });
    // Version preservation (v2)
    const insV2 = await adminSb
      .from("strategy03_institutional_ownership")
      .insert({
        ...baseRow,
        idempotency_key: `${marker}|NSE|2026-09-30|v2`,
        version: 2,
        is_restated: true,
        fii_pct: 21.0,
      })
      .select()
      .single();
    // Invalid verification_status rejection
    const badStatus = await adminSb.from("strategy03_institutional_ownership").insert({
      ...baseRow,
      idempotency_key: `${marker}|NSE|2026-06-30|v1`,
      reporting_quarter: "2026-06-30",
      verification_status: "BOGUS_STATUS",
    });

    const versions = await adminSb
      .from("strategy03_institutional_ownership")
      .select("version, fii_pct")
      .eq("symbol", marker)
      .order("version", { ascending: true });

    smokeChecks.checks = {
      insertOk: !ins1.error,
      readOk: !read1.error && read1.data?.symbol === marker,
      idempotentUpsertOk: !upsert1.error && Number(upsert1.data?.fii_pct) === 20.5,
      duplicateVersionedKeyRejected: Boolean(dupUk.error),
      duplicateVersionedKeyError: dupUk.error?.message ?? null,
      versionPreservationOk: !insV2.error && (versions.data?.length ?? 0) === 2,
      invalidStatusRejected: Boolean(badStatus.error),
      invalidStatusError: badStatus.error?.message ?? null,
    };
  } finally {
    await adminSb.from("strategy03_institutional_ownership").delete().eq("symbol", marker);
    const { count } = await adminSb
      .from("strategy03_institutional_ownership")
      .select("*", { count: "exact", head: true })
      .eq("symbol", marker);
    smokeChecks.cleanupVerified = (count ?? 0) === 0;
  }

  // 3. Persist all 479 records from Phase 6.4.2
  const records: NormalizedShareholdingRecord[] = JSON.parse(
    fs.readFileSync(path.join(PHASE_642_DIR, "batch100_ownership.json"), "utf8")
  );
  for (let i = 0; i < records.length; i += 100) {
    const res = await persistInstitutionalOwnershipIdempotent(adminSb, records.slice(i, i + 100));
    if (res.status !== "PERSISTED") throw new Error(`Persistence failed: ${res.error}`);
  }

  // 4. Actual remote DB counts
  const { data: allDbRows, error: allErr } = await adminSb
    .from("strategy03_institutional_ownership")
    .select("symbol, verification_status, reporting_quarter, version");
  if (allErr) throw allErr;

  const dbCounts = {
    total: allDbRows?.length ?? 0,
    VERIFIED: (allDbRows ?? []).filter((r) => r.verification_status === "VERIFIED").length,
    STALE: (allDbRows ?? []).filter((r) => r.verification_status === "STALE").length,
    MISSING: (allDbRows ?? []).filter((r) => r.verification_status === "MISSING").length,
    UNVERIFIED: (allDbRows ?? []).filter((r) => r.verification_status === "UNVERIFIED").length,
    CONFLICTED: (allDbRows ?? []).filter((r) => r.verification_status === "CONFLICTED").length,
  };

  // 5. Run ingestion a second time -> prove no duplicates
  for (let i = 0; i < records.length; i += 100) {
    const res = await persistInstitutionalOwnershipIdempotent(adminSb, records.slice(i, i + 100));
    if (res.status !== "PERSISTED") throw new Error(`Second run failed: ${res.error}`);
  }
  const { count: countAfterRun2 } = await adminSb
    .from("strategy03_institutional_ownership")
    .select("*", { count: "exact", head: true });

  // 6. Anon RLS check
  const anonChecks: Record<string, unknown> = { anonKeyConfigured: Boolean(anonKey) };
  if (anonKey) {
    const anonSb = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    const sel = await anonSb.from("strategy03_institutional_ownership").select("*").limit(5);
    const ins = await anonSb
      .from("strategy03_institutional_ownership")
      .insert({ symbol: "ANON_DENIED" });
    anonChecks.selectRowsReturned = sel.data?.length ?? 0;
    anonChecks.selectBlockedOrEmpty = Boolean(sel.error) || (sel.data?.length ?? 0) === 0;
    anonChecks.insertBlocked = Boolean(ins.error);
    anonChecks.insertError = ins.error ? `${ins.error.code}: ${ins.error.message}` : null;
  }

  // 7 & 8. Verify Strategy03InstitutionalResearchService reads persisted records & guards against STALE
  const instSvc = new Strategy03InstitutionalResearchService();
  const relianceEval = await instSvc.evaluate({ symbol: "RELIANCE" });

  // Find a symbol whose latest persisted row is STALE
  const staleOnlySym = (allDbRows ?? []).find(
    (r) =>
      r.verification_status === "STALE" &&
      !(allDbRows ?? []).some((o) => o.symbol === r.symbol && o.verification_status === "VERIFIED")
  )?.symbol;
  const staleEval = staleOnlySym ? await instSvc.evaluate({ symbol: staleOnlySym }) : null;

  const report = {
    generatedAt: new Date().toISOString(),
    remoteTableExists: true,
    smokeChecks,
    inputRecordsCount: records.length,
    dbCountsAfterRun1: dbCounts,
    dbCountAfterRun2: countAfterRun2 ?? 0,
    idempotentNoDuplicates: dbCounts.total === (countAfterRun2 ?? -1),
    anonChecks,
    serviceIntegrationCheck: {
      relianceSymbol: relianceEval.symbol,
      relianceStatus: relianceEval.shareholdingVerificationStatus,
      relianceLatestQuarter: relianceEval.latestQuarter,
      relianceFiiDeltaPct: relianceEval.fiiDeltaPct,
      relianceMutualFundPct: relianceEval.mutualFundPct,
      staleSymbolTested: staleOnlySym ?? null,
      staleStatus: staleEval?.shareholdingVerificationStatus ?? null,
      staleMissingFields: staleEval?.missingFields ?? [],
      staleCannotBeTreatedAsVerified: staleEval ? staleEval.shareholdingVerificationStatus !== "VERIFIED" : null,
    },
    safetyChecks: {
      STRATEGY_01: false,
      STRATEGY_02: false,
      STRATEGY_03: false,
      LIVE_TRADING: false,
      BROKER_EXECUTION_ENABLED: false,
      experimental_paper_trades: 0,
    },
  };

  fs.writeFileSync(path.join(OUT_DIR, "phase6421_verification_report.json"), JSON.stringify(report, null, 2));
  console.log("Phase 6.4.2.1 verification complete:", JSON.stringify({ dbCounts, countAfterRun2, anonChecks, serviceIntegrationCheck: report.serviceIntegrationCheck }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

