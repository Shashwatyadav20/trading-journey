import { NextRequest, NextResponse } from "next/server";
import {
  readServerLedger,
  writeServerLedger,
  PersistedTrade,
  simulateInstitutionalSlippage,
  createBrokerWebhookStub,
  recordBrokerWebhookLog,
  getISTTimestamp,
} from "@/lib/indian/tradePersistence";

export const dynamic = "force-dynamic";

/**
 * GET /api/indian/swing/trades
 * Returns the persisted active trades and completed history trades with slippage & webhook metadata.
 */
export async function GET() {
  try {
    const data = readServerLedger();
    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      activeTrades: data.activeTrades,
      historyTrades: data.historyTrades,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err?.message }, { status: 500 });
  }
}

/**
 * POST /api/indian/swing/trades
 * Synchronizes client trades, performs atomic persistence, applies slippage simulation,
 * and generates institutional broker webhook events.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const action = body.action || "SYNC"; // "SYNC" | "DEPLOY_TRADE" | "CLOSE_TRADE" | "UPDATE_TSL"
    const currentLedger = readServerLedger();
    const { iso, ist, dateKey } = getISTTimestamp();

    if (action === "DEPLOY_TRADE") {
      const tradeData = body.trade;
      if (!tradeData || !tradeData.symbol || !tradeData.entryPrice || !tradeData.quantity) {
        return NextResponse.json({ success: false, error: "Invalid trade payload" }, { status: 400 });
      }

      // Check for duplicate active trade
      if (currentLedger.activeTrades.some((t) => t.symbol === tradeData.symbol)) {
        return NextResponse.json(
          { success: false, error: `${tradeData.symbol} is already active in portfolio` },
          { status: 409 }
        );
      }

      // Simulate institutional slippage
      const orderValue = tradeData.allocatedCapital || tradeData.entryPrice * tradeData.quantity;
      const slippage = simulateInstitutionalSlippage(tradeData.entryPrice, "BUY", orderValue);

      // Generate broker webhook stub
      const brokerWebhook = createBrokerWebhookStub(
        tradeData.tradeId,
        tradeData.symbol,
        tradeData.quantity,
        slippage.executedPrice,
        "ORDER_FILLED"
      );
      recordBrokerWebhookLog(brokerWebhook);

      const newPersistedTrade: PersistedTrade = {
        tradeId: tradeData.tradeId || `TRADE-${tradeData.symbol}-${Date.now()}`,
        symbol: tradeData.symbol,
        companyName: tradeData.companyName || tradeData.symbol,
        strategyUsed: tradeData.strategyUsed || "INSTITUTIONAL_SWING",
        entryPrice: slippage.executedPrice,
        stopLossPrice: tradeData.stopLossPrice,
        initialStopLoss: tradeData.stopLossPrice,
        targetPrice: tradeData.targetPrice,
        target2Price: tradeData.target2Price,
        trailingStopPrice: tradeData.stopLossPrice,
        isTslActive: false,
        tslTier: "BASE_STRUCTURAL_STOP",
        allocatedCapital: Math.round(tradeData.quantity * slippage.executedPrice),
        quantity: tradeData.quantity,
        executionTimestampIso: iso,
        executionTimestampIst: ist,
        status: "ACTIVE",
        currentSimulatedPrice: slippage.executedPrice,
        peakSimulatedPrice: slippage.executedPrice,
        pnlAmount: 0,
        pnlPercent: 0,
        lockedGainPercent: 0,
        lockedGainRupees: 0,
        slippageSimulation: slippage,
        brokerWebhook,
        mtfSnapshot: tradeData.mtfSnapshot,
        auditTrail: [
          {
            timestamp: ist,
            action: "TRADE_DELEGATED_TO_BROKER",
            details: `Order executed via ${brokerWebhook.broker} at ₹${slippage.executedPrice} (Slippage: +${slippage.slippagePercent}%, ₹${slippage.slippageAmountRupees}). Broker Order ID: ${brokerWebhook.brokerOrderId}`,
          },
        ],
        frozenDateKey: dateKey,
        daysHeld: 0,
      };

      const updatedActive = [newPersistedTrade, ...currentLedger.activeTrades];
      writeServerLedger(updatedActive, currentLedger.historyTrades);

      return NextResponse.json({
        success: true,
        trade: newPersistedTrade,
        message: `Order filled at ₹${slippage.executedPrice} via ${brokerWebhook.broker}`,
      });
    }

    if (action === "SYNC") {
      // Direct synchronization from client array
      const activeTrades: PersistedTrade[] = Array.isArray(body.activeTrades) ? body.activeTrades : currentLedger.activeTrades;
      const historyTrades: PersistedTrade[] = Array.isArray(body.historyTrades) ? body.historyTrades : currentLedger.historyTrades;
      writeServerLedger(activeTrades, historyTrades);

      return NextResponse.json({
        success: true,
        syncedCount: activeTrades.length + historyTrades.length,
      });
    }

    return NextResponse.json({ success: false, error: "Unrecognized action" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err?.message }, { status: 500 });
  }
}
