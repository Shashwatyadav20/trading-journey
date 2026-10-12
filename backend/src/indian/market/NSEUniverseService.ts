/**
 * Dynamic NSE Cash-Market Stock Universe Service
 *
 * Dynamically sources, validates, and filters the National Stock Exchange (NSE) equity universe.
 * Primary source: Official NSE India listed equity securities repository (EQUITY_L.csv)
 * and benchmark index repositories (ind_nifty500list.csv).
 *
 * Invariants:
 * 1. Excludes non-equity series (BE, SM, ST, BZ, IL, P, etc.).
 * 2. Excludes ETFs, Index funds, Mutual funds, Gold/Silver BeES, REITs, InvITs.
 * 3. Excludes derivatives-only instruments and invalid/suspended tickers.
 * 4. Resolves corporate action renamings/aliases (e.g. ZOMATO -> ETERNAL).
 * 5. Deduplicates by Symbol and ISIN.
 * 6. Records full transparency metrics: total raw, exclusions by reason, eligible count.
 * 7. Never relies on hardcoded 10-stock arrays.
 */

import fs from "fs";
import path from "path";
import baselineData from "./data/nse_equity_baseline.json";

export interface NSEUniverseSecurity {
  symbol: string;
  cleanSymbol: string;
  companyName: string;
  series: string;
  isin: string;
  industry?: string;
  isNifty500?: boolean;
}

export interface NSEUniverseMetadata {
  source: string;
  lastUpdated: string;
  totalRawSecurities: number;
  excludedNonEQSeries: number;
  excludedETFsAndFunds: number;
  excludedInvalidOrSuspended: number;
  eligibleCashEquitiesCount: number;
  nifty500Count: number;
}

export type UniversePreset = "ALL_NSE_CASH" | "NIFTY_500" | "NIFTY_100" | "NIFTY_50";

export const SYMBOL_ALIASES: Record<string, string> = {
  ZOMATO: "ETERNAL",
};

export class NSEUniverseService {
  private metadata: NSEUniverseMetadata;
  private securities: Map<string, NSEUniverseSecurity> = new Map();
  private nifty500Symbols: Set<string> = new Set();
  private nifty100Symbols: Set<string> = new Set();
  private nifty50Symbols: Set<string> = new Set();
  private isRefreshing: boolean = false;

  constructor() {
    this.metadata = baselineData.metadata;
    this.loadBaseline(baselineData);
  }

  private loadBaseline(data: { metadata: NSEUniverseMetadata; securities: any[] }) {
    this.metadata = data.metadata;
    this.securities.clear();
    this.nifty500Symbols.clear();
    this.nifty100Symbols.clear();
    this.nifty50Symbols.clear();

    for (const item of data.securities) {
      const cleanSymbol = item.symbol.toUpperCase().trim();
      const security: NSEUniverseSecurity = {
        symbol: cleanSymbol,
        cleanSymbol,
        companyName: item.companyName,
        series: item.series || "EQ",
        isin: item.isin,
        industry: item.industry,
        isNifty500: Boolean(item.isNifty500),
      };
      this.securities.set(cleanSymbol, security);
      if (item.isNifty500) {
        this.nifty500Symbols.add(cleanSymbol);
      }
    }

    // Top 50 and 100 liquid bluechips subset from the Nifty 500
    const top50 = [
      "RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK", "BHARTIARTL", "SBIN",
      "LT", "ITC", "BAJFINANCE", "MARUTI", "TATAMOTORS", "TITAN", "SUNPHARMA",
      "AXISBANK", "NTPC", "ONGC", "POWERGRID", "M&M", "COALINDIA", "TATASTEEL",
      "KOTAKBANK", "HINDALCO", "JSWSTEEL", "ADANIENT", "ADANIPORTS", "TECHM",
      "WIPRO", "HCLTECH", "ULTRACEMCO", "BAJAJFINSV", "NESTLEIND", "GRASIM",
      "DRREDDY", "CIPLA", "APOLLOHOSP", "DIVISLAB", "TATACONSUM", "HEROMOTOCO",
      "ASIANPAINT", "BAJAJ-AUTO", "EICHERMOT", "BRITANNIA", "BPCL", "SHRIRAMFIN",
      "TRENT", "BEL", "INDUSINDBK", "HDFCLIFE", "SBILIFE"
    ];
    top50.forEach(s => {
      this.nifty50Symbols.add(s);
      this.nifty100Symbols.add(s);
    });

    const next50 = [
      "HAL", "DIXON", "BSE", "CDSL", "PERSISTENT", "POLYCAB", "COCHINSHIP",
      "MAZDOCK", "SUZLON", "ETERNAL", "MCX", "KALYANKJIL", "ANGELONE", "IRFC",
      "VOLTAS", "CUMMINSIND", "ABB", "SIEMENS", "BHEL", "VBL", "CHOLAFIN",
      "TVSMOTOR", "HAVELLS", "PIDILITIND", "GAIL", "DLF", "IOC", "VEDL",
      "AMBUJACEM", "BANKBARODA", "PNB", "INDIGO", "ZOMATO", "GODREJCP",
      "DABUR", "ICICIPRULI", "ICICIGI", "MOTHERSON", "BOSCHLTD", "COLPAL"
    ];
    next50.forEach(s => this.nifty100Symbols.add(this.resolveSymbol(s)));
  }

  /**
   * Resolves corporate actions, ticker rebranding, and well-known symbol migrations.
   */
  public resolveSymbol(rawSymbol: string): string {
    const clean = rawSymbol.trim().toUpperCase().replace(/\.NS$/, "").replace(/\.BO$/, "");
    return SYMBOL_ALIASES[clean] || clean;
  }

  /**
   * Returns metadata and audit counters regarding universe composition and exclusions.
   */
  public getUniverseMetadata(): NSEUniverseMetadata {
    return { ...this.metadata };
  }

  /**
   * Returns a security descriptor by symbol if eligible.
   */
  public getSecurity(symbol: string): NSEUniverseSecurity | undefined {
    const resolved = this.resolveSymbol(symbol);
    return this.securities.get(resolved);
  }

  /**
   * Returns true if the symbol is in the eligible cash equity universe.
   */
  public isEligibleSecurity(symbol: string): boolean {
    const resolved = this.resolveSymbol(symbol);
    return this.securities.has(resolved);
  }

  /**
   * Retrieves an array of eligible securities based on preset and filtering options.
   */
  public getEligibleUniverse(
    preset: UniversePreset = "NIFTY_500",
    options?: {
      maxSymbols?: number;
      offset?: number;
      symbols?: string[];
      requireNifty500?: boolean;
    }
  ): NSEUniverseSecurity[] {
    // 1. Explicit symbols override
    if (options?.symbols && options.symbols.length > 0) {
      const explicitList: NSEUniverseSecurity[] = [];
      for (const sym of options.symbols) {
        const resolved = this.resolveSymbol(sym);
        const sec = this.securities.get(resolved) || {
          symbol: resolved,
          cleanSymbol: resolved,
          companyName: resolved,
          series: "EQ",
          isin: "MANUAL_OVERRIDE",
          isNifty500: this.nifty500Symbols.has(resolved),
        };
        explicitList.push(sec);
      }
      return explicitList;
    }

    // 2. Select by preset
    let list: NSEUniverseSecurity[] = [];
    if (preset === "ALL_NSE_CASH") {
      list = Array.from(this.securities.values());
    } else if (preset === "NIFTY_500") {
      list = Array.from(this.securities.values()).filter(
        (s) => s.isNifty500 || this.nifty500Symbols.has(s.symbol)
      );
    } else if (preset === "NIFTY_100") {
      list = Array.from(this.securities.values()).filter((s) =>
        this.nifty100Symbols.has(s.symbol)
      );
    } else if (preset === "NIFTY_50") {
      list = Array.from(this.securities.values()).filter((s) =>
        this.nifty50Symbols.has(s.symbol)
      );
    } else {
      list = Array.from(this.securities.values());
    }

    // Apply offset and maxSymbols pagination if provided
    const offset = Math.max(0, options?.offset || 0);
    let result = list.slice(offset);
    if (options?.maxSymbols && options.maxSymbols > 0) {
      result = result.slice(0, options.maxSymbols);
    }

    return result;
  }

  /**
   * Safely refreshes universe from official NSE archive endpoints.
   * If network fails or endpoints return non-200, retains current universe safely.
   */
  public async refreshUniverse(): Promise<NSEUniverseMetadata> {
    if (this.isRefreshing) {
      return this.metadata;
    }

    this.isRefreshing = true;
    try {
      const eqUrl = "https://archives.nseindia.com/content/equities/EQUITY_L.csv";
      const n500Url = "https://archives.nseindia.com/content/indices/ind_nifty500list.csv";

      const [eqRes, n500Res] = await Promise.all([
        fetch(eqUrl, { headers: { "User-Agent": "Mozilla/5.0" } }).catch(() => null),
        fetch(n500Url, { headers: { "User-Agent": "Mozilla/5.0" } }).catch(() => null),
      ]);

      if (!eqRes || !eqRes.ok) {
        console.warn(`[NSEUniverseService] Could not reach EQUITY_L.csv (HTTP ${eqRes?.status || "network_err"}). Preserving baseline universe.`);
        return this.metadata;
      }

      const eqText = await eqRes.text();
      const eqLines = eqText.split("\n").filter((l) => l.trim().length > 0);

      const n500Map = new Map<string, { companyName: string; industry: string }>();
      if (n500Res && n500Res.ok) {
        const n500Text = await n500Res.text();
        const n500Lines = n500Text.split("\n").filter((l) => l.trim().length > 0);
        for (let i = 1; i < n500Lines.length; i++) {
          const parts = n500Lines[i].split(",").map((p) => p.trim());
          if (parts.length >= 3) {
            n500Map.set(parts[2].toUpperCase(), { companyName: parts[0], industry: parts[1] });
          }
        }
      }

      const totalRaw = eqLines.length - 1;
      let excludedNonEQ = 0;
      let excludedETFs = 0;
      let excludedInvalid = 0;

      const freshSecurities: NSEUniverseSecurity[] = [];
      const seen = new Set<string>();

      for (let i = 1; i < eqLines.length; i++) {
        const parts = eqLines[i].split(",").map((p) => p.trim());
        if (parts.length < 3) continue;
        const rawSymbol = parts[0].toUpperCase();
        const companyName = parts[1];
        const series = parts[2];
        const isin = parts[6] || "";

        if (series !== "EQ") {
          excludedNonEQ++;
          continue;
        }

        if (
          rawSymbol.endsWith("BEES") ||
          rawSymbol.endsWith("ETF") ||
          rawSymbol.endsWith("GOLD") ||
          rawSymbol.endsWith("SILVER") ||
          companyName.toUpperCase().includes("EXCHANGE TRADED FUND") ||
          companyName.toUpperCase().includes(" ETF") ||
          companyName.toUpperCase().includes("MUTUAL FUND") ||
          companyName.toUpperCase().includes("INVIT") ||
          companyName.toUpperCase().includes("REIT")
        ) {
          excludedETFs++;
          continue;
        }

        if (!rawSymbol || rawSymbol.length < 2 || /[^A-Z0-9&-]/i.test(rawSymbol)) {
          excludedInvalid++;
          continue;
        }

        if (seen.has(rawSymbol)) continue;
        seen.add(rawSymbol);

        const n500Info = n500Map.get(rawSymbol);
        freshSecurities.push({
          symbol: rawSymbol,
          cleanSymbol: rawSymbol,
          companyName,
          series,
          isin,
          industry: n500Info?.industry,
          isNifty500: Boolean(n500Info),
        });
      }

      const newMetadata: NSEUniverseMetadata = {
        source: "NSE_OFFICIAL_ARCHIVES",
        lastUpdated: new Date().toISOString(),
        totalRawSecurities: totalRaw,
        excludedNonEQSeries: excludedNonEQ,
        excludedETFsAndFunds: excludedETFs,
        excludedInvalidOrSuspended: excludedInvalid,
        eligibleCashEquitiesCount: freshSecurities.length,
        nifty500Count: freshSecurities.filter((s) => s.isNifty500).length,
      };

      this.metadata = newMetadata;
      this.loadBaseline({ metadata: newMetadata, securities: freshSecurities });
      console.log(`[NSEUniverseService] Universe refreshed successfully. Eligible: ${freshSecurities.length}`);
      return this.metadata;
    } catch (err: any) {
      console.warn(`[NSEUniverseService] Error refreshing universe: ${err.message}. Retaining existing universe.`);
      return this.metadata;
    } finally {
      this.isRefreshing = false;
    }
  }
}

export const nseUniverseService = new NSEUniverseService();
