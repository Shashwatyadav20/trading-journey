import { NextRequest, NextResponse } from "next/server";
import { fetchLiveStockCandles } from "@/lib/indian/liveSwingScanner";
import {
  runHistoricalBacktest,
  StrategyId,
} from "@/lib/indian/dailyStrategyScanner";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const rawSymbol = (searchParams.get("symbol") || "TRENT").toUpperCase().trim();
    const cleanSymbol = rawSymbol.replace(/\.NS$/, "").replace(/\.BO$/, "");
    const strategyId = (searchParams.get("strategy") || "STRATEGY_A_BREAKOUT") as StrategyId;

    const candleData = await fetchLiveStockCandles(cleanSymbol);
    if (!candleData || candleData.candles.length < 20) {
      return NextResponse.json(
        {
          success: false,
          error: `Insufficient historical data to run backtest on '${cleanSymbol}'`,
        },
        { status: 404 }
      );
    }

    const backtestResult = runHistoricalBacktest(
      cleanSymbol,
      strategyId,
      candleData.candles
    );

    return NextResponse.json({
      success: true,
      data: backtestResult,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        error: err.message || "Failed to execute backtest",
      },
      { status: 500 }
    );
  }
}
