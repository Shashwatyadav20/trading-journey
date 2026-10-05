import { phase38SessionCollector, Phase38SessionObservation } from "./Phase38SessionCollector";
import { phase38TradeCollector, Phase38TradeObservation } from "./Phase38TradeCollector";
import { strategyFingerprintManager } from "./StrategyFingerprintManager";

export interface CohortRevalidationResult {
  passed: boolean;
  totalSessionsRevalidated: number;
  totalTradesRevalidated: number;
  hashMismatches: string[];
  timestampViolations: string[];
  timezoneViolations: string[];
  signalSnapshotViolations: string[];
  optionChainProvenanceViolations: string[];
  priceProvenanceViolations: string[];
  dhanProvenanceViolations: string[];
  websocketProvenanceViolations: string[];
  lotSizeProvenanceViolations: string[];
  entryViolations: string[];
  exitViolations: string[];
  chargesViolations: string[];
  slippageViolations: string[];
  pnlViolations: string[];
  reconciliationViolations: string[];
  fingerprintViolations: string[];
  allViolations: string[];
  revalidatedAt: string;
}

export class Phase39CohortRevalidator {
  /**
   * Revalidates every session and trade in the cohort against all 17 integrity criteria.
   * Never silently repairs historical evidence; explicitly reports any mismatch.
   */
  public revalidateCohort(
    sessionsInput?: Phase38SessionObservation[],
    tradesInput?: Phase38TradeObservation[],
    expectedFingerprint?: string
  ): CohortRevalidationResult {
    const sessions = sessionsInput || phase38SessionCollector.getSessions(true);
    const trades = tradesInput || phase38TradeCollector.getTrades(true);
    const fp = expectedFingerprint || strategyFingerprintManager.getCurrentFingerprint().masterFingerprintHash;

    const hashMismatches: string[] = [];
    const timestampViolations: string[] = [];
    const timezoneViolations: string[] = [];
    const signalSnapshotViolations: string[] = [];
    const optionChainProvenanceViolations: string[] = [];
    const priceProvenanceViolations: string[] = [];
    const dhanProvenanceViolations: string[] = [];
    const websocketProvenanceViolations: string[] = [];
    const lotSizeProvenanceViolations: string[] = [];
    const entryViolations: string[] = [];
    const exitViolations: string[] = [];
    const chargesViolations: string[] = [];
    const slippageViolations: string[] = [];
    const pnlViolations: string[] = [];
    const reconciliationViolations: string[] = [];
    const fingerprintViolations: string[] = [];

    // 1. Revalidate Sessions
    for (const session of sessions) {
      // Hash verification
      const { immutableHash, ...base } = session;
      const computedHash = phase38SessionCollector.computeHash(base);
      if (computedHash !== immutableHash) {
        hashMismatches.push(`Session ${session.sessionId}: Immutable hash mismatch. Expected ${immutableHash}, got ${computedHash}`);
      }

      // Timezone check
      if (session.timezone !== "Asia/Kolkata") {
        timezoneViolations.push(`Session ${session.sessionId}: Invalid timezone ${session.timezone} (must be Asia/Kolkata).`);
      }

      // DHAN provenance
      if (session.provider !== "DHAN" || session.spotSource !== "DHAN") {
        dhanProvenanceViolations.push(`Session ${session.sessionId}: DHAN provenance invalid (provider=${session.provider}, spotSource=${session.spotSource}).`);
      }

      // WebSocket provenance
      if (!session.websocketHealthValid || session.websocketStatus !== "HEALTHY") {
        websocketProvenanceViolations.push(`Session ${session.sessionId}: WebSocket provenance unhealthy (${session.websocketStatus}).`);
      }

      // Option Chain provenance
      if (session.optionChainSource !== "DHAN" || session.optionPriceSource !== "DHAN") {
        optionChainProvenanceViolations.push(`Session ${session.sessionId}: Option chain provenance invalid (${session.optionChainSource}/${session.optionPriceSource}).`);
      }

      // Lot size provenance
      if (!session.lotSizeVerified || session.lotSizeSource !== "DHAN_MASTER") {
        lotSizeProvenanceViolations.push(`Session ${session.sessionId}: Lot size provenance unverified (${session.lotSizeSource}).`);
      }

      // Reconciliation
      if (session.reconciliationStatus !== "PASS" || !session.threeWayReconciliationPass) {
        reconciliationViolations.push(`Session ${session.sessionId}: 3-way reconciliation failed (${session.reconciliationStatus}).`);
      }

      // Strategy Fingerprint
      if (session.strategyFingerprint !== fp) {
        fingerprintViolations.push(`Session ${session.sessionId}: Strategy fingerprint mismatch (${session.strategyFingerprint} vs ${fp}).`);
      }
    }

    // 2. Revalidate Trades
    for (const trade of trades) {
      // Hash verification
      const { immutableHash, ...base } = trade;
      const computedHash = phase38TradeCollector.computeHash(base);
      if (computedHash !== immutableHash) {
        hashMismatches.push(`Trade ${trade.tradeId}: Immutable hash mismatch. Expected ${immutableHash}, got ${computedHash}`);
      }

      // Timestamp order check: signal <= entry <= exit
      const entryTime = new Date(trade.entry.timestamp).getTime();
      const exitTime = trade.exit ? new Date(trade.exit.timestamp).getTime() : undefined;
      if (exitTime && entryTime > exitTime) {
        timestampViolations.push(`Trade ${trade.tradeId}: Exit timestamp (${trade.exit?.timestamp}) prior to entry timestamp (${trade.entry.timestamp}).`);
      }

      // Signal Snapshot Check
      if (trade.signalId) {
        const snap = phase38TradeCollector.getSignalSnapshot(trade.signalId) || trade.signalSnapshot;
        if (!snap) {
          signalSnapshotViolations.push(`Trade ${trade.tradeId}: Signal snapshot missing for signalId ${trade.signalId}.`);
        } else {
          const sigTime = new Date(snap.timestamp).getTime();
          if (sigTime > entryTime) {
            signalSnapshotViolations.push(`Trade ${trade.tradeId}: Signal time (${snap.timestamp}) after entry time (${trade.entry.timestamp}).`);
          }
        }
      }

      // Provenance Checks
      if (trade.dataProvenance.spotSource !== "DHAN") {
        dhanProvenanceViolations.push(`Trade ${trade.tradeId}: Spot source provenance invalid (${trade.dataProvenance.spotSource}).`);
      }
      if (!trade.optionChainProvenance.chainVerified || trade.optionChainProvenance.provider !== "DHAN") {
        optionChainProvenanceViolations.push(`Trade ${trade.tradeId}: Option chain provenance unverified (${trade.optionChainProvenance.provider}).`);
      }
      if (!trade.priceProvenance.verified) {
        priceProvenanceViolations.push(`Trade ${trade.tradeId}: Price provenance unverified.`);
      }
      if (!trade.optionChainProvenance.lotSizeVerified) {
        lotSizeProvenanceViolations.push(`Trade ${trade.tradeId}: Lot size unverified.`);
      }

      // Entry & Exit integrity
      if (!trade.entry.hedgeFirstCompleted) {
        entryViolations.push(`Trade ${trade.tradeId}: Hedge-first sequence not completed.`);
      }
      if (!trade.entry.shortLegConfirmed) {
        entryViolations.push(`Trade ${trade.tradeId}: Short leg confirmation missing.`);
      }
      if (!trade.exit || !trade.exit.timestamp) {
        exitViolations.push(`Trade ${trade.tradeId}: Exit details incomplete.`);
      }

      // Charges & Slippage
      if (trade.charges.totalCharges <= 0) {
        chargesViolations.push(`Trade ${trade.tradeId}: Charges recorded as <= 0 (${trade.charges.totalCharges}).`);
      }
      if (trade.slippage < 0) {
        slippageViolations.push(`Trade ${trade.tradeId}: Negative slippage recorded (${trade.slippage}).`);
      }

      // P&L recalculation
      const gross = trade.realizedPnL.grossPnL;
      const chargesTotal = trade.charges.totalCharges;
      const slip = trade.slippage;
      const expectedNet = Number((gross - chargesTotal - slip).toFixed(2));
      if (Math.abs(trade.realizedPnL.netPnL - expectedNet) > 1.0) {
        pnlViolations.push(`Trade ${trade.tradeId}: Realized Net P&L mismatch. Expected ${expectedNet}, got ${trade.realizedPnL.netPnL}.`);
      }

      // Reconciliation
      if (trade.reconciliationStatus !== "PASS") {
        reconciliationViolations.push(`Trade ${trade.tradeId}: Reconciliation failed (${trade.reconciliationStatus}).`);
      }

      // Strategy Fingerprint
      if (trade.strategyFingerprint !== fp) {
        fingerprintViolations.push(`Trade ${trade.tradeId}: Fingerprint mismatch (${trade.strategyFingerprint} vs ${fp}).`);
      }
    }

    const allViolations = [
      ...hashMismatches,
      ...timestampViolations,
      ...timezoneViolations,
      ...signalSnapshotViolations,
      ...optionChainProvenanceViolations,
      ...priceProvenanceViolations,
      ...dhanProvenanceViolations,
      ...websocketProvenanceViolations,
      ...lotSizeProvenanceViolations,
      ...entryViolations,
      ...exitViolations,
      ...chargesViolations,
      ...slippageViolations,
      ...pnlViolations,
      ...reconciliationViolations,
      ...fingerprintViolations,
    ];

    return {
      passed: allViolations.length === 0,
      totalSessionsRevalidated: sessions.length,
      totalTradesRevalidated: trades.length,
      hashMismatches,
      timestampViolations,
      timezoneViolations,
      signalSnapshotViolations,
      optionChainProvenanceViolations,
      priceProvenanceViolations,
      dhanProvenanceViolations,
      websocketProvenanceViolations,
      lotSizeProvenanceViolations,
      entryViolations,
      exitViolations,
      chargesViolations,
      slippageViolations,
      pnlViolations,
      reconciliationViolations,
      fingerprintViolations,
      allViolations,
      revalidatedAt: new Date().toISOString(),
    };
  }
}

export const phase39CohortRevalidator = new Phase39CohortRevalidator();
