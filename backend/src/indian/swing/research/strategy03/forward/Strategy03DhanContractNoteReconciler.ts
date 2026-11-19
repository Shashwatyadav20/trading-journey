import { calculateDhanDeliveryCost } from "../costs/Strategy03DhanDeliveryCostCalculator.js";
import { calculateDhanIntradayCost } from "../costs/Strategy03DhanIntradayCostCalculator.js";

export interface DhanContractNoteTradeInput {
  contractNoteId: string;
  tradeDate: string;
  symbol: string;
  segment: "EQUITY_DELIVERY" | "EQUITY_INTRADAY";
  buyPriceInr: number;
  sellPriceInr: number;
  quantity: number;
  actualBrokerageInr: number;
  actualSttInr: number;
  actualExchangeChargesInr: number;
  actualSebiChargesInr: number;
  actualStampDutyInr: number;
  actualGstInr: number;
  actualDpChargesInr: number;
  actualOtherChargesInr: number;
}

export interface ContractNoteComparisonRow {
  contractNoteId: string;
  symbol: string;
  segment: "EQUITY_DELIVERY" | "EQUITY_INTRADAY";
  actualTotalChargesInr: number;
  estimatedTotalChargesInr: number;
  varianceInr: number;
  componentDiffs: {
    brokerageDiffInr: number;
    sttDiffInr: number;
    exchangeDiffInr: number;
    sebiDiffInr: number;
    stampDutyDiffInr: number;
    gstDiffInr: number;
    dpDiffInr: number;
  };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export function reconcileDhanContractNotes(records: DhanContractNoteTradeInput[]): {
  status: "RECONCILED" | "PENDING";
  recordCount: number;
  comparisons: ContractNoteComparisonRow[];
  totalActualInr: number;
  totalEstimatedInr: number;
  totalVarianceInr: number;
} {
  if (records.length === 0) {
    return {
      status: "PENDING",
      recordCount: 0,
      comparisons: [],
      totalActualInr: 0,
      totalEstimatedInr: 0,
      totalVarianceInr: 0,
    };
  }

  const comparisons: ContractNoteComparisonRow[] = records.map((r) => {
    const est =
      r.segment === "EQUITY_INTRADAY"
        ? calculateDhanIntradayCost({ buyPriceInr: r.buyPriceInr, sellPriceInr: r.sellPriceInr, quantity: r.quantity })
        : calculateDhanDeliveryCost({ buyPriceInr: r.buyPriceInr, sellPriceInr: r.sellPriceInr, quantity: r.quantity });

    const actualTotal = round2(
      r.actualBrokerageInr +
        r.actualSttInr +
        r.actualExchangeChargesInr +
        r.actualSebiChargesInr +
        r.actualStampDutyInr +
        r.actualGstInr +
        r.actualDpChargesInr +
        r.actualOtherChargesInr
    );
    const estGst = round2(est.gstOnTradingInr + est.dpChargeGstInr);
    return {
      contractNoteId: r.contractNoteId,
      symbol: r.symbol,
      segment: r.segment,
      actualTotalChargesInr: actualTotal,
      estimatedTotalChargesInr: est.totalChargesInr,
      varianceInr: round2(actualTotal - est.totalChargesInr),
      componentDiffs: {
        brokerageDiffInr: round2(r.actualBrokerageInr - est.brokerageInr),
        sttDiffInr: round2(r.actualSttInr - est.sttTotalInr),
        exchangeDiffInr: round2(r.actualExchangeChargesInr - est.exchangeChargesInr),
        sebiDiffInr: round2(r.actualSebiChargesInr - est.sebiChargesInr),
        stampDutyDiffInr: round2(r.actualStampDutyInr - est.stampDutyInr),
        gstDiffInr: round2(r.actualGstInr - estGst),
        dpDiffInr: round2(r.actualDpChargesInr - est.dpTotalInr),
      },
    };
  });

  const totalActualInr = round2(comparisons.reduce((a, c) => a + c.actualTotalChargesInr, 0));
  const totalEstimatedInr = round2(comparisons.reduce((a, c) => a + c.estimatedTotalChargesInr, 0));
  return {
    status: "RECONCILED",
    recordCount: comparisons.length,
    comparisons,
    totalActualInr,
    totalEstimatedInr,
    totalVarianceInr: round2(totalActualInr - totalEstimatedInr),
  };
}

