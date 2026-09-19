import {
  INiftyHistoricalDataProvider,
  FetchHistoricalOptionsRequest,
  FetchHistoricalOptionsResponse,
  CandidateSourceInfo,
} from "./INiftyHistoricalDataProvider";

export class NiftyHistoricalDataProviderAdapter implements INiftyHistoricalDataProvider {
  private providerName: string = "Broker/Vendor API Adapter";

  public getProviderName(): string {
    return this.providerName;
  }

  public isConfigured(): boolean {
    // Check if any genuine historical options provider credentials exist in process.env
    return !!(
      process.env.NIFTY_HISTORICAL_API_KEY ||
      process.env.ZERODHA_KITE_API_KEY ||
      process.env.TRUEDATA_API_KEY
    );
  }

  public async fetchHistoricalData(
    req: FetchHistoricalOptionsRequest
  ): Promise<FetchHistoricalOptionsResponse> {
    if (!this.isConfigured()) {
      return {
        success: false,
        status: "HISTORICAL_PROVIDER_NOT_CONFIGURED",
        providerName: this.providerName,
        dataPoints: [],
        error: "No historical option provider API key configured in environment. Supply genuine CSV or configure API credentials.",
      };
    }

    // Provider placeholder if credentials ever supplied
    return {
      success: true,
      status: "OK",
      providerName: this.providerName,
      dataPoints: [],
    };
  }

  public getCandidateInfo(): CandidateSourceInfo {
    return {
      provider: "Broker / Vendor API (Kite/TrueData/Dhan)",
      historicalOptions: true,
      intradayOptions: true,
      timestampResolution: "1m / 15m / 1d",
      OI: "AVAILABLE",
      IV: "NOT AVAILABLE",
      bidAsk: "NOT AVAILABLE",
      exportFormat: "JSON / REST",
      authentication: "API Key + Session Token",
      cost: "Paid (₹2,000–₹5,000/mo)",
      licenseStatus: "Commercial",
      integrationStatus: this.isConfigured() ? "ACTIVE" : "NOT_CONFIGURED",
      capabilities: [
        { field: "timestamp", status: "AVAILABLE" },
        { field: "expiry", status: "AVAILABLE" },
        { field: "strike", status: "AVAILABLE" },
        { field: "CE/PE", status: "AVAILABLE" },
        { field: "LTP", status: "AVAILABLE" },
        { field: "bid", status: "NOT AVAILABLE", notes: "L2 quotes not stored historically on standard REST" },
        { field: "ask", status: "NOT AVAILABLE", notes: "L2 quotes not stored historically on standard REST" },
        { field: "volume", status: "AVAILABLE" },
        { field: "OI", status: "AVAILABLE" },
        { field: "IV", status: "NOT AVAILABLE", notes: "Must be derived via Black-Scholes" },
      ],
    };
  }
}

export const niftyHistoricalDataProviderAdapter = new NiftyHistoricalDataProviderAdapter();
