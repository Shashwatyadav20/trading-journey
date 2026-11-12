"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Activity, Gauge, Layers, Radio, Target, TrendingDown, TrendingUp, Zap } from "lucide-react";
import type { ActiveFOSpreadPosition, FOScannerSetup } from "./types";
import type {
  LiveLegTick,
  LivePositionTick,
  UseLiveFoTickerResult,
} from "@/hooks/useLiveFoTicker";

// ─────────────────────────────────────────────────────────────────────────────
// FlashValue: briefly flashes emerald (up) / crimson (down) on every tick change
// ─────────────────────────────────────────────────────────────────────────────
export function FlashValue({
  value,
  children,
  className = "",
}: {
  value: number;
  children: React.ReactNode;
  className?: string;
}) {
  const prev = useRef(value);
  const [flash, setFlash] = useState<"UP" | "DOWN" | null>(null);

  useEffect(() => {
    if (value === prev.current) return;
    setFlash(value > prev.current ? "UP" : "DOWN");
    prev.current = value;
    const t = setTimeout(() => setFlash(null), 650);
    return () => clearTimeout(t);
  }, [value]);

  return (
    <span
      className={`inline-block rounded-md px-1 -mx-1 transition-colors duration-500 ${
        flash === "UP"
          ? "bg-emerald-500/25 shadow-[0_0_12px_rgba(16,185,129,0.45)]"
          : flash === "DOWN"
          ? "bg-rose-500/25 shadow-[0_0_12px_rgba(244,63,94,0.45)]"
          : "bg-transparent"
      } ${className}`}
    >
      {children}
    </span>
  );
}

const inr = (n: number, digits = 2) =>
  n.toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits });

const glass =
  "bg-[#0b1120]/80 backdrop-blur-xl border rounded-2xl shadow-2xl";

// ─────────────────────────────────────────────────────────────────────────────
// CE / PE glowing leg pill
// ─────────────────────────────────────────────────────────────────────────────
function LegPill({ leg, lots, lotSize }: { leg: LiveLegTick; lots: number; lotSize: number }) {
  const isCE = leg.right === "CE";
  const legPnl = (leg.action === "BUY" ? 1 : -1) * (leg.premium - leg.entryPremium) * lots * lotSize;
  return (
    <div
      className={`rounded-xl border px-3 py-2 text-[11px] font-mono ${
        isCE
          ? "bg-emerald-950/30 border-emerald-400/50 shadow-[0_0_14px_rgba(16,185,129,0.25)]"
          : "bg-rose-950/30 border-rose-400/50 shadow-[0_0_14px_rgba(244,63,94,0.25)]"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className={`px-2 py-0.5 rounded-full text-[10px] font-black tracking-wide ${
            isCE
              ? "bg-emerald-400/20 text-emerald-300 ring-1 ring-emerald-400/60"
              : "bg-rose-400/20 text-rose-300 ring-1 ring-rose-400/60"
          }`}
        >
          {leg.action} {leg.strike} {leg.right}
        </span>
        <FlashValue value={leg.premium} className="font-extrabold text-white text-xs">
          ₹{inr(leg.premium)}
        </FlashValue>
      </div>
      <div className="mt-1.5 grid grid-cols-4 gap-1 text-[10px] text-slate-400">
        <span>Δ <b className="text-slate-200">{leg.delta.toFixed(2)}</b></span>
        <span>Θ <b className="text-slate-200">{leg.theta.toFixed(1)}</b></span>
        <span>V <b className="text-slate-200">{leg.vega.toFixed(1)}</b></span>
        <span>IV <b className="text-amber-300">{leg.iv.toFixed(1)}%</b></span>
      </div>
      <div className="mt-1 flex items-center justify-between text-[10px]">
        <span className="text-slate-500">Entry ₹{inr(leg.entryPremium)}</span>
        <span className={legPnl >= 0 ? "text-emerald-400 font-bold" : "text-rose-400 font-bold"}>
          {legPnl >= 0 ? "+" : ""}₹{inr(legPnl, 0)}
        </span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Active position live card
// ─────────────────────────────────────────────────────────────────────────────
function LivePositionCard({
  pos,
  tick,
}: {
  pos: ActiveFOSpreadPosition;
  tick?: LivePositionTick;
}) {
  const pnl = tick?.unrealizedPnLINR ?? 0;
  const positive = pnl >= 0;
  return (
    <div
      className={`${glass} p-4 space-y-3 ${
        positive ? "border-emerald-500/30" : "border-rose-500/30"
      } hover:border-fuchsia-400/50 transition-colors`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-base font-black text-white">{pos.cleanSymbol}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-fuchsia-500/15 text-fuchsia-300 border border-fuchsia-500/30">
              {pos.expiryDate}
            </span>
          </div>
          <div className="text-[11px] text-cyan-300 font-bold mt-0.5">{pos.strategyName}</div>
          <div className="text-[10px] text-slate-500 mt-0.5">
            {pos.lotsDeployed} lot(s) × {pos.lotSize} · Margin ₹{pos.marginBlockedINR.toLocaleString("en-IN")}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] text-slate-500 uppercase">Live Spread P&amp;L</div>
          <FlashValue
            value={pnl}
            className={`text-lg font-black ${positive ? "text-emerald-400" : "text-rose-400"}`}
          >
            {positive ? "+" : ""}₹{inr(pnl, 0)}
          </FlashValue>
          <div className={`text-[10px] font-bold ${positive ? "text-emerald-400" : "text-rose-400"}`}>
            {(tick?.roiOnMarginPct ?? 0) >= 0 ? "+" : ""}
            {(tick?.roiOnMarginPct ?? 0).toFixed(2)}% on margin
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between text-[11px] font-mono bg-slate-950/60 rounded-xl px-3 py-2 border border-slate-800">
        <span className="text-slate-400">
          Spot{" "}
          <FlashValue value={tick?.spot ?? pos.currentSpotPrice} className="text-white font-bold">
            ₹{inr(tick?.spot ?? pos.currentSpotPrice)}
          </FlashValue>
        </span>
        <span className="text-emerald-400">🎯 ₹{pos.targetSpotLevel.toLocaleString("en-IN")}</span>
        <span className="text-rose-400">🛑 ₹{pos.stopLossSpotLevel.toLocaleString("en-IN")}</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {(tick?.legs ?? []).map((leg) => {
          const src = pos.legs.find((l) => l.legId === leg.legId);
          return (
            <LegPill key={leg.legId} leg={leg} lots={src?.lots ?? 1} lotSize={src?.lotSize ?? pos.lotSize} />
          );
        })}
        {!tick && (
          <div className="text-[11px] text-slate-500 col-span-2">Calibrating live Greeks…</div>
        )}
      </div>

      {tick && (
        <div className="grid grid-cols-4 gap-2 text-center text-[10px] font-mono">
          {[
            { k: "Net Δ", v: tick.netDelta.toFixed(1), c: "text-cyan-300" },
            { k: "Net Γ", v: tick.netGamma.toFixed(4), c: "text-violet-300" },
            { k: "Θ ₹/day", v: tick.netThetaINRPerDay.toLocaleString("en-IN"), c: tick.netThetaINRPerDay >= 0 ? "text-emerald-400" : "text-rose-400" },
            { k: "Vega ₹/1%", v: tick.netVegaINRPerPct.toLocaleString("en-IN"), c: "text-amber-300" },
          ].map((g) => (
            <div key={g.k} className="rounded-lg bg-slate-950/70 border border-slate-800 py-1.5">
              <div className="text-slate-500">{g.k}</div>
              <div className={`font-extrabold ${g.c}`}>{g.v}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PCR gauge (semicircle, range 0.5 → 1.5)
// ─────────────────────────────────────────────────────────────────────────────
function PCRGauge({ pcr }: { pcr: number }) {
  const clamped = Math.max(0.5, Math.min(1.5, pcr));
  const angle = -90 + ((clamped - 0.5) / 1.0) * 180; // -90 .. +90
  const label =
    pcr >= 1.2 ? "BULLISH · Put Writing" : pcr <= 0.8 ? "BEARISH · Call Writing" : "NEUTRAL · Balanced";
  const color = pcr >= 1.2 ? "#34d399" : pcr <= 0.8 ? "#fb7185" : "#fbbf24";
  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 200 115" className="w-full max-w-[220px]">
        <defs>
          <linearGradient id="pcrGrad" x1="0" x2="1">
            <stop offset="0%" stopColor="#f43f5e" />
            <stop offset="50%" stopColor="#f59e0b" />
            <stop offset="100%" stopColor="#10b981" />
          </linearGradient>
        </defs>
        <path d="M 15 100 A 85 85 0 0 1 185 100" fill="none" stroke="#1e293b" strokeWidth="16" strokeLinecap="round" />
        <path d="M 15 100 A 85 85 0 0 1 185 100" fill="none" stroke="url(#pcrGrad)" strokeWidth="10" strokeLinecap="round" opacity="0.9" />
        <g transform={`rotate(${angle} 100 100)`} style={{ transition: "transform 0.8s ease" }}>
          <line x1="100" y1="100" x2="100" y2="28" stroke={color} strokeWidth="3" strokeLinecap="round" />
        </g>
        <circle cx="100" cy="100" r="7" fill={color} />
        <text x="15" y="114" fill="#64748b" fontSize="9">0.5</text>
        <text x="93" y="12" fill="#64748b" fontSize="9">1.0</text>
        <text x="172" y="114" fill="#64748b" fontSize="9">1.5</text>
      </svg>
      <div className="text-2xl font-black font-mono" style={{ color }}>{pcr.toFixed(2)}</div>
      <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color }}>{label}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Command Center
// ─────────────────────────────────────────────────────────────────────────────
export default function FOLiveCommandCenter({
  setups,
  activeSetup,
  positions,
  ticker,
  onSelectSymbol,
}: {
  setups: FOScannerSetup[];
  activeSetup: FOScannerSetup | null;
  positions: ActiveFOSpreadPosition[];
  ticker: UseLiveFoTickerResult;
  onSelectSymbol: (symbol: string) => void;
}) {
  const liveSpot = activeSetup
    ? ticker.symbolTicks[activeSetup.cleanSymbol]?.spot ?? activeSetup.spotPrice
    : 0;

  const totalLivePnL = useMemo(
    () => positions.reduce((acc, p) => acc + (ticker.positionTicks[p.positionId]?.unrealizedPnLINR ?? 0), 0),
    [positions, ticker.positionTicks]
  );
  const totalMargin = useMemo(() => positions.reduce((a, p) => a + p.marginBlockedINR, 0), [positions]);
  const portfolioTheta = useMemo(
    () => positions.reduce((a, p) => a + (ticker.positionTicks[p.positionId]?.netThetaINRPerDay ?? 0), 0),
    [positions, ticker.positionTicks]
  );

  const oiRows = useMemo(() => {
    if (!activeSetup) return [];
    const strikes = activeSetup.optionChain.strikes;
    const atmIdx = Math.max(0, strikes.findIndex((s) => s.isATM));
    return strikes.slice(Math.max(0, atmIdx - 5), atmIdx + 6);
  }, [activeSetup]);
  const maxOI = useMemo(
    () => Math.max(1, ...oiRows.map((r) => Math.max(r.ceOI, r.peOI))),
    [oiRows]
  );

  const chain = activeSetup?.optionChain;
  const maxPainDist = chain ? liveSpot - chain.maxPainStrike : 0;
  const maxPainDistPct = chain && liveSpot ? (maxPainDist / liveSpot) * 100 : 0;
  const lastTickLabel = ticker.lastTickAt
    ? new Date(ticker.lastTickAt).toLocaleTimeString("en-IN", { hour12: false })
    : "--:--:--";

  return (
    <div className="space-y-4 font-mono">
      {/* ── Header & LIVE badge ── */}
      <div className={`${glass} border-emerald-500/30 p-4 flex flex-wrap items-center justify-between gap-3 bg-gradient-to-r from-[#07101f]/90 via-[#0b1120]/90 to-[#120a1f]/90`}>
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-fuchsia-500/15 border border-fuchsia-500/40 shadow-[0_0_20px_rgba(217,70,239,0.25)]">
            <Zap className="w-5 h-5 text-fuchsia-300" />
          </div>
          <div>
            <h2 className="text-base sm:text-lg font-black text-white tracking-tight">
              F&amp;O LIVE COMMAND CENTER
            </h2>
            <p className="text-[10px] text-slate-400">
              Black-Scholes re-pricing every 1.5s · Micro-ticks simulated between NSE feed syncs (anchored to real spot)
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] font-black border ${
              ticker.isStreaming
                ? "bg-emerald-500/10 border-emerald-400/60 text-emerald-300 shadow-[0_0_18px_rgba(16,185,129,0.35)]"
                : "bg-slate-800 border-slate-700 text-slate-400"
            }`}
          >
            <span className="relative flex h-2.5 w-2.5">
              {ticker.isStreaming && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              )}
              <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${ticker.isStreaming ? "bg-emerald-400" : "bg-slate-500"}`} />
            </span>
            {ticker.isStreaming ? "🔴 LIVE STREAMING ACTIVE" : "STREAM PAUSED"}
          </span>
          <span className="px-2.5 py-1.5 rounded-full text-[10px] bg-slate-900 border border-slate-700 text-slate-300 flex items-center gap-1">
            <Radio className="w-3 h-3 text-cyan-400" /> Tick #{ticker.tickCount} · {lastTickLabel}
          </span>
        </div>
      </div>

      {/* ── Spot ticker strip ── */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {setups.map((s) => {
          const t = ticker.symbolTicks[s.cleanSymbol];
          const spot = t?.spot ?? s.spotPrice;
          const chg = t?.changePct ?? s.changePercent;
          const selected = activeSetup?.cleanSymbol === s.cleanSymbol;
          return (
            <button
              key={s.cleanSymbol}
              onClick={() => onSelectSymbol(s.cleanSymbol)}
              className={`shrink-0 px-3 py-2 rounded-xl border text-left cursor-pointer transition-all ${
                selected
                  ? "bg-fuchsia-500/15 border-fuchsia-400/60 shadow-[0_0_14px_rgba(217,70,239,0.3)]"
                  : "bg-[#0b1120]/80 border-slate-800 hover:border-slate-600"
              }`}
            >
              <div className="text-[10px] text-slate-400 font-bold">{s.cleanSymbol}</div>
              <FlashValue value={spot} className="text-sm font-extrabold text-white">
                ₹{inr(spot)}
              </FlashValue>
              <div className={`text-[10px] font-bold flex items-center gap-0.5 ${chg >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                {chg >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                {chg >= 0 ? "+" : ""}{chg.toFixed(2)}%
              </div>
            </button>
          );
        })}
      </div>

      {/* ── Portfolio live strip ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className={`${glass} border-slate-800 p-3`}>
          <div className="text-[10px] text-slate-500 uppercase">Portfolio Live P&amp;L</div>
          <FlashValue value={totalLivePnL} className={`text-xl font-black ${totalLivePnL >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
            {totalLivePnL >= 0 ? "+" : ""}₹{inr(totalLivePnL, 0)}
          </FlashValue>
        </div>
        <div className={`${glass} border-slate-800 p-3`}>
          <div className="text-[10px] text-slate-500 uppercase">ROI on Hedged Margin</div>
          <div className={`text-xl font-black ${totalLivePnL >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
            {((totalLivePnL / Math.max(1, totalMargin)) * 100).toFixed(2)}%
          </div>
        </div>
        <div className={`${glass} border-slate-800 p-3`}>
          <div className="text-[10px] text-slate-500 uppercase">Portfolio Θ (₹/day)</div>
          <div className={`text-xl font-black ${portfolioTheta >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
            {portfolioTheta >= 0 ? "+" : ""}₹{portfolioTheta.toLocaleString("en-IN")}
          </div>
        </div>
        <div className={`${glass} border-slate-800 p-3`}>
          <div className="text-[10px] text-slate-500 uppercase">Margin Deployed</div>
          <div className="text-xl font-black text-cyan-300">₹{totalMargin.toLocaleString("en-IN")}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* ── Active positions ── */}
        <div className="xl:col-span-2 space-y-3">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-200">
            <Activity className="w-4 h-4 text-fuchsia-400" /> ACTIVE F&amp;O POSITIONS · LIVE GREEKS ({positions.length})
          </div>
          {positions.length === 0 ? (
            <div className={`${glass} border-slate-800 p-8 text-center text-xs text-slate-500`}>
              No active spreads. Deploy one from the Spread Scanner to see live-ticking premiums, Greeks &amp; P&amp;L.
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {positions.map((p) => (
                <LivePositionCard key={p.positionId} pos={p} tick={ticker.positionTicks[p.positionId]} />
              ))}
            </div>
          )}
        </div>

        {/* ── PCR + Max Pain ── */}
        <div className="space-y-3">
          <div className={`${glass} border-amber-500/30 p-4`}>
            <div className="flex items-center gap-2 text-xs font-bold text-amber-200 mb-2">
              <Gauge className="w-4 h-4 text-amber-400" /> PUT-CALL RATIO · {activeSetup?.cleanSymbol ?? "—"}
            </div>
            {chain ? <PCRGauge pcr={chain.overallPCR} /> : <div className="text-xs text-slate-500">Awaiting chain…</div>}
          </div>

          <div className={`${glass} border-violet-500/30 p-4 space-y-3`}>
            <div className="flex items-center gap-2 text-xs font-bold text-violet-200">
              <Target className="w-4 h-4 text-violet-400" /> MAX PAIN MAGNET
            </div>
            {chain ? (
              <>
                <div className="flex items-end justify-between">
                  <div>
                    <div className="text-[10px] text-slate-500">Max Pain Strike</div>
                    <div className="text-2xl font-black text-violet-300">₹{chain.maxPainStrike.toLocaleString("en-IN")}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] text-slate-500">Live Spot Distance</div>
                    <FlashValue value={maxPainDist} className={`text-sm font-extrabold ${maxPainDist >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                      {maxPainDist >= 0 ? "+" : ""}{maxPainDist.toFixed(1)} pts ({maxPainDistPct.toFixed(2)}%)
                    </FlashValue>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[10px]">
                  <div className="rounded-lg bg-rose-950/30 border border-rose-500/40 p-2">
                    <div className="text-rose-300/80">Call OI Wall (Resistance)</div>
                    <div className="text-rose-300 font-black text-sm">₹{chain.highestCallOIStrike.toLocaleString("en-IN")}</div>
                  </div>
                  <div className="rounded-lg bg-emerald-950/30 border border-emerald-500/40 p-2">
                    <div className="text-emerald-300/80">Put OI Wall (Support)</div>
                    <div className="text-emerald-300 font-black text-sm">₹{chain.highestPutOIStrike.toLocaleString("en-IN")}</div>
                  </div>
                </div>
                <div className="text-[10px] text-slate-400">
                  ATM IV <b className="text-amber-300">{chain.atmIV}%</b> · IV Rank <b className="text-amber-300">{chain.ivRank}</b> · DTE <b className="text-cyan-300">{chain.daysToExpiry}</b>
                </div>
              </>
            ) : (
              <div className="text-xs text-slate-500">Awaiting chain…</div>
            )}
          </div>
        </div>
      </div>

      {/* ── OI build-up ── */}
      {chain && (
        <div className={`${glass} border-cyan-500/30 p-4`}>
          <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
            <div className="flex items-center gap-2 text-xs font-bold text-cyan-200">
              <Layers className="w-4 h-4 text-cyan-400" /> OPTION CHAIN OI BUILD-UP · {activeSetup?.cleanSymbol} (ATM ±5)
            </div>
            <div className="flex items-center gap-3 text-[10px]">
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-400 shadow-[0_0_8px_#34d399]" /> CE OI</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-rose-400 shadow-[0_0_8px_#fb7185]" /> PE OI</span>
              <span className="text-slate-500">OI synced at feed refresh</span>
            </div>
          </div>
          <div className="space-y-1">
            {oiRows.map((r) => (
              <div
                key={r.strike}
                className={`grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-[10px] rounded-lg px-1 py-0.5 ${
                  r.isATM ? "bg-fuchsia-500/10 ring-1 ring-fuchsia-500/40" : ""
                }`}
              >
                <div className="flex items-center justify-end gap-2">
                  <span className={`${r.ceChangeInOIPct >= 0 ? "text-emerald-400" : "text-slate-500"}`}>
                    {r.ceChangeInOIPct >= 0 ? "+" : ""}{r.ceChangeInOIPct.toFixed(1)}%
                  </span>
                  <span className="text-slate-500 hidden sm:inline">{r.ceBuildupType.replace(/_/g, " ")}</span>
                  <div className="w-full max-w-[220px] h-3 bg-slate-900 rounded-full overflow-hidden flex justify-end">
                    <div
                      className="h-full bg-gradient-to-l from-emerald-400 to-emerald-700 shadow-[0_0_10px_rgba(52,211,153,0.6)] rounded-full"
                      style={{ width: `${(r.ceOI / maxOI) * 100}%` }}
                    />
                  </div>
                </div>
                <div className={`w-20 text-center font-black ${r.isATM ? "text-fuchsia-300" : "text-slate-200"}`}>
                  {r.strike}
                  {r.isATM && <div className="text-[8px] text-fuchsia-400">ATM</div>}
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-full max-w-[220px] h-3 bg-slate-900 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-rose-400 to-rose-700 shadow-[0_0_10px_rgba(251,113,133,0.6)] rounded-full"
                      style={{ width: `${(r.peOI / maxOI) * 100}%` }}
                    />
                  </div>
                  <span className="text-slate-500 hidden sm:inline">{r.peBuildupType.replace(/_/g, " ")}</span>
                  <span className={`${r.peChangeInOIPct >= 0 ? "text-rose-400" : "text-slate-500"}`}>
                    {r.peChangeInOIPct >= 0 ? "+" : ""}{r.peChangeInOIPct.toFixed(1)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

