import { NextRequest, NextResponse } from "next/server";
import { BACKEND_URL } from "@/lib/backendUrl";
import { MatchedStockOpportunity, StrategyId } from "@/lib/indian/dailyStrategyScanner";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const universeParam = (searchParams.get("universe") || "MOMENTUM_LEADERS").toUpperCase();
    const strategyFilter = (searchParams.get("strategy") || "ALL").toUpperCase();
    const forceRefresh = searchParams.get("forceRefresh") === "true";
    const dateParam = searchParams.get("date"); // e.g. "2026-10-12"

    // 1. If forceRefresh is requested, trigger manual scan on Fastify backend
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

    // 4. Fallback if backend is unavailable
    return NextResponse.json({
      success: true,
      hasData: false,
      isPersisted: false,
      scanRun: null,
      scanDate: null,
      completedAt: null,
      scanType: null,
      scanStatus: "BACKEND_UNAVAILABLE",
      opportunitiesCount: 0,
      multiStrategyCount: 0,
      opportunities: [],
      multiStrategyMatches: [],
      strategyCounts: getEmptyStrategyCounts(),
      marketRegime: getDefaultMarketRegime(),
      message: "Fastify backend service is unreachable. Ensure the backend server is running on port 4000.",
    });
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
