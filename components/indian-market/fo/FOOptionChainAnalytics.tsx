"use client";

import React, { useState } from "react";
import {
  Layers,
  ShieldAlert,
  TrendingUp,
  TrendingDown,
  Sparkles,
  Activity,
  Sliders,
  CheckCircle2,
  Eye,
} from "lucide-react";
import type { FOScannerSetup, FOOptionChainRow } from "./types";

interface FOOptionChainAnalyticsProps {
  setups: FOScannerSetup[];
  activeSetup: FOScannerSetup;
  onSelectSetup: (setup: FOScannerSetup) => void;
  onOpenInSimulator: (setup: FOScannerSetup) => void;
}

export default function FOOptionChainAnalytics({
  setups,
  activeSetup,
  onSelectSetup,
  onOpenInSimulator,
}: FOOptionChainAnalyticsProps) {
  const [showFullGreeks, setShowFullGreeks] = useState<boolean>(true);
  const [highlightOnlyPurpleBoxWalls, setHighlightOnlyPurpleBoxWalls] = useState<boolean>(false);

  const { optionChain, purpleBox } = activeSetup;
  const maxCallOI = Math.max(...optionChain.strikes.map((s) => s.ceOI), 1);
  const maxPutOI = Math.max(...optionChain.strikes.map((s) => s.peOI), 1);

  const activeLegStrikes = new Set(activeSetup.legs.map((l) => `${l.strike}-${l.right}`));

  const visibleStrikes = highlightOnlyPurpleBoxWalls
    ? optionChain.strikes.filter(
        (r) =>
          r.alignsWithVALSupport ||
          r.alignsWithVAHResistance ||
          r.isATM ||
          r.institutionalZoneTag !== "NEUTRAL"
      )
    : optionChain.strikes;

  const getBuildupBadge = (type: FOOptionChainRow["ceBuildupType"]) => {
    switch (type) {
      case "SHORT_BUILDUP":
        return (
          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30">
            WRITING (SB)
          </span>
        );
      case "LONG_BUILDUP":
        return (
          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
            LONG (LB)
          </span>
        );
      case "SHORT_COVERING":
        return (
          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
            COVER (SC)
          </span>
        );
      case "LONG_UNWINDING":
        return (
          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-slate-800 text-slate-400 border border-slate-700">
            UNWIND (LU)
          </span>
        );
    }
  };

  return (
    <div className="space-y-4">
      {/* Top Contract Switcher & Institutional OI Confluence Banner */}
      <div className="p-4 rounded-2xl bg-[#0d1322]/95 border border-slate-800/80 flex flex-col xl:flex-row items-stretch xl:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <label className="block text-[10px] font-mono uppercase text-slate-400 mb-1">
              Select F&O Underlying
            </label>
            <select
              value={activeSetup.cleanSymbol}
              onChange={(e) => {
                const found = setups.find((s) => s.cleanSymbol === e.target.value);
                if (found) onSelectSetup(found);
              }}
              className="px-3 py-2 rounded-xl bg-slate-950 border border-violet-500/40 text-sm font-mono font-bold text-slate-100 focus:outline-none"
            >
              {setups.map((s) => (
                <option key={s.cleanSymbol} value={s.cleanSymbol}>
                  {s.cleanSymbol} ({s.instrumentType}) — Spot ₹{s.spotPrice.toLocaleString("en-IN")} | Lot {s.lotSize}
                </option>
              ))}
            </select>
          </div>

          {/* Institutional Alignment Callout */}
          <div className="px-3.5 py-2 rounded-xl bg-violet-950/30 border border-violet-500/30 text-xs font-mono max-w-2xl">
            <div className="flex items-center gap-1.5 text-violet-300 font-bold">
              <Sparkles className="w-3.5 h-3.5 text-violet-400 shrink-0" />
              <span>Institutional OI Wall ↔ Purple Box Confluence Detected</span>
            </div>
            <p className="text-[11px] text-slate-300 mt-0.5">
              {optionChain.institutionalAlignmentSummary}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setHighlightOnlyPurpleBoxWalls((v) => !v)}
            className={`px-3 py-2 rounded-xl text-xs font-mono font-semibold border transition-all flex items-center gap-1.5 ${
              highlightOnlyPurpleBoxWalls
                ? "bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/40"
                : "bg-slate-900 text-slate-300 border-slate-800 hover:bg-slate-800"
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            <span>{highlightOnlyPurpleBoxWalls ? "Showing Key OI Walls" : "Filter Institutional Walls"}</span>
          </button>

          <button
            onClick={() => setShowFullGreeks((v) => !v)}
            className={`px-3 py-2 rounded-xl text-xs font-mono font-semibold border transition-all ${
              showFullGreeks
                ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/40"
                : "bg-slate-900 text-slate-300 border-slate-800"
            }`}
          >
            {showFullGreeks ? "Greeks (Δ, Γ, Θ, V) ON" : "Show Option Greeks"}
          </button>

          <button
            onClick={() => onOpenInSimulator(activeSetup)}
            className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-violet-600 to-cyan-600 hover:from-violet-500 hover:to-cyan-500 text-white text-xs font-mono font-bold flex items-center gap-1.5 shadow-md"
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>Simulate {activeSetup.strategyName.split("(")[0]}</span>
          </button>
        </div>
      </div>

      {/* 6-Card Option Chain & IV Skew Summary Strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 font-mono">
        <div className="p-3.5 rounded-xl bg-[#0d1322]/90 border border-slate-800/80">
          <div className="text-[10px] text-slate-400 uppercase">Spot / Futures Basis</div>
          <div className="text-base font-bold text-slate-100 mt-1">
            ₹{optionChain.spotPrice.toLocaleString("en-IN")}
          </div>
          <div className="text-[11px] text-cyan-400 mt-0.5">
            FUT ₹{optionChain.futuresPrice.toLocaleString("en-IN")} (+{optionChain.futuresBasisPct}%)
          </div>
        </div>

        <div className="p-3.5 rounded-xl bg-[#0d1322]/90 border border-slate-800/80">
          <div className="text-[10px] text-slate-400 uppercase">Put-Call Ratio (PCR)</div>
          <div className="text-base font-bold text-emerald-400 mt-1">
            {optionChain.overallPCR}
          </div>
          <div className="text-[10px] text-slate-300 mt-0.5">
            {optionChain.pcrSentiment.replace(/_/g, " ")}
          </div>
        </div>

        <div className="p-3.5 rounded-xl bg-[#0d1322]/90 border border-emerald-500/30">
          <div className="text-[10px] text-emerald-400 uppercase font-bold">
            🛡️ VAL Put Writing Wall
          </div>
          <div className="text-base font-bold text-emerald-300 mt-1">
            {optionChain.valAlignedStrike.toLocaleString("en-IN")} PE
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">
            Box VAL Floor: ₹{purpleBox.valSupportFloor.toLocaleString("en-IN")}
          </div>
        </div>

        <div className="p-3.5 rounded-xl bg-[#0d1322]/90 border border-fuchsia-500/30">
          <div className="text-[10px] text-fuchsia-400 uppercase font-bold">
            🧱 VAH Call Writing Wall
          </div>
          <div className="text-base font-bold text-fuchsia-300 mt-1">
            {optionChain.vahAlignedStrike.toLocaleString("en-IN")} CE
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">
            Box VAH Ceiling: ₹{purpleBox.vahResistanceCeiling.toLocaleString("en-IN")}
          </div>
        </div>

        <div className="p-3.5 rounded-xl bg-[#0d1322]/90 border border-slate-800/80">
          <div className="text-[10px] text-slate-400 uppercase">ATM IV & 25Δ Skew</div>
          <div className="text-base font-bold text-violet-300 mt-1">
            {optionChain.atmIV}% <span className="text-xs text-slate-400">(IVR {optionChain.ivRank})</span>
          </div>
          <div className="text-[10px] text-amber-300 mt-0.5">
            25Δ Put-Call Skew: {optionChain.ivSkew25DeltaPct >= 0 ? "+" : ""}
            {optionChain.ivSkew25DeltaPct}%
          </div>
        </div>

        <div className="p-3.5 rounded-xl bg-[#0d1322]/90 border border-slate-800/80">
          <div className="text-[10px] text-slate-400 uppercase">Max Pain & Expiry</div>
          <div className="text-base font-bold text-amber-400 mt-1">
            ₹{optionChain.maxPainStrike.toLocaleString("en-IN")}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">
            {optionChain.expiryDate} ({optionChain.daysToExpiry} DTE)
          </div>
        </div>
      </div>

      {/* Option Chain & Institutional Strike Alignment Table */}
      <div className="rounded-2xl bg-[#0d1322]/95 border border-slate-800/80 overflow-hidden shadow-xl">
        <div className="px-4 py-3 border-b border-slate-800/80 bg-slate-900/60 flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-cyan-400" />
            <span className="font-bold text-slate-100">
              INSTITUTIONAL OPTION CHAIN, GREEKS & PURPLE BOX OI WALL ALIGNMENT — {activeSetup.cleanSymbol}
            </span>
          </div>
          <div className="flex items-center gap-3 text-[11px]">
            <span className="inline-flex items-center gap-1 text-emerald-300">
              <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500/40 border border-emerald-400" />
              VAL Put Support Wall
            </span>
            <span className="inline-flex items-center gap-1 text-fuchsia-300">
              <span className="w-2.5 h-2.5 rounded-sm bg-fuchsia-500/40 border border-fuchsia-400" />
              VAH Call Resistance Wall
            </span>
            <span className="inline-flex items-center gap-1 text-cyan-300">
              <span className="w-2.5 h-2.5 rounded-sm bg-cyan-500/40 border border-cyan-400" />
              Matched Spread Leg
            </span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-center border-collapse font-mono text-xs">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/80 text-[10px] uppercase text-slate-400">
                <th
                  colSpan={showFullGreeks ? 6 : 4}
                  className="py-2 px-3 text-amber-300 border-r border-slate-800 bg-amber-950/15"
                >
                  CALLS (CE) — Resistance & Upside Momentum
                </th>
                <th className="py-2 px-3 text-slate-200 bg-slate-900">
                  STRIKE & CONFLUENCE
                </th>
                <th
                  colSpan={showFullGreeks ? 6 : 4}
                  className="py-2 px-3 text-emerald-300 border-l border-slate-800 bg-emerald-950/15"
                >
                  PUTS (PE) — Support Defense & Put Writing
                </th>
              </tr>
              <tr className="border-b border-slate-800/80 bg-slate-950/60 text-[10px] text-slate-400">
                <th className="py-2 px-2 text-left">Buildup</th>
                <th className="py-2 px-2 text-right">OI (Shares)</th>
                <th className="py-2 px-2 text-right">ΔOI %</th>
                {showFullGreeks && (
                  <>
                    <th className="py-2 px-2 text-right">IV %</th>
                    <th className="py-2 px-2 text-right">Δ / Θ</th>
                  </>
                )}
                <th className="py-2 px-2.5 text-right border-r border-slate-800 text-amber-300">
                  CE LTP
                </th>

                {/* Center Strike Column */}
                <th className="py-2 px-3 bg-slate-900/90 text-slate-100">
                  Strike / Zone
                </th>

                <th className="py-2 px-2.5 text-left border-l border-slate-800 text-emerald-300">
                  PE LTP
                </th>
                {showFullGreeks && (
                  <>
                    <th className="py-2 px-2 text-left">Δ / Θ</th>
                    <th className="py-2 px-2 text-left">IV %</th>
                  </>
                )}
                <th className="py-2 px-2 text-left">ΔOI %</th>
                <th className="py-2 px-2 text-left">OI (Shares)</th>
                <th className="py-2 px-2 text-right">Buildup</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {visibleStrikes.map((row) => {
                const ceOIWidth = Math.min(100, Math.round((row.ceOI / maxCallOI) * 100));
                const peOIWidth = Math.min(100, Math.round((row.peOI / maxPutOI) * 100));
                const isCESpreadLeg = activeLegStrikes.has(`${row.strike}-CE`);
                const isPESpreadLeg = activeLegStrikes.has(`${row.strike}-PE`);

                let rowHighlightClass = "hover:bg-slate-900/50";
                if (row.alignsWithVALSupport) {
                  rowHighlightClass = "bg-emerald-950/25 hover:bg-emerald-950/35";
                } else if (row.alignsWithVAHResistance) {
                  rowHighlightClass = "bg-fuchsia-950/25 hover:bg-fuchsia-950/35";
                } else if (row.isATM) {
                  rowHighlightClass = "bg-cyan-950/25 hover:bg-cyan-950/35";
                }

                return (
                  <tr key={row.strike} className={`transition-colors ${rowHighlightClass}`}>
                    {/* CE Buildup */}
                    <td className="py-2.5 px-2 text-left">{getBuildupBadge(row.ceBuildupType)}</td>

                    {/* CE OI with visual bar */}
                    <td className="py-2.5 px-2 text-right min-w-[115px]">
                      <div className="text-[11px] font-semibold text-slate-200">
                        {row.ceOI.toLocaleString("en-IN")}
                      </div>
                      <div className="w-full h-1.5 rounded-full bg-slate-800 mt-1 overflow-hidden flex justify-end">
                        <div
                          className="h-full bg-amber-500/70 rounded-full"
                          style={{ width: `${ceOIWidth}%` }}
                        />
                      </div>
                    </td>

                    {/* CE Change in OI % */}
                    <td
                      className={`py-2.5 px-2 text-right font-bold text-[11px] ${
                        row.ceChangeInOIPct >= 20
                          ? "text-fuchsia-300"
                          : row.ceChangeInOIPct >= 0
                          ? "text-amber-300"
                          : "text-slate-400"
                      }`}
                    >
                      {row.ceChangeInOIPct >= 0 ? "+" : ""}
                      {row.ceChangeInOIPct}%
                    </td>

                    {showFullGreeks && (
                      <>
                        <td className="py-2.5 px-2 text-right text-slate-300 text-[11px]">
                          {row.ceIV}%
                        </td>
                        <td className="py-2.5 px-2 text-right text-[10px] text-slate-400">
                          <span className="text-cyan-300">{row.ceDelta.toFixed(2)}</span> /{" "}
                          <span className="text-rose-400">{row.ceTheta}</span>
                        </td>
                      </>
                    )}

                    {/* CE LTP */}
                    <td
                      className={`py-2.5 px-2.5 text-right font-bold border-r border-slate-800 ${
                        isCESpreadLeg
                          ? "bg-cyan-500/20 text-cyan-200 ring-1 ring-inset ring-cyan-400"
                          : "text-amber-300"
                      }`}
                    >
                      ₹{row.ceLTP.toFixed(2)}
                      {isCESpreadLeg && (
                        <span className="block text-[9px] text-cyan-300 uppercase">Spread Leg</span>
                      )}
                    </td>

                    {/* Center Strike & Institutional Alignment Tag */}
                    <td className="py-2.5 px-3 bg-slate-900/90 min-w-[175px]">
                      <div className="font-bold text-slate-100 text-sm flex items-center justify-center gap-1.5">
                        <span>{row.strike.toLocaleString("en-IN")}</span>
                        <span className="text-[10px] text-slate-400">
                          ({row.distanceFromSpotPct >= 0 ? "+" : ""}
                          {row.distanceFromSpotPct}%)
                        </span>
                      </div>

                      {row.alignsWithVALSupport && (
                        <span className="inline-block mt-0.5 px-2 py-0.5 rounded bg-emerald-500/25 text-emerald-200 border border-emerald-400/60 text-[9px] font-extrabold shadow-[0_0_14px_rgba(16,185,129,0.35)]">
                          🛡️ VAL SUPPORT + PUT WALL
                        </span>
                      )}
                      {row.alignsWithVAHResistance && (
                        <span className="inline-block mt-0.5 px-2 py-0.5 rounded bg-fuchsia-500/25 text-fuchsia-200 border border-fuchsia-400/60 text-[9px] font-extrabold shadow-[0_0_14px_rgba(217,70,239,0.35)]">
                          🧱 VAH CEILING + CALL WALL
                        </span>
                      )}
                      {row.isATM && !row.alignsWithVALSupport && !row.alignsWithVAHResistance && (
                        <span className="inline-block mt-0.5 px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 text-[9px] font-bold">
                          ⚡ ATM SPOT STRIKE
                        </span>
                      )}
                    </td>

                    {/* PE LTP */}
                    <td
                      className={`py-2.5 px-2.5 text-left font-bold border-l border-slate-800 ${
                        isPESpreadLeg
                          ? "bg-cyan-500/20 text-cyan-200 ring-1 ring-inset ring-cyan-400"
                          : "text-emerald-300"
                      }`}
                    >
                      ₹{row.peLTP.toFixed(2)}
                      {isPESpreadLeg && (
                        <span className="block text-[9px] text-cyan-300 uppercase">Spread Leg</span>
                      )}
                    </td>

                    {showFullGreeks && (
                      <>
                        <td className="py-2.5 px-2 text-left text-[10px] text-slate-400">
                          <span className="text-amber-300">{row.peDelta.toFixed(2)}</span> /{" "}
                          <span className="text-rose-400">{row.peTheta}</span>
                        </td>
                        <td className="py-2.5 px-2 text-left text-slate-300 text-[11px]">
                          {row.peIV}%
                        </td>
                      </>
                    )}

                    {/* PE Change in OI % */}
                    <td
                      className={`py-2.5 px-2 text-left font-bold text-[11px] ${
                        row.peChangeInOIPct >= 20
                          ? "text-emerald-300"
                          : row.peChangeInOIPct >= 0
                          ? "text-cyan-300"
                          : "text-slate-400"
                      }`}
                    >
                      {row.peChangeInOIPct >= 0 ? "+" : ""}
                      {row.peChangeInOIPct}%
                    </td>

                    {/* PE OI with visual bar */}
                    <td className="py-2.5 px-2 text-left min-w-[115px]">
                      <div className="text-[11px] font-semibold text-slate-200">
                        {row.peOI.toLocaleString("en-IN")}
                      </div>
                      <div className="w-full h-1.5 rounded-full bg-slate-800 mt-1 overflow-hidden">
                        <div
                          className="h-full bg-emerald-500/70 rounded-full"
                          style={{ width: `${peOIWidth}%` }}
                        />
                      </div>
                    </td>

                    {/* PE Buildup */}
                    <td className="py-2.5 px-2 text-right">{getBuildupBadge(row.peBuildupType)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

