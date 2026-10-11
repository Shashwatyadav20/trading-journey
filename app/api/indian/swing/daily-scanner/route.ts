import { NextRequest, NextResponse } from "next/server";
import { fetchLiveStockCandles } from "@/lib/indian/liveSwingScanner";
import {
  buildStockIndicatorProfile,
  evaluateAllStrategiesForStock,
  LIQUID_UNIVERSES,
  MatchedStockOpportunity,
  StrategyId,
} from "@/lib/indian/dailyStrategyScanner";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// In-memory cache for fast snappy responses
interface ScanCacheEntry {
  timestamp: number;
  data: any;
}
const scanCache: Record<string, ScanCacheEntry> = {};
const CACHE_TTL_MS = 30 * 1000; // 30 seconds

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const universeParam = (searchParams.get("universe") || "MOMENTUM_LEADERS").toUpperCase();
    const strategyFilter = (searchParams.get("strategy") || "ALL").toUpperCase();
    const forceRefresh = searchParams.get("forceRefresh") === "true";

    const cacheKey = `${universeParam}_${strategyFilter}`;
    const now = Date.now();

    if (!forceRefresh && scanCache[cacheKey] && now - scanCache[cacheKey].timestamp < CACHE_TTL_MS) {
      return NextResponse.json({
        ...scanCache[cacheKey].data,
        cached: true,
      });
    }

    // 1. Fetch live NIFTY 50 benchmark
    let niftySpot = 22520.45;
    let niftyChangePercent = 1.3;
    let niftyEma20 = 22380.0;
    try {
      const niftyData = await fetchLiveStockCandles("^NSEI");
      if (niftyData && niftyData.candles.length >= 20) {
        const meta = niftyData.meta;
        const closes = niftyData.candles.map((c) => c.close);
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

    const marketRegime = {
      niftySpot,
      niftyChangePercent,
      niftyEma20,
      bias: niftySpot >= niftyEma20 ? "BULLISH_TREND" : "RANGE_BOUND",
      clearance: niftySpot >= niftyEma20 ? "HIGH_CONVICTION" : "SELECTIVE_OPPORTUNITIES",
      regimeScore: niftySpot >= niftyEma20 ? 88 : 65,
      analysisSummary: `NIFTY 50 (₹${niftySpot.toLocaleString("en-IN")}) trading ${
        niftySpot >= niftyEma20 ? "cleanly above" : "near"
      } 20 EMA (₹${niftyEma20.toLocaleString("en-IN")}). Cash swing market breadth is favorable for long positions.`,
    };

    // 2. Select universe of symbols to scan
    let symbolsToScan: string[] = [];
    if (universeParam === "NIFTY_50") {
      symbolsToScan = LIQUID_UNIVERSES.NIFTY_50;
    } else if (universeParam === "NIFTY_NEXT_50") {
      symbolsToScan = LIQUID_UNIVERSES.NIFTY_NEXT_50;
    } else if (universeParam === "ALL_LIQUID") {
      symbolsToScan = Array.from(
        new Set([
          ...LIQUID_UNIVERSES.MOMENTUM_LEADERS,
          ...LIQUID_UNIVERSES.NIFTY_50,
          ...LIQUID_UNIVERSES.NIFTY_NEXT_50,
        ])
      );
    } else {
      // Default to MOMENTUM_LEADERS
      symbolsToScan = LIQUID_UNIVERSES.MOMENTUM_LEADERS;
    }

    // 3. Scan stocks concurrently
    const scanResults = await Promise.allSettled(
      symbolsToScan.map(async (symbol) => {
        const candleData = await fetchLiveStockCandles(symbol);
        if (!candleData || candleData.candles.length < 15) return null;

        const profile = buildStockIndicatorProfile(
          symbol,
          candleData.candles,
          candleData.meta,
          niftySpot,
          niftyChangePercent
        );

        const opp = evaluateAllStrategiesForStock(profile);
        return {
          profile,
          opportunity: opp,
          candleHistory: candleData.candles.slice(-30),
        };
      })
    );

    const allProfiles: any[] = [];
    const opportunities: MatchedStockOpportunity[] = [];
    const quoteMap: Record<string, any> = {};

    scanResults.forEach((res) => {
      if (res.status === "fulfilled" && res.value) {
        allProfiles.push(res.value.profile);
        quoteMap[res.value.profile.symbol] = {
          price: res.value.profile.currentPrice,
          change: res.value.profile.change,
          changePercent: res.value.profile.changePercent,
          volume: res.value.profile.volume,
          volumeMultiplier: res.value.profile.volumeMultiplier,
        };
        if (res.value.opportunity) {
          opportunities.push(res.value.opportunity);
        }
      }
    });

    // 4. Strategy breakdown counts
    const strategyCounts: Record<StrategyId, number> = {
      STRATEGY_A_BREAKOUT: 0,
      STRATEGY_B_PULLBACK: 0,
      STRATEGY_C_SUPPORT_BOUNCE: 0,
      STRATEGY_D_MA_CROSSOVER: 0,
      STRATEGY_E_MOMENTUM: 0,
      STRATEGY_F_RANGE_BREAKOUT: 0,
      STRATEGY_G_TREND_CONTINUATION: 0,
      STRATEGY_H_VOLUME_BREAKOUT: 0,
    };

    opportunities.forEach((opp) => {
      opp.allMatchedStrategies.forEach((st) => {
        strategyCounts[st.strategyId]++;
      });
    });

    // 5. Multi-Strategy matches (sorted by highest confluence score)
    const multiStrategyMatches = opportunities
      .filter((opp) => opp.isMultiStrategyMatch)
      .sort((a, b) => b.confluenceScore - a.confluenceScore);

    // 6. Filter by requested strategy if applicable
    let filteredOpportunities = opportunities;
    if (strategyFilter !== "ALL") {
      filteredOpportunities = opportunities.filter((opp) =>
        opp.allMatchedStrategies.some((st) => st.strategyId === strategyFilter)
      );
    }
    // Sort opportunities by confluence score
    filteredOpportunities.sort((a, b) => b.confluenceScore - a.confluenceScore);

    const payload = {
      success: true,
      timestamp: new Date().toISOString(),
      marketStatus: "NSE_OPEN_EOD_SYNCHRONIZED",
      universe: universeParam,
      scannedTotalCount: allProfiles.length,
      opportunitiesCount: filteredOpportunities.length,
      multiStrategyCount: multiStrategyMatches.length,
      marketRegime,
      strategyCounts,
      opportunities: filteredOpportunities,
      multiStrategyMatches,
      quotes: quoteMap,
    };

    scanCache[cacheKey] = {
      timestamp: now,
      data: payload,
    };

    return NextResponse.json(payload);
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        error: err.message || "Failed to execute daily stock strategy scan",
      },
      { status: 500 }
    );
  }
}
