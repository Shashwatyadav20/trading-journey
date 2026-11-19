"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Search,
  ShieldCheck,
  AlertTriangle,
  ExternalLink,
  RefreshCw,
  ArrowLeft,
  X,
  Eye,
} from "lucide-react";
import { supabase } from "../../lib/supabase";
import {
  STRATEGY03_STATUS_FILTERS,
  countStrategy03Statuses,
  deriveSignalGuidance,
  filterStrategy03Stocks,
  type Strategy03PreBreakoutRecord,
  type Strategy03ScannerStatusFilter,
} from "../../lib/indian/strategy03ScannerHelpers";

interface Strategy03FactorScore {
  key: string;
  label: string;
  score: number;
  maxScore: number;
  explanation: string;
}

interface Strategy03ResultRow {
  evaluationId: string;
  symbol: string;
  companyName: string;
  decision: "ENTER_CANDIDATE" | "WAIT" | "REJECT";
  totalScore: number;
  factorScores: Record<string, Strategy03FactorScore>;
  missingData: string[];
  conflicts: string[];
  sourceReferences: string[];
  confidence: number;
  decisionExplanation: string;
  evaluatedAt: string;
}

interface Strategy03OwnershipRow {
  symbol: string;
  reporting_quarter: string;
  filing_date: string | null;
  source_name: string;
  source_url: string;
  verification_status: string;
  promoter_pct: number | null;
  promoter_pledged_pct: number | null;
  fii_pct: number | null;
  dii_pct: number | null;
  mutual_fund_pct: number | null;
  fii_qoq_change_pp: number | null;
  dii_qoq_change_pp: number | null;
  validation_notes?: string[];
}

export default function Strategy03ResearchSection() {
  const [resultsBySymbol, setResultsBySymbol] = useState<
    Record<string, Strategy03ResultRow>
  >({});
  const [ownershipBySymbol, setOwnershipBySymbol] = useState<
    Record<string, Strategy03OwnershipRow[]>
  >({});
  const [shadowData, setShadowData] = useState<any>(null);
  const [statusFilter, setStatusFilter] =
    useState<Strategy03ScannerStatusFilter>("ALL");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const getAuthHeaders = async (): Promise<Record<string, string>> => {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  const fetchScannerData = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const headers = await getAuthHeaders();
      const [res, shRes] = await Promise.all([
        fetch("/api/indian/strategy03/research/results?limit=100", {
          headers,
          cache: "no-store",
        }),
        fetch("/api/indian/strategy03/research/shadow", {
          headers,
          cache: "no-store",
        }),
      ]);

      if (res.ok) {
        const json = await res.json();
        if (Array.isArray(json.results)) {
          const map: Record<string, Strategy03ResultRow> = {};
          for (const r of json.results) {
            if (r?.symbol) map[String(r.symbol).toUpperCase()] = r;
          }
          setResultsBySymbol(map);
        }
      } else if (res.status === 401) {
        setErrorMsg(
          "Sign in to inspect Strategy 03 AI institutional research evaluations."
        );
      }

      if (shRes.ok) {
        const shJson = await shRes.json();
        setShadowData(shJson);
      }
    } catch (err: any) {
      setErrorMsg(
        err?.message ?? "Failed to load Strategy 03 scanner candidates."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchScannerData();
  }, [fetchScannerData]);

  // Lazily fetch symbol-level research & ownership evidence ONLY when View is opened
  useEffect(() => {
    if (!selectedSymbol) return;
    const sym = selectedSymbol.toUpperCase();
    let cancelled = false;

    const loadSymbolEvidence = async () => {
      const needEval = !resultsBySymbol[sym];
      const needOwn = !ownershipBySymbol[sym];
      if (!needEval && !needOwn) return;

      setDetailLoading(true);
      try {
        const headers = await getAuthHeaders();
        const tasks: Promise<void>[] = [];

        if (needEval) {
          tasks.push(
            fetch("/api/indian/strategy03/research/evaluate-symbol", {
              method: "POST",
              headers: { "Content-Type": "application/json", ...headers },
              body: JSON.stringify({ symbol: sym, persist: false }),
            })
              .then(async (r) => {
                if (!r.ok) return;
                const j = await r.json();
                if (!cancelled && j?.evaluation) {
                  setResultsBySymbol((prev) => ({
                    ...prev,
                    [sym]: j.evaluation,
                  }));
                }
              })
              .catch(() => {})
          );
        }

        if (needOwn) {
          tasks.push(
            fetch(
              `/api/indian/strategy03/research/ownership/${encodeURIComponent(
                sym
              )}`,
              { headers, cache: "no-store" }
            )
              .then(async (r) => {
                if (!r.ok) return;
                const j = await r.json();
                if (!cancelled && Array.isArray(j?.records)) {
                  setOwnershipBySymbol((prev) => ({
                    ...prev,
                    [sym]: j.records,
                  }));
                }
              })
              .catch(() => {})
          );
        }

        await Promise.all(tasks);
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    };

    void loadSymbolEvidence();
    return () => {
      cancelled = true;
    };
  }, [selectedSymbol, resultsBySymbol, ownershipBySymbol]);

  const allStocks: Strategy03PreBreakoutRecord[] = useMemo(() => {
    if (Array.isArray(shadowData?.preBreakoutWatchlist)) {
      return shadowData.preBreakoutWatchlist;
    }
    return [];
  }, [shadowData]);

  const statusCounts = useMemo(
    () => countStrategy03Statuses(allStocks),
    [allStocks]
  );

  const filteredStocks = useMemo(
    () => filterStrategy03Stocks(allStocks, statusFilter, searchQuery),
    [allStocks, statusFilter, searchQuery]
  );

  const selectedStock = useMemo(() => {
    if (!selectedSymbol) return null;
    const sym = selectedSymbol.toUpperCase();
    return (
      allStocks.find((s) => s.nseSymbol.toUpperCase() === sym) ?? null
    );
  }, [allStocks, selectedSymbol]);

  // Additional per-symbol context shown ONLY inside the View panel
  const selectedContext = useMemo(() => {
    if (!selectedStock) return null;
    const sym = selectedStock.nseSymbol.toUpperCase();
    const evalRow = resultsBySymbol[sym] ?? null;
    const ownershipRows = ownershipBySymbol[sym] ?? [];
    const momentumRow = Array.isArray(shadowData?.watchlist)
      ? shadowData.watchlist.find(
          (w: any) => String(w.symbol).toUpperCase() === sym
        ) ?? null
      : null;
    const forwardSnapshot = Array.isArray(shadowData?.forwardSignalSnapshots)
      ? shadowData.forwardSignalSnapshots.find(
          (f: any) => String(f.symbol).toUpperCase() === sym
        ) ?? null
      : null;
    const forwardOutcome = Array.isArray(shadowData?.forwardSignalOutcomes)
      ? shadowData.forwardSignalOutcomes.find(
          (f: any) => String(f.symbol).toUpperCase() === sym
        ) ?? null
      : null;
    const alerts = Array.isArray(shadowData?.monitoringAlerts)
      ? shadowData.monitoringAlerts.filter(
          (a: any) => String(a.symbol).toUpperCase() === sym
        )
      : [];
    const guidance = deriveSignalGuidance(selectedStock);
    return {
      evalRow,
      ownershipRows,
      momentumRow,
      forwardSnapshot,
      forwardOutcome,
      alerts,
      guidance,
    };
  }, [selectedStock, resultsBySymbol, ownershipBySymbol, shadowData]);

  // ── Dedicated Full-Width Detail View Panel ──────────────────────────────────
  if (selectedStock && selectedContext) {
    const pb = selectedStock;
    const {
      evalRow,
      ownershipRows,
      momentumRow,
      forwardSnapshot,
      forwardOutcome,
      alerts,
      guidance,
    } = selectedContext;
    const latestOwn = ownershipRows[0] ?? null;
    const refCandles = Array.isArray(pb.ohlcv4hDrilldownIst)
      ? pb.ohlcv4hDrilldownIst
      : [];

    return (
      <div className="p-4 sm:p-5 rounded-xl bg-[#0b101b] border border-slate-800 space-y-4 transition-all">
        {/* Top Navigation Bar */}
        <div className="flex items-center justify-between flex-wrap gap-3 pb-3 border-b border-slate-800">
          <div className="flex items-center gap-3 flex-wrap">
            <button
              type="button"
              onClick={() => setSelectedSymbol(null)}
              className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to Scanner</span>
            </button>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-slate-100 tracking-wide">
                  {pb.nseSymbol}
                </h3>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-200 border border-slate-700">
                  {pb.status}
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-900 text-slate-400 border border-slate-800">
                  RESEARCH_ONLY
                </span>
              </div>
              {pb.companyName && (
                <div className="text-xs text-slate-400">{pb.companyName}</div>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={() => setSelectedSymbol(null)}
            aria-label="Close detail view"
            className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-800 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* A. Stock Information */}
        <section className="p-3.5 rounded-lg bg-slate-900/60 border border-slate-800 space-y-2">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300">
            A. Stock Information
          </h4>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 text-xs">
            <div className="p-2.5 rounded bg-slate-950/70 border border-slate-800/80">
              <div className="text-[10px] text-slate-500">NSE Symbol</div>
              <div className="font-bold text-slate-100">{pb.nseSymbol}</div>
            </div>
            <div className="p-2.5 rounded bg-slate-950/70 border border-slate-800/80">
              <div className="text-[10px] text-slate-500">Company Name</div>
              <div className="font-medium text-slate-200 truncate">
                {pb.companyName ?? "—"}
              </div>
            </div>
            <div className="p-2.5 rounded bg-slate-950/70 border border-slate-800/80">
              <div className="text-[10px] text-slate-500">Latest 4H Price</div>
              <div className="font-mono font-bold text-slate-100">
                {pb.currentPrice !== null && pb.currentPrice !== undefined
                  ? pb.currentPrice
                  : "—"}
              </div>
            </div>
            <div className="p-2.5 rounded bg-slate-950/70 border border-slate-800/80">
              <div className="text-[10px] text-slate-500">Candidate Status</div>
              <div className="font-bold text-cyan-300">{pb.status}</div>
            </div>
            <div className="p-2.5 rounded bg-slate-950/70 border border-slate-800/80">
              <div className="text-[10px] text-slate-500">Research Score</div>
              <div className="font-mono font-bold text-slate-100">
                {pb.priorityScore !== undefined ? `${pb.priorityScore}/100` : "—"}
              </div>
            </div>
            <div className="p-2.5 rounded bg-slate-950/70 border border-slate-800/80">
              <div className="text-[10px] text-slate-500">Last Evaluated (IST)</div>
              <div className="font-mono text-[11px] text-slate-300">
                {pb.lastUpdatedIst ? pb.lastUpdatedIst.slice(0, 19) : "—"}
              </div>
            </div>
          </div>
        </section>

        {/* B. Technical Analysis */}
        <section className="p-3.5 rounded-lg bg-slate-900/60 border border-slate-800 space-y-2">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300">
            B. Technical Analysis (4H Only)
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 text-xs">
            <div className="p-2.5 rounded bg-slate-950/70 border border-slate-800/80 space-y-0.5">
              <div className="text-[10px] text-slate-500">4H Impulse</div>
              {pb.impulse?.detected ? (
                <>
                  <div className="font-semibold text-slate-100">
                    {pb.impulse.candleCount ?? 0} Bars · +{pb.impulse.displacementPct ?? 0}%
                  </div>
                  <div className="text-[10px] text-slate-400">
                    Body Exp: {pb.impulse.bodyExpansionRatio ?? "—"}x ·{" "}
                    {pb.impulse.startIst?.slice(5, 16) ?? "—"} →{" "}
                    {pb.impulse.endIst?.slice(11, 16) ?? "—"}
                  </div>
                </>
              ) : (
                <div className="text-slate-500">Not detected</div>
              )}
            </div>

            <div className="p-2.5 rounded bg-slate-950/70 border border-slate-800/80 space-y-0.5">
              <div className="text-[10px] text-slate-500">Consolidation Range & Duration</div>
              {pb.consolidation?.high != null && pb.consolidation?.low != null ? (
                <>
                  <div className="font-mono font-semibold text-slate-100">
                    {pb.consolidation.low} – {pb.consolidation.high} ({pb.consolidation.rangePct ?? "—"}%)
                  </div>
                  <div className="text-[10px] text-slate-400">
                    {pb.consolidation.candleCount ?? 0}B / {pb.consolidation.tradingDaysElapsed ?? "—"}D ·{" "}
                    {pb.consolidation.tier ?? "—"}
                  </div>
                </>
              ) : (
                <div className="text-slate-500">Not detected</div>
              )}
            </div>

            <div className="p-2.5 rounded bg-slate-950/70 border border-slate-800/80 space-y-0.5">
              <div className="text-[10px] text-slate-500">Bullish Order Block</div>
              {pb.orderBlock?.detected ? (
                <>
                  <div className="font-mono font-semibold text-slate-100">
                    {pb.orderBlock.obLow} – {pb.orderBlock.obHigh}
                  </div>
                  <div className="text-[10px] text-slate-400">
                    {pb.orderBlock.timestampIst?.slice(5, 16) ?? "—"} ·{" "}
                    {pb.orderBlock.invalidated
                      ? "Invalidated"
                      : pb.orderBlock.mitigated
                      ? "Mitigated"
                      : "Unmitigated"}
                  </div>
                </>
              ) : (
                <div className="text-slate-500">
                  {pb.orderBlock?.reason ?? "None"}
                </div>
              )}
            </div>

            <div className="p-2.5 rounded bg-slate-950/70 border border-slate-800/80 space-y-0.5">
              <div className="text-[10px] text-slate-500">Support & Liquidity Sweep</div>
              {pb.supportZone?.detected ? (
                <>
                  <div className="font-mono font-semibold text-slate-100">
                    {pb.supportZone.supportLow} – {pb.supportZone.supportHigh}
                  </div>
                  <div className="text-[10px] text-slate-400">
                    {pb.supportZone.supportRelevance ?? "—"} (Dist:{" "}
                    {pb.supportZone.supportDistancePct ?? "—"}%) ·{" "}
                    {pb.supportZone.liquiditySweepDetected
                      ? `Sweep @ ${pb.supportZone.sweepLow}`
                      : `${pb.supportZone.reactionCount ?? 0} reactions`}
                  </div>
                </>
              ) : (
                <div className="text-slate-500">
                  {pb.supportZone?.reason ?? "Not detected"}
                </div>
              )}
            </div>

            <div className="p-2.5 rounded bg-slate-950/70 border border-slate-800/80">
              <div className="text-[10px] text-slate-500">Breakout Distance</div>
              <div className="font-mono font-bold text-cyan-300">
                {pb.breakoutDistancePct !== null &&
                pb.breakoutDistancePct !== undefined
                  ? `${pb.breakoutDistancePct}%`
                  : "—"}
              </div>
            </div>

            <div className="p-2.5 rounded bg-slate-950/70 border border-slate-800/80">
              <div className="text-[10px] text-slate-500">Volume Confirmation (RVOL)</div>
              <div className="font-mono font-semibold text-slate-100">
                {pb.impulse?.rvol !== undefined ? `${pb.impulse.rvol}x` : "—"} ·{" "}
                <span
                  className={
                    pb.impulse?.volumeConfirmed
                      ? "text-emerald-300"
                      : "text-slate-400"
                  }
                >
                  {pb.impulse?.volumeConfirmed ? "Confirmed" : "Unconfirmed"}
                </span>
              </div>
            </div>

            {forwardOutcome && (
              <div className="p-2.5 rounded bg-slate-950/70 border border-slate-800/80 sm:col-span-2">
                <div className="text-[10px] text-slate-500">
                  Forward Shadow Outcome ({forwardOutcome.cohort})
                </div>
                <div className="text-[11px] text-slate-200">
                  Status: <strong>{forwardOutcome.outcomeStatus}</strong> · Post-Signal
                  4H Bars: {forwardOutcome.forwardCompleted4hBlocksObserved} ·
                  5B/10B/20B: {forwardOutcome.horizon5B?.statusAtHorizon}/
                  {forwardOutcome.horizon10B?.statusAtHorizon}/
                  {forwardOutcome.horizon20B?.statusAtHorizon}
                </div>
              </div>
            )}
          </div>
        </section>

        {/* C. Price Structure */}
        <section className="p-3.5 rounded-lg bg-slate-900/60 border border-slate-800 space-y-2.5">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300">
            C. Price Structure & 4H Reference Candles
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
            <div className="p-2.5 rounded bg-slate-950/70 border border-slate-800 text-slate-200">
              <div className="text-[10px] text-slate-500 mb-0.5">
                Support / Liquidity Box
              </div>
              {pb.supportZone?.supportLow != null ? (
                <div className="font-mono text-[11px]">
                  {pb.supportZone.supportLow} – {pb.supportZone.supportHigh} (
                  {pb.supportZone.zoneStartIst?.slice(5, 16) ?? "—"} →{" "}
                  {pb.supportZone.zoneEndIst?.slice(5, 16) ?? "—"})
                </div>
              ) : (
                <div className="text-slate-500 text-[11px]">No support box</div>
              )}
            </div>
            <div className="p-2.5 rounded bg-slate-950/70 border border-slate-800 text-slate-200">
              <div className="text-[10px] text-slate-500 mb-0.5">
                Consolidation Box
              </div>
              {pb.consolidation?.low != null ? (
                <div className="font-mono text-[11px]">
                  {pb.consolidation.low} – {pb.consolidation.high} (
                  {pb.consolidation.startIst?.slice(5, 16) ?? "—"} →{" "}
                  {pb.consolidation.endIst?.slice(5, 16) ?? "—"})
                </div>
              ) : (
                <div className="text-slate-500 text-[11px]">
                  No consolidation box
                </div>
              )}
            </div>
          </div>

          {forwardSnapshot && (
            <div className="p-2.5 rounded bg-slate-950/70 border border-slate-800 text-[11px] font-mono text-slate-300">
              Immutable READY Reference Bar ({forwardSnapshot.signalCompleted4hTimestampIst}): O:
              {forwardSnapshot.reference4hOhlcv?.open} H:
              {forwardSnapshot.reference4hOhlcv?.high} L:
              {forwardSnapshot.reference4hOhlcv?.low} C:
              {forwardSnapshot.reference4hOhlcv?.close} V:
              {forwardSnapshot.reference4hOhlcv?.volume}
            </div>
          )}

          {refCandles.length > 0 ? (
            <div className="max-h-52 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5 text-[10px] font-mono text-slate-300">
              {refCandles.map((c, idx) => (
                <div
                  key={`${c.timestampIst ?? c.timestamp ?? idx}`}
                  className="px-2 py-1 rounded bg-slate-950 border border-slate-800/80"
                >
                  {c.timestampIst?.slice(0, 16) ?? c.timestamp} | O:{c.open} H:
                  {c.high} L:{c.low} C:{c.close} V:{c.volume}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs text-slate-500">
              No 4H drilldown candles stored for this symbol.
            </div>
          )}
        </section>

        {/* D. Research Evidence */}
        <section className="p-3.5 rounded-lg bg-slate-900/60 border border-slate-800 space-y-2.5">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300">
              D. Research Evidence
            </h4>
            {detailLoading && (
              <span className="text-[10px] text-slate-400">
                Loading symbol research & ownership evidence…
              </span>
            )}
          </div>

          {Array.isArray(pb.scoringReasons) && pb.scoringReasons.length > 0 && (
            <div className="p-2.5 rounded bg-slate-950/70 border border-slate-800/80 space-y-1">
              <div className="text-[10px] text-slate-500">Scoring Breakdown</div>
              <div className="flex flex-wrap gap-1.5 text-[11px] text-slate-200">
                {pb.scoringReasons.map((sr, i) => (
                  <span
                    key={i}
                    className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800"
                  >
                    {sr}
                  </span>
                ))}
              </div>
            </div>
          )}

          {evalRow && (
            <div className="p-2.5 rounded bg-slate-950/70 border border-slate-800/80 space-y-2">
              <div className="flex items-center justify-between flex-wrap gap-2 text-xs">
                <span className="font-semibold text-slate-200">
                  Fundamental & Institutional Research ({evalRow.decision} ·{" "}
                  {evalRow.totalScore}/100 · Conf {Math.round(evalRow.confidence * 100)}%)
                </span>
                <span className="text-[10px] text-slate-500">
                  Evaluated: {new Date(evalRow.evaluatedAt).toLocaleString()}
                </span>
              </div>
              <div className="text-[11px] text-slate-300">
                {evalRow.decisionExplanation}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-1.5 text-[10px]">
                {Object.values(evalRow.factorScores || {}).map((f) => (
                  <div
                    key={f.key}
                    className="p-1.5 rounded bg-slate-900 border border-slate-800"
                  >
                    <div className="text-slate-400 truncate">{f.label}</div>
                    <div className="font-bold text-slate-100">
                      {f.score} / {f.maxScore}
                    </div>
                  </div>
                ))}
              </div>
              {evalRow.missingData?.length > 0 && (
                <div className="text-[11px] text-amber-300">
                  Missing Data Warnings: {evalRow.missingData.join(", ")}
                </div>
              )}
              {evalRow.conflicts?.length > 0 && (
                <div className="text-[11px] text-rose-300">
                  Conflicts: {evalRow.conflicts.join(", ")}
                </div>
              )}
              {evalRow.sourceReferences?.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap text-[10px] text-slate-400">
                  <ExternalLink className="w-3 h-3" />
                  <span>{evalRow.sourceReferences.join(" | ")}</span>
                </div>
              )}
            </div>
          )}

          {latestOwn && (
            <div className="p-2.5 rounded bg-slate-950/70 border border-slate-800/80 space-y-1.5 text-[11px]">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <span className="font-semibold text-slate-200">
                  Ownership Evidence ({latestOwn.reporting_quarter})
                </span>
                <span className="text-[10px] text-slate-400">
                  {latestOwn.verification_status} · {latestOwn.source_name}
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-[10px] text-slate-300">
                <div>FII: {latestOwn.fii_pct ?? "—"}%</div>
                <div>DII: {latestOwn.dii_pct ?? "—"}%</div>
                <div>MF: {latestOwn.mutual_fund_pct ?? "—"}%</div>
                <div>Promoter: {latestOwn.promoter_pct ?? "—"}%</div>
                <div>Pledge: {latestOwn.promoter_pledged_pct ?? "—"}%</div>
              </div>
            </div>
          )}

          {momentumRow && (
            <div className="p-2.5 rounded bg-slate-950/70 border border-slate-800/80 text-[11px] text-slate-300">
              Momentum Context: {momentumRow.momentumClassification} · Fund
              Score: {momentumRow.fundamentalScore} · RS 50D:{" "}
              {momentumRow.relativeStrength50dPp ?? "—"}pp · Vol Ratio:{" "}
              {momentumRow.volumeRatio20d ?? "—"}x · Verification:{" "}
              {momentumRow.verificationStatus}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px] text-slate-400">
            <div className="p-2 rounded bg-slate-950/70 border border-slate-800/80">
              Source: {pb.dataProvider ?? "—"} ({pb.sourceReference ?? "—"})
            </div>
            <div className="p-2 rounded bg-slate-950/70 border border-slate-800/80">
              Verification Status: {pb.independentVerificationStatus ?? "—"}
            </div>
            <div className="p-2 rounded bg-slate-950/70 border border-slate-800/80">
              Source Timestamp: {pb.sourceTimestampIst ?? "—"}
            </div>
          </div>

          {alerts.length > 0 && (
            <div className="p-2.5 rounded bg-slate-950/70 border border-slate-800/80 space-y-1 text-[10px] text-slate-300">
              <div className="text-slate-400 font-semibold">
                Monitoring Alerts ({alerts.length})
              </div>
              {alerts.slice(0, 5).map((al: any) => (
                <div key={al.eventId}>
                  {al.alertType} ({al.previousStatus ?? "INIT"} → {al.newStatus}) ·{" "}
                  {al.completed4hTimestampIst?.slice(0, 16)} · Freshness:{" "}
                  {al.dataFreshness}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* E. Signal Information */}
        <section className="p-3.5 rounded-lg bg-slate-900/60 border border-slate-800 space-y-2.5">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300">
            E. Signal Information
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
            <div className="p-2.5 rounded bg-slate-950/70 border border-slate-800/80">
              <div className="text-[10px] text-slate-500">
                Classification & Reason
              </div>
              <div className="font-bold text-slate-100">{pb.status}</div>
              <div className="text-[11px] text-slate-300 mt-0.5">
                {pb.reason ?? "—"}
              </div>
            </div>
            <div className="p-2.5 rounded bg-slate-950/70 border border-slate-800/80">
              <div className="text-[10px] text-slate-500">
                Invalidation Level & Next Requirement
              </div>
              <div className="font-mono font-semibold text-rose-300">
                {guidance.invalidationLevel !== null
                  ? `${guidance.invalidationLevel} (${guidance.invalidationLabel})`
                  : "No structural invalidation level defined"}
              </div>
              <div className="text-[11px] text-slate-300 mt-0.5">
                {guidance.nextRequiredAction}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-[11px]">
            <div className="p-2.5 rounded bg-slate-950/70 border border-slate-800/80 space-y-1">
              <div className="text-[10px] text-emerald-400 font-semibold">
                Conditions Satisfied
              </div>
              {guidance.conditionsSatisfied.length > 0 ? (
                guidance.conditionsSatisfied.map((c, i) => (
                  <div key={i} className="text-slate-200">
                    • {c}
                  </div>
                ))
              ) : (
                <div className="text-slate-500">None</div>
              )}
            </div>
            <div className="p-2.5 rounded bg-slate-950/70 border border-slate-800/80 space-y-1">
              <div className="text-[10px] text-amber-400 font-semibold">
                Conditions Pending
              </div>
              {guidance.conditionsPending.length > 0 ? (
                guidance.conditionsPending.map((c, i) => (
                  <div key={i} className="text-slate-300">
                    • {c}
                  </div>
                ))
              ) : (
                <div className="text-slate-500">None</div>
              )}
            </div>
          </div>
        </section>

        <div className="pt-1 flex justify-end">
          <button
            type="button"
            onClick={() => setSelectedSymbol(null)}
            className="px-3.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700 text-xs font-semibold cursor-pointer"
          >
            Back to Stock List
          </button>
        </div>
      </div>
    );
  }

  // ── Main Scanner View — Stocks Only ─────────────────────────────────────────
  return (
    <div className="p-4 rounded-xl bg-[#0b101b] border border-slate-800 space-y-3">
      {/* Compact Header & Controls */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-cyan-400" />
          <h3 className="text-sm font-bold text-slate-100">
            Strategy 03 — 4H Stock Scanner
          </h3>
          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-900 text-slate-400 border border-slate-800">
            RESEARCH_ONLY
          </span>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search symbol..."
              aria-label="Search stock symbol"
              className="pl-8 pr-3 py-1 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-100 placeholder:text-slate-600 w-44 focus:outline-none focus:border-cyan-500/50"
            />
          </div>
          <button
            type="button"
            onClick={fetchScannerData}
            disabled={loading}
            title="Refresh scanner list"
            className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 text-xs cursor-pointer disabled:opacity-50"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`}
            />
          </button>
        </div>
      </div>

      {/* Simple Status Filter Pills */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex flex-wrap gap-1">
          {STRATEGY03_STATUS_FILTERS.map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setStatusFilter(st)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium border cursor-pointer transition-colors ${
                statusFilter === st
                  ? "bg-cyan-500/15 border-cyan-500/40 text-cyan-200 font-semibold"
                  : "bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200"
              }`}
            >
              {st} ({statusCounts[st]})
            </button>
          ))}
        </div>
        <div className="text-[11px] text-slate-500 font-mono">
          Showing {filteredStocks.length} of {allStocks.length}
        </div>
      </div>

      {errorMsg && (
        <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-amber-300 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Clean Compact 2-Column Stock List */}
      <div className="max-h-[640px] overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/60">
        {filteredStocks.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-500">
            {loading
              ? "Loading Strategy 03 stock list…"
              : "No stocks match the current filter."}
          </div>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 bg-[#0d1322] border-b border-slate-800 text-[11px] uppercase tracking-wider text-slate-400">
              <tr>
                <th className="py-2 px-3 font-semibold">Stock Symbol</th>
                <th className="py-2 px-3 font-semibold text-right w-24">
                  View
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-900/90 text-xs">
              {filteredStocks.map((stock) => (
                <tr
                  key={stock.idempotencyKey ?? stock.nseSymbol}
                  className="hover:bg-slate-900/70 transition-colors"
                >
                  <td className="py-1.5 px-3 font-mono font-semibold text-slate-100">
                    {stock.nseSymbol}
                  </td>
                  <td className="py-1.5 px-3 text-right">
                    <button
                      type="button"
                      onClick={() => setSelectedSymbol(stock.nseSymbol)}
                      className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border border-cyan-500/30 text-[11px] font-semibold cursor-pointer transition-colors"
                    >
                      <Eye className="w-3 h-3" />
                      <span>View</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
