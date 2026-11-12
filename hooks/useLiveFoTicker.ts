"use client";

/**
 * useLiveFoTicker
 * ─────────────────────────────────────────────────────────────────────────────
 * Real-time F&O tick engine for the F&O Quant Desk.
 *
 * Every `intervalMs` (default 1.5s) it:
 *   1. Advances each underlying's spot with an IV-scaled Gaussian micro-step,
 *      mean-reverting toward the last REAL anchor price from the NSE scanner feed
 *      (so the stream never drifts away from the exchange sync).
 *   2. Applies a small mean-reverting IV wobble per option leg.
 *   3. Fully re-prices every option leg with Black-Scholes (spot, strike, live DTE,
 *      live IV) plus a fixed per-leg basis, so that the price at entry conditions
 *      equals the recorded entry premium exactly (P&L starts at ₹0) and all later
 *      moves are mathematically consistent with the Greeks.
 *   4. Computes signed unrealized P&L and net position Greeks:
 *        P&L  = Σ side × (livePremium − entryPremium) × lots × lotSize
 *        side = +1 (BUY) / −1 (SELL)
 *
 * mode = "SIMULATED_MICROTICK": ticks between feed syncs are model-generated.
 * Replace `stepSpot` with a WebSocket tick handler to go fully exchange-live.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { computeBlackScholesGreeks } from "@/lib/indian/foQuantEngine";
import type {
  ActiveFOSpreadPosition,
  FOScannerSetup,
  FOSpreadLeg,
} from "@/components/indian-market/fo/types";

export type TickDirection = "UP" | "DOWN" | "FLAT";

export interface LiveSymbolTick {
  symbol: string;
  spot: number;
  prevSpot: number;
  anchorSpot: number;
  sessionOpenSpot: number;
  changePct: number;
  direction: TickDirection;
  atmIV: number;
}

export interface LiveLegTick {
  legId: string;
  right: "CE" | "PE";
  action: "BUY" | "SELL";
  strike: number;
  entryPremium: number;
  premium: number;
  prevPremium: number;
  iv: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  direction: TickDirection;
}

export interface LivePositionTick {
  positionId: string;
  symbol: string;
  spot: number;
  legs: LiveLegTick[];
  unrealizedPnLINR: number;
  prevUnrealizedPnLINR: number;
  roiOnMarginPct: number;
  netDelta: number; // in underlying units (shares-equivalent)
  netGamma: number;
  netThetaINRPerDay: number;
  netVegaINRPerPct: number;
  direction: TickDirection;
}

export interface UseLiveFoTickerOptions {
  setups: FOScannerSetup[];
  positions: ActiveFOSpreadPosition[];
  intervalMs?: number;
  enabled?: boolean;
}

export interface UseLiveFoTickerResult {
  symbolTicks: Record<string, LiveSymbolTick>;
  positionTicks: Record<string, LivePositionTick>;
  tickCount: number;
  lastTickAt: number | null;
  isStreaming: boolean;
  mode: "SIMULATED_MICROTICK";
}

// Trading-year seconds: 252 sessions × 6.25h
const TRADING_YEAR_SECONDS = 252 * 6.25 * 3600;
const MEAN_REVERSION_KAPPA = 0.04; // pull toward real feed anchor per tick
const IV_REVERSION_KAPPA = 0.08;
const IV_TICK_STDEV = 0.03; // vol points per tick

function gaussian(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function dirOf(next: number, prev: number): TickDirection {
  if (next > prev + 1e-9) return "UP";
  if (next < prev - 1e-9) return "DOWN";
  return "FLAT";
}

export function daysToExpiryFrom(expiry: string, fallback: number): number {
  const parsed = Date.parse(expiry);
  if (Number.isNaN(parsed)) return fallback;
  // NSE expiry settles 15:30 IST = 10:00 UTC
  const expiryMs = parsed + 10 * 3600 * 1000;
  const days = (expiryMs - Date.now()) / 86_400_000;
  return Math.max(days, 0.01);
}

interface LegModelState {
  baseIV: number;
  iv: number;
  basis: number;
  premium: number;
}

/** Re-price a leg with Black-Scholes at given market state, adding its basis. */
function priceLeg(
  leg: FOSpreadLeg,
  spot: number,
  dte: number,
  iv: number,
  basis: number
) {
  const bs = computeBlackScholesGreeks(spot, leg.strike, dte, iv, leg.right);
  return {
    premium: Math.max(0.05, round2(bs.price + basis)),
    delta: bs.delta,
    gamma: bs.gamma,
    theta: bs.theta,
    vega: bs.vega,
  };
}

export function useLiveFoTicker({
  setups,
  positions,
  intervalMs = 1500,
  enabled = true,
}: UseLiveFoTickerOptions): UseLiveFoTickerResult {
  const [symbolTicks, setSymbolTicks] = useState<Record<string, LiveSymbolTick>>({});
  const [positionTicks, setPositionTicks] = useState<Record<string, LivePositionTick>>({});
  const [tickCount, setTickCount] = useState(0);
  const [lastTickAt, setLastTickAt] = useState<number | null>(null);

  const spotRef = useRef<Record<string, LiveSymbolTick>>({});
  const legModelRef = useRef<Record<string, LegModelState>>({});
  const pnlRef = useRef<Record<string, number>>({});
  const setupsRef = useRef(setups);
  const positionsRef = useRef(positions);

  useEffect(() => {
    setupsRef.current = setups;
    // Re-anchor every underlying to the latest REAL feed price
    setups.forEach((s) => {
      const existing = spotRef.current[s.cleanSymbol];
      if (!existing) {
        spotRef.current[s.cleanSymbol] = {
          symbol: s.cleanSymbol,
          spot: s.spotPrice,
          prevSpot: s.spotPrice,
          anchorSpot: s.spotPrice,
          sessionOpenSpot: s.spotPrice / (1 + (s.changePercent || 0) / 100),
          changePct: s.changePercent || 0,
          direction: "FLAT",
          atmIV: s.optionChain?.atmIV || 14,
        };
      } else {
        existing.anchorSpot = s.spotPrice;
        existing.atmIV = s.optionChain?.atmIV || existing.atmIV;
      }
    });
  }, [setups]);

  useEffect(() => {
    positionsRef.current = positions;
  }, [positions]);

  useEffect(() => {
    if (!enabled) return;

    const tick = () => {
      if (typeof document !== "undefined" && document.hidden) return;

      const dtSeconds = intervalMs / 1000;
      const stepScale = Math.sqrt(dtSeconds / TRADING_YEAR_SECONDS);

      // ── 1. Spot micro-ticks (IV-scaled GBM + mean reversion to feed anchor)
      const nextSpots: Record<string, LiveSymbolTick> = {};
      Object.values(spotRef.current).forEach((st) => {
        const sigma = Math.max(st.atmIV, 5) / 100;
        const shock = st.spot * sigma * stepScale * gaussian();
        const pull = MEAN_REVERSION_KAPPA * (st.anchorSpot - st.spot);
        const next = round2(Math.max(0.05, st.spot + shock + pull));
        const updated: LiveSymbolTick = {
          ...st,
          prevSpot: st.spot,
          spot: next,
          direction: dirOf(next, st.spot),
          changePct: round2(((next - st.sessionOpenSpot) / st.sessionOpenSpot) * 100),
        };
        spotRef.current[st.symbol] = updated;
        nextSpots[st.symbol] = updated;
      });

      // ── 2. Re-price every leg of every active position
      const nextPositions: Record<string, LivePositionTick> = {};
      const fallbackDte = (sym: string) =>
        setupsRef.current.find((s) => s.cleanSymbol === sym)?.daysToExpiry ?? 7;

      positionsRef.current.forEach((pos) => {
        const sym = pos.cleanSymbol;
        const liveSpot =
          spotRef.current[sym]?.spot ?? pos.currentSpotPrice ?? pos.entrySpotPrice;
        const dte = daysToExpiryFrom(pos.expiryDate, fallbackDte(sym));

        let pnl = 0;
        let netDelta = 0;
        let netGamma = 0;
        let netTheta = 0;
        let netVega = 0;

        const legs: LiveLegTick[] = pos.legs.map((leg) => {
          const key = `${pos.positionId}:${leg.legId}`;
          let model = legModelRef.current[key];

          if (!model) {
            // Calibrate basis so BS(entry spot, entry IV) + basis == entry premium
            const atEntry = computeBlackScholesGreeks(
              pos.entrySpotPrice,
              leg.strike,
              dte,
              leg.iv,
              leg.right
            );
            model = {
              baseIV: leg.iv,
              iv: leg.iv,
              basis: leg.premium - atEntry.price,
              premium: leg.premium,
            };
            legModelRef.current[key] = model;
          }

          // Mean-reverting IV wobble
          const nextIV = Math.max(
            5,
            model.iv + IV_REVERSION_KAPPA * (model.baseIV - model.iv) + IV_TICK_STDEV * gaussian()
          );
          const priced = priceLeg(leg, liveSpot, dte, nextIV, model.basis);
          const prevPremium = model.premium;
          model.iv = nextIV;
          model.premium = priced.premium;

          const side = leg.action === "BUY" ? 1 : -1;
          const qty = leg.lots * leg.lotSize;
          pnl += side * (priced.premium - leg.premium) * qty;
          netDelta += side * priced.delta * qty;
          netGamma += side * priced.gamma * qty;
          netTheta += side * priced.theta * qty;
          netVega += side * priced.vega * qty;

          return {
            legId: leg.legId,
            right: leg.right,
            action: leg.action,
            strike: leg.strike,
            entryPremium: leg.premium,
            premium: priced.premium,
            prevPremium,
            iv: round2(nextIV),
            delta: priced.delta,
            gamma: priced.gamma,
            theta: priced.theta,
            vega: priced.vega,
            direction: dirOf(priced.premium, prevPremium),
          };
        });

        const roundedPnl = Math.round(pnl);
        const prevPnl = pnlRef.current[pos.positionId] ?? 0;
        pnlRef.current[pos.positionId] = roundedPnl;

        nextPositions[pos.positionId] = {
          positionId: pos.positionId,
          symbol: sym,
          spot: liveSpot,
          legs,
          unrealizedPnLINR: roundedPnl,
          prevUnrealizedPnLINR: prevPnl,
          roiOnMarginPct: round2((roundedPnl / Math.max(1, pos.marginBlockedINR)) * 100),
          netDelta: round2(netDelta),
          netGamma: Math.round(netGamma * 10000) / 10000,
          netThetaINRPerDay: Math.round(netTheta),
          netVegaINRPerPct: Math.round(netVega),
          direction: dirOf(roundedPnl, prevPnl),
        };
      });

      // Drop leg models for squared-off positions
      const liveIds = new Set(positionsRef.current.map((p) => p.positionId));
      Object.keys(legModelRef.current).forEach((k) => {
        if (!liveIds.has(k.split(":")[0])) delete legModelRef.current[k];
      });

      setSymbolTicks(nextSpots);
      setPositionTicks(nextPositions);
      setTickCount((c) => c + 1);
      setLastTickAt(Date.now());
    };

    tick();
    const timer = setInterval(tick, intervalMs);
    return () => clearInterval(timer);
  }, [enabled, intervalMs]);

  return useMemo(
    () => ({
      symbolTicks,
      positionTicks,
      tickCount,
      lastTickAt,
      isStreaming: enabled && lastTickAt !== null,
      mode: "SIMULATED_MICROTICK" as const,
    }),
    [symbolTicks, positionTicks, tickCount, lastTickAt, enabled]
  );
}

