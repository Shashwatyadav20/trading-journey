import { HistoricalDataPoint } from "../backtest/BacktestEngine";

export interface ProviderCapability {
  field: string;
  status: "AVAILABLE" | "NOT AVAILABLE" | "UNKNOWN";
  notes?: string;
}

export interface CandidateSourceInfo {
  provider: string;
  historicalOptions: boolean;
  intradayOptions: boolean;
  timestampResolution: string;
  OI: "AVAILABLE" | "NOT AVAILABLE" | "UNKNOWN";
  IV: "AVAILABLE" | "NOT AVAILABLE" | "UNKNOWN";
  bidAsk: "AVAILABLE" | "NOT AVAILABLE" | "UNKNOWN";
  exportFormat: string;
  authentication: string;
  cost: string;
  licenseStatus: string;
  integrationStatus: "ACTIVE" | "NOT_CONFIGURED" | "PLANNED" | "MANUAL_ONLY";
  capabilities: ProviderCapability[];
}

export interface FetchHistoricalOptionsRequest {
  symbol: string;
  startDate: string;
  endDate: string;
  interval?: "1m" | "5m" | "15m" | "1d";
}

export interface FetchHistoricalOptionsResponse {
  success: boolean;
  status: "OK" | "HISTORICAL_PROVIDER_NOT_CONFIGURED" | "ERROR";
  providerName: string;
  dataPoints: HistoricalDataPoint[];
  error?: string;
}

export interface INiftyHistoricalDataProvider {
  getProviderName(): string;
  isConfigured(): boolean;
  fetchHistoricalData(req: FetchHistoricalOptionsRequest): Promise<FetchHistoricalOptionsResponse>;
  getCandidateInfo(): CandidateSourceInfo;
}
