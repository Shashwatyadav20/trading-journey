export interface NiftyConfig {
  symbol: string;
  lotSize: number;
  maxCapitalRiskPctPerTrade: number;
  minStrategyScore: number;
  scorePassWithFilters: number;
  dailyLossLimit: number;
  dailyProfitTarget: number;
  maxTradesPerDay: number;
  maxConsecutiveLosses: number;
  defaultPaperMode: boolean;
  defaultLiveMode: boolean;
  slippagePointsPerLeg: number;
  maxBidAskSpreadPoints: number;
  targetCreditCapturePct: number;
  stopLossCreditMultiplier: number;
  brokeragePerLeg: number;
  sttPct: number;
  exchangeFeePct: number;
  gstPct: number;
  sebiFeePerCrore: number;
  stampDutyPct: number;
}

export const DEFAULT_NIFTY_CONFIG: NiftyConfig = {
  symbol: "NIFTY",
  lotSize: 25,
  maxCapitalRiskPctPerTrade: 1.0, // 1% per trade
  minStrategyScore: 80,
  scorePassWithFilters: 70,
  dailyLossLimit: -5000, // Rs -5000 hard stop
  dailyProfitTarget: 1000, // Rs 1000 daily net target
  maxTradesPerDay: 3,
  maxConsecutiveLosses: 2,
  defaultPaperMode: true,
  defaultLiveMode: false, // MANDATORY FALSE
  slippagePointsPerLeg: 0.5,
  maxBidAskSpreadPoints: 3.0,
  targetCreditCapturePct: 50, // 50% capture target
  stopLossCreditMultiplier: 1.5, // 1.5x credit stop loss
  brokeragePerLeg: 20, // Rs 20 per executed leg
  sttPct: 0.00125, // 0.125% on sell side option premium
  exchangeFeePct: 0.0005, // 0.05% turnover fee
  gstPct: 0.18, // 18% GST
  sebiFeePerCrore: 10,
  stampDutyPct: 0.00003, // 0.003% on buy side
};
