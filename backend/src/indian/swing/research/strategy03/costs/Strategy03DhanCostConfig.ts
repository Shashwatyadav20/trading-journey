export interface DhanTariffVerificationMeta {
  version: string;
  effectiveDate: string;
  retrievedAt: string;
  sourceUrls: string[];
  verificationStatus: "VERIFIED_PUBLIC_TARIFF" | "UNVERIFIED";
  ipftVerificationStatus: "UNVERIFIED_EXCLUDED_PENDING_CONTRACT_NOTE";
  notes: string;
}

export interface DhanEquityDeliveryConfig {
  version: string;
  brokerageFlatInr: number;
  sttBuyPct: number;
  sttSellPct: number;
  nseExchangeTxnPct: number;
  sebiTurnoverPct: number;
  stampDutyBuyPct: number;
  gstPct: number;
  dpChargePerIsinSellInr: number;
  dpGstPct: number;
  ipftPct: number;
}

export interface DhanEquityIntradayConfig {
  version: string;
  brokerageMaxInrPerOrder: number;
  brokeragePctPerOrder: number;
  sttSellPct: number;
  nseExchangeTxnPct: number;
  sebiTurnoverPct: number;
  stampDutyBuyPct: number;
  gstPct: number;
  dpChargeInr: number;
}

export const DHAN_TARIFF_META_V2026_11: DhanTariffVerificationMeta = {
  version: "DHAN_NSE_CASH_V2026_11",
  effectiveDate: "2026-11-17",
  retrievedAt: "2026-11-17T14:42:45+05:30",
  sourceUrls: [
    "https://dhan.co/pricing/",
    "https://dhan.co/calculators/brokerage-calculator/",
  ],
  verificationStatus: "VERIFIED_PUBLIC_TARIFF",
  ipftVerificationStatus: "UNVERIFIED_EXCLUDED_PENDING_CONTRACT_NOTE",
  notes:
    "Verified against public Dhan pricing & brokerage calculator: Delivery brokerage ₹0, STT 0.1% buy+sell, NSE txn 0.0030699%, SEBI 0.0001%, Stamp duty 0.015% buy-only, GST 18% on brokerage+exchange+SEBI, DP ₹12.50 + 18% GST per sell ISIN instruction.",
};

export const DHAN_DELIVERY_CONFIG_V2026_11: DhanEquityDeliveryConfig = {
  version: "DHAN_NSE_DELIVERY_V2026_11",
  brokerageFlatInr: 0,
  sttBuyPct: 0.1,
  sttSellPct: 0.1,
  nseExchangeTxnPct: 0.0030699,
  sebiTurnoverPct: 0.0001,
  stampDutyBuyPct: 0.015,
  gstPct: 18,
  dpChargePerIsinSellInr: 12.5,
  dpGstPct: 18,
  ipftPct: 0,
};

export const DHAN_INTRADAY_CONFIG_V2026_11: DhanEquityIntradayConfig = {
  version: "DHAN_NSE_INTRADAY_V2026_11",
  brokerageMaxInrPerOrder: 20,
  brokeragePctPerOrder: 0.03,
  sttSellPct: 0.025,
  nseExchangeTxnPct: 0.0030699,
  sebiTurnoverPct: 0.0001,
  stampDutyBuyPct: 0.003,
  gstPct: 18,
  dpChargeInr: 0,
};

