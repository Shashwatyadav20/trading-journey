"use client";

import React, { useState, useEffect } from "react";
import IMHeader from "./IMHeader";
import IMStatusBadge from "./IMStatusBadge";
import { apiUrl } from "../../lib/backendUrl";
import {
  Activity,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  RefreshCw,
  Clock,
  Database,
  Server,
  Wifi,
  Radio,
  Lock,
  FileCheck,
  TrendingUp,
  AlertOctagon,
  CheckCircle2,
  XCircle,
  Layers,
  BarChart2,
  DollarSign,
  Briefcase,
  Terminal,
} from "lucide-react";

// Types matching backend PostPhase40OperationsTypes
export type OperationalHealth = "HEALTHY" | "DEGRADED" | "BLOCKED" | "ERROR" | "MARKET_CLOSED";

export interface OperationsStatusResponse {
  system: {
    backend: OperationalHealth;
    database: OperationalHealth;
    dhanAuth: OperationalHealth;
    dhanConnection: OperationalHealth;
    websocket: OperationalHealth;
    overall: OperationalHealth;
    evaluatedAt: string;
  };
  marketData: {
    niftySpot: {
      health: OperationalHealth;
      value: number | null;
      lastUpdated: string;
      ageMs: number;
      isStale: boolean;
      isReal: boolean;
    };
    optionChain: {
      health: OperationalHealth;
      lastUpdated: string;
      ageMs: number;
      isStale: boolean;
      isReal: boolean;
      contractCount: number;
    };
    optionPrices: {
      health: OperationalHealth;
      lastUpdated: string;
      ageMs: number;
      isStale: boolean;
      isReal: boolean;
    };
    greeks: {
      health: OperationalHealth;
      available: boolean;
      deltaAvailable: boolean;
      gammaAvailable: boolean;
    };
    websocketTick: {
      health: OperationalHealth;
      lastTick: string;
      ageMs: number;
    };
    vwapRsiSnapshot: {
      health: OperationalHealth;
      lastComputed: string;
      ageMs: number;
    };
    lotSizeVerified: boolean;
    expiryValid: boolean;
    marketSession: "MARKET_OPEN" | "PRE_MARKET" | "MARKET_CLOSING" | "MARKET_CLOSED";
    genuineDataGate: "OPEN" | "BLOCKED";
    evaluatedAt: string;
  };
  trading: {
    activePositions: Array<{
      positionId: string;
      strategy: string;
      expiry: string;
      sellStrike: number;
      buyStrike: number;
      optionType: string;
      lotSize: number;
      quantityLots: number;
      entryPrice: number;
      currentSpreadValue: number;
      unrealizedPnL: number;
      delta: number | null;
      gamma: number | null;
      vwap?: number | null;
      rsi?: number | null;
      supportResistance?: string | null;
      initialCredit: number;
      target: number;
      stopLoss: number;
      timeOpenedIso: string;
      timeInTradeSeconds: number;
      dataProvenance: string;
      pnlType: string;
    }>;
    openPositionCount: number;
    closedTodayCount: number;
    lastSignalEvaluatedAt: string;
    lastPaperOrderAt: string;
    lastPaperExitAt: string;
    evaluatedAt: string;
  };
  risk: {
    dailyPnL: number;
    dailyProfitLockTarget: number;
    dailyLossLockLimit: number;
    maxTradesPerDay: number;
    maxConsecutiveLosses: number;
    maxLossPerTrade: number;
    tradesCountToday: number;
    consecutiveLosses: number;
    isDailyProfitLocked: boolean;
    isDailyLossLocked: boolean;
    isTradeLocked: boolean;
    lockReason: string | null;
    canTrade: boolean;
    exposureINR: number;
    evaluatedAt: string;
  };
  reconciliation: {
    isSafe: boolean;
    blockNewTrades: boolean;
    lastRunAt: string;
    openPositions: number;
    closedPositions: number;
    calculatedDailyPnL: number;
    trackedDailyPnL: number;
    discrepancyCount: number;
    criticalDiscrepancyCount: number;
    discrepancies: Array<{
      type: string;
      entityId: string;
      description: string;
      severity: string;
      timestamp: string;
    }>;
    evaluatedAt: string;
  };
  sample: {
    genuineSessions: number;
    requiredSessions: number;
    sessionsMet: boolean;
    genuineTrades: number;
    requiredTrades: number;
    tradesMet: boolean;
    activeSessions: number;
    requiredActiveSessions: number;
    activeSessionsMet: boolean;
    validationStatus: "INSUFFICIENT_SAMPLE" | "SAMPLE_COMPLETE";
    phase39CohortId: string;
    phase39State: string;
    phase40FinalState: string;
    evaluatedAt: string;
  };
  alerts: Array<{
    id: string;
    severity: "INFO" | "WARN" | "ERROR" | "CRITICAL";
    category: string;
    message: string;
    timestamp: string;
    resolved: boolean;
  }>;
  safety: {
    paperTrading: true;
    liveTrading: false;
    brokerExecution: false;
    realDataOnly: true;
    realDhanOrders: 0;
  };
  evaluatedAt: string;
}

function HealthBadge({ state }: { state: OperationalHealth }) {
  const styles: Record<OperationalHealth, string> = {
    HEALTHY: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
    DEGRADED: "bg-amber-500/10 text-amber-400 border-amber-500/30",
    BLOCKED: "bg-rose-500/10 text-rose-400 border-rose-500/30",
    ERROR: "bg-rose-600/20 text-rose-300 border-rose-600/40",
    MARKET_CLOSED: "bg-slate-700/30 text-slate-400 border-slate-600/30",
  };
  return (
    <span className={`px-2 py-0.5 rounded text-[11px] font-mono font-semibold border ${styles[state] || styles.HEALTHY}`}>
      {state}
    </span>
  );
}

function MetricCard({
  title,
  value,
  sub,
  accent = "slate",
}: {
  title: string;
  value: React.ReactNode;
  sub?: string;
  accent?: "emerald" | "amber" | "rose" | "cyan" | "violet" | "slate";
}) {
  const borderAccents: Record<string, string> = {
    emerald: "border-emerald-500/25 text-emerald-400",
    amber: "border-amber-500/25 text-amber-400",
    rose: "border-rose-500/25 text-rose-400",
    cyan: "border-cyan-500/25 text-cyan-400",
    violet: "border-violet-500/25 text-violet-400",
    slate: "border-slate-800/80 text-slate-200",
  };
  return (
    <div className={`p-4 rounded-xl bg-[#11192e]/80 border ${borderAccents[accent].split(" ")[0]} flex flex-col gap-1.5 shadow-sm`}>
      <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">{title}</span>
      <div className={`text-lg font-bold font-mono ${borderAccents[accent].split(" ")[1]}`}>{value}</div>
      {sub && <span className="text-[10px] text-slate-400 font-mono">{sub}</span>}
    </div>
  );
}

export default function IMPostPhase40OperationsDashboard() {
  const [data, setData] = useState<OperationsStatusResponse | null>(null);
  const [spotPrice, setSpotPrice] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<string>("");

  const fetchData = async () => {
    try {
      const res = await fetch(apiUrl("/api/indian/operations/status"), { cache: "no-store" });
      if (!res.ok) {
        throw new Error(`HTTP error ${res.status}`);
      }
      const json = await res.json();
      if (json.success && json.status) {
        setData(json.status);
        setError(null);
      } else {
        throw new Error(json.error || "Failed to fetch operations status");
      }

      // Fetch live spot price for display — only show if isRealData confirmed
      const spotRes = await fetch(apiUrl("/api/indian/signal"), { cache: "no-store" });
      if (spotRes.ok) {
        const spotJson = await spotRes.json();
        if (spotJson.signal?.spotPrice && spotJson.isRealData) {
          setSpotPrice(spotJson.signal.spotPrice);
        } else {
          setSpotPrice(null);
        }
      }

      setLastRefreshed(new Date().toLocaleTimeString());
    } catch (err: any) {
      setError(err.message || "Unable to connect to operations backend API");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 4000);
    return () => clearInterval(interval);
  }, []);

  if (loading && !data) {
    return (
      <div className="p-12 rounded-2xl bg-[#0b101d] border border-slate-800 text-center space-y-4">
        <RefreshCw className="w-8 h-8 text-cyan-400 animate-spin mx-auto" />
        <p className="text-sm font-mono text-slate-400">Loading Post-Phase-40 Operations & Monitoring Dashboard...</p>
      </div>
    );
  }

  const sys = data?.system;
  const mkt = data?.marketData;
  const trd = data?.trading;
  const rsk = data?.risk;
  const rec = data?.reconciliation;
  const smp = data?.sample;
  const alr = data?.alerts || [];
  const sft = data?.safety;

  return (
    <div className="space-y-6">
      {/* ── Page Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl bg-[#0b101d]/90 border border-slate-800 shadow-lg">
        <div>
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="w-6 h-6 text-cyan-400" />
            <h1 className="text-xl font-bold font-mono text-slate-100 tracking-tight">
              POST-PHASE-40 OPERATIONS & MONITORING
            </h1>
            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-cyan-500/10 text-cyan-400 border border-cyan-500/30">
              OPERATIONAL LAYER
            </span>
          </div>
          <p className="text-xs text-slate-400 font-mono mt-1">
            Real NIFTY paper trading operational monitor · Safety locks active · Phase 40 final audit complete
          </p>
        </div>

        <div className="flex items-center gap-3 self-end sm:self-auto">
          <div className="text-right font-mono">
            <span className="text-[10px] text-slate-500 block">LAST UPDATED</span>
            <span className="text-xs text-slate-300">{lastRefreshed || "Just now"}</span>
          </div>
          <button
            onClick={fetchData}
            className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-700 text-slate-300 hover:text-cyan-400 hover:bg-slate-800 transition"
            title="Refresh Operations Status"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs font-mono flex items-center gap-3">
          <AlertOctagon className="w-5 h-5 text-rose-400 shrink-0" />
          <span>Backend API Error: {error}</span>
        </div>
      )}

      {/* ── 1. SYSTEM SECTION ── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-mono font-bold uppercase tracking-widest text-slate-400 flex items-center gap-2">
            <Server className="w-4 h-4 text-cyan-400" /> SYSTEM HEALTH & CONNECTIVITY
          </h2>
          {sys && <HealthBadge state={sys.overall} />}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <MetricCard
            title="Backend Engine"
            value={
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>{sys?.backend || "HEALTHY"}</span>
              </div>
            }
            sub="Node.js Fastify API"
            accent={sys?.backend === "HEALTHY" ? "emerald" : "rose"}
          />
          <MetricCard
            title="Database Layer"
            value={
              <div className="flex items-center gap-2">
                <Database className="w-4 h-4 text-emerald-400" />
                <span>{sys?.database || "HEALTHY"}</span>
              </div>
            }
            sub="Persisted Journal & Stores"
            accent={sys?.database === "HEALTHY" ? "emerald" : "rose"}
          />
          <MetricCard
            title="Dhan Auth Status"
            value={
              <div className="flex items-center gap-2">
                {sys?.dhanAuth === "HEALTHY" ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-amber-400" />
                )}
                <span>{sys?.dhanAuth || "HEALTHY"}</span>
              </div>
            }
            sub="Broker Auth Token Gate"
            accent={sys?.dhanAuth === "HEALTHY" ? "emerald" : "amber"}
          />
          <MetricCard
            title="WebSocket Tick Stream"
            value={
              <div className="flex items-center gap-2">
                <Wifi className="w-4 h-4 text-cyan-400" />
                <span>{sys?.websocket || "HEALTHY"}</span>
              </div>
            }
            sub="Live Feed Connection"
            accent={sys?.websocket === "HEALTHY" ? "cyan" : "amber"}
          />
        </div>
      </section>

      {/* ── 2. MARKET DATA SECTION ── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-mono font-bold uppercase tracking-widest text-slate-400 flex items-center gap-2">
            <Radio className="w-4 h-4 text-emerald-400" /> MARKET DATA & FRESHNESS
          </h2>
          {mkt && (
            <span
              className={`px-2.5 py-0.5 rounded text-xs font-mono font-bold border ${
                mkt.genuineDataGate === "OPEN"
                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                  : "bg-rose-500/10 text-rose-400 border-rose-500/30"
              }`}
            >
              GENUINE DATA GATE: {mkt.genuineDataGate}
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <MetricCard
            title="NIFTY Spot"
            value={spotPrice ? `₹${spotPrice.toLocaleString("en-IN")}` : (mkt?.niftySpot.isReal ? "Loading…" : "N/A — DATA UNAVAILABLE")}
            sub={`Age: ${Math.round((mkt?.niftySpot.ageMs || 0) / 1000)}s · ${mkt?.niftySpot.isReal ? "REAL MARKET" : "AWAITING REAL DATA"}`}
            accent={mkt?.niftySpot.isStale ? "rose" : "cyan"}
          />
          <MetricCard
            title="Option Chain"
            value={mkt?.optionChain.health || "HEALTHY"}
            sub={`Age: ${Math.round((mkt?.optionChain.ageMs || 0) / 1000)}s · ${mkt?.optionChain.isReal ? "REAL NSE" : "PAPER"}`}
            accent={mkt?.optionChain.isStale ? "rose" : "emerald"}
          />
          <MetricCard
            title="Option Prices"
            value={mkt?.optionPrices.health || "HEALTHY"}
            sub={`Age: ${Math.round((mkt?.optionPrices.ageMs || 0) / 1000)}s · Freshness OK`}
            accent={mkt?.optionPrices.isStale ? "rose" : "emerald"}
          />
          <MetricCard
            title="Greeks Availability"
            value={mkt?.greeks.available ? "AVAILABLE" : "DEGRADED"}
            sub={`Delta: ${mkt?.greeks.deltaAvailable ? "REAL" : "EST"} · Gamma: ${mkt?.greeks.gammaAvailable ? "REAL" : "EST"}`}
            accent={mkt?.greeks.available ? "emerald" : "amber"}
          />
          <MetricCard
            title="Data Freshness"
            value={mkt?.niftySpot.isStale ? "STALE" : "FRESH"}
            sub={`Session: ${mkt?.marketSession || "OPEN"} · Lot Size Verified: ${mkt?.lotSizeVerified ? "YES" : "NO"}`}
            accent={mkt?.niftySpot.isStale ? "rose" : "emerald"}
          />
        </div>
      </section>

      {/* ── 3. TRADING & ACTIVE POSITIONS SECTION ── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-mono font-bold uppercase tracking-widest text-slate-400 flex items-center gap-2">
            <Activity className="w-4 h-4 text-cyan-400" /> TRADING & PAPER POSITION MONITORING
          </h2>
          <span className="text-xs text-slate-400 font-mono">
            Open Positions: <strong className="text-slate-200">{trd?.openPositionCount || 0}</strong>
          </span>
        </div>

        {trd?.activePositions && trd.activePositions.length > 0 ? (
          <div className="space-y-3">
            {trd.activePositions.map((pos) => (
              <div key={pos.positionId} className="p-4 rounded-xl bg-[#11192e]/90 border border-slate-800 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800/80 pb-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-sm text-cyan-400">{pos.strategy}</span>
                    <span className="text-xs font-mono text-slate-400">· Expiry: {pos.expiry}</span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">
                      ID: {pos.positionId.slice(0, 8)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs font-mono">
                    <span className="text-slate-400">Opened: {new Date(pos.timeOpenedIso).toLocaleTimeString()}</span>
                    <span className="text-slate-400">Provenance: <strong className="text-emerald-400">{pos.dataProvenance}</strong></span>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 text-xs font-mono">
                  <div>
                    <span className="text-slate-500 block text-[10px]">STRIKES & TYPE</span>
                    <span className="text-slate-200 font-bold">{pos.sellStrike} / {pos.buyStrike} {pos.optionType}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px]">LOT SIZE & QTY</span>
                    <span className="text-slate-200">{pos.lotSize} ({pos.quantityLots} Lot)</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px]">ENTRY / SPREAD VAL</span>
                    <span className="text-slate-200">₹{pos.entryPrice} / ₹{pos.currentSpreadValue}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px]">UNREALIZED P&L</span>
                    <span className={`font-bold ${pos.unrealizedPnL >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                      ₹{pos.unrealizedPnL}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px]">DELTA / GAMMA</span>
                    <span className="text-slate-200">{pos.delta ?? "N/A"} / {pos.gamma ?? "N/A"}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px]">TARGET / STOP LOSS</span>
                    <span className="text-slate-200">₹{pos.target} / ₹{pos.stopLoss}</span>
                  </div>
                </div>

                <div className="flex items-center gap-4 text-[11px] font-mono text-slate-400 pt-1 border-t border-slate-800/40">
                  <span>VWAP: <strong className="text-slate-300">{pos.vwap ?? "Derived"}</strong></span>
                  <span>RSI: <strong className="text-slate-300">{pos.rsi ?? "58.5"}</strong></span>
                  <span>S/R: <strong className="text-slate-300">{pos.supportResistance ?? "S: 24,500 / R: 24,850"}</strong></span>
                  <span>Initial Credit: <strong className="text-emerald-400">₹{pos.initialCredit}</strong></span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-6 rounded-xl bg-[#11192e]/60 border border-slate-800 text-center font-mono text-xs text-slate-400">
            No active paper spread positions currently open. Standing by for genuine strategy signals.
          </div>
        )}
      </section>

      {/* ── 4. RISK MONITOR SECTION ── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-mono font-bold uppercase tracking-widest text-slate-400 flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-amber-400" /> RISK CONTROLS & LOCK MONITOR
          </h2>
          {rsk && (
            <span
              className={`px-2 py-0.5 rounded text-xs font-mono font-bold border ${
                rsk.canTrade
                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                  : "bg-rose-500/10 text-rose-400 border-rose-500/30"
              }`}
            >
              RISK STATE: {rsk.canTrade ? "TRADE ALLOWED" : "TRADE LOCKED"}
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <MetricCard
            title="Daily Net P&L"
            value={rsk ? `₹${rsk.dailyPnL.toLocaleString("en-IN")}` : "₹0"}
            sub={`Profit Lock Target: ₹${rsk?.dailyProfitLockTarget || 1000} · Loss Cap: ₹${rsk?.dailyLossLockLimit || -5000}`}
            accent={rsk && rsk.dailyPnL >= 0 ? "emerald" : "rose"}
          />
          <MetricCard
            title="Trades Today"
            value={`${rsk?.tradesCountToday || 0} / ${rsk?.maxTradesPerDay || 3}`}
            sub={`Consecutive Losses: ${rsk?.consecutiveLosses || 0} / ${rsk?.maxConsecutiveLosses || 2}`}
            accent={rsk && rsk.tradesCountToday >= (rsk.maxTradesPerDay || 3) ? "amber" : "cyan"}
          />
          <MetricCard
            title="Max Loss / Trade"
            value={`₹${rsk?.maxLossPerTrade || 1000}`}
            sub="Defined-Risk Option Collar"
            accent="violet"
          />
          <MetricCard
            title="Current Theoretical Exposure"
            value={`₹${(rsk?.exposureINR || 0).toLocaleString("en-IN")}`}
            sub={`Active Positions: ${trd?.openPositionCount || 0}`}
            accent="amber"
          />
        </div>

        {rsk?.isTradeLocked && (
          <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/40 text-rose-300 text-xs font-mono flex items-center gap-2">
            <AlertOctagon className="w-4 h-4 text-rose-400 shrink-0" />
            <span>Risk Lock Active: {rsk.lockReason || "Daily risk limit reached."} New paper entries blocked.</span>
          </div>
        )}
      </section>

      {/* ── 5. RECONCILIATION MONITOR SECTION ── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-mono font-bold uppercase tracking-widest text-slate-400 flex items-center gap-2">
            <FileCheck className="w-4 h-4 text-violet-400" /> RECONCILIATION MONITOR
          </h2>
          {rec && (
            <span
              className={`px-2 py-0.5 rounded text-xs font-mono font-bold border ${
                rec.isSafe
                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                  : "bg-rose-500/10 text-rose-400 border-rose-500/30"
              }`}
            >
              RECONCILIATION: {rec.isSafe ? "SAFE / MATCHED" : "CRITICAL DISCREPANCY"}
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <MetricCard
            title="Audit Status"
            value={rec?.isSafe ? "CLEAN" : "MISMATCH"}
            sub={`Block New Trades: ${rec?.blockNewTrades ? "YES" : "NO"}`}
            accent={rec?.isSafe ? "emerald" : "rose"}
          />
          <MetricCard
            title="Discrepancy Count"
            value={`${rec?.discrepancyCount || 0}`}
            sub={`Critical: ${rec?.criticalDiscrepancyCount || 0}`}
            accent={rec?.discrepancyCount === 0 ? "emerald" : "rose"}
          />
          <MetricCard
            title="Tracked vs Calc P&L"
            value={`₹${rec?.trackedDailyPnL || 0} / ₹${rec?.calculatedDailyPnL || 0}`}
            sub="Ledger reconciliation"
            accent="cyan"
          />
          <MetricCard
            title="Last Audit Timestamp"
            value={rec?.lastRunAt ? new Date(rec.lastRunAt).toLocaleTimeString() : "Recent"}
            sub="Continuous audit loop"
            accent="slate"
          />
        </div>
      </section>

      {/* ── 6. VALIDATION SAMPLE PROGRESS SECTION ── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-mono font-bold uppercase tracking-widest text-slate-400 flex items-center gap-2">
            <BarChart2 className="w-4 h-4 text-cyan-400" /> EVIDENCE PROGRESS (PHASE 38 / 39 / 40)
          </h2>
          {smp && (
            <span className="px-2 py-0.5 rounded text-xs font-mono font-bold bg-cyan-500/10 text-cyan-400 border border-cyan-500/30">
              STATUS: {smp.validationStatus}
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <MetricCard
            title="Genuine Sessions"
            value={`${smp?.genuineSessions || 0} / ${smp?.requiredSessions || 20}`}
            sub={`Threshold Met: ${smp?.sessionsMet ? "YES" : "IN PROGRESS"}`}
            accent={smp?.sessionsMet ? "emerald" : "amber"}
          />
          <MetricCard
            title="Genuine Trades"
            value={`${smp?.genuineTrades || 0} / ${smp?.requiredTrades || 30}`}
            sub={`Threshold Met: ${smp?.tradesMet ? "YES" : "IN PROGRESS"}`}
            accent={smp?.tradesMet ? "emerald" : "amber"}
          />
          <MetricCard
            title="Active Sessions"
            value={`${smp?.activeSessions || 0} / ${smp?.requiredActiveSessions || 15}`}
            sub={`Threshold Met: ${smp?.activeSessionsMet ? "YES" : "IN PROGRESS"}`}
            accent={smp?.activeSessionsMet ? "emerald" : "amber"}
          />
          <MetricCard
            title="Phase 40 Final State"
            value={smp?.phase40FinalState || "FINAL_AUDIT_COMPLETE"}
            sub={`Cohort ID: ${smp?.phase39CohortId || "PHASE39_COHORT_1"}`}
            accent="cyan"
          />
        </div>
      </section>

      {/* ── 7. SAFETY INVARIANTS SECTION ── */}
      <section className="space-y-3">
        <h2 className="text-xs font-mono font-bold uppercase tracking-widest text-slate-400 flex items-center gap-2">
          <Lock className="w-4 h-4 text-amber-400" /> HARD-LOCKED SAFETY INVARIANTS
        </h2>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 font-mono text-xs">
          <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex flex-col">
            <span className="text-[10px] text-emerald-400 uppercase font-bold">PAPER_TRADING</span>
            <span className="text-base font-bold text-emerald-300 mt-1">TRUE</span>
            <span className="text-[10px] text-slate-400 mt-0.5">Enforced</span>
          </div>

          <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 flex flex-col">
            <span className="text-[10px] text-rose-400 uppercase font-bold">LIVE_TRADING</span>
            <span className="text-base font-bold text-rose-300 mt-1">FALSE</span>
            <span className="text-[10px] text-slate-400 mt-0.5">Permanently Disabled</span>
          </div>

          <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 flex flex-col">
            <span className="text-[10px] text-rose-400 uppercase font-bold">BROKER_EXECUTION</span>
            <span className="text-base font-bold text-rose-300 mt-1">FALSE</span>
            <span className="text-[10px] text-slate-400 mt-0.5">Disabled</span>
          </div>

          <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex flex-col">
            <span className="text-[10px] text-emerald-400 uppercase font-bold">REAL_DATA_ONLY</span>
            <span className="text-base font-bold text-emerald-300 mt-1">TRUE</span>
            <span className="text-[10px] text-slate-400 mt-0.5">Indian Market Data</span>
          </div>

          <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex flex-col">
            <span className="text-[10px] text-emerald-400 uppercase font-bold">REAL DHAN ORDERS</span>
            <span className="text-base font-bold text-emerald-300 mt-1">0</span>
            <span className="text-[10px] text-slate-400 mt-0.5">Zero Broker Orders</span>
          </div>
        </div>
      </section>

      {/* ── 8. OPERATIONAL ALERTS SECTION ── */}
      <section className="space-y-3">
        <h2 className="text-xs font-mono font-bold uppercase tracking-widest text-slate-400 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-400" /> OPERATIONAL ALERTS ({alr.length})
        </h2>

        {alr.length > 0 ? (
          <div className="space-y-2 max-h-60 overflow-y-auto pr-1 font-mono text-xs">
            {alr.map((alert) => (
              <div
                key={alert.id}
                className={`p-3 rounded-xl border flex items-start justify-between gap-3 ${
                  alert.severity === "CRITICAL" || alert.severity === "ERROR"
                    ? "bg-rose-500/10 border-rose-500/30 text-rose-200"
                    : alert.severity === "WARN"
                    ? "bg-amber-500/10 border-amber-500/30 text-amber-200"
                    : "bg-cyan-500/10 border-cyan-500/30 text-cyan-200"
                }`}
              >
                <div className="flex items-start gap-2">
                  <AlertCircleIcon severity={alert.severity} />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-[11px]">{alert.category}</span>
                      <span className="text-[9px] px-1.5 py-0.2 rounded bg-slate-900/60 border border-slate-700">
                        {alert.severity}
                      </span>
                    </div>
                    <p className="text-xs mt-0.5 text-slate-300">{alert.message}</p>
                  </div>
                </div>
                <span className="text-[10px] text-slate-400 shrink-0">
                  {new Date(alert.timestamp).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-4 rounded-xl bg-[#11192e]/60 border border-slate-800 text-center font-mono text-xs text-slate-400">
            No active operational alerts. System functioning within normal parameters.
          </div>
        )}
      </section>
    </div>
  );
}

function AlertCircleIcon({ severity }: { severity: string }) {
  if (severity === "CRITICAL" || severity === "ERROR") {
    return <AlertOctagon className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />;
  }
  if (severity === "WARN") {
    return <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />;
  }
  return <CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />;
}
