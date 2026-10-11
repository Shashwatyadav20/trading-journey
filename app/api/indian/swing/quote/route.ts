import { NextRequest, NextResponse } from "next/server";
import {
  fetchLiveStockCandles,
  evaluateLiveStockStrategy,
} from "@/lib/indian/liveSwingScanner";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const rawSymbol = (searchParams.get("symbol") || "TRENT").toUpperCase().trim();
    const cleanSymbol = rawSymbol.replace(/\.NS$/, "").replace(/\.BO$/, "");

    // 1. Fetch live candles for the requested symbol
    const candleData = await fetchLiveStockCandles(cleanSymbol);
    if (!candleData) {
      return NextResponse.json(
        {
          success: false,
          error: `No live market data found on NSE for symbol '${cleanSymbol}'. Please ensure the ticker exists on NSE (e.g. BSE, CDSL, TRENT, DIXON, RELIANCE, TCS).`,
        },
        { status: 404 }
      );
    }

    // 2. Fetch or evaluate NIFTY regime for relative strength comparison
    let niftySpot = 22520.45;
    let niftyEma20 = 22380.0;
    try {
      const niftyCandles = await fetchLiveStockCandles("^NSEI");
      if (niftyCandles && niftyCandles.candles.length >= 20) {
        const meta = niftyCandles.meta;
        const closes = niftyCandles.candles.map((c) => c.close);
        const len = closes.length;
        niftySpot = Number((meta.regularMarketPrice || closes[len - 1]).toFixed(2));
        const k20 = 2 / 21;
        let e20 = closes[0];
        for (let i = 1; i < len; i++) e20 = closes[i] * k20 + e20 * (1 - k20);
        niftyEma20 = Number(e20.toFixed(2));
      }
    } catch {
      // Benchmark fallback
    }

    // 3. Run automated 5-pillar strategy evaluation on the live stock
    const evaluatedSignal = evaluateLiveStockStrategy(
      cleanSymbol,
      candleData.candles,
      candleData.meta,
      niftySpot,
      niftyEma20
    );

    return NextResponse.json({
      success: true,
      data: {
        symbol: `${cleanSymbol}.NS`,
        cleanSymbol,
        price: evaluatedSignal.currentPrice,
        prevClose: Number((evaluatedSignal.currentPrice - evaluatedSignal.change).toFixed(2)),
        change: evaluatedSignal.change,
        changePercent: evaluatedSignal.changePercent,
        dayHigh: evaluatedSignal.dayHigh,
        dayLow: evaluatedSignal.dayLow,
        high52: evaluatedSignal.high52,
        low52: evaluatedSignal.low52,
        volume: candleData.meta.regularMarketVolume || 0,
        avgVolume20D: Math.round(
          candleData.candles
            .slice(-20)
            .map((c) => c.volume)
            .reduce((a, b) => a + b, 0) / 20
        ),
        volumeMultiplier: evaluatedSignal.volumeMultiplier,
        ema20: evaluatedSignal.ema20,
        ema50: evaluatedSignal.ema50,
        isAbove20EMA: evaluatedSignal.currentPrice >= evaluatedSignal.ema20,
        isAbove50EMA: evaluatedSignal.currentPrice >= evaluatedSignal.ema50,
        resistanceLevel: evaluatedSignal.target1Price > evaluatedSignal.entryPrice ? evaluatedSignal.target1Price : evaluatedSignal.entryPrice * 1.05,
        supportLevel: evaluatedSignal.stopLossPrice,
        swingLow: evaluatedSignal.stopLossPrice,
        detectedSetup: {
          setupId: evaluatedSignal.setupId,
          setupName: evaluatedSignal.setupTitle,
          setupBadge: evaluatedSignal.setupBadge,
          status: evaluatedSignal.status,
          entryPrice: evaluatedSignal.entryPrice,
          stopLossPrice: evaluatedSignal.stopLossPrice,
          target1Price: evaluatedSignal.target1Price,
          target2Price: evaluatedSignal.target2Price,
          riskPerShare: evaluatedSignal.riskPerShare,
          rewardRiskRatio: evaluatedSignal.rewardRiskRatio,
          confluenceScore: evaluatedSignal.confluenceScore,
          rationale: evaluatedSignal.tradeRationale,
          rejectionDescription: evaluatedSignal.rejectionCandle || evaluatedSignal.setupTitle,
        },
        candleHistory: candleData.candles.slice(-30),
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
