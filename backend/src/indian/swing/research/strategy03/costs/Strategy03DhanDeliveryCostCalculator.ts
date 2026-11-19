import {
  DHAN_DELIVERY_CONFIG_V2026_11,
  type DhanEquityDeliveryConfig,
} from "./Strategy03DhanCostConfig.js";

export interface DhanCostBreakdown {
  segment: "EQUITY_DELIVERY" | "EQUITY_INTRADAY";
  configVersion: string;
  buyTurnoverInr: number;
  sellTurnoverInr: number;
  totalTurnoverInr: number;
  brokerageInr: number;
  sttBuyInr: number;
  sttSellInr: number;
  sttTotalInr: number;
  exchangeChargesInr: number;
  sebiChargesInr: number;
  stampDutyInr: number;
  gstOnTradingInr: number;
  dpChargeBaseInr: number;
  dpChargeGstInr: number;
  dpTotalInr: number;
  otherVerifiedChargesInr: number;
  totalBrokerChargesInr: number;
  totalStatutoryChargesInr: number;
  totalChargesInr: number;
  totalChargesPctOfBuy: number;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export function calculateDhanDeliveryCost(params: {
  buyPriceInr: number;
  sellPriceInr: number;
  quantity: number;
  config?: DhanEquityDeliveryConfig;
}): DhanCostBreakdown {
  const cfg = params.config ?? DHAN_DELIVERY_CONFIG_V2026_11;
  const buyTurnover = round2(params.buyPriceInr * params.quantity);
  const sellTurnover = round2(params.sellPriceInr * params.quantity);
  const totalTurnover = round2(buyTurnover + sellTurnover);

  const brokerage = cfg.brokerageFlatInr;
  // Indian STT on equity delivery is rounded to nearest rupee per side
  const sttBuy = Math.round(buyTurnover * (cfg.sttBuyPct / 100));
  const sttSell = Math.round(sellTurnover * (cfg.sttSellPct / 100));
  const sttTotal = sttBuy + sttSell;

  const exchangeCharges = round2(totalTurnover * (cfg.nseExchangeTxnPct / 100));
  const sebiCharges = round2(totalTurnover * (cfg.sebiTurnoverPct / 100));
  const stampDuty = Math.round(buyTurnover * (cfg.stampDutyBuyPct / 100));

  const gstOnTrading = round2((brokerage + exchangeCharges + sebiCharges) * (cfg.gstPct / 100));
  const dpBase = cfg.dpChargePerIsinSellInr;
  const dpGst = round2(dpBase * (cfg.dpGstPct / 100));
  const dpTotal = round2(dpBase + dpGst);
  const otherCharges = round2(totalTurnover * (cfg.ipftPct / 100));

  const totalBrokerCharges = round2(brokerage + dpBase);
  const totalStatutoryCharges = round2(
    sttTotal + exchangeCharges + sebiCharges + stampDuty + gstOnTrading + dpGst + otherCharges
  );
  const totalCharges = round2(totalBrokerCharges + totalStatutoryCharges);

  return {
    segment: "EQUITY_DELIVERY",
    configVersion: cfg.version,
    buyTurnoverInr: buyTurnover,
    sellTurnoverInr: sellTurnover,
    totalTurnoverInr: totalTurnover,
    brokerageInr: brokerage,
    sttBuyInr: sttBuy,
    sttSellInr: sttSell,
    sttTotalInr: sttTotal,
    exchangeChargesInr: exchangeCharges,
    sebiChargesInr: sebiCharges,
    stampDutyInr: stampDuty,
    gstOnTradingInr: gstOnTrading,
    dpChargeBaseInr: dpBase,
    dpChargeGstInr: dpGst,
    dpTotalInr: dpTotal,
    otherVerifiedChargesInr: otherCharges,
    totalBrokerChargesInr: totalBrokerCharges,
    totalStatutoryChargesInr: totalStatutoryCharges,
    totalChargesInr: totalCharges,
    totalChargesPctOfBuy: buyTurnover > 0 ? round2((totalCharges / buyTurnover) * 100) : 0,
  };
}

