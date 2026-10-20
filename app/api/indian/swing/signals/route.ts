import { NextResponse } from "next/server";
import { fetchLiveStockCandles } from "@/lib/indian/liveSwingScanner";
import {
  buildStockIndicatorProfile,
  evaluateAllStrategiesForStock,
} from "@/lib/indian/dailyStrategyScanner";
import { nseUniverseService } from "@/lib/indian/NSEUniverseService";
import { BACKEND_URL } from "@/lib/backendUrl";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    // 1. Fetch live NIFTY 50 index data for Market Regime
    let niftySpot = 0;
    let niftyChangePercent = 0;
    let niftyEma20 = 0;
    let niftyEma50 = 0;
    let niftyEma200 = 0;

    try {
      const niftyCandlesData = await fetchLiveStockCandles("^NSEI");
      if (niftyCandlesData && niftyCandlesData.candles.length >= 20) {
        const meta = niftyCandlesData.meta;
        const closes = niftyCandlesData.candles.map((c) => c.close);
        const len = closes.length;
        niftySpot = Number((meta.regularMarketPrice || closes[len - 1]).toFixed(2));
        // prevClose from actual previous candle (not chartPreviousClose)
        const niftyPrevClose = closes[len - 2] ?? closes[len - 1];
        niftyChangePercent = niftyPrevClose > 0
          ? Number((((niftySpot - niftyPrevClose) / niftyPrevClose) * 100).toFixed(2))
          : 0;

        const k20 = 2 / 21;
        let e20 = closes.slice(0, 20).reduce((a, b) => a + b, 0) / Math.min(20, len);
        for (let i = 20; i < len; i++) e20 = closes[i] * k20 + e20 * (1 - k20);
        niftyEma20 = Number(e20.toFixed(2));

        const k50 = 2 / 51;
        let e50 = closes.slice(0, 50).reduce((a, b) => a + b, 0) / Math.min(50, len);
        for (let i = 50; i < len; i++) e50 = closes[i] * k50 + e50 * (1 - k50);
        niftyEma50 = Number(e50.toFixed(2));
      }
    } catch {
      // Benchmark unavailable
    }

    const regime = {
      spotPrice: niftySpot,
      changePercent: niftyChangePercent,
      ema20: niftyEma20,
      ema50: niftyEma50,
      ema200: niftyEma200,
      bias: niftySpot === 0 ? "UNAVAILABLE" : niftySpot >= niftyEma20 ? "BULLISH_TREND" : "RANGE_BOUND",
      clearance: niftySpot === 0 ? "UNAVAILABLE" : niftySpot >= niftyEma20 ? "HIGH_CONVICTION" : "SELECTIVE_OPPORTUNITIES",
      // Breadth requires a separate data source not available from Yahoo Finance
      breadthPercentAbove50EMA: null as number | null,
      advancingStocksCount: null as number | null,
      decliningStocksCount: null as number | null,
      regimeScore: niftySpot === 0 ? 50 : niftySpot >= niftyEma20 ? 85 : 62,
      analysisSummary: niftySpot === 0
        ? "NIFTY data unavailable. Run scanner for live data."
        : `NIFTY (₹${niftySpot.toLocaleString("en-IN")}) trading ${niftySpot >= niftyEma20 ? "above" : "below"} 20 EMA (₹${niftyEma20.toLocaleString("en-IN")}).`,
    };

    // 2. Query persisted scanner opportunities from backend (primary path)
    try {
      const backendRes = await fetch(`${BACKEND_URL}/api/indian/swing/daily-scanner/latest`, {
        cache: "no-store",
      });
      if (backendRes.ok) {
        const backendData = await backendRes.json();
        if (backendData.success && backendData.hasData && backendData.opportunities) {
          const quoteMap: Record<string, any> = {
            "^NSEI": { price: niftySpot, changePercent: niftyChangePercent },
          };
          for (const opp of backendData.opportunities) {
            quoteMap[`${opp.symbol}.NS`] = {
              symbol: `${opp.symbol}.NS`,
              price: opp.current_price,
              change: 0,
              changePercent: 0,
              dayHigh: opp.current_price,
              dayLow: opp.current_price,
              volumeMultiplier: opp.indicator_snapshot?.volumeMultiplier || 1.0,
            };
          }
          return NextResponse.json({
            success: true,
            isRealData: true,
            dataSource: "PERSISTED_BACKEND_SCANNER",
            regime,
            signals: backendData.opportunities,
            quotes: quoteMap,
            scannedCount: backendData.run?.scanned_count || backendData.opportunities.length,
            universeSize: backendData.run?.universe_size || 500,
            timestamp: backendData.run?.completed_at || new Date().toISOString(),
          });
        }
      }
    } catch {
      // Backend not available; evaluate dynamic NSE universe candidates below
    }

    // 3. Fallback: Evaluate dynamic NSE universe symbols (no hardcoded list)
    const dynamicUniverse = nseUniverseService.getEligibleUniverse("NIFTY_50", { maxSymbols: 15 });
    const symbolsToScan = dynamicUniverse.map((s) => s.symbol);

    const results = await Promise.allSettled(
      symbolsToScan.map(async (symbol) => {
        const candleData = await fetchLiveStockCandles(symbol);
        if (!candleData || candleData.candles.length < 20) return null;
        const profile = buildStockIndicatorProfile(
          symbol, candleData.candles, candleData.meta,
          niftySpot || 24000, niftyChangePercent
        );
        return evaluateAllStrategiesForStock(profile);
      })
    );

    const signals: any[] = [];
    const quoteMap: Record<string, any> = {
      "^NSEI": { price: niftySpot, changePercent: niftyChangePercent },
    };

    results.forEach((r) => {
      if (r.status === "fulfilled" && r.value) {
        signals.push(r.value);
        quoteMap[r.value.cleanSymbol] = {
          price: r.value.currentPrice,
          changePercent: r.value.changePercent,
        };
      }
    });

    return NextResponse.json({
      success: true,
      isRealData: true,
      dataSource: "DYNAMIC_NSE_UNIVERSE_SCANNER",
      regime,
      signals,
      quotes: quoteMap,
      scannedCount: symbolsToScan.length,
      universeSize: nseUniverseService.getUniverseMetadata().nifty500Count,
      timestamp: new Date().toISOString(),
      disclaimer: "Breadth data unavailable (requires separate market breadth source). Regime based on NIFTY price vs EMA only.",
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
