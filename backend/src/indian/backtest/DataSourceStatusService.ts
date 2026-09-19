import { CandidateSourceInfo } from "../market/INiftyHistoricalDataProvider";

export interface DataSourceAuditEntry {
  provider: string;
  purpose: string;
  spotData: boolean;
  optionChain: boolean;
  historicalOptions: boolean;
  apiConfigured: boolean;
  currentlyWorking: boolean;
}

export interface DataSourceStatus {
  historicalProviderAvailable: boolean;
  historicalProviderName: string;
  csvImportAvailable: boolean;
  realDataAvailable: boolean;
  syntheticDataAvailable: boolean;
  backtestReady: boolean;
  reason: string;
  csvTemplate: string;
  providersAudit: DataSourceAuditEntry[];
  candidateSources: CandidateSourceInfo[];
}

export class DataSourceStatusService {
  /**
   * Generates the canonical CSV template string for historical option data.
   */
  public getCSVTemplate(): string {
    return `# TEMPLATE_ONLY — NOT REAL MARKET DATA
# Format: timestamp,expiry,strike,optionType,LTP,bid,ask,volume,OI,IV
# Required columns: timestamp, expiry, strike, optionType, LTP
# Optional columns: bid, ask, volume, OI, IV
timestamp,expiry,strike,optionType,LTP,bid,ask,volume,OI,IV`;
  }

  /**
   * Conducts systemic audit of all workspace market data providers.
   */
  public getProvidersAudit(): DataSourceAuditEntry[] {
    const isTwelveDataConfigured = !!process.env.TWELVE_DATA_API_KEY;

    return [
      {
        provider: "Twelve Data API",
        purpose: "Index & Commodity Spot Price Feed (XAU/USD, NIFTY Spot)",
        spotData: true,
        optionChain: false,
        historicalOptions: false,
        apiConfigured: isTwelveDataConfigured,
        currentlyWorking: isTwelveDataConfigured,
      },
      {
        provider: "OANDA v20 API",
        purpose: "Forex & CFD Spot Quotes (XAU/USD)",
        spotData: true,
        optionChain: false,
        historicalOptions: false,
        apiConfigured: !!process.env.OANDA_API_KEY,
        currentlyWorking: !!process.env.OANDA_API_KEY,
      },
      {
        provider: "Coinbase WebSocket",
        purpose: "Crypto Ticks (BTC/USD)",
        spotData: true,
        optionChain: false,
        historicalOptions: false,
        apiConfigured: true,
        currentlyWorking: true,
      },
      {
        provider: "Indian Broker API (Kite/Dhan/AngelOne)",
        purpose: "Live NIFTY Options Execution & Order Book",
        spotData: false,
        optionChain: false,
        historicalOptions: false,
        apiConfigured: false,
        currentlyWorking: false, // Locked OFF via LIVE_TRADING = false
      },
    ];
  }

  /**
   * Returns candidate legitimate historical options data sources matrix.
   */
  public getCandidateSources(): CandidateSourceInfo[] {
    return [
      {
        provider: "NSE Archives / Daily Bhavcopy",
        historicalOptions: true,
        intradayOptions: false,
        timestampResolution: "1d (Daily EOD)",
        OI: "AVAILABLE",
        IV: "NOT AVAILABLE",
        bidAsk: "NOT AVAILABLE",
        exportFormat: "CSV / ZIP",
        authentication: "Public Download (No Auth)",
        cost: "Free",
        licenseStatus: "Public Data",
        integrationStatus: "MANUAL_ONLY",
        capabilities: [
          { field: "timestamp", status: "AVAILABLE" },
          { field: "expiry", status: "AVAILABLE" },
          { field: "strike", status: "AVAILABLE" },
          { field: "CE/PE", status: "AVAILABLE" },
          { field: "LTP", status: "AVAILABLE" },
          { field: "bid", status: "NOT AVAILABLE" },
          { field: "ask", status: "NOT AVAILABLE" },
          { field: "volume", status: "AVAILABLE" },
          { field: "OI", status: "AVAILABLE" },
          { field: "IV", status: "NOT AVAILABLE" },
        ],
      },
      {
        provider: "Zerodha Kite Connect Historical API",
        historicalOptions: true,
        intradayOptions: true,
        timestampResolution: "1m / 5m / 15m",
        OI: "AVAILABLE",
        IV: "NOT AVAILABLE",
        bidAsk: "NOT AVAILABLE",
        exportFormat: "JSON REST",
        authentication: "API Key + Enctoken",
        cost: "Paid (₹2,000 + ₹2,000/mo)",
        licenseStatus: "Broker Subscription",
        integrationStatus: "NOT_CONFIGURED",
        capabilities: [
          { field: "timestamp", status: "AVAILABLE" },
          { field: "expiry", status: "AVAILABLE" },
          { field: "strike", status: "AVAILABLE" },
          { field: "CE/PE", status: "AVAILABLE" },
          { field: "LTP", status: "AVAILABLE" },
          { field: "bid", status: "NOT AVAILABLE" },
          { field: "ask", status: "NOT AVAILABLE" },
          { field: "volume", status: "AVAILABLE" },
          { field: "OI", status: "AVAILABLE" },
          { field: "IV", status: "NOT AVAILABLE" },
        ],
      },
      {
        provider: "TrueData Options Historical API",
        historicalOptions: true,
        intradayOptions: true,
        timestampResolution: "Tick / 1m / 15m",
        OI: "AVAILABLE",
        IV: "AVAILABLE",
        bidAsk: "AVAILABLE",
        exportFormat: "WebSocket / REST JSON",
        authentication: "API Key + User Auth",
        cost: "Paid (₹3,500/mo)",
        licenseStatus: "Commercial Market Data",
        integrationStatus: "NOT_CONFIGURED",
        capabilities: [
          { field: "timestamp", status: "AVAILABLE" },
          { field: "expiry", status: "AVAILABLE" },
          { field: "strike", status: "AVAILABLE" },
          { field: "CE/PE", status: "AVAILABLE" },
          { field: "LTP", status: "AVAILABLE" },
          { field: "bid", status: "AVAILABLE" },
          { field: "ask", status: "AVAILABLE" },
          { field: "volume", status: "AVAILABLE" },
          { field: "OI", status: "AVAILABLE" },
          { field: "IV", status: "AVAILABLE" },
        ],
      },
      {
        provider: "User-Supplied Genuine Historical CSV Importer",
        historicalOptions: true,
        intradayOptions: true,
        timestampResolution: "Custom (1m / 5m / 15m)",
        OI: "AVAILABLE",
        IV: "AVAILABLE",
        bidAsk: "AVAILABLE",
        exportFormat: "CSV Upload",
        authentication: "Local File Upload",
        cost: "Free",
        licenseStatus: "User Provided",
        integrationStatus: "ACTIVE",
        capabilities: [
          { field: "timestamp", status: "AVAILABLE" },
          { field: "expiry", status: "AVAILABLE" },
          { field: "strike", status: "AVAILABLE" },
          { field: "CE/PE", status: "AVAILABLE" },
          { field: "LTP", status: "AVAILABLE" },
          { field: "bid", status: "AVAILABLE", notes: "Optional field" },
          { field: "ask", status: "AVAILABLE", notes: "Optional field" },
          { field: "volume", status: "AVAILABLE", notes: "Optional field" },
          { field: "OI", status: "AVAILABLE", notes: "Optional field" },
          { field: "IV", status: "AVAILABLE", notes: "Optional field" },
        ],
      },
    ];
  }

  /**
   * Computes comprehensive data-source availability status.
   */
  public getDataSourceStatus(hasRealImportedDataset: boolean = false): DataSourceStatus {
    const providers = this.getProvidersAudit();
    const historicalProvider = providers.find((p) => p.historicalOptions && p.currentlyWorking);

    const historicalProviderAvailable = !!historicalProvider;
    const historicalProviderName = historicalProvider ? historicalProvider.provider : "NOT CONFIGURED";
    const realDataAvailable = hasRealImportedDataset || historicalProviderAvailable;

    let reason = "NO_HISTORICAL_OPTION_PROVIDER_CONFIGURED";
    if (realDataAvailable) {
      reason = "REAL HISTORICAL OPTION DATA AVAILABLE";
    } else {
      reason = "No genuine historical NIFTY option-chain provider or imported CSV dataset available in project. Upload a historical option CSV to run live backtest validation.";
    }

    return {
      historicalProviderAvailable,
      historicalProviderName,
      csvImportAvailable: true,
      realDataAvailable,
      syntheticDataAvailable: true, // Synthetic estimation engine is always operational
      backtestReady: realDataAvailable,
      reason,
      csvTemplate: this.getCSVTemplate(),
      providersAudit: providers,
      candidateSources: this.getCandidateSources(),
    };
  }
}

export const dataSourceStatusService = new DataSourceStatusService();
