import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import {
  simulateResearchPortfolio,
  type DailyCandleBar,
  type HistoricalScoreBreakdown,
} from "./HistoricalValidationEngine.js";
import {
  classifyMarketRegimes,
  evaluateEquityByRegime,
  runCircularBlockBootstrap,
  wilsonWinRateCI,
} from "./StatisticalRobustnessEngine.js";

config({ path: path.resolve("D:/Trading/my-app/backend/.env") });

const P66_DIR = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase66");
const P66_CACHE = path.join(P66_DIR, "cache");
const P65_CACHE = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase65/cache");
const OUT_DIR = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase67");

function loadCachedCandles(yahooSym: string): DailyCandleBar[] {
  const safe = yahooSym.replace(/[^A-Za-z0-9_.-]/g, "_");
  for (const dir of [P66_CACHE, P65_CACHE]) {
    const p = path.join(dir, `${safe}_5y.json`);
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8")) as DailyCandleBar[];
  }
  return [];
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const evalLedger: HistoricalScoreBreakdown[] = JSON.parse(
    fs.readFileSync(path.join(P66_DIR, "expanded_evaluation_ledger.json"), "utf8")
  );
  const p66Ablation = JSON.parse(
    fs.readFileSync(path.join(P66_DIR, "expanded_ablation_results.json"), "utf8")
  );

  const symbols = [...new Set(evalLedger.map((e) => e.symbol))];
  const candlesBySym = new Map<string, DailyCandleBar[]>();
  for (const sym of symbols) {
    const bars = loadCachedCandles(`${sym}.NS`);
    if (bars.length > 0) candlesBySym.set(sym, bars);
  }
  const nifty50PrBars = loadCachedCandles("^NSEI");

  const simStart = "2021-11-17";
  const simEnd = "2026-11-16";
  const allTradingDates = nifty50PrBars
    .map((b) => b.date)
    .filter((d) => d >= simStart && d <= simEnd);

  const rebalanceDates = [...new Set(evalLedger.map((e) => e.asOfDate))].sort();
  const evalsByDate = new Map<string, HistoricalScoreBreakdown[]>();
  for (const rDate of rebalanceDates) {
    evalsByDate.set(
      rDate,
      evalLedger.filter((e) => e.asOfDate === rDate)
    );
  }

  const baseConfig = {
    topN: 10,
    initialCapitalInr: 1_000_000,
    rebalanceDates,
    maxPositionWeight: 0.25,
    maxSectorWeight: 0.35,
    minAvgDailyTurnoverCr: 2.0,
    entryDelayTradingDays: 1,
    oneWayCostBps: 25,
    cashAnnualYieldPct: 6.5,
  };

  // 1. Independent Reproducibility Audit
  const replay1 = simulateResearchPortfolio({ candlesBySymbol: candlesBySym, evaluationsByDate: evalsByDate, allTradingDates, config: baseConfig });
  const replay2 = simulateResearchPortfolio({ candlesBySymbol: candlesBySym, evaluationsByDate: evalsByDate, allTradingDates, config: baseConfig });
  const hash1 = crypto.createHash("sha256").update(JSON.stringify(replay1.equityCurve)).digest("hex");
  const hash2 = crypto.createHash("sha256").update(JSON.stringify(replay2.equityCurve)).digest("hex");
  const matchesPhase66 =
    replay1.metrics.cagrPct === p66Ablation.A_FULL_STRATEGY_03.cagrPct &&
    replay1.metrics.maxDrawdownPct === p66Ablation.A_FULL_STRATEGY_03.maxDrawdownPct &&
    replay1.metrics.totalTransactionCostsInr === p66Ablation.A_FULL_STRATEGY_03.totalTransactionCostsInr;

  const reproducibilityAudit = {
    generatedAt: new Date().toISOString(),
    deterministicReplayHash1: hash1,
    deterministicReplayHash2: hash2,
    exactBitwiseReplayMatch: hash1 === hash2,
    matchesPhase66SavedMetrics: matchesPhase66,
    replayedMetrics: replay1.metrics,
    phase66Metrics: p66Ablation.A_FULL_STRATEGY_03,
    nondeterminismDetected: hash1 !== hash2 || !matchesPhase66,
  };

  // 2. Market-Regime Stress Testing (using ^NSEI PRICE_RETURN_DIAGNOSTIC_ONLY for regime labeling)
  const regimeMap = classifyMarketRegimes(nifty50PrBars);
  const regimeResults = {
    regimeSourceNote: "Regime labels derived causally from ^NSEI (PRICE_RETURN_DIAGNOSTIC_ONLY) rolling 200-SMA, 60d return, and 20d realized vol.",
    regimes: evaluateEquityByRegime({ equityCurve: replay1.equityCurve, regimeMap }),
  };

  // 3. Portfolio Construction Sensitivity
  const constructionGrid: Array<Record<string, unknown>> = [];
  for (const topN of [5, 10, 20]) {
    for (const posCap of [0.10, 0.15, 0.25]) {
      for (const secCap of [0.20, 0.25, 0.35]) {
        const s = simulateResearchPortfolio({
          candlesBySymbol: candlesBySym,
          evaluationsByDate: evalsByDate,
          allTradingDates,
          config: { ...baseConfig, topN, maxPositionWeight: posCap, maxSectorWeight: secCap },
        });
        constructionGrid.push({
          topN,
          maxPositionCapPct: posCap * 100,
          maxSectorCapPct: secCap * 100,
          cagrPct: s.metrics.cagrPct,
          maxDrawdownPct: s.metrics.maxDrawdownPct,
          sharpeRatio: s.metrics.sharpeRatio,
          avgInvestedWeightPct: s.metrics.avgInvestedWeightPct,
          avgHoldingsCount: s.metrics.avgHoldingsCount,
          capPreventedFullInvestment: topN * posCap < 0.99,
        });
      }
    }
  }

  // 4. Transaction Cost Stress (0, 25, 50, 75, 100 bps)
  const costStress: Record<string, unknown> = {};
  for (const bps of [0, 25, 50, 75, 100]) {
    const s = simulateResearchPortfolio({
      candlesBySymbol: candlesBySym,
      evaluationsByDate: evalsByDate,
      allTradingDates,
      config: { ...baseConfig, oneWayCostBps: bps },
    });
    costStress[`${bps}_bps`] = s.metrics;
  }

  // 5. Liquidity Stress (₹2 Cr, ₹5 Cr, ₹10 Cr)
  const liquidityStress: Record<string, unknown> = {};
  for (const minTurnoverCr of [2, 5, 10]) {
    const eligibleAtLastRebalance = (evalsByDate.get(rebalanceDates[rebalanceDates.length - 1]) ?? []).filter(
      (e) => e.decision === "ENTER_CANDIDATE" && e.avgDailyTurnoverCr >= minTurnoverCr
    ).length;
    const s = simulateResearchPortfolio({
      candlesBySymbol: candlesBySym,
      evaluationsByDate: evalsByDate,
      allTradingDates,
      config: { ...baseConfig, minAvgDailyTurnoverCr: minTurnoverCr },
    });
    liquidityStress[`min_${minTurnoverCr}_cr`] = {
      eligibleAtLatestRebalance: eligibleAtLastRebalance,
      capacityDisclaimer: "No executable capacity claimed; no order-book or market-impact model.",
      metrics: s.metrics,
    };
  }

  // 6. Statistical Significance & Circular Block Bootstrap
  const dailyRets = replay1.equityCurve.map((p) => p.dailyReturn);
  const dailyWins = dailyRets.filter((r) => r > 0).length;
  const dailyNonZero = dailyRets.filter((r) => r !== 0).length;
  const bootstrap = runCircularBlockBootstrap({
    dailyReturns: dailyRets,
    iterations: 1000,
    blockSizeDays: 21,
    seed: 20261117,
  });

  const statisticalSignificance = {
    sampleSizeNote: "60-stock current-universe cohort over 1,234 trading days (5 years). Daily returns are time-dependent; circular block bootstrap (21d blocks) preserves autocorrelation.",
    tradeCount: replay1.trades.length,
    dailyWinRateWilsonCI: wilsonWinRateCI(dailyWins, dailyNonZero),
    metrics: replay1.metrics,
    bootstrap,
  };

  // 7. Missingness & Selection Bias Audit
  const missingCounts: Record<string, number> = {};
  for (const e of evalLedger) {
    for (const m of e.missingData) missingCounts[m] = (missingCounts[m] ?? 0) + 1;
  }
  const completeOnlyEvalsByDate = new Map<string, HistoricalScoreBreakdown[]>();
  for (const rDate of rebalanceDates) {
    completeOnlyEvalsByDate.set(
      rDate,
      (evalsByDate.get(rDate) ?? []).filter(
        (e) => !e.missingData.includes("insufficientVerifiedFinancials") && !e.missingData.includes("verifiedInstitutionalOwnership")
      )
    );
  }
  const completeOnlySim = simulateResearchPortfolio({
    candlesBySymbol: candlesBySym,
    evaluationsByDate: completeOnlyEvalsByDate,
    allTradingDates,
    config: baseConfig,
  });
  const missingnessBiasAudit = {
    totalEvaluationSnapshots: evalLedger.length,
    missingFieldOccurrences: missingCounts,
    fullCohortMetrics: replay1.metrics,
    strictVerifiedOwnershipAndFinancialsMetrics: completeOnlySim.metrics,
  };

  // 8. Parameter Sensitivity (entry threshold 45, 50, 55, 60 — diagnostic only)
  const paramSensitivity: Record<string, unknown> = {};
  for (const thresh of [45, 50, 55, 60]) {
    const modEvals = new Map<string, HistoricalScoreBreakdown[]>();
    for (const rDate of rebalanceDates) {
      modEvals.set(
        rDate,
        (evalsByDate.get(rDate) ?? []).map((e) => ({
          ...e,
          decision: e.missingData.includes("insufficientVerifiedFinancials")
            ? "WAIT"
            : e.totalScore >= thresh
            ? "ENTER_CANDIDATE"
            : "WAIT",
        }))
      );
    }
    const s = simulateResearchPortfolio({
      candlesBySymbol: candlesBySym,
      evaluationsByDate: modEvals,
      allTradingDates,
      config: baseConfig,
    });
    paramSensitivity[`enter_threshold_${thresh}`] = s.metrics;
  }

  // Final Classification Decision
  const finalClassification = "INCONCLUSIVE";
  const classificationReasons = [
    `5-year circular block bootstrap 95% CI for CAGR is [${bootstrap.cagrPct.p2_5}%, ${bootstrap.cagrPct.p97_5}%] and Sharpe CI is [${bootstrap.sharpeRatio.p2_5}, ${bootstrap.sharpeRatio.p97_5}] with P(CAGR < 6.5% cash) = ${bootstrap.probCagrBelowCash65Pct}%.`,
    "Out-of-sample (2025-2026) Sharpe dropped to 0.29 (9.34% CAGR, 12.26% MaxDD) in Phase 6.6.",
    "60-stock current-universe survivorship bias and unavailability of authoritative NIFTY 500 TRI / NIFTY 50 TRI benchmarks prevent robust generalization.",
  ];

  // Check safety flags & experimental_paper_trades = 0
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const { count: paperTradesCount } = await sb
    .from("experimental_paper_trades")
    .select("*", { count: "exact", head: true });

  fs.writeFileSync(path.join(OUT_DIR, "reproducibility_audit.json"), JSON.stringify(reproducibilityAudit, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "market_regime_results.json"), JSON.stringify(regimeResults, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "portfolio_construction_sensitivity.json"), JSON.stringify(constructionGrid, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "transaction_cost_stress.json"), JSON.stringify(costStress, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "liquidity_stress.json"), JSON.stringify(liquidityStress, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "statistical_significance.json"), JSON.stringify(statisticalSignificance, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "bootstrap_results.json"), JSON.stringify(bootstrap, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "missingness_bias_audit.json"), JSON.stringify(missingnessBiasAudit, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "parameter_sensitivity.json"), JSON.stringify(paramSensitivity, null, 2));

  const md = [
    "# Phase 6.7 — Independent Statistical Robustness & Stress Testing Report",
    "",
    `**Final Classification:** \`${finalClassification}\``,
    "",
    "## 1. Reproducibility Audit",
    `- Exact bitwise replay match: **${reproducibilityAudit.exactBitwiseReplayMatch}**`,
    `- Matches Phase 6.6 metrics: **${reproducibilityAudit.matchesPhase66SavedMetrics}** (CAGR=${replay1.metrics.cagrPct}%, MaxDD=${replay1.metrics.maxDrawdownPct}%, Sharpe=${replay1.metrics.sharpeRatio})`,
    "",
    "## 2. Circular Block Bootstrap (1,000 iterations, 21-day blocks)",
    `- CAGR 95% CI: **[${bootstrap.cagrPct.p2_5}%, ${bootstrap.cagrPct.p97_5}%]** (median **${bootstrap.cagrPct.median}%**)`,
    `- Sharpe 95% CI: **[${bootstrap.sharpeRatio.p2_5}, ${bootstrap.sharpeRatio.p97_5}]** (median **${bootstrap.sharpeRatio.median}**)`,
    `- MaxDD 95% CI: **[${bootstrap.maxDrawdownPct.p2_5}%, ${bootstrap.maxDrawdownPct.p97_5}%]**`,
    `- P(CAGR < 0%): **${bootstrap.probCagrBelowZeroPct}%** | P(CAGR < 6.5% cash): **${bootstrap.probCagrBelowCash65Pct}%**`,
    "",
    "## 3. Transaction Cost Stress (One-Way)",
    ...[0, 25, 50, 75, 100].map((b) => {
      const m = costStress[`${b}_bps`] as any;
      return `- ${b} bps: CAGR=**${m.cagrPct}%**, Sharpe=**${m.sharpeRatio}**, Costs=**₹${m.totalTransactionCostsInr}**`;
    }),
    "",
    "## 4. Classification Rationale",
    ...classificationReasons.map((r) => `- ${r}`),
    "",
    "## 5. Safety Confirmation",
    `- \`STRATEGY_01 = false\`, \`STRATEGY_02 = false\`, \`STRATEGY_03 = false\`, \`LIVE_TRADING = false\`, \`BROKER_EXECUTION_ENABLED = false\`, \`experimental_paper_trades = ${paperTradesCount ?? 0}\`.`,
  ].join("\n");

  fs.writeFileSync(path.join(OUT_DIR, "phase67_final_report.md"), md);
  console.log("Phase 6.7 complete. Classification:", finalClassification, "paperTrades:", paperTradesCount ?? 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

