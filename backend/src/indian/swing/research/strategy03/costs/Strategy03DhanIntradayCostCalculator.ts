import {
  DHAN_INTRADAY_CONFIG_V2026_11,
  type DhanEquityIntradayConfig,
} from "./Strategy03DhanCostConfig.js";
import type { DhanCostBreakdown } from "./Strategy03DhanDeliveryCostCalculator.js";

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export function calculateDhanIntradayCost(params: {
  buyPriceInr: number;
  sellPriceInr: number;
  quantity: number;
  config?: DhanEquityIntradayConfig;
}): DhanCostBreakdown {
  const cfg = params.config ?? DHAN_INTRADAY_CONFIG_V2026_11;
  const buyTurnover = round2(params.buyPriceInr * params.quantity);
  const sellTurnover = round2(params.sellPriceInr * params.quantity);
  const totalTurnover = round2(buyTurnover + sellTurnover);

  const brokBuy = Math.min(cfg.brokerageMaxInrPerOrder, buyTurnover * (cfg.brokeragePctPerOrder / 100));
  const brokSell = Math.min(cfg.brokerageMaxInrPerOrder, sellTurnover * (cfg.brokeragePctPerOrder / 100));
  const brokerage = round2(brokBuy + brokSell);

  const sttBuy = 0;
  const sttSell = Math.round(sellTurnover * (cfg.sttSellPct / 100));
  const sttTotal = sttSell;

  const exchangeCharges = round2(totalTurnover * (cfg.nseExchangeTxnPct / 100));
  const sebiCharges = round2(totalTurnover * (cfg.sebiTurnoverPct / 100));
  const stampDuty = Math.round(buyTurnover * (cfg.stampDutyBuyPct / 100));
  const gstOnTrading = round2((brokerage + exchangeCharges + sebiCharges) * (cfg.gstPct / 100));

  const totalBrokerCharges = brokerage;
  const totalStatutoryCharges = round2(sttTotal + exchangeCharges + sebiCharges + stampDuty + gstOnTrading);
  const totalCharges = round2(totalBrokerCharges + totalStatutoryCharges);

  return {
    segment: "EQUITY_INTRADAY",
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
    dpChargeBaseInr: 0,
    dpChargeGstInr: 0,
    dpTotalInr: 0,
    otherVerifiedChargesInr: 0,
    totalBrokerChargesInr: totalBrokerCharges,
    totalStatutoryChargesInr: totalStatutoryCharges,
    totalChargesInr: totalCharges,
    totalChargesPctOfBuy: buyTurnover > 0 ? round2((totalCharges / buyTurnover) * 100) : 0,
  };
}

