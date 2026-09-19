"use client";

import React, { useState } from "react";
import IMHeader from "./IMHeader";
import IMStatusBadge from "./IMStatusBadge";

// ── Mock Option Chain data ───────────────────────────────────────────────────
const ATM_STRIKE = 24700;
const SPOT = 24700.45;
const EXPIRIES = ["26 Sep 2026", "03 Oct 2026", "31 Oct 2026"];

interface OptionRow {
  strike: number;
  callOI: number;
  callOIChg: number;
  callVol: number;
  callIV: number;
  callLTP: number;
  callBid: number;
  callAsk: number;
  putBid: number;
  putAsk: number;
  putLTP: number;
  putIV: number;
  putVol: number;
  putOIChg: number;
  putOI: number;
}

function genRow(strike: number): OptionRow {
  const diff = (SPOT - strike) / 50;
  const callITM = strike < SPOT;
  return {
    strike,
    callOI: Math.round((Math.abs(diff) * 18000 + 5000) * (callITM ? 0.6 : 1.1)),
    callOIChg: Math.round((Math.random() - 0.3) * 3000),
    callVol: Math.round(Math.abs(diff) * 5000 + 1200),
    callIV: Math.round((14 + Math.abs(diff) * 0.8 + Math.random() * 0.5) * 10) / 10,
    callLTP: Math.max(5, Math.round((callITM ? SPOT - strike + 50 : Math.max(5, 250 - Math.abs(diff) * 40)) * 10) / 10),
    callBid: Math.max(4, Math.round((callITM ? SPOT - strike + 48 : Math.max(4, 248 - Math.abs(diff) * 40)) * 10) / 10),
    callAsk: Math.max(6, Math.round((callITM ? SPOT - strike + 52 : Math.max(6, 252 - Math.abs(diff) * 40)) * 10) / 10),
    putBid: Math.max(4, Math.round((!callITM ? strike - SPOT + 48 : Math.max(4, 248 - Math.abs(diff) * 40)) * 10) / 10),
    putAsk: Math.max(6, Math.round((!callITM ? strike - SPOT + 52 : Math.max(6, 252 - Math.abs(diff) * 40)) * 10) / 10),
    putLTP: Math.max(5, Math.round((!callITM ? strike - SPOT + 50 : Math.max(5, 250 - Math.abs(diff) * 40)) * 10) / 10),
    putIV: Math.round((14.5 + Math.abs(diff) * 0.9 + Math.random() * 0.5) * 10) / 10,
    putVol: Math.round(Math.abs(diff) * 4800 + 1000),
    putOIChg: Math.round((Math.random() - 0.3) * 2800),
    putOI: Math.round((Math.abs(diff) * 16000 + 6000) * (!callITM ? 0.6 : 1.1)),
  };
}

const STRIKES = Array.from({ length: 15 }, (_, i) => ATM_STRIKE - 350 + i * 50);
const ROWS: OptionRow[] = STRIKES.map(genRow);

function fmtOI(n: number) {
  return n >= 1000 ? (n / 1000).toFixed(1) + "K" : n.toString();
}

function LiquidityDot({ vol }: { vol: number }) {
  const high = vol > 4000;
  const mid = vol > 2000;
  return (
    <span
      className={`inline-block w-1.5 h-1.5 rounded-full ${high ? "bg-emerald-400" : mid ? "bg-amber-400" : "bg-slate-600"}`}
      title={`Volume ${vol}`}
    />
  );
}

export default function IMOptionChain() {
  const [expiry, setExpiry] = useState(EXPIRIES[0]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-100 tracking-tight">OPTION CHAIN</h2>
          <p className="text-xs text-slate-400 font-mono">NSE NIFTY · All values DEMO / MOCK</p>
        </div>
        <IMStatusBadge status="DEMO" size="sm" />
      </div>

      <IMHeader />

      {/* Header info */}
      <div className="flex flex-wrap items-center gap-4 px-4 py-3 rounded-xl bg-[#11192e]/80 border border-slate-800/80 font-mono text-xs">
        <div className="flex items-center gap-1.5">
          <span className="text-slate-500">Instrument</span>
          <span className="font-bold text-slate-100">NIFTY</span>
        </div>
        <div className="w-px h-4 bg-slate-800" />
        <div className="flex items-center gap-1.5">
          <span className="text-slate-500">Spot</span>
          <span className="font-bold text-emerald-400">24,700.45</span>
        </div>
        <div className="w-px h-4 bg-slate-800" />
        <div className="flex items-center gap-1.5">
          <span className="text-slate-500">Expiry</span>
          <select
            value={expiry}
            onChange={(e) => setExpiry(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded px-2 py-0.5 text-amber-300 text-[10px] outline-none"
          >
            {EXPIRIES.map((e) => (
              <option key={e} value={e}>{e}</option>
            ))}
          </select>
        </div>
        <div className="w-px h-4 bg-slate-800" />
        <div className="flex items-center gap-1.5">
          <span className="text-slate-500">ATM Strike</span>
          <span className="font-bold text-cyan-400">{ATM_STRIKE}</span>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-[9px] font-mono text-slate-500 px-1">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-emerald-500/15 border border-emerald-500/30 inline-block" /> ATM</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-cyan-500/10 border border-cyan-500/20 inline-block" /> ITM (Calls)</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-rose-500/10 border border-rose-500/20 inline-block" /> OTM (Calls)</span>
        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" /> High Liq</span>
        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" /> Mid Liq</span>
        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-slate-600 inline-block" /> Low Liq</span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-slate-800/80">
        <table className="w-full text-[10px] font-mono whitespace-nowrap">
          <thead>
            <tr className="bg-slate-900/80 text-slate-500 uppercase tracking-wider text-[9px]">
              <th colSpan={7} className="text-center py-2 border-b border-r border-slate-800 text-cyan-500">
                ← CALLS
              </th>
              <th className="py-2 px-3 border-b border-slate-800 text-center text-amber-400 font-bold">STRIKE</th>
              <th colSpan={7} className="text-center py-2 border-b border-l border-slate-800 text-rose-500">
                PUTS →
              </th>
            </tr>
            <tr className="bg-[#0d1322] text-slate-500 uppercase tracking-wider text-[9px]">
              {/* Calls */}
              <th className="py-2 px-2 text-left border-b border-slate-800">OI</th>
              <th className="py-2 px-2 text-left border-b border-slate-800">OI Chg</th>
              <th className="py-2 px-2 text-left border-b border-slate-800">Vol</th>
              <th className="py-2 px-2 text-left border-b border-slate-800">IV%</th>
              <th className="py-2 px-2 text-left border-b border-slate-800">LTP</th>
              <th className="py-2 px-2 text-left border-b border-slate-800">Bid</th>
              <th className="py-2 px-2 text-left border-b border-r border-slate-800">Ask</th>
              {/* Strike */}
              <th className="py-2 px-3 text-center border-b border-slate-800 text-amber-400">—</th>
              {/* Puts */}
              <th className="py-2 px-2 text-left border-b border-l border-slate-800">Bid</th>
              <th className="py-2 px-2 text-left border-b border-slate-800">Ask</th>
              <th className="py-2 px-2 text-left border-b border-slate-800">LTP</th>
              <th className="py-2 px-2 text-left border-b border-slate-800">IV%</th>
              <th className="py-2 px-2 text-left border-b border-slate-800">Vol</th>
              <th className="py-2 px-2 text-left border-b border-slate-800">OI Chg</th>
              <th className="py-2 px-2 text-left border-b border-slate-800">OI</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => {
              const isATM = row.strike === ATM_STRIKE;
              const callITM = row.strike < SPOT;
              const putITM = row.strike > SPOT;
              const rowBg = isATM
                ? "bg-emerald-500/8 border-emerald-500/20"
                : callITM
                ? "bg-cyan-500/5"
                : "bg-rose-500/5";

              return (
                <tr key={row.strike} className={`border-b border-slate-800/40 hover:brightness-110 transition-all ${rowBg}`}>
                  {/* Calls */}
                  <td className="py-1.5 px-2 text-slate-300">{fmtOI(row.callOI)}</td>
                  <td className={`py-1.5 px-2 ${row.callOIChg >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                    {row.callOIChg >= 0 ? "+" : ""}{fmtOI(row.callOIChg)}
                  </td>
                  <td className="py-1.5 px-2 text-slate-300 flex items-center gap-1">
                    <LiquidityDot vol={row.callVol} />
                    {fmtOI(row.callVol)}
                  </td>
                  <td className="py-1.5 px-2 text-violet-400">{row.callIV}%</td>
                  <td className="py-1.5 px-2 font-semibold text-slate-100">{row.callLTP}</td>
                  <td className="py-1.5 px-2 text-slate-400">{row.callBid}</td>
                  <td className="py-1.5 px-2 text-slate-400 border-r border-slate-800/40">{row.callAsk}</td>
                  {/* Strike */}
                  <td className={`py-1.5 px-3 text-center font-bold border-x border-slate-800/40 ${isATM ? "text-emerald-300" : "text-amber-300"}`}>
                    {row.strike.toLocaleString("en-IN")}
                    {isATM && <span className="ml-1 text-[8px] text-emerald-400">ATM</span>}
                    {callITM && !isATM && <span className="ml-1 text-[8px] text-cyan-500">ITM</span>}
                    {putITM && !isATM && <span className="ml-1 text-[8px] text-rose-500">OTM</span>}
                  </td>
                  {/* Puts */}
                  <td className="py-1.5 px-2 text-slate-400 border-l border-slate-800/40">{row.putBid}</td>
                  <td className="py-1.5 px-2 text-slate-400">{row.putAsk}</td>
                  <td className="py-1.5 px-2 font-semibold text-slate-100">{row.putLTP}</td>
                  <td className="py-1.5 px-2 text-violet-400">{row.putIV}%</td>
                  <td className="py-1.5 px-2 text-slate-300 flex items-center gap-1">
                    <LiquidityDot vol={row.putVol} />
                    {fmtOI(row.putVol)}
                  </td>
                  <td className={`py-1.5 px-2 ${row.putOIChg >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                    {row.putOIChg >= 0 ? "+" : ""}{fmtOI(row.putOIChg)}
                  </td>
                  <td className="py-1.5 px-2 text-slate-300">{fmtOI(row.putOI)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="text-[9px] text-slate-600 font-mono text-center">
        ⚠ DEMO DATA — No live option chain API connected. OI, IV, and LTP values are simulated.
      </div>
    </div>
  );
}
