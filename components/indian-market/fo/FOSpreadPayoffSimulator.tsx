"use client";

import React, { useState, useMemo } from "react";
import {
  Sliders,
  ShieldCheck,
  AlertTriangle,
  Zap,
  CheckCircle2,
  TrendingUp,
  Layers,
  Lock,
} from "lucide-react";
import type {
  FOScannerSetup,
  FOStrategyCode,
  FOSpreadLeg,
  FOPayoffPoint,
} from "./types";
import {
  FO_UNIVERSE,
  FO_MAX_SINGLE_SPREAD_MARGIN_PCT,
  buildStrategyLegsAndDetails,
  calculateSpreadPayoffAndMargin,
} from "@/lib/indian/foQuantEngine";

interface FOSpreadPayoffSimulatorProps {
  setups: FOScannerSetup[];
  activeSetup: FOScannerSetup;
  deskCapitalINR: number;
  currentMarginUsedINR: number;
  onSelectSetup: (setup: FOScannerSetup) => void;
  onDeploySimulatedSpread: (
    setup: FOScannerSetup,
    strategyCode: FOStrategyCode,
    strategyName: string,
    legs: FOSpreadLeg[],
    lotsMultiplier: number
  ) => void;
}

const ALL_STRATEGIES: { code: FOStrategyCode; label: string; regimeTag: string }[] = [
  {
    code: "HEDGED_IRON_CONDOR",
    label: "Hedged Iron Condor (4-Leg Defined Risk)",
    regimeTag: "RANGE BOUND",
  },
  {
    code: "DEFINED_RISK_SHORT_STRADDLE",
    label: "Short Straddle w/ Defined Risk Wings",
    regimeTag: "RANGE BOUND (POC PIN)",
  },
  {
    code: "BULL_PUT_CREDIT_SPREAD",
    label: "Bull Put Credit Spread (OTM Put + Wing)",
    regimeTag: "VAL SUPPORT BOUNCE",
  },
  {
    code: "BULL_CALL_DEBIT_SPREAD",
    label: "Bull Call Debit Spread (ATM + OTM Cap)",
    regimeTag: "VAH BREAKOUT + DOJI",
  },
  {
    code: "CALL_RATIO_BACKSPREAD",
    label: "1:2 Call Ratio Spread (Low Outlay)",
    regimeTag: "BREAKOUT SQUEEZE",
  },
];

export default function FOSpreadPayoffSimulator({
  setups,
  activeSetup,
  deskCapitalINR,
  currentMarginUsedINR,
  onSelectSetup,
  onDeploySimulatedSpread,
}: FOSpreadPayoffSimulatorProps) {
  const [selectedStrategy, setSelectedStrategy] = useState<FOStrategyCode>(
    activeSetup.strategyCode
  );
  const [lotsMultiplier, setLotsMultiplier] = useState<number>(1);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  // Sync strategy when user switches underlying symbol from parent
  const [prevSymbol, setPrevSymbol] = useState(activeSetup.cleanSymbol);
  if (activeSetup.cleanSymbol !== prevSymbol) {
    setPrevSymbol(activeSetup.cleanSymbol);
    setSelectedStrategy(activeSetup.strategyCode);
    setLotsMultiplier(1);
    setHoverIdx(null);
  }

  const spec = useMemo(() => {
    return (
      FO_UNIVERSE.find((u) => u.cleanSymbol === activeSetup.cleanSymbol) ||
      FO_UNIVERSE[0]
    );
  }, [activeSetup.cleanSymbol]);

  const simulated = useMemo(() => {
    const built = buildStrategyLegsAndDetails(
      selectedStrategy,
      spec,
      activeSetup.spotPrice,
      activeSetup.purpleBox,
      activeSetup.optionChain,
      lotsMultiplier
    );
    const metrics = calculateSpreadPayoffAndMargin(
      built.legs,
      activeSetup.spotPrice,
      activeSetup.purpleBox,
      spec,
      activeSetup.daysToExpiry,
      deskCapitalINR
    );
    return { ...built, metrics };
  }, [selectedStrategy, spec, activeSetup, lotsMultiplier, deskCapitalINR]);

  const { metrics, legs } = simulated;
  const curve = metrics.payoffCurve;

  // SVG Chart Geometry
  const svgW = 820;
  const svgH = 290;
  const padL = 68;
  const padR = 28;
  const padT = 26;
  const padB = 38;
  const plotW = svgW - padL - padR;
  const plotH = svgH - padT - padB;

  const minPrice = curve[0]?.underlyingPrice || activeSetup.spotPrice * 0.9;
  const maxPrice =
    curve[curve.length - 1]?.underlyingPrice || activeSetup.spotPrice * 1.1;

  const maxAbsPayoff = Math.max(
    Math.abs(metrics.maxProfitINR),
    Math.abs(metrics.maxLossINR),
    1000
  ) * 1.18;

  const priceToX = (p: number) =>
    padL + ((p - minPrice) / Math.max(maxPrice - minPrice, 1)) * plotW;
  const payoffToY = (pnl: number) =>
    padT + ((maxAbsPayoff - pnl) / (2 * maxAbsPayoff)) * plotH;

  const zeroY = payoffToY(0);
  const spotX = priceToX(activeSetup.spotPrice);
  const valX = priceToX(activeSetup.purpleBox.valSupportFloor);
  const vahX = priceToX(activeSetup.purpleBox.vahResistanceCeiling);

  const polylinePoints = curve
    .map((pt) => `${priceToX(pt.underlyingPrice).toFixed(1)},${payoffToY(pt.netPayoffINR).toFixed(1)}`)
    .join(" ");

  const areaPolygonPoints = `${priceToX(curve[0].underlyingPrice).toFixed(1)},${zeroY.toFixed(1)} ${polylinePoints} ${priceToX(curve[curve.length - 1].underlyingPrice).toFixed(1)},${zeroY.toFixed(1)}`;

  const hoveredPoint: FOPayoffPoint | null =
    hoverIdx !== null && curve[hoverIdx] ? curve[hoverIdx] : null;

  const projectedTotalDeskMarginPct =
    Math.round(
      ((currentMarginUsedINR + metrics.estimatedMarginRequiredINR) /
        Math.max(deskCapitalINR, 1)) *
        1000
    ) / 10;

  const exceedsSingleSpreadCap = !metrics.isWithinMarginLimit;
  const exceedsTotalDeskCap = projectedTotalDeskMarginPct > 65;

  return (
    <div className="space-y-4 font-mono">
      {/* Top Control Bar: Contract, Strategy Matcher Override, and Lot Size Controls */}
      <div className="p-4 rounded-2xl bg-[#0d1322]/95 border border-slate-800/80 grid grid-cols-1 md:grid-cols-3 xl:grid-cols-4 gap-4 items-end">
        {/* 1. Underlying Selector */}
        <div>
          <label className="block text-[10px] uppercase text-slate-400 mb-1">
            1. F&O Derivative Contract
          </label>
          <select
            value={activeSetup.cleanSymbol}
            onChange={(e) => {
              const found = setups.find((s) => s.cleanSymbol === e.target.value);
              if (found) onSelectSetup(found);
            }}
            className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs font-bold text-slate-100 focus:outline-none focus:border-violet-500"
          >
            {setups.map((s) => (
              <option key={s.cleanSymbol} value={s.cleanSymbol}>
                {s.cleanSymbol} ({s.instrumentType}) — Spot ₹{s.spotPrice.toLocaleString("en-IN")} | Lot {s.lotSize}
              </option>
            ))}
          </select>
        </div>

        {/* 2. Strategy Selector */}
        <div className="md:col-span-1 xl:col-span-2">
          <div className="flex items-center justify-between mb-1">
            <label className="text-[10px] uppercase text-slate-400">
              2. Multi-Leg F&O Strategy (Auto-Matched: {activeSetup.strategyCode.replace(/_/g, " ")})
            </label>
            {selectedStrategy === activeSetup.strategyCode && (
              <span className="text-[10px] text-emerald-400 font-bold">
                ✓ Matched to {activeSetup.marketRegime}
              </span>
            )}
          </div>
          <select
            value={selectedStrategy}
            onChange={(e) => setSelectedStrategy(e.target.value as FOStrategyCode)}
            className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-violet-500/50 text-xs font-bold text-violet-200 focus:outline-none"
          >
            {ALL_STRATEGIES.map((st) => (
              <option key={st.code} value={st.code}>
                [{st.regimeTag}] {st.label}
              </option>
            ))}
          </select>
        </div>

        {/* 3. Lot Size Multiplier & Risk Enforcer */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[10px] uppercase text-slate-400">
              3. Lot Sizing (1 Lot = {activeSetup.lotSize} qty)
            </label>
            <span className="text-[10px] text-cyan-400">
              Max Safe: {metrics.maxAllowedLotsByRisk} Lots
            </span>
          </div>
          <div className="flex items-center gap-2">
            {[1, 2, 3, 5, 8].map((lotCount) => (
              <button
                key={lotCount}
                onClick={() => setLotsMultiplier(lotCount)}
                className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all ${
                  lotsMultiplier === lotCount
                    ? "bg-violet-600 text-white border-violet-400 shadow-sm"
                    : lotCount > metrics.maxAllowedLotsByRisk
                    ? "bg-rose-950/30 text-rose-400 border-rose-500/30 hover:bg-rose-950/50"
                    : "bg-slate-900 text-slate-300 border-slate-800 hover:bg-slate-800"
                }`}
              >
                {lotCount}L
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Risk & Margin Limit Warning / Approval Banner */}
      <div
        className={`p-3.5 rounded-2xl border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${
          exceedsSingleSpreadCap || exceedsTotalDeskCap
            ? "bg-rose-950/30 border-rose-500/50 text-rose-200"
            : "bg-emerald-950/20 border-emerald-500/30 text-emerald-200"
        }`}
      >
        <div className="flex items-center gap-2.5">
          {exceedsSingleSpreadCap || exceedsTotalDeskCap ? (
            <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
          ) : (
            <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0" />
          )}
          <div className="text-xs">
            <div className="font-bold">
              {exceedsSingleSpreadCap
                ? `RISK LIMIT BREACH: Spread uses ${metrics.marginUtilizationPct}% of Desk Capital (Max allowed per spread is ${FO_MAX_SINGLE_SPREAD_MARGIN_PCT}%). Reduce lots to ≤ ${metrics.maxAllowedLotsByRisk}L.`
                : exceedsTotalDeskCap
                ? `PORTFOLIO MARGIN ALERT: Total F&O Margin Utilization would reach ${projectedTotalDeskMarginPct}% (65% Institutional Hard Cap).`
                : `INSTITUTIONAL MARGIN CHECK PASSED: ${lotsMultiplier} Lot(s) (${lotsMultiplier * activeSetup.lotSize} qty) requires ₹${metrics.estimatedMarginRequiredINR.toLocaleString("en-IN")} (${metrics.marginUtilizationPct}% of ₹${(deskCapitalINR / 100000).toFixed(1)}L Desk Capital).`}
            </div>
            <div className="text-[11px] opacity-80 mt-0.5">
              Naked SPAN Margin: ₹{metrics.nakedMarginWithoutHedgeINR.toLocaleString("en-IN")} → Hedged Spread Margin: ₹{metrics.estimatedMarginRequiredINR.toLocaleString("en-IN")} ({metrics.hedgeMarginBenefitPct}% Margin Reduction Benefit)
            </div>
          </div>
        </div>

        <button
          onClick={() =>
            onDeploySimulatedSpread(
              activeSetup,
              simulated.strategyCode,
              simulated.strategyName,
              legs,
              lotsMultiplier
            )
          }
          disabled={exceedsSingleSpreadCap || exceedsTotalDeskCap}
          className={`px-4 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 shrink-0 transition-all ${
            exceedsSingleSpreadCap || exceedsTotalDeskCap
              ? "bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed"
              : "bg-gradient-to-r from-emerald-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 text-white shadow-lg shadow-emerald-600/20"
          }`}
        >
          <Zap className="w-4 h-4" />
          <span>
            Execute {lotsMultiplier} Lot{lotsMultiplier > 1 ? "s" : ""} Spread (Lock LTP)
          </span>
        </button>
      </div>

      {/* Main Grid: Payoff Chart (Left 7 cols) + KPI & Leg Breakdown (Right 5 cols) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        {/* Left: Interactive SVG Expiry Payoff Diagram */}
        <div className="xl:col-span-7 p-4 rounded-2xl bg-[#0d1322]/95 border border-slate-800/80 flex flex-col justify-between">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div>
              <h3 className="text-sm font-bold text-slate-100">
                EXPIRY PAYOFF DIAGRAM — {simulated.strategyName}
              </h3>
              <p className="text-[11px] text-slate-400">
                Purple Box Zone: VAL ₹{activeSetup.purpleBox.valSupportFloor.toLocaleString("en-IN")} ↔ VAH ₹{activeSetup.purpleBox.vahResistanceCeiling.toLocaleString("en-IN")}
              </p>
            </div>

            {hoveredPoint ? (
              <div className="px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-700 text-xs flex items-center gap-3">
                <span>
                  Expiry:{" "}
                  <strong className="text-slate-100">
                    ₹{hoveredPoint.underlyingPrice.toLocaleString("en-IN")}
                  </strong>{" "}
                  ({hoveredPoint.movePct >= 0 ? "+" : ""}
                  {hoveredPoint.movePct}%)
                </span>
                <span
                  className={`font-bold ${
                    hoveredPoint.netPayoffINR >= 0 ? "text-emerald-400" : "text-rose-400"
                  }`}
                >
                  P&L: {hoveredPoint.netPayoffINR >= 0 ? "+" : ""}₹
                  {hoveredPoint.netPayoffINR.toLocaleString("en-IN")}
                </span>
              </div>
            ) : (
              <div className="text-[11px] text-slate-500">
                Hover over curve to inspect expiry P&L
              </div>
            )}
          </div>

          {/* Interactive SVG Payoff Plot */}
          <div className="w-full overflow-x-auto">
            <svg
              viewBox={`0 0 ${svgW} ${svgH}`}
              className="w-full h-auto select-none bg-slate-950/70 rounded-xl border border-slate-800/80"
              onMouseLeave={() => setHoverIdx(null)}
            >
              <defs>
                <clipPath id="above-zero-clip">
                  <rect x={padL} y={padT} width={plotW} height={Math.max(0, zeroY - padT)} />
                </clipPath>
                <clipPath id="below-zero-clip">
                  <rect
                    x={padL}
                    y={zeroY}
                    width={plotW}
                    height={Math.max(0, svgH - padB - zeroY)}
                  />
                </clipPath>
              </defs>

              {/* Shaded Purple Box Zone between VAL and VAH */}
              {valX >= padL && vahX <= svgW - padR && vahX > valX && (
                <g>
                  <rect
                    x={valX}
                    y={padT}
                    width={vahX - valX}
                    height={plotH}
                    fill="rgba(168, 85, 247, 0.08)"
                    stroke="rgba(168, 85, 247, 0.35)"
                    strokeDasharray="4 4"
                  />
                  <text
                    x={(valX + vahX) / 2}
                    y={padT + 14}
                    textAnchor="middle"
                    fill="#d8b4fe"
                    fontSize="10"
                    fontWeight="bold"
                  >
                    PURPLE BOX (VAL ↔ VAH)
                  </text>
                </g>
              )}

              {/* Profit Area Fill (Above Zero) */}
              <polygon
                points={areaPolygonPoints}
                className="fill-emerald-500/20"
                clipPath="url(#above-zero-clip)"
              />

              {/* Loss Area Fill (Below Zero) */}
              <polygon
                points={areaPolygonPoints}
                className="fill-rose-500/20"
                clipPath="url(#below-zero-clip)"
              />

              {/* Zero P&L Baseline */}
              <line
                x1={padL}
                y1={zeroY}
                x2={svgW - padR}
                y2={zeroY}
                stroke="#64748b"
                strokeWidth="1.2"
                strokeDasharray="3 3"
              />
              <text x={padL - 8} y={zeroY + 4} textAnchor="end" fill="#94a3b8" fontSize="10">
                ₹0
              </text>

              {/* Spot Price Marker */}
              <line
                x1={spotX}
                y1={padT}
                x2={spotX}
                y2={svgH - padB}
                stroke="#38bdf8"
                strokeWidth="1.5"
                strokeDasharray="4 3"
              />
              <text
                x={spotX}
                y={svgH - padB + 15}
                textAnchor="middle"
                fill="#38bdf8"
                fontSize="10"
                fontWeight="bold"
              >
                Spot ₹{activeSetup.spotPrice.toLocaleString("en-IN")}
              </text>

              {/* Lower Breakeven Marker */}
              {metrics.lowerBreakeven >= minPrice && metrics.lowerBreakeven <= maxPrice && (
                <g>
                  <circle
                    cx={priceToX(metrics.lowerBreakeven)}
                    cy={zeroY}
                    r="4.5"
                    fill="#fbbf24"
                    stroke="#0f172a"
                    strokeWidth="1.5"
                  />
                  <text
                    x={priceToX(metrics.lowerBreakeven)}
                    y={zeroY - 8}
                    textAnchor="middle"
                    fill="#fbbf24"
                    fontSize="9.5"
                    fontWeight="bold"
                  >
                    BE ₹{metrics.lowerBreakeven.toLocaleString("en-IN")}
                  </text>
                </g>
              )}

              {/* Upper Breakeven Marker */}
              {metrics.upperBreakeven &&
                metrics.upperBreakeven >= minPrice &&
                metrics.upperBreakeven <= maxPrice && (
                  <g>
                    <circle
                      cx={priceToX(metrics.upperBreakeven)}
                      cy={zeroY}
                      r="4.5"
                      fill="#fbbf24"
                      stroke="#0f172a"
                      strokeWidth="1.5"
                    />
                    <text
                      x={priceToX(metrics.upperBreakeven)}
                      y={zeroY - 8}
                      textAnchor="middle"
                      fill="#fbbf24"
                      fontSize="9.5"
                      fontWeight="bold"
                    >
                      BE ₹{metrics.upperBreakeven.toLocaleString("en-IN")}
                    </text>
                  </g>
                )}

              {/* Payoff Curve Line */}
              <polyline
                fill="none"
                stroke="#e2e8f0"
                strokeWidth="2.4"
                points={polylinePoints}
              />

              {/* Y-Axis Max Profit & Max Loss Labels */}
              <text
                x={padL - 8}
                y={payoffToY(metrics.maxProfitINR) + 4}
                textAnchor="end"
                fill="#34d399"
                fontSize="10"
                fontWeight="bold"
              >
                +₹{metrics.maxProfitINR.toLocaleString("en-IN")}
              </text>
              {metrics.maxLossINR > 0 && (
                <text
                  x={padL - 8}
                  y={payoffToY(-metrics.maxLossINR) + 4}
                  textAnchor="end"
                  fill="#fb7185"
                  fontSize="10"
                  fontWeight="bold"
                >
                  -₹{metrics.maxLossINR.toLocaleString("en-IN")}
                </text>
              )}

              {/* Hover Crosshair & Point */}
              {hoveredPoint && (
                <g>
                  <line
                    x1={priceToX(hoveredPoint.underlyingPrice)}
                    y1={padT}
                    x2={priceToX(hoveredPoint.underlyingPrice)}
                    y2={svgH - padB}
                    stroke="#94a3b8"
                    strokeWidth="1"
                  />
                  <circle
                    cx={priceToX(hoveredPoint.underlyingPrice)}
                    cy={payoffToY(hoveredPoint.netPayoffINR)}
                    r="5"
                    fill={hoveredPoint.netPayoffINR >= 0 ? "#10b981" : "#f43f5e"}
                    stroke="#ffffff"
                    strokeWidth="1.5"
                  />
                </g>
              )}

              {/* Invisible Hover Columns */}
              {curve.map((pt, idx) => {
                const colW = plotW / curve.length;
                return (
                  <rect
                    key={pt.underlyingPrice}
                    x={padL + idx * colW}
                    y={padT}
                    width={colW + 1}
                    height={plotH}
                    fill="transparent"
                    onMouseEnter={() => setHoverIdx(idx)}
                  />
                );
              })}
            </svg>
          </div>

          {/* Bottom Legend */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-3 text-[11px] text-slate-400">
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1.5 text-emerald-400">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> Profit Zone
              </span>
              <span className="flex items-center gap-1.5 text-rose-400">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-500" /> Defined Risk Zone
              </span>
              <span className="flex items-center gap-1.5 text-amber-400">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-400" /> Breakeven Point(s)
              </span>
            </div>
            <div className="text-violet-300">
              {simulated.strategyThesis}
            </div>
          </div>
        </div>

        {/* Right: Payoff KPIs, Greeks & Multi-Leg Breakdown */}
        <div className="xl:col-span-5 space-y-4">
          {/* 6 KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="p-3 rounded-xl bg-[#0d1322]/95 border border-emerald-500/30">
              <div className="text-[10px] text-slate-400 uppercase">Max Profit</div>
              <div className="text-base font-bold text-emerald-400 mt-1">
                +₹{metrics.maxProfitINR.toLocaleString("en-IN")}
              </div>
              <div className="text-[10px] text-emerald-500 mt-0.5">
                +{metrics.maxProfitPctOnMargin}% ROI on Margin
              </div>
            </div>

            <div className="p-3 rounded-xl bg-[#0d1322]/95 border border-rose-500/30">
              <div className="text-[10px] text-slate-400 uppercase">Max Defined Loss</div>
              <div className="text-base font-bold text-rose-400 mt-1">
                -₹{metrics.maxLossINR.toLocaleString("en-IN")}
              </div>
              <div className="text-[10px] text-rose-400/80 mt-0.5">
                -{metrics.maxLossPctOnMargin}% of Margin
              </div>
            </div>

            <div className="p-3 rounded-xl bg-[#0d1322]/95 border border-cyan-500/30">
              <div className="text-[10px] text-slate-400 uppercase">Prob. of Profit</div>
              <div className="text-base font-bold text-cyan-300 mt-1">
                {metrics.probabilityOfProfitPct}%
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">
                R:R = 1 : {metrics.rewardToRiskRatio}
              </div>
            </div>

            <div className="p-3 rounded-xl bg-[#0d1322]/95 border border-slate-800">
              <div className="text-[10px] text-slate-400 uppercase">Breakeven Zone</div>
              <div className="text-xs font-bold text-amber-300 mt-1">
                ₹{metrics.lowerBreakeven.toLocaleString("en-IN")}
                {metrics.upperBreakeven
                  ? ` ↔ ₹${metrics.upperBreakeven.toLocaleString("en-IN")}`
                  : "+"}
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">
                Spot: ₹{activeSetup.spotPrice.toLocaleString("en-IN")}
              </div>
            </div>

            <div className="p-3 rounded-xl bg-[#0d1322]/95 border border-slate-800">
              <div className="text-[10px] text-slate-400 uppercase">
                Net {metrics.isNetCredit ? "Credit" : "Debit"}
              </div>
              <div
                className={`text-sm font-bold mt-1 ${
                  metrics.isNetCredit ? "text-emerald-400" : "text-amber-400"
                }`}
              >
                {metrics.isNetCredit ? "+" : "-"}₹
                {Math.abs(metrics.netPremiumTotalINR).toLocaleString("en-IN")}
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">
                ₹{Math.abs(metrics.netPremiumPerUnit)} / unit
              </div>
            </div>

            <div className="p-3 rounded-xl bg-[#0d1322]/95 border border-violet-500/30">
              <div className="text-[10px] text-slate-400 uppercase">Net Greeks (Position)</div>
              <div className="text-xs font-bold text-slate-200 mt-1">
                Δ {metrics.netGreeks.delta} | Θ{" "}
                <span
                  className={
                    metrics.netGreeks.thetaINRPerDay >= 0
                      ? "text-emerald-400"
                      : "text-rose-400"
                  }
                >
                  {metrics.netGreeks.thetaINRPerDay >= 0 ? "+" : ""}₹
                  {metrics.netGreeks.thetaINRPerDay}/d
                </span>
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">
                Vega: ₹{metrics.netGreeks.vegaINRPerPct}/1% IV
              </div>
            </div>
          </div>

          {/* Multi-Leg Execution Specification Table */}
          <div className="rounded-2xl bg-[#0d1322]/95 border border-slate-800/80 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-slate-800 bg-slate-900/60 flex items-center justify-between text-xs">
              <span className="font-bold text-slate-200">
                SPREAD LEG SPECIFICATION ({legs.length} Legs)
              </span>
              <span className="text-[11px] text-slate-400">
                Expiry: {activeSetup.expiryDate}
              </span>
            </div>
            <div className="divide-y divide-slate-800/60">
              {legs.map((leg) => (
                <div
                  key={leg.legId}
                  className="p-3 flex items-center justify-between gap-2 text-xs"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                          leg.action === "BUY"
                            ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                            : "bg-rose-500/20 text-rose-300 border-rose-500/40"
                        }`}
                      >
                        {leg.action}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-extrabold border ${
                          leg.action === "BUY"
                            ? "bg-emerald-950/90 text-emerald-200 border-emerald-500/40"
                            : "bg-rose-950/90 text-rose-200 border-rose-500/40"
                        }`}
                      >
                        {leg.strike.toLocaleString("en-IN")} {leg.right}
                      </span>
                      <span className="text-slate-400 text-[11px]">
                        ({leg.lots} Lot × {leg.lotSize} = {leg.lots * leg.lotSize} qty)
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-400 mt-0.5">
                      {leg.roleLabel} · IV {leg.iv}% · Δ {leg.delta} · Θ {leg.theta}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold text-slate-100">₹{leg.premium.toFixed(2)}</div>
                    <div className="text-[10px] text-slate-400">
                      ₹{Math.round(leg.premium * leg.lots * leg.lotSize).toLocaleString("en-IN")}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

