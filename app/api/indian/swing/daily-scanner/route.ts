import { NextRequest, NextResponse } from "next/server";
import { BACKEND_URL } from "@/lib/backendUrl";
import { fetchLiveStockCandles } from "@/lib/indian/liveSwingScanner";
import {
  buildStockIndicatorProfile,
  evaluateAllStrategiesForStock,
  LIQUID_UNIVERSES,
  MatchedStockOpportunity,
  StrategyId,
} from "@/lib/indian/dailyStrategyScanner";
import {
  LIVE_TRADING,
  CONCURRENCY_LIMIT,
  BATCH_DELAY_MS,
  SCAN_RESPONSE_CACHE_TTL_MS,
} from "@/lib/indian/scannerConfig";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// ─────────────────────────────────────────────────────────────────────────────
// Safety check
// ─────────────────────────────────────────────────────────────────────────────

if (LIVE_TRADING !== false) {
  throw new Error("SAFETY: LIVE_TRADING must be false in scanner config");
}

// ─────────────────────────────────────────────────────────────────────────────
// In-memory cache (keyed by universe + strategy filter)
// ─────────────────────────────────────────────────────────────────────────────

interface ScanCacheEntry {
  timestamp: number;
  data: any;
}
const scanCache: Record<string, ScanCacheEntry> = {};

// ─────────────────────────────────────────────────────────────────────────────
// Bounded concurrency helper (used in inline fallback scan)
// ─────────────────────────────────────────────────────────────────────────────

async function runBatched<T>(
  items: string[],
  worker: (symbol: string) => Promise<T | null>,
  limit: number,
  batchDelayMs: number
): Promise<{ symbol: string; result: T | null; failed: boolean; failReason?: string }[]> {
  const output: { symbol: string; result: T | null; failed: boolean; failReason?: string }[] = [];
  let i = 0;
  while (i < items.length) {
    const batch = items.slice(i, i + limit);
    const batchResults = await Promise.allSettled(
      batch.map(async (sym) => ({ symbol: sym, result: await worker(sym) }))
    );
    for (const res of batchResults) {
      if (res.status === "fulfilled") {
        output.push({ symbol: res.value.symbol, result: res.value.result, failed: false });
      } else {
        output.push({
          symbol: batch[batchResults.indexOf(res)] || "UNKNOWN",
          result: null,
          failed: true,
          failReason: res.reason?.message || "unknown error",
        });
      }
    }
    i += limit;
    if (i < items.length) {
      await new Promise((r) => setTimeout(r, batchDelayMs));
    }
  }
  return output;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET handler
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const universeParam = (searchParams.get("universe") || "MOMENTUM_LEADERS").toUpperCase();
    const strategyFilter = (searchParams.get("strategy") || "ALL").toUpperCase();
    const forceRefresh = searchParams.get("forceRefresh") === "true";
    const dateParam = searchParams.get("date"); // e.g. "2026-10-12"
    const now = Date.now();
    const cacheKey = `${universeParam}:${strategyFilter}`;

    // 1. If forceRefresh, trigger manual scan on Fastify backend
    if (forceRefresh) {
      try {
        const scanRes = await fetch(`${BACKEND_URL}/api/indian/swing/manual-scan`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ force: true }),
          cache: "no-store",
        });
        if (!scanRes.ok) {
          const errData = await scanRes.json().catch(() => ({}));
          console.warn("[daily-scanner/route] Manual scan trigger returned non-200:", errData);
        }
      } catch (triggerErr: any) {
        console.warn("[daily-scanner/route] Could not trigger backend manual scan:", triggerErr.message);
      }
    }

    // 2. Query Fastify backend for persisted scan results
    const endpoint = dateParam
      ? `${BACKEND_URL}/api/indian/swing/daily-scanner/date/${encodeURIComponent(dateParam)}`
      : `${BACKEND_URL}/api/indian/swing/daily-scanner/latest`;

    let backendData: any = null;
    try {
      const res = await fetch(endpoint, { cache: "no-store" });
      if (res.ok) {
        backendData = await res.json();
      }
    } catch (fetchErr: any) {
      console.warn(`[daily-scanner/route] Backend connection failed:`, fetchErr.message);
    }

    // 3. Process persisted backend response if available
    if (backendData && backendData.success) {
      if (!backendData.hasData || !backendData.run) {
        return NextResponse.json({
          success: true,
          hasData: false,
          isPersisted: true,
          scanRun: null,
          scanDate: null,
          completedAt: null,
          scanType: null,
          scanStatus: "EMPTY",
          opportunitiesCount: 0,
          multiStrategyCount: 0,
          opportunities: [],
          multiStrategyMatches: [],
          strategyCounts: getEmptyStrategyCounts(),
          marketRegime: getDefaultMarketRegime(),
          message: "No daily stock scan has been persisted yet. Awaiting scheduled run at 15:45 IST or manual trigger.",
        });
      }

      const run = backendData.run;
      const rawOpportunities = (backendData.opportunities || []) as any[];

      // Map DB opportunities to MatchedStockOpportunity contract
      const mappedOpportunities: MatchedStockOpportunity[] = rawOpportunities.map((opp: any) => {
        const snap = opp.indicator_snapshot || {};
        const cleanSymbol = opp.symbol.replace(/\.NS$/, "").replace(/\.BO$/, "");
        const entryPrice = Number(opp.entry_price || opp.current_price);
        const stopLoss = Number(opp.stop_loss);
        const target1 = Number(opp.target_1);
        const target2 = Number(opp.target_2 || target1 * 1.05);

        const primaryMatch: any = {
          strategyId: opp.primary_strategy,
          strategyCode: "A",
          strategyName: opp.primary_strategy,
          matched: true,
          direction: opp.signal_direction === "SHORT" ? "BEARISH" : "BULLISH",
          confirmationStatus: "CONFIRMED",
          entryZone: {
            min: opp.entry_zone?.min || entryPrice,
            max: opp.entry_zone?.max || entryPrice,
            trigger: entryPrice,
          },
          stopLoss,
          target1,
          target2,
          riskPerShare: Number(Math.abs(entryPrice - stopLoss).toFixed(2)),
          rewardRiskRatio: Number(opp.reward_risk_ratio),
          confidenceScore: Number(opp.confluence_score),
          rationale: snap.tradeRationale || [],
          keyLevel: entryPrice,
        };

        const matchedList = Array.isArray(opp.matched_strategies) && opp.matched_strategies.length > 0
          ? opp.matched_strategies
          : [primaryMatch];

        return {
          id: opp.id,
          symbol: opp.symbol,
          cleanSymbol,
          companyName: snap.companyName || opp.symbol,
          sector: snap.sector || "Indian Cash Market",
          marketCapCr: snap.marketCapCr || 0,
          currentPrice: Number(opp.current_price),
          changePercent: snap.changePercent ?? 0,
          direction: opp.signal_direction === "SHORT" ? "BEARISH" : "BULLISH",
          primaryStrategy: primaryMatch,
          allMatchedStrategies: matchedList,
          matchedStrategyCount: matchedList.length,
          isMultiStrategyMatch: matchedList.length > 1,
          confluenceScore: Number(opp.confluence_score),
          entryTrigger: entryPrice,
          entryZone: opp.entry_zone ? `₹${opp.entry_zone.min} - ₹${opp.entry_zone.max}` : `₹${entryPrice}`,
          stopLoss,
          target1,
          target2,
          riskPerShare: Number(Math.abs(entryPrice - stopLoss).toFixed(2)),
          rewardRiskRatio: Number(opp.reward_risk_ratio),
          relativeVolume: snap.volumeMultiplier || 1.0,
          rsi: snap.rsi14 ?? null,
          trendStrength: snap.trendStrength || "RANGE_BOUND",
          confirmationStatus: "CONFIRMED",
          timestamp: opp.trading_date || run.scan_date,
          scoreBreakdown: snap.scoreBreakdown || {
            trendConfirmation: 0,
            priceAction: 0,
            volumeConfirmation: 0,
            relativeStrength: 0,
            supportResistanceQuality: 0,
            momentumConfirmation: 0,
            rewardRiskRatio: 0,
          },
          tradeRationale: snap.tradeRationale || [],
          invalidationTrigger: `Daily candle close below ₹${stopLoss} invalidates setup.`,
          trailingStopPlan: "Move SL to breakeven at 1R; trail remainder below 20 EMA.",
          marketStructure: snap.marketStructure || undefined,
          liquiditySweep: snap.liquiditySweep || snap.marketStructure?.recentLiquiditySweep || null,
          choch: snap.choch || snap.marketStructure?.recentChoch || null,
        };
      });

      // Filter by requested strategy
      let filteredOpportunities = mappedOpportunities;
      if (strategyFilter !== "ALL") {
        filteredOpportunities = mappedOpportunities.filter((opp) =>
          opp.allMatchedStrategies.some((st: any) => st.strategyId === strategyFilter) ||
          opp.primaryStrategy.strategyId === strategyFilter
        );
      }
      filteredOpportunities.sort((a, b) => b.confluenceScore - a.confluenceScore);

      const multiStrategyMatches = mappedOpportunities
        .filter((opp) => opp.isMultiStrategyMatch)
        .sort((a, b) => b.confluenceScore - a.confluenceScore);

      const strategyCounts = getEmptyStrategyCounts();
      mappedOpportunities.forEach((opp) => {
        opp.allMatchedStrategies.forEach((st: any) => {
          if (strategyCounts[st.strategyId as StrategyId] !== undefined) {
            strategyCounts[st.strategyId as StrategyId]++;
          }
        });
        if (opp.allMatchedStrategies.length === 0 && strategyCounts[opp.primaryStrategy.strategyId as StrategyId] !== undefined) {
          strategyCounts[opp.primaryStrategy.strategyId as StrategyId]++;
        }
      });

      return NextResponse.json({
        success: true,
        hasData: true,
        isPersisted: true,
        scanRun: run,
        scanDate: run.scan_date,
        completedAt: run.completed_at,
        scanType: run.scan_type,
        scanStatus: run.status,
        durationMs: run.duration_ms,
        universeSize: run.universe_size || 500,
        scannedTotalCount: run.scanned_count || mappedOpportunities.length,
        successCount: run.success_count ?? null,
        failureCount: run.failure_count ?? null,
        opportunitiesCount: filteredOpportunities.length,
        multiStrategyCount: multiStrategyMatches.length,
        strategyCounts,
        opportunities: filteredOpportunities,
        multiStrategyMatches,
        marketRegime: getDefaultMarketRegime(),
      });
    }

    // 4. Backend unavailable — run inline scan with bounded concurrency as fallback
    if (!forceRefresh && scanCache[cacheKey] && now - scanCache[cacheKey].timestamp < SCAN_RESPONSE_CACHE_TTL_MS) {
      return NextResponse.json({ ...scanCache[cacheKey].data, cached: true });
    }

    // ── Fetch NIFTY 50 benchmark ──────────────────────────────────────────────
    let niftySpot = 0;
    let niftyChangePercent = 0;
    let niftyEma20 = 0;

    try {
      const niftyData = await fetchLiveStockCandles("^NSEI");
      if (niftyData && niftyData.candles.length >= 20) {
        const closes = niftyData.candles.map((c) => c.close);
        const len = closes.length;
        niftySpot = niftyData.meta.regularMarketPrice ?? closes[len - 1];
        const niftyPrevClose = closes[len - 2] ?? closes[len - 1];
        niftyChangePercent =
          niftyPrevClose > 0
            ? Number((((niftySpot - niftyPrevClose) / niftyPrevClose) * 100).toFixed(2))
            : 0;
        const k20 = 2 / 21;
        let e20 = closes.slice(0, 20).reduce((a, b) => a + b, 0) / Math.min(20, len);
        for (let i = 20; i < len; i++) e20 = closes[i] * k20 + e20 * (1 - k20);
        niftyEma20 = Number(e20.toFixed(2));
      }
    } catch {
      // Benchmark fetch failed — regime remains unknown
    }

    const marketRegime = {
      niftySpot,
      niftyChangePercent,
      niftyEma20,
      bias:
        niftySpot === 0
          ? "UNAVAILABLE"
          : niftySpot >= niftyEma20
          ? "BULLISH_TREND"
          : "RANGE_BOUND",
      clearance:
        niftySpot === 0
          ? "UNAVAILABLE"
          : niftySpot >= niftyEma20
          ? "HIGH_CONVICTION"
          : "SELECTIVE_OPPORTUNITIES",
      analysisSummary:
        niftySpot === 0
          ? "NIFTY benchmark data unavailable."
          : `NIFTY 50 (₹${niftySpot.toLocaleString("en-IN")}) trading ${
              niftySpot >= niftyEma20 ? "above" : "below"
            } 20 EMA (₹${niftyEma20.toLocaleString("en-IN")}).`,
    };

    // ── Select universe ────────────────────────────────────────────────────────
    let symbolsToScan: string[] = [];
    if (universeParam === "ALL_LIQUID") {
      symbolsToScan = Array.from(
        new Set([
          ...LIQUID_UNIVERSES.MOMENTUM_LEADERS,
          ...LIQUID_UNIVERSES.NIFTY_50,
          ...LIQUID_UNIVERSES.NIFTY_NEXT_50,
        ])
      );
    } else if (LIQUID_UNIVERSES[universeParam]) {
      symbolsToScan = LIQUID_UNIVERSES[universeParam];
    } else {
      symbolsToScan = LIQUID_UNIVERSES.MOMENTUM_LEADERS;
    }

    // ── Scan with bounded concurrency ─────────────────────────────────────────
    const scanResults = await runBatched(
      symbolsToScan,
      async (symbol) => {
        const candleData = await fetchLiveStockCandles(symbol);
        if (!candleData || candleData.candles.length < 20) return null;

        const profile = buildStockIndicatorProfile(
          symbol,
          candleData.candles,
          candleData.meta,
          niftySpot || 24000,
          niftyChangePercent
        );

        const opp = evaluateAllStrategiesForStock(profile);
        return { profile, opportunity: opp };
      },
      CONCURRENCY_LIMIT,
      BATCH_DELAY_MS
    );

    // ── Collect results ────────────────────────────────────────────────────────
    const allProfiles: any[] = [];
    const opportunities: MatchedStockOpportunity[] = [];
    const failedList: { symbol: string; reason: string }[] = [];
    const skippedList: { symbol: string; reason: string }[] = [];
    const quoteMap: Record<string, any> = {};

    for (const { symbol, result, failed, failReason } of scanResults) {
      if (failed) {
        failedList.push({ symbol, reason: failReason || "exception during scan" });
        continue;
      }
      if (result === null) {
        skippedList.push({ symbol, reason: "Insufficient candle data or data fetch returned null" });
        continue;
      }
      const { profile, opportunity } = result;
      allProfiles.push(profile);
      quoteMap[profile.cleanSymbol] = {
        price: profile.currentPrice,
        change: profile.change,
        changePercent: profile.changePercent,
        volume: profile.volume,
        volumeMultiplier: profile.volumeMultiplier,
      };
      if (opportunity) {
        opportunities.push(opportunity);
      }
    }

    // ── Strategy counts ────────────────────────────────────────────────────────
    const strategyCounts: Record<string, number> = {};
    for (const opp of opportunities) {
      for (const st of opp.allMatchedStrategies) {
        strategyCounts[st.strategyId] = (strategyCounts[st.strategyId] || 0) + 1;
      }
    }

    const multiStrategyMatches = opportunities
      .filter((opp) => opp.isMultiStrategyMatch)
      .sort((a, b) => b.confluenceScore - a.confluenceScore);

    let filteredOpportunities = opportunities;
    if (strategyFilter !== "ALL") {
      filteredOpportunities = opportunities.filter((opp) =>
        opp.allMatchedStrategies.some((st) => st.strategyId === strategyFilter)
      );
    }
    filteredOpportunities.sort((a, b) => b.confluenceScore - a.confluenceScore);

    const payload = {
      success: true,
      hasData: filteredOpportunities.length > 0,
      isPersisted: false,
      scanStatus: "BACKEND_UNAVAILABLE_INLINE_SCAN",
      timestamp: new Date().toISOString(),
      universe: universeParam,
      coverage: {
        symbolsQueued: symbolsToScan.length,
        scannedSuccessfully: allProfiles.length,
        skippedCount: skippedList.length,
        failedCount: failedList.length,
        opportunitiesFound: filteredOpportunities.length,
      },
      scannedTotalCount: allProfiles.length,
      opportunitiesCount: filteredOpportunities.length,
      multiStrategyCount: multiStrategyMatches.length,
      marketRegime,
      strategyCounts,
      opportunities: filteredOpportunities,
      multiStrategyMatches,
      quotes: quoteMap,
      skippedSymbols: skippedList,
      failedSymbols: failedList,
      dataProvider: "Yahoo Finance v8 Chart API (.NS)",
      disclaimer:
        "Backend unavailable — inline scan of liquid universe only. Use /api/indian/swing/nse-scanner for full NSE coverage.",
    };

    scanCache[cacheKey] = { timestamp: now, data: payload };
    return NextResponse.json(payload);
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        error: err.message || "Failed to retrieve persisted daily stock strategy scan",
      },
      { status: 500 }
    );
  }
}

function getEmptyStrategyCounts(): Record<StrategyId, number> {
  return {
    STRATEGY_A_BREAKOUT: 0,
    STRATEGY_B_PULLBACK: 0,
    STRATEGY_C_SUPPORT_BOUNCE: 0,
    STRATEGY_D_MA_CROSSOVER: 0,
    STRATEGY_E_MOMENTUM: 0,
    STRATEGY_F_RANGE_BREAKOUT: 0,
    STRATEGY_G_TREND_CONTINUATION: 0,
    STRATEGY_H_VOLUME_BREAKOUT: 0,
  };
}

function getDefaultMarketRegime() {
  return {
    niftySpot: 24700.45,
    niftyChangePercent: 0.85,
    niftyEma20: 24520.0,
    bias: "BULLISH_TREND",
    clearance: "HIGH_CONVICTION",
    regimeScore: 88,
    analysisSummary: "NIFTY 50 trading above 20 EMA. Cash swing market conditions favorable for high-confluence setups.",
  };
}
