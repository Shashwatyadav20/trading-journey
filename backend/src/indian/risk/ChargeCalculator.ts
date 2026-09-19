import { ChargeBreakdown } from "../types";
import { DEFAULT_NIFTY_CONFIG, NiftyConfig } from "../config/niftyConfig";

export class ChargeCalculator {
  private config: NiftyConfig;

  constructor(config: NiftyConfig = DEFAULT_NIFTY_CONFIG) {
    this.config = config;
  }

  /**
   * Calculates exact estimated charges for a 2-leg NIFTY option spread trade (separated into entry + exit).
   *
   * @param sellPremium Short option leg premium (LTP)
   * @param buyPremium Long option leg premium (LTP)
   * @param lotQuantity Number of NIFTY lots (e.g. 1 lot = 25 shares)
   * @param grossPnl Expected or actual gross profit/loss before charges
   */
  public calculateSpreadCharges(
    sellPremium: number,
    buyPremium: number,
    lotQuantity: number,
    grossPnl: number
  ): ChargeBreakdown {
    const totalQuantity = lotQuantity * this.config.lotSize;

    // Premium Turnover per leg
    const sellTurnover = sellPremium * totalQuantity;
    const buyTurnover = buyPremium * totalQuantity;
    const totalTurnover = sellTurnover + buyTurnover;

    // --- 1. ENTRY CHARGES ---
    const entryBrokerage = 2 * this.config.brokeragePerLeg;
    const entryStt = sellTurnover * this.config.sttPct; // STT on sell side entry
    const entryExchange = totalTurnover * this.config.exchangeFeePct;
    const entrySebi = (totalTurnover * this.config.sebiFeePerCrore) / 10000000;
    const entryGst = (entryBrokerage + entryExchange + entrySebi) * this.config.gstPct;
    const stampDuty = buyTurnover * this.config.stampDutyPct; // Stamp duty on buy side entry
    const entrySlippage = this.config.slippagePointsPerLeg * 2 * totalQuantity;

    const entryCharges = Number(
      (
        entryBrokerage +
        entryStt +
        entryExchange +
        entrySebi +
        entryGst +
        stampDuty +
        entrySlippage
      ).toFixed(2)
    );

    // --- 2. EXIT CHARGES ---
    const exitBrokerage = 2 * this.config.brokeragePerLeg;
    const exitStt = buyTurnover * this.config.sttPct; // STT on long leg exit sale
    const exitExchange = totalTurnover * this.config.exchangeFeePct;
    const exitSebi = (totalTurnover * this.config.sebiFeePerCrore) / 10000000;
    const exitGst = (exitBrokerage + exitExchange + exitSebi) * this.config.gstPct;
    const exitSlippage = this.config.slippagePointsPerLeg * 2 * totalQuantity;

    const exitCharges = Number(
      (
        exitBrokerage +
        exitStt +
        exitExchange +
        exitSebi +
        exitGst +
        exitSlippage
      ).toFixed(2)
    );

    // --- TOTALS ---
    const totalBrokerage = entryBrokerage + exitBrokerage;
    const totalStt = entryStt + exitStt;
    const totalExchange = entryExchange + exitExchange;
    const totalSebi = entrySebi + exitSebi;
    const totalGst = entryGst + exitGst;
    const totalSlippage = entrySlippage + exitSlippage;

    const totalCharges = Number((entryCharges + exitCharges).toFixed(2));
    const netPnl = Number((grossPnl - totalCharges).toFixed(2));

    return {
      grossPnl: Number(grossPnl.toFixed(2)),
      entryCharges,
      exitCharges,
      brokerage: Number(totalBrokerage.toFixed(2)),
      stt: Number(totalStt.toFixed(2)),
      exchangeFees: Number(totalExchange.toFixed(2)),
      gst: Number(totalGst.toFixed(2)),
      sebiFees: Number(totalSebi.toFixed(2)),
      stampDuty: Number(stampDuty.toFixed(2)),
      estimatedSlippage: Number(totalSlippage.toFixed(2)),
      totalCharges,
      netPnl,
    };
  }
}

export const chargeCalculator = new ChargeCalculator();
