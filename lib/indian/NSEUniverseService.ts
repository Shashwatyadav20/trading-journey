/**
 * Dynamic NSE Cash-Market Stock Universe Service (Shared/Client Library)
 */

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

  public resolveSymbol(rawSymbol: string): string {
    const clean = rawSymbol.trim().toUpperCase().replace(/\.NS$/, "").replace(/\.BO$/, "");
    return SYMBOL_ALIASES[clean] || clean;
  }

  public getUniverseMetadata(): NSEUniverseMetadata {
    return { ...this.metadata };
  }

  public getSecurity(symbol: string): NSEUniverseSecurity | undefined {
    const resolved = this.resolveSymbol(symbol);
    return this.securities.get(resolved);
  }

  public isEligibleSecurity(symbol: string): boolean {
    const resolved = this.resolveSymbol(symbol);
    return this.securities.has(resolved);
  }

  public getEligibleUniverse(
    preset: UniversePreset = "NIFTY_500",
    options?: {
      maxSymbols?: number;
      offset?: number;
      symbols?: string[];
    }
  ): NSEUniverseSecurity[] {
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

    const offset = Math.max(0, options?.offset || 0);
    let result = list.slice(offset);
    if (options?.maxSymbols && options.maxSymbols > 0) {
      result = result.slice(0, options.maxSymbols);
    }

    return result;
  }
}

export const nseUniverseService = new NSEUniverseService();
