import { ChargeBreakdown } from "../types";

export interface IBrokerChargeAdapter {
  calculateBrokerage(quantity: number, price: number, side: "BUY" | "SELL"): number;
  calculateSTT(quantity: number, price: number, side: "BUY" | "SELL"): number;
  calculateExchangeCharges(quantity: number, price: number): number;
  calculateGST(brokerage: number, exchangeFees: number): number;
  calculateSEBICharges(quantity: number, price: number): number;
  calculateStampDuty(quantity: number, price: number, side: "BUY" | "SELL"): number;
  calculateTotalCharges(quantity: number, buyPrice: number, sellPrice: number): ChargeBreakdown;
}

/**
  * Standard Zerodha / Indian Broker Options Charge Adapter
  */
export class StandardIndianBrokerChargeAdapter implements IBrokerChargeAdapter {
  private flatBrokeragePerOrder = 20; // ₹20 per executed order (Zerodha standard)

  public calculateBrokerage(_quantity: number, _price: number, _side: "BUY" | "SELL"): number {
    return this.flatBrokeragePerOrder;
  }

  public calculateSTT(quantity: number, price: number, side: "BUY" | "SELL"): number {
    // STT on Options: 0.125% on sell side premium (or 0.1% on intrinsic value at exercise)
    if (side === "SELL") {
      const turnover = quantity * price;
      return Number((turnover * 0.00125).toFixed(2));
    }
    return 0;
  }

  public calculateExchangeCharges(quantity: number, price: number): number {
    // NSE Options exchange txn charge: ~0.05% of premium
    const turnover = quantity * price;
    return Number((turnover * 0.0005).toFixed(2));
  }

  public calculateGST(brokerage: number, exchangeFees: number): number {
    // GST 18% on (Brokerage + Exchange Fees)
    return Number(((brokerage + exchangeFees) * 0.18).toFixed(2));
  }

  public calculateSEBICharges(quantity: number, price: number): number {
    // SEBI turnover charge: ₹10 per crore (0.0001%)
    const turnover = quantity * price;
    return Number((turnover * 0.000001).toFixed(2));
  }

  public calculateStampDuty(quantity: number, price: number, side: "BUY" | "SELL"): number {
    // Stamp Duty on options buy side: 0.003% of premium
    if (side === "BUY") {
      const turnover = quantity * price;
      return Number((turnover * 0.00003).toFixed(2));
    }
    return 0;
  }

  public calculateTotalCharges(quantity: number, buyPrice: number, sellPrice: number): ChargeBreakdown {
    const buyBrokerage = this.calculateBrokerage(quantity, buyPrice, "BUY");
    const sellBrokerage = this.calculateBrokerage(quantity, sellPrice, "SELL");
    const totalBrokerage = buyBrokerage + sellBrokerage;

    const buyStt = this.calculateSTT(quantity, buyPrice, "BUY");
    const sellStt = this.calculateSTT(quantity, sellPrice, "SELL");
    const totalStt = buyStt + sellStt;

    const buyExch = this.calculateExchangeCharges(quantity, buyPrice);
    const sellExch = this.calculateExchangeCharges(quantity, sellPrice);
    const totalExch = buyExch + sellExch;

    const gst = this.calculateGST(totalBrokerage, totalExch);

    const buySebi = this.calculateSEBICharges(quantity, buyPrice);
    const sellSebi = this.calculateSEBICharges(quantity, sellPrice);
    const totalSebi = buySebi + sellSebi;

    const buyStamp = this.calculateStampDuty(quantity, buyPrice, "BUY");
    const sellStamp = this.calculateStampDuty(quantity, sellPrice, "SELL");
    const totalStamp = buyStamp + sellStamp;

    const estimatedSlippage = Number((quantity * 0.10).toFixed(2)); // ₹0.10 per share estimated slippage

    const totalCharges = Number(
      (totalBrokerage + totalStt + totalExch + gst + totalSebi + totalStamp + estimatedSlippage).toFixed(2)
    );

    const grossPnl = Number(((sellPrice - buyPrice) * quantity).toFixed(2));
    const netPnl = Number((grossPnl - totalCharges).toFixed(2));

    return {
      grossPnl,
      entryCharges: Number((buyBrokerage + buyExch + buySebi + buyStamp).toFixed(2)),
      exitCharges: Number((sellBrokerage + sellStt + sellExch + sellSebi + sellStamp).toFixed(2)),
      brokerage: totalBrokerage,
      stt: totalStt,
      exchangeFees: totalExch,
      gst,
      sebiFees: totalSebi,
      stampDuty: totalStamp,
      estimatedSlippage,
      totalCharges,
      netPnl,
    };
  }
}

export const standardBrokerChargeAdapter = new StandardIndianBrokerChargeAdapter();
