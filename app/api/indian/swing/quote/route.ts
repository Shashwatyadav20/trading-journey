import { NextRequest, NextResponse } from "next/server";
import { fetchLiveStockCandles } from "@/lib/indian/liveSwingScanner";
import {
  buildStockIndicatorProfile,
  evaluateAllStrategiesForStock,
} from "@/lib/indian/dailyStrategyScanner";

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
    let niftyChangePercent = 1.3;
    let niftyEma20 = 22380.0;
    try {
      const niftyCandles = await fetchLiveStockCandles("^NSEI");
      if (niftyCandles && niftyCandles.candles.length >= 20) {
        const meta = niftyCandles.meta;
        const closes = niftyCandles.candles.map((c) => c.close);
        const len = closes.length;
        niftySpot = Number((meta.regularMarketPrice || closes[len - 1]).toFixed(2));
        niftyChangePercent = Number((meta.regularMarketChangePercent || 1.3).toFixed(2));
        const k20 = 2 / 21;
        let e20 = closes[0];
        for (let i = 1; i < len; i++) e20 = closes[i] * k20 + e20 * (1 - k20);
        niftyEma20 = Number(e20.toFixed(2));
      }
    } catch {
      // Benchmark fallback
    }

    // 3. Build indicator profile and evaluate 8 strategies
    const profile = buildStockIndicatorProfile(
      cleanSymbol,
      candleData.candles,
      candleData.meta,
      niftySpot || 24000,
      niftyChangePercent
    );
    const multiOpportunity = evaluateAllStrategiesForStock(profile);
    const primaryStrategy = multiOpportunity?.primaryStrategy;

    return NextResponse.json({
      success: true,
      data: {
        symbol: `${cleanSymbol}.NS`,
        cleanSymbol,
        companyName: profile.companyName,
        price: profile.currentPrice,
        prevClose: profile.prevClose,
        change: profile.change,
        changePercent: profile.changePercent,
        dayHigh: profile.dayHigh,
        dayLow: profile.dayLow,
        high52: profile.high52,
        low52: profile.low52,
        volume: candleData.meta.regularMarketVolume || 0,
        avgVolume20D: profile.avgVolume20D,
        volumeMultiplier: profile.volumeMultiplier,
        ema20: profile.ema20,
        ema50: profile.ema50,
        ema200: profile.ema200,
        rsi14: profile.rsi14,
        macd: profile.macd,
        trendStrength: profile.trendStrength,
        relativeStrengthVsNifty: profile.relativeStrengthVsNifty,
        isAbove20EMA: profile.currentPrice >= profile.ema20,
        isAbove50EMA: profile.currentPrice >= profile.ema50,
        resistanceLevel: profile.resistanceLevel,
        supportLevel: profile.supportLevel,
        swingLow: profile.swingLow,
        detectedSetup: primaryStrategy ? {
          setupId: primaryStrategy.strategyId,
          setupName: primaryStrategy.strategyName,
          setupBadge: primaryStrategy.strategyName,
          status: "ACTIVE_OPPORTUNITY",
          entryPrice: multiOpportunity.entryTrigger,
          stopLossPrice: multiOpportunity.stopLoss,
          target1Price: multiOpportunity.target1,
          target2Price: multiOpportunity.target2,
          riskPerShare: multiOpportunity.entryTrigger - multiOpportunity.stopLoss,
          rewardRiskRatio: multiOpportunity.rewardRiskRatio,
          confluenceScore: multiOpportunity.confluenceScore,
          rationale: multiOpportunity.tradeRationale,
        } : null,
        allMatchedStrategies: multiOpportunity?.allMatchedStrategies || [],
        isMultiStrategyMatch: multiOpportunity?.isMultiStrategyMatch || false,
        candleHistory: candleData.candles.slice(-30),
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
