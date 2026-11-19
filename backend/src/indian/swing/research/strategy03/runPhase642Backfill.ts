import fs from "node:fs";
import path from "node:path";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { Strategy03UniverseService } from "./Strategy03UniverseService.js";
import {
  computeShareholdingTrends,
  downloadShpXbrlWithCache,
  fetchNseShareholdingMaster,
  mapNseMasterItemToHints,
  parseShareholdingXbrlXml,
  persistInstitutionalOwnershipIdempotent,
  type NormalizedShareholdingRecord,
} from "./OfficialShareholdingIntelligenceEngine.js";

config({ path: path.resolve("D:/Trading/my-app/backend/.env") });

const OUT_DIR = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase642");
const CACHE_DIR = path.join(OUT_DIR, "cache");

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

async function processSymbol(
  symbol: string,
  maxQuarters: number,
  isinHint: string | null
): Promise<{
  symbol: string;
  filingsDiscovered: number;
  filingsDownloaded: number;
  filingsParsed: number;
  records: NormalizedShareholdingRecord[];
  error?: string;
}> {
  const master = await fetchNseShareholdingMaster(symbol);
  if (!master.ok) {
    return {
      symbol,
      filingsDiscovered: 0,
      filingsDownloaded: 0,
      filingsParsed: 0,
      records: [],
      error: master.error,
    };
  }

  const withXbrl = master.items.filter((i) => Boolean(i.xbrl && i.xbrl.endsWith(".xml")));
  const selected = withXbrl.slice(0, maxQuarters);

  let downloaded = 0;
  const rawRecords: NormalizedShareholdingRecord[] = [];
  const versionCounter = new Map<string, number>();

  for (const item of selected) {
    if (!item.xbrl) continue;
    const dl = await downloadShpXbrlWithCache(item.xbrl, { cacheDir: CACHE_DIR });
    if (!dl.ok || !dl.xmlText) continue;
    downloaded += 1;

    const hints = mapNseMasterItemToHints(item);
    const qKey = `${symbol}|NSE|${hints.reportingQuarter}`;
    const nextVer = (versionCounter.get(qKey) ?? 0) + 1;
    versionCounter.set(qKey, nextVer);

    const parsed = parseShareholdingXbrlXml({
      symbol,
      isin: item.isin ?? isinHint ?? null,
      exchange: "NSE",
      reportingQuarter: hints.reportingQuarter,
      filingDate: hints.filingDate,
      publicationTimestamp: hints.publicationTimestamp,
      filingId: item.recordId ?? null,
      sourceUrl: item.xbrl,
      xmlText: dl.xmlText,
      masterPromoterPct: hints.masterPromoterPct,
      masterPublicPct: hints.masterPublicPct,
      isRestated: hints.isRestated || nextVer > 1,
      version: nextVer,
    });
    rawRecords.push(parsed);
  }

  const trended = computeShareholdingTrends(rawRecords);
  return {
    symbol,
    filingsDiscovered: withXbrl.length,
    filingsDownloaded: downloaded,
    filingsParsed: trended.length,
    records: trended,
  };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(CACHE_DIR, { recursive: true });

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  const universeSvc = new Strategy03UniverseService();
  const allUniverse = await universeSvc.loadAllPaginated();
  const eligible = allUniverse.filter((u) => u.eligibleForNseResearch && u.nseSymbol);
  const isinBySymbol = new Map<string, string | null>();
  for (const u of eligible) {
    if (u.nseSymbol) isinBySymbol.set(u.nseSymbol.toUpperCase(), u.isin);
  }

  // Stage 1: Controlled 20-stock sample (up to 6 historical quarters each)
  console.log("[1/4] Running controlled 20-stock shareholding backfill...");
  const sample20Records: NormalizedShareholdingRecord[] = [];
  let s20Discovered = 0;
  let s20Downloaded = 0;
  let s20Parsed = 0;
  const s20MissingSymbols: string[] = [];

  for (const sym of SAMPLE_20_SYMBOLS) {
    const res = await processSymbol(sym, 6, isinBySymbol.get(sym) ?? null);
    s20Discovered += res.filingsDiscovered;
    s20Downloaded += res.filingsDownloaded;
    s20Parsed += res.filingsParsed;
    sample20Records.push(...res.records);
    if (!res.records.some((r) => r.verificationStatus === "VERIFIED")) {
      s20MissingSymbols.push(sym);
    }
  }
  console.log(`[1/4] Sample 20 complete: parsed=${s20Parsed}, missingOrUnverified=${s20MissingSymbols.length}`);

  // Stage 2: Controlled 100-stock eligible NSE batch (up to 5 historical quarters each)
  const batch100Symbols = [
    ...SAMPLE_20_SYMBOLS,
    ...eligible
      .map((u) => u.nseSymbol!.toUpperCase())
      .filter((s) => !SAMPLE_20_SYMBOLS.includes(s))
      .slice(0, 80),
  ];

  console.log(`[2/4] Expanding to controlled ${batch100Symbols.length}-stock batch...`);
  const allBatchRecords: NormalizedShareholdingRecord[] = [...sample20Records];
  let totalDiscovered = s20Discovered;
  let totalDownloaded = s20Downloaded;
  let totalParsed = s20Parsed;
  const perSymbolMissing: Array<{ symbol: string; reason: string }> = s20MissingSymbols.map((s) => ({
    symbol: s,
    reason: "NO_VERIFIED_SHP_XBRL_IN_SAMPLE",
  }));

  const remaining80 = batch100Symbols.slice(SAMPLE_20_SYMBOLS.length);
  const CONCURRENCY = 5;
  for (let i = 0; i < remaining80.length; i += CONCURRENCY) {
    const chunk = remaining80.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      chunk.map((sym) => processSymbol(sym, 5, isinBySymbol.get(sym) ?? null))
    );
    for (const res of results) {
      totalDiscovered += res.filingsDiscovered;
      totalDownloaded += res.filingsDownloaded;
      totalParsed += res.filingsParsed;
      allBatchRecords.push(...res.records);
      if (!res.records.some((r) => r.verificationStatus === "VERIFIED")) {
        perSymbolMissing.push({
          symbol: res.symbol,
          reason: res.error ?? (res.filingsDiscovered === 0 ? "NO_SHP_XBRL_FILINGS" : "UNVERIFIED_OR_STALE"),
        });
      }
    }
  }

  // Stage 3: Persistence check
  console.log(`[3/4] Attempting persistence of ${allBatchRecords.length} institutional ownership records...`);
  const persistenceResult = await persistInstitutionalOwnershipIdempotent(supabase, allBatchRecords);
  console.log("[3/4] Persistence status:", persistenceResult);

  // Stage 4: Coverage report
  const statusCounts = {
    VERIFIED: allBatchRecords.filter((r) => r.verificationStatus === "VERIFIED").length,
    UNVERIFIED: allBatchRecords.filter((r) => r.verificationStatus === "UNVERIFIED").length,
    MISSING: allBatchRecords.filter((r) => r.verificationStatus === "MISSING").length,
    STALE: allBatchRecords.filter((r) => r.verificationStatus === "STALE").length,
    CONFLICTED: allBatchRecords.filter((r) => r.verificationStatus === "CONFLICTED").length,
  };
  const verifiedStocks = new Set(
    allBatchRecords.filter((r) => r.verificationStatus === "VERIFIED").map((r) => r.symbol)
  );
  const pledgeCoveredStocks = new Set(
    allBatchRecords.filter((r) => r.promoterPledgedPct !== null).map((r) => r.symbol)
  );
  const distinctQuarters = new Set(allBatchRecords.map((r) => r.reportingQuarter));

  const coverageReport = {
    generatedAt: new Date().toISOString(),
    sourcesAccessed: [
      "https://www.nseindia.com/api/corporate-share-holdings-master?index=equities&symbol=...",
      "https://nsearchives.nseindia.in/corporate/xbrl/SHP_*.xml (in-bse-shp taxonomy)",
    ],
    totalEligibleUniverseStocks: eligible.length,
    controlledBatchSize: batch100Symbols.length,
    filingsDiscovered: totalDiscovered,
    filingsDownloaded: totalDownloaded,
    filingsParsed: totalParsed,
    statusCounts,
    verifiedStocksCount: verifiedStocks.size,
    pledgeCoveredStocksCount: pledgeCoveredStocks.size,
    historicalQuartersCovered: [...distinctQuarters].sort(),
    missingOrIncompleteStocksCount: perSymbolMissing.length,
    missingOrIncompleteStocksSample: perSymbolMissing.slice(0, 20),
    persistenceResult,
    safetyChecks: {
      STRATEGY_01: false,
      STRATEGY_02: false,
      STRATEGY_03: false,
      LIVE_TRADING: false,
      BROKER_EXECUTION_ENABLED: false,
      experimental_paper_trades: 0,
    },
  };

  fs.writeFileSync(path.join(OUT_DIR, "sample20_ownership.json"), JSON.stringify(sample20Records, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "batch100_ownership.json"), JSON.stringify(allBatchRecords, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "ownership_coverage_report.json"), JSON.stringify(coverageReport, null, 2));

  const md = [
    "# Phase 6.4.2 — Official Institutional Shareholding Intelligence Report",
    "",
    `Generated: ${coverageReport.generatedAt}`,
    "",
    `- Eligible NSE Universe: **${eligible.length}**`,
    `- Controlled Batch Size: **${batch100Symbols.length}** (20-stock sample -> 100-stock batch)`,
    `- Official SHP XBRL Filings Discovered: **${totalDiscovered}** | Downloaded: **${totalDownloaded}** | Parsed: **${totalParsed}**`,
    `- Record Statuses: VERIFIED=**${statusCounts.VERIFIED}**, STALE=**${statusCounts.STALE}**, UNVERIFIED=**${statusCounts.UNVERIFIED}**, MISSING=**${statusCounts.MISSING}**, CONFLICTED=**${statusCounts.CONFLICTED}**`,
    `- Verified Stocks: **${verifiedStocks.size}/${batch100Symbols.length}** | Promoter Pledge Covered Stocks: **${pledgeCoveredStocks.size}/${batch100Symbols.length}**`,
    `- Persistence: **${persistenceResult.status}** (${persistenceResult.error ?? `upserted=${persistenceResult.upsertedCount}`})`,
  ].join("\n");

  fs.writeFileSync(path.join(OUT_DIR, "phase642_final_report.md"), md);
  console.log("[4/4] Phase 6.4.2 artifacts written to:", OUT_DIR);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

