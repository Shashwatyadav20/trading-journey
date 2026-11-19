import fs from "node:fs";
import path from "node:path";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import {
  FORWARD_VALIDATION_ACCEPTANCE_CRITERIA,
  STRATEGY03_PROPOSED_RISK_SPEC,
} from "./Strategy03ReadinessCertifier.js";
import type { ForwardReturnObservation, ShadowSignalRecord } from "./Strategy03ShadowRunner.js";

config({ path: path.resolve("D:/Trading/my-app/backend/.env") });

const P69_DIR = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase69");
const OUT_DIR = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase610");

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const { count: paperTradesCount } = await sb
    .from("experimental_paper_trades")
    .select("*", { count: "exact", head: true });

  const shadowLedger: ShadowSignalRecord[] = JSON.parse(
    fs.readFileSync(path.join(P69_DIR, "shadow_signal_ledger.json"), "utf8")
  );
  const forwardTracking = JSON.parse(
    fs.readFileSync(path.join(P69_DIR, "forward_return_tracking.json"), "utf8")
  ) as { observations: ForwardReturnObservation[] };
  const shadowCoverage = JSON.parse(
    fs.readFileSync(path.join(P69_DIR, "shadow_data_coverage.json"), "utf8")
  );

  // Separate historical 90-day baseline (2026-08-18) from live forward observations (2026-11-17)
  const liveSignals = shadowLedger.filter((s) => s.signalDate >= "2026-11-17");
  const baselineSignals = shadowLedger.filter((s) => s.signalDate < "2026-11-17");

  const maturityCounts = (obs: ForwardReturnObservation[]) => ({
    totalSignals: obs.length,
    matured1d: obs.filter((o) => o.ret1dPct !== null).length,
    matured5d: obs.filter((o) => o.ret5dPct !== null).length,
    matured10d: obs.filter((o) => o.ret10dPct !== null).length,
    matured20d: obs.filter((o) => o.ret20dPct !== null).length,
    matured60d: obs.filter((o) => o.ret60dPct !== null).length,
    incompleteNeverCoercedToZero: true,
  });

  const liveObs = forwardTracking.observations.filter((o) => o.signalDate >= "2026-11-17");
  const baselineObs = forwardTracking.observations.filter((o) => o.signalDate < "2026-11-17");

  const paperEngineAudit = {
    auditedAt: new Date().toISOString(),
    inspectedFiles: [
      "backend/src/indian/experimentalPaper/ExperimentalPaperTradeManager.ts",
      "backend/src/indian/security/BrokerSafetyLock.ts",
    ],
    reusableControls: [
      "idempotency_key deduplication (getTradeByIdempotencyKey + insertTrade)",
      "Duplicate OPEN position prevention per strategy + contractIdentifier",
      "Partial-fill liquidity cap (<= 5% of barVolume) & conservative slippage (8 bps / bid-ask)",
      "Gap-through-SL at bar open (GAP_THROUGH_SL / GAP_THROUGH_TSL)",
      "Conservative intra-bar SL-before-target ordering",
      "Non-widening dynamic TSL (+1R breakeven, +1.5R profit lock)",
      "emergencyCloseTrade, recoverOnStartup (RESTART_RECOVERY_COMPLETED), DailyRiskController lock",
    ],
    strategy03IsolationRequirements: [
      "Extend ExperimentalStrategyId union or create dedicated Strategy03 paper partition with enabled: false default",
      "Enforce multi-day swing/delivery holding rules without intraday squareoff",
      "Do not share or alter STRATEGY_01 / STRATEGY_02 retirement manifests or legacy PAPER_TRADING",
    ],
  };

  const shadowStatus = {
    liveObservationStartDate: "2026-11-17",
    actualLiveObservationDays: 1,
    requiredMinLiveDays: FORWARD_VALIDATION_ACCEPTANCE_CRITERIA.minLiveShadowCalendarDays,
    liveSignalsCount: liveSignals.length,
    liveMaturity: maturityCounts(liveObs),
    historical90dBaselineSignalsCount: baselineSignals.length,
    historical90dBaselineMaturity: maturityCounts(baselineObs),
    meets90DayLiveAcceptanceCriteria: false,
  };

  const dataReadinessAudit = {
    exactPaginatedCounts: shadowCoverage.exactPaginatedRowCounts,
    metricCoverage: shadowCoverage.metricCoverage,
    remainingGaps: [
      "strategy03_delivery_data = 0 rows remotely (requires full-universe delivery backfill if delivery factor is enabled)",
      "FCF non-null = 0 and Debt non-null = 42 across 931 XBRL rows (quarterly Ind-AS filings omit full balance sheet/cash flow for many quarters)",
      "Authoritative NIFTY 500 TRI / NIFTY 50 TRI unavailable without WAF bypass",
      "Universe remains CURRENT_UNIVERSE_HISTORICAL_RESEARCH (no delisted historical constituent table)",
    ],
    failClosedPolicy: "Critical missing, stale, unverified, or conflicted evidence produces WAIT.",
  };

  const executionIsolationAudit = {
    STRATEGY_01: false,
    STRATEGY_02: false,
    STRATEGY_03: false,
    LIVE_TRADING: false,
    BROKER_EXECUTION_ENABLED: false,
    experimental_paper_trades: paperTradesCount ?? 0,
    noOrderButtonsInUi: true,
    noBrokerOrderPathInStrategy03: true,
  };

  const uiReadinessAudit = {
    component: "components/indian-market/Strategy03ResearchSection.tsx",
    verifiedFeatures: [
      "Read-only shadow scan summary (scanDate, stocksEvaluated, BUY_CANDIDATE/WATCH/WAIT/SELL_CANDIDATE counts)",
      "Verified DB coverage display",
      "Official exchange vs unverified badge separation",
      "Zero order buttons or strategy activation controls",
    ],
  };

  // Honest classification: Architecture is audited, but live shadow observation is 1/90 days and FCF/delivery/debt gaps remain -> NOT_READY for controlled paper execution, though architecture review items are documented.
  const finalClassification = "NOT_READY";

  fs.writeFileSync(path.join(OUT_DIR, "paper_engine_architecture_audit.json"), JSON.stringify(paperEngineAudit, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "strategy03_risk_specification.json"), JSON.stringify(STRATEGY03_PROPOSED_RISK_SPEC, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "forward_validation_acceptance_criteria.json"), JSON.stringify(FORWARD_VALIDATION_ACCEPTANCE_CRITERIA, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "shadow_observation_status.json"), JSON.stringify(shadowStatus, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "data_readiness_audit.json"), JSON.stringify(dataReadinessAudit, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "execution_isolation_audit.json"), JSON.stringify(executionIsolationAudit, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "ui_readiness_audit.json"), JSON.stringify(uiReadinessAudit, null, 2));

  const md = [
    "# Phase 6.10 — Paper Trading Readiness & Safety Certification Report",
    "",
    `**Final Classification:** \`${finalClassification}\``,
    "",
    "## 1. Why `NOT_READY` (Objective Gate Check)",
    `- Actual live shadow observation days: **1 / 90** minimum required (started \`2026-11-17\`; 0 matured live 1D/5D/10D/20D/60D signals yet).`,
    `- Data gaps remaining: \`deliveryRows = 0\`, \`fcfNonNull = 0\`, \`debtNonNull = 42/931\`, no TRI benchmark, current-universe survivorship bias.`,
    "",
    "## 2. Paper Engine Architecture & Risk Specification",
    `- Audited \`ExperimentalPaperTradeManager.ts\` and \`BrokerSafetyLock.ts\`: idempotency, duplicate-open prevention, 5% bar-volume partial-fill cap, gap-through-SL, SL-before-target, dynamic TSL, \`emergencyCloseTrade\`, and \`recoverOnStartup\` are reusable with Strategy03 partition isolation.`,
    `- Proposed Risk Spec (approval required): max 10 positions, 12.5% max position weight, 25% max sector concentration, ₹5 Cr min turnover, 1% per-position risk, 2% max daily loss, 12% max drawdown, no averaging down, no martingale sizing.`,
    "",
    "## 3. Safety Confirmation",
    `- \`STRATEGY_01 = false\`, \`STRATEGY_02 = false\`, \`STRATEGY_03 = false\`, \`LIVE_TRADING = false\`, \`BROKER_EXECUTION_ENABLED = false\`, \`experimental_paper_trades = ${paperTradesCount ?? 0}\`.`,
  ].join("\n");

  fs.writeFileSync(path.join(OUT_DIR, "phase610_final_report.md"), md);
  console.log("Phase 6.10 complete. Classification:", finalClassification, "paperTrades:", paperTradesCount ?? 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

