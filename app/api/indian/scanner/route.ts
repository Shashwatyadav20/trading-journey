import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_NSE_SMC_SYMBOLS } from "@/lib/indian/institutionalSwingEngine";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface LiveSnapshot {
  symbol: string;
  ltp: number | null;
  prevClose: number | null;
  changePercent: number | null;
  marketTimestamp: number | null;
}

async function fetchLiveSnapshot(symbol: string): Promise<LiveSnapshot> {
  const clean = symbol.trim().toUpperCase().replace(/\.NS$/i, "").replace(/\.BO$/i, "");
  const ticker = clean.startsWith("^") ? clean : `${clean}.NS`;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1d&interval=1d&_t=${Date.now()}`;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "Cache-Control": "no-cache, no-store, must-revalidate",
        Pragma: "no-cache",
      },
      cache: "no-store",
    });

    if (res.ok) {
      const data = await res.json();
      const result = data?.chart?.result?.[0];
      const meta = result?.meta;
      const rawLtp = meta?.regularMarketPrice;
      const rawPrev = meta?.chartPreviousClose ?? meta?.previousClose;

      const ltp = typeof rawLtp === "number" && rawLtp > 0 ? Number(rawLtp.toFixed(2)) : null;
      const prevClose = typeof rawPrev === "number" && rawPrev > 0 ? Number(rawPrev.toFixed(2)) : null;
      const changePercent =
        ltp !== null && prevClose !== null && prevClose > 0
          ? Number((((ltp - prevClose) / prevClose) * 100).toFixed(2))
          : null;

      return {
        symbol: clean,
        ltp,
        prevClose,
        changePercent,
        marketTimestamp: typeof meta?.regularMarketTime === "number" ? meta.regularMarketTime * 1000 : Date.now(),
      };
    }
  } catch {}

  // Fallback if network blocked or rate limited
  const baseline = DEFAULT_NSE_SMC_SYMBOLS.find((s) => s.symbol === clean);
  const fallbackLtp = baseline?.fallbackLtp ?? 1000.0;
  return {
    symbol: clean,
    ltp: fallbackLtp,
    prevClose: fallbackLtp,
    changePercent: 0,
    marketTimestamp: Date.now(),
  };
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const rawSymbol = searchParams.get("symbol") || "";
    const rawSymbols = searchParams.get("symbols") || "";

    const symbolList: string[] = [];

    if (rawSymbol) {
      symbolList.push(rawSymbol.trim().toUpperCase());
    }
    if (rawSymbols) {
      rawSymbols.split(",").forEach((s) => {
        const clean = s.trim().toUpperCase();
        if (clean) symbolList.push(clean);
      });
    }

    // Default to SMC monitored universe if no symbol provided
    if (symbolList.length === 0) {
      DEFAULT_NSE_SMC_SYMBOLS.forEach((s) => symbolList.push(s.symbol));
    }

    const uniqueSymbols = Array.from(new Set(symbolList));
    const snapshots = await Promise.all(uniqueSymbols.map((sym) => fetchLiveSnapshot(sym)));

    const livePrices: Record<string, { ltp: number; changePercent: number | null; prevClose: number | null }> = {};
    for (const snap of snapshots) {
      if (snap.ltp !== null) {
        livePrices[snap.symbol] = {
          ltp: snap.ltp,
          changePercent: snap.changePercent,
          prevClose: snap.prevClose,
        };
      }
    }

    const firstSnap = snapshots[0] || null;

    return NextResponse.json({
      success: true,
      symbol: firstSnap?.symbol,
      ltp: firstSnap?.ltp,
      changePercent: firstSnap?.changePercent,
      prevClose: firstSnap?.prevClose,
      livePrices,
      timestamp: new Date().toISOString(),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Live scanner route error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
