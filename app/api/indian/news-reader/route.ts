import { NextRequest, NextResponse } from "next/server";
import {
  RawNewsHeadline,
  ActiveSymbolTradeContext,
  SymbolAiShieldReport,
  evaluateCombinedNewsAndReversalShield,
  generateMicrostructureNewsFallback,
  NSE_EQUITY_COMPANY_NAMES,
  decodeHtmlEntities,
} from "../../../../lib/indian/aiNewsReversalEngine";

export const dynamic = "force-dynamic";

interface LivePriceActionSnapshot {
  ltp: number;
  todayOpen: number;
  todayHigh: number;
  todayLow: number;
  changePercent: number;
  volumeSpikeMultiplier: number;
}

interface NewsCacheEntry {
  headlines: RawNewsHeadline[];
  cachedAt: number;
}

const NEWS_CACHE_TTL_MS = 120_000; // 2 minutes in-memory cache
const newsMemoryCache = new Map<string, NewsCacheEntry>();

async function fetchLiveNewsForSymbol(cleanSymbol: string): Promise<RawNewsHeadline[]> {
  const now = Date.now();
  const cached = newsMemoryCache.get(cleanSymbol);
  if (cached && now - cached.cachedAt < NEWS_CACHE_TTL_MS && cached.headlines.length > 0) {
    return cached.headlines;
  }

  const companyName = NSE_EQUITY_COMPANY_NAMES[cleanSymbol] || cleanSymbol;
  const rawList: RawNewsHeadline[] = [];

  // Source 1: Google News RSS for Indian Financial Markets
  try {
    const query = cleanSymbol === "NIFTY"
      ? "Nifty 50 NSE India stock index news"
      : cleanSymbol === "BANKNIFTY"
      ? "Nifty Bank NSE India stock index news"
      : `${companyName} stock NSE India`;

    const gNewsUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`;
    const res = await fetch(gNewsUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Cache-Control": "no-cache",
      },
      cache: "no-store",
    });

    if (res.ok) {
      const xml = await res.text();
      const itemRegex =
        /<item>[\s\S]*?<title>(.*?)<\/title>[\s\S]*?<link>(.*?)<\/link>[\s\S]*?<pubDate>(.*?)<\/pubDate>[\s\S]*?(?:<source[^>]*>(.*?)<\/source>)?[\s\S]*?<\/item>/g;
      const matches = [...xml.matchAll(itemRegex)];

      for (const m of matches) {
        let rawTitle = decodeHtmlEntities(m[1] || "").trim();
        const link = m[2] ? m[2].trim() : undefined;
        const pubDateStr = m[3] ? m[3].trim() : "";
        let publisher = decodeHtmlEntities(m[4] || "").trim();

        if (!publisher && rawTitle.includes(" - ")) {
          const parts = rawTitle.split(" - ");
          publisher = parts.pop()!.trim();
          rawTitle = parts.join(" - ").trim();
        }

        // Clean trailing prefixes
        rawTitle = rawTitle.replace(/^Live:\s*/i, "").trim();

        let timeIst = new Date().toLocaleTimeString("en-IN", { hour12: false });
        if (pubDateStr) {
          const parsedD = new Date(pubDateStr);
          if (!isNaN(parsedD.getTime())) {
            timeIst = parsedD.toLocaleTimeString("en-IN", { hour12: false });
          }
        }

        if (rawTitle.length > 10) {
          rawList.push({
            title: rawTitle,
            publisher: publisher || "NSE Financial Feed",
            link,
            publishedAt: timeIst,
          });
        }
      }
    }
  } catch {
    // try fallback
  }

  // Source 2: Yahoo Finance Search API as supplemental / fallback
  if (rawList.length < 3) {
    try {
      const queryTicker = cleanSymbol === "NIFTY" ? "^NSEI" : cleanSymbol === "BANKNIFTY" ? "^NSEBANK" : `${cleanSymbol}.NS`;
      const yUrl = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(queryTicker)}&quotesCount=1&newsCount=6`;
      const res = await fetch(yUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
        cache: "no-store",
      });
      if (res.ok) {
        const data = await res.json();
        const newsList = Array.isArray(data?.news) ? data.news : [];
        for (const n of newsList) {
          const title = String(n.title || "").trim();
          if (title && !rawList.some((r) => r.title.toLowerCase() === title.toLowerCase())) {
            rawList.push({
              title,
              publisher: String(n.publisher || "Yahoo Finance"),
              link: typeof n.link === "string" ? n.link : undefined,
              publishedAt:
                typeof n.providerPublishTime === "number"
                  ? new Date(n.providerPublishTime * 1000).toLocaleTimeString("en-IN", { hour12: false })
                  : new Date().toLocaleTimeString("en-IN", { hour12: false }),
            });
          }
        }
      }
    } catch {
      // ignore
    }
  }

  // Prioritize meaningful business / regulatory / market action news over generic landing pages
  const ACTION_WORDS_REGEX =
    /\b(earnings|profit|loss|revenue|order|clears|target|buy|sell|sebi|results|jump|gain|soar|fall|drop|plunge|deal|investor|dividend|q[1-4]|guidance|rating|contract|shares|stocks|high|low|acquisition|expansion|growth|bid)\b/i;

  const sortedList = [...rawList].sort((a, b) => {
    const aAction = ACTION_WORDS_REGEX.test(a.title) ? 1 : 0;
    const bAction = ACTION_WORDS_REGEX.test(b.title) ? 1 : 0;
    const aGeneric = /share price.*stock price/i.test(a.title) ? -1 : 0;
    const bGeneric = /share price.*stock price/i.test(b.title) ? -1 : 0;
    return bAction + bGeneric - (aAction + aGeneric);
  });

  const finalHeadlines = sortedList.slice(0, 6);
  if (finalHeadlines.length > 0) {
    newsMemoryCache.set(cleanSymbol, {
      headlines: finalHeadlines,
      cachedAt: now,
    });
  }

  return finalHeadlines;
}

async function fetchYahooPriceActionForSymbol(
  cleanSymbol: string,
  fallbackPrice = 1000
): Promise<LivePriceActionSnapshot> {
  const ticker =
    cleanSymbol === "NIFTY"
      ? "^NSEI"
      : cleanSymbol === "BANKNIFTY"
      ? "^NSEBANK"
      : cleanSymbol.startsWith("^")
      ? cleanSymbol
      : `${cleanSymbol}.NS`;

  const endpoints = [
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1mo&interval=1d&_t=${Date.now()}`,
    `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1mo&interval=1d&_t=${Date.now()}`,
  ];

  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
          "Cache-Control": "no-cache, no-store, must-revalidate",
        },
        cache: "no-store",
      });
      if (!res.ok) continue;
      const data = await res.json();
      const result = data?.chart?.result?.[0];
      if (!result) continue;

      const meta = result.meta || {};
      const quote = result.indicators?.quote?.[0] || {};
      const closes: number[] = (quote.close || []).filter((v: any) => typeof v === "number" && v > 0);
      const opens: number[] = (quote.open || []).filter((v: any) => typeof v === "number" && v > 0);
      const highs: number[] = (quote.high || []).filter((v: any) => typeof v === "number" && v > 0);
      const lows: number[] = (quote.low || []).filter((v: any) => typeof v === "number" && v > 0);
      const volumes: number[] = (quote.volume || []).filter((v: any) => typeof v === "number" && v >= 0);

      const ltp = Number(
        (typeof meta.regularMarketPrice === "number" && meta.regularMarketPrice > 0
          ? meta.regularMarketPrice
          : closes[closes.length - 1] ?? fallbackPrice
        ).toFixed(2)
      );
      const prevClose = Number(
        (typeof meta.chartPreviousClose === "number" && meta.chartPreviousClose > 0
          ? meta.chartPreviousClose
          : closes[closes.length - 2] ?? ltp
        ).toFixed(2)
      );
      const todayOpen = Number((opens[opens.length - 1] ?? prevClose).toFixed(2));
      const todayHigh = Number(Math.max(highs[highs.length - 1] ?? ltp, ltp).toFixed(2));
      const todayLow = Number(Math.min(lows[lows.length - 1] ?? ltp, ltp).toFixed(2));
      const todayVol = Number(volumes[volumes.length - 1] ?? 1000000);
      const priorVols = volumes.slice(0, -1);
      const avgVol =
        priorVols.length > 0
          ? priorVols.reduce((a, b) => a + b, 0) / priorVols.length
          : Math.max(1, todayVol * 0.8);
      const volumeSpikeMultiplier = Number(Math.min(5.0, Math.max(0.8, todayVol / Math.max(1, avgVol))).toFixed(2));
      const changePercent = Number((((ltp - prevClose) / Math.max(1, prevClose)) * 100).toFixed(2));

      return {
        ltp,
        todayOpen,
        todayHigh,
        todayLow,
        changePercent,
        volumeSpikeMultiplier,
      };
    } catch {
      // try fallback
    }
  }

  return {
    ltp: fallbackPrice,
    todayOpen: fallbackPrice,
    todayHigh: Number((fallbackPrice * 1.005).toFixed(2)),
    todayLow: Number((fallbackPrice * 0.995).toFixed(2)),
    changePercent: 0,
    volumeSpikeMultiplier: 1.2,
  };
}

async function runNewsReaderWorker(
  trades: ActiveSymbolTradeContext[],
  simulateCatalystSymbol?: string | null
) {
  const reports: Record<string, SymbolAiShieldReport> = {};
  const livePrices: Record<string, number> = {};

  const uniqueTrades = trades.slice(0, 30);
  const simSym = simulateCatalystSymbol
    ? simulateCatalystSymbol.trim().toUpperCase().replace(/\.NS$/i, "").replace(/\.BO$/i, "")
    : null;

  await Promise.allSettled(
    uniqueTrades.map(async (tr) => {
      const cleanSym = String(tr.symbol || "")
        .trim()
        .toUpperCase()
        .replace(/\.NS$/i, "")
        .replace(/\.BO$/i, "");
      if (!cleanSym) return;

      const [headlines, priceSnap] = await Promise.all([
        fetchLiveNewsForSymbol(cleanSym),
        fetchYahooPriceActionForSymbol(cleanSym, tr.currentPrice || tr.entryPrice || 1000),
      ]);

      const effectiveLtp = priceSnap.ltp > 0 ? priceSnap.ltp : tr.currentPrice || tr.entryPrice || 1000;
      livePrices[cleanSym] = effectiveLtp;

      const report = evaluateCombinedNewsAndReversalShield({
        symbol: cleanSym,
        headlines,
        tradeContext: {
          ...tr,
          symbol: cleanSym,
          currentPrice: effectiveLtp,
        },
        liveLtp: effectiveLtp,
        todayHigh: Math.max(priceSnap.todayHigh, effectiveLtp),
        todayLow: Math.min(priceSnap.todayLow, effectiveLtp),
        todayOpen: priceSnap.todayOpen,
        volumeSpikeMultiplier: priceSnap.volumeSpikeMultiplier,
        changePercent: priceSnap.changePercent,
        simulateAdverseCatalyst: simSym === cleanSym,
      });

      reports[cleanSym] = report;
    })
  );

  const triggeredExits = Object.values(reports).filter((r) => r.shouldAutoExit);

  return {
    success: true,
    timestamp: new Date().toISOString(),
    evaluatedCount: Object.keys(reports).length,
    triggeredExitCount: triggeredExits.length,
    triggeredExits,
    reports,
    livePrices,
  };
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const rawSymbols = (url.searchParams.get("symbols") || "")
      .split(",")
      .map((s) => s.trim().toUpperCase().replace(/\.NS$/i, "").replace(/\.BO$/i, ""))
      .filter((s) => /^[A-Z0-9&\-^]{1,20}$/.test(s));

    const simulateCatalystSymbol = url.searchParams.get("simulateCatalystSymbol");

    const trades: ActiveSymbolTradeContext[] = Array.from(new Set(rawSymbols)).map((symbol) => ({
      symbol,
    }));

    const payload = await runNewsReaderWorker(trades, simulateCatalystSymbol);
    return NextResponse.json(payload);
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err?.message || "AI News Reader error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const rawTrades: ActiveSymbolTradeContext[] = Array.isArray(body?.trades) ? body.trades : [];
    const simulateCatalystSymbol: string | null = body?.simulateCatalystSymbol || null;

    const payload = await runNewsReaderWorker(rawTrades, simulateCatalystSymbol);
    return NextResponse.json(payload);
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err?.message || "AI News Reader POST error" }, { status: 500 });
  }
}

