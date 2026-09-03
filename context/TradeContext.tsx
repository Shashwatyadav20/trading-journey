"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import { Trade, TradeSide, TradeStatus, MistakeTag, PendingOrder } from "../types/trade";
import {
  loadTradesFromStorage,
  saveTradesToStorage,
  clearTradesStorage,
  exportTradesToFile,
  loadPendingOrdersFromStorage,
  savePendingOrdersToStorage,
  clearPendingOrdersStorage,
} from "../lib/storage";

export const SAMPLE_TRADES: Trade[] = [
  {
    id: "t1",
    date: "2026-08-25",
    time: "09:30",
    symbol: "NQ1!",
    side: "LONG",
    entryPrice: 20400,
    stopLoss: 20350,
    targetPrice: 20550,
    exitPrice: 20550,
    quantity: 1,
    pnl: 1490,
    fees: 10,
    rMultiple: 3.0,
    strategy: "Liquidity Sweep",
    status: "WIN",
    mistakeTag: "No Mistake",
    notes: "Perfect A+ liquidity sweep setup on 15m chart during NY opening range.",
  },
  {
    id: "t2",
    date: "2026-08-26",
    time: "10:15",
    symbol: "BTC/USD",
    side: "SHORT",
    entryPrice: 88000,
    stopLoss: 88340,
    targetPrice: 87150,
    exitPrice: 87150,
    quantity: 1,
    pnl: 845,
    fees: 5,
    rMultiple: 2.5,
    strategy: "swing high and swing low",
    status: "WIN",
    mistakeTag: "No Mistake",
    notes: "Short entry at 4H Fair Value Gap retest.",
  },
  {
    id: "t3",
    date: "2026-08-27",
    time: "11:00",
    symbol: "AAPL",
    side: "LONG",
    entryPrice: 225,
    stopLoss: 220.5,
    targetPrice: 235,
    exitPrice: 220.5,
    quantity: 100,
    pnl: -455,
    fees: 5,
    rMultiple: -1.0,
    strategy: "EQH AND EQL",
    status: "LOSS",
    mistakeTag: "FOMO",
    notes: "Chased entry after initial momentum candle without waiting for 5m retest.",
  },
  {
    id: "t4",
    date: "2026-08-28",
    time: "14:15",
    symbol: "ES1!",
    side: "LONG",
    entryPrice: 5880,
    stopLoss: 5871,
    targetPrice: 5898,
    exitPrice: 5898,
    quantity: 1,
    pnl: 912,
    fees: 8,
    rMultiple: 2.0,
    strategy: "Liquidity Sweep",
    status: "WIN",
    mistakeTag: "No Mistake",
    notes: "London Session low sweep re-entry.",
  },
  {
    id: "t5",
    date: "2026-08-29",
    time: "09:45",
    symbol: "NVDA",
    side: "LONG",
    entryPrice: 125,
    stopLoss: 124.45,
    targetPrice: 127.2,
    exitPrice: 127.2,
    quantity: 1000,
    pnl: 2188,
    fees: 12,
    rMultiple: 4.0,
    strategy: "OB CREATE AND RETEST THEN ENTRY",
    status: "WIN",
    mistakeTag: "No Mistake",
    notes: "Clean 5m opening range breakout after earnings report.",
  },
  {
    id: "t6",
    date: "2026-08-30",
    time: "13:20",
    symbol: "EUR/USD",
    side: "SHORT",
    entryPrice: 1.095,
    stopLoss: 1.0988,
    targetPrice: 1.09,
    exitPrice: 1.0988,
    quantity: 100000,
    pnl: -386,
    fees: 6,
    rMultiple: -1.0,
    strategy: "PWL AND PWH",
    status: "LOSS",
    mistakeTag: "No Confirmation",
    notes: "Entered early before high impact USD news event release.",
  },
  {
    id: "t7",
    date: "2026-09-01",
    time: "15:00",
    symbol: "TSLA",
    side: "SHORT",
    entryPrice: 215,
    stopLoss: 220,
    targetPrice: 204,
    exitPrice: 204,
    quantity: 100,
    pnl: 1090,
    fees: 10,
    rMultiple: 2.2,
    strategy: "Liquidity Sweep",
    status: "WIN",
    mistakeTag: "No Mistake",
    notes: "Short at daily resistance level rejection.",
  },
  {
    id: "t8",
    date: "2026-09-02",
    time: "11:30",
    symbol: "NQ1!",
    side: "SHORT",
    entryPrice: 20600,
    stopLoss: 20550,
    targetPrice: 20400,
    exitPrice: 20650,
    quantity: 1,
    pnl: -508,
    fees: 8,
    rMultiple: -1.0,
    strategy: "OB CREATE AND RETEST THEN ENTRY",
    status: "LOSS",
    mistakeTag: "Moved Stop Loss",
    notes: "Moved stop loss wide during drawdown.",
  },
];

export interface CreateTradeInput {
  date: string;
  time?: string;
  symbol: string;
  side: TradeSide;
  strategy: string;
  entryPrice: number;
  stopLoss?: number;
  targetPrice?: number;
  exitPrice?: number;
  quantity: number;
  fees?: number;
  notes?: string;
  mistakeTag?: MistakeTag;
  screenshotUrl?: string;
  status?: TradeStatus;
  orderType?: "MARKET" | "LIMIT";
}

interface TradeContextType {
  trades: Trade[];
  startingCapital: number;
  pendingOrders: PendingOrder[];
  addTrade: (input: CreateTradeInput) => Trade;
  updateTrade: (id: string, input: CreateTradeInput) => void;
  deleteTrade: (id: string) => void;
  closePosition: (id: string, exitPrice: number) => void;
  updateTradeStopLoss: (id: string, newSL: number) => void;
  updateTradeTargetPrice: (id: string, newTP: number) => void;
  addPendingOrder: (order: Omit<PendingOrder, "id" | "status">) => PendingOrder;
  cancelPendingOrder: (id: string) => void;
  fillPendingOrder: (id: string, fillPrice: number) => void;
  loadSampleTrades: () => void;
  clearTrades: () => void;
  exportTrades: () => void;
  importTrades: (importedTrades: Trade[]) => void;
  updateStartingCapital: (amount: number) => void;
  resetAccount: () => void;
  isInitialized: boolean;
}

const TradeContext = createContext<TradeContextType | undefined>(undefined);

export function computeTradeMetrics(input: CreateTradeInput): {
  pnl: number;
  rMultiple: number;
  status: TradeStatus;
} {
  const fees = input.fees || 0;
  const entry = input.entryPrice;
  const exit = input.exitPrice ?? entry;
  const qty = input.quantity;
  const side = input.side;

  // If explicitly opened as OPEN status
  if (input.status === "OPEN") {
    return { pnl: 0, rMultiple: 0, status: "OPEN" };
  }

  // Calculate Net PnL after fees
  const pnl =
    side === "LONG" ? (exit - entry) * qty - fees : (entry - exit) * qty - fees;

  // Calculate Status
  const status: TradeStatus =
    pnl > 0 ? "WIN" : pnl < 0 ? "LOSS" : "BREAKEVEN";

  // Calculate R-Multiple
  let rMultiple = 0;
  if (input.stopLoss && input.stopLoss > 0) {
    const riskPerUnit = Math.abs(entry - input.stopLoss);
    if (riskPerUnit > 0) {
      const rewardPerUnit = side === "LONG" ? exit - entry : entry - exit;
      rMultiple = rewardPerUnit / riskPerUnit;
    }
  } else {
    rMultiple = pnl > 0 ? 1 : pnl < 0 ? -1 : 0;
  }

  return { pnl, rMultiple, status };
}

const CAPITAL_STORAGE_KEY = "trading-journey-starting-capital";

export function TradeProvider({ children }: { children: React.ReactNode }) {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [startingCapital, setStartingCapital] = useState<number>(500);
  const [pendingOrders, setPendingOrders] = useState<PendingOrder[]>([]);
  const [isInitialized, setIsInitialized] = useState<boolean>(false);

  // Load trades, pending orders, and starting capital from localStorage on mount
  useEffect(() => {
    const storedTrades = loadTradesFromStorage();
    setTrades(storedTrades);

    const storedPending = loadPendingOrdersFromStorage();
    setPendingOrders(storedPending);

    if (typeof window !== "undefined") {
      const storedCap = localStorage.getItem(CAPITAL_STORAGE_KEY);
      if (storedCap) {
        const parsed = parseFloat(storedCap);
        if (!isNaN(parsed) && parsed > 0) {
          setStartingCapital(parsed);
        }
      }
    }
    setIsInitialized(true);
  }, []);

  const updateStartingCapital = (amount: number) => {
    setStartingCapital(amount);
    if (typeof window !== "undefined") {
      localStorage.setItem(CAPITAL_STORAGE_KEY, amount.toString());
    }
  };

  const resetAccount = () => {
    setTrades([]);
    setPendingOrders([]);
    clearTradesStorage();
    clearPendingOrdersStorage();
    updateStartingCapital(500);
  };

  const addTrade = (input: CreateTradeInput): Trade => {
    const { pnl, rMultiple, status } = computeTradeMetrics(input);
    const newTrade: Trade = {
      ...input,
      id: `trade_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      fees: input.fees || 0,
      exitPrice: input.exitPrice ?? input.entryPrice,
      pnl,
      rMultiple,
      status,
    };

    setTrades((prev) => {
      const nextTrades = [newTrade, ...prev];
      saveTradesToStorage(nextTrades);
      return nextTrades;
    });

    return newTrade;
  };

  const updateTrade = (id: string, input: CreateTradeInput) => {
    const { pnl, rMultiple, status } = computeTradeMetrics(input);
    setTrades((prev) => {
      const nextTrades = prev.map((t) =>
        t.id === id
          ? {
              ...t,
              ...input,
              exitPrice: input.exitPrice ?? input.entryPrice,
              fees: input.fees || 0,
              pnl,
              rMultiple,
              status,
            }
          : t
      );
      saveTradesToStorage(nextTrades);
      return nextTrades;
    });
  };

  const closePosition = (id: string, exitPrice: number) => {
    const exitTimeStr = new Date().toTimeString().split(" ")[0].substring(0, 5);

    setTrades((prev) => {
      const nextTrades = prev.map((t) => {
        if (t.id !== id) return t;

        const updatedInput: CreateTradeInput = {
          ...t,
          exitPrice,
          status: undefined, // remove OPEN status override so computeTradeMetrics resolves WIN/LOSS/BREAKEVEN
        };

        const { pnl, rMultiple, status } = computeTradeMetrics(updatedInput);

        // Estimate holding time (if entry time is available)
        let holdingTime = "15m";
        if (t.time) {
          const [eH, eM] = t.time.split(":").map(Number);
          const [xH, xM] = exitTimeStr.split(":").map(Number);
          const totalMinutes = Math.max((xH * 60 + xM) - (eH * 60 + eM), 5);
          if (totalMinutes >= 60) {
            const hrs = Math.floor(totalMinutes / 60);
            const mins = totalMinutes % 60;
            holdingTime = `${hrs}h ${mins}m`;
          } else {
            holdingTime = `${totalMinutes}m`;
          }
        }

        return {
          ...t,
          exitPrice,
          exitTime: exitTimeStr,
          holdingTime,
          pnl,
          rMultiple,
          status,
        };
      });

      saveTradesToStorage(nextTrades);
      return nextTrades;
    });
  };

  // Update stop loss for an open position (used by draggable SL on chart)
  const updateTradeStopLoss = (id: string, newSL: number) => {
    setTrades((prev) => {
      const nextTrades = prev.map((t) =>
        t.id === id ? { ...t, stopLoss: newSL } : t
      );
      saveTradesToStorage(nextTrades);
      return nextTrades;
    });
  };

  // Update take profit for an open position (used by draggable TP on chart)
  const updateTradeTargetPrice = (id: string, newTP: number) => {
    setTrades((prev) => {
      const nextTrades = prev.map((t) =>
        t.id === id ? { ...t, targetPrice: newTP } : t
      );
      saveTradesToStorage(nextTrades);
      return nextTrades;
    });
  };

  const deleteTrade = (id: string) => {
    setTrades((prev) => {
      const nextTrades = prev.filter((t) => t.id !== id);
      saveTradesToStorage(nextTrades);
      return nextTrades;
    });
  };

  const loadSampleTrades = () => {
    setTrades(SAMPLE_TRADES);
    saveTradesToStorage(SAMPLE_TRADES);
  };

  const clearTrades = () => {
    setTrades([]);
    clearTradesStorage();
  };

  const exportTrades = () => {
    exportTradesToFile(trades);
  };

  const importTrades = (importedTrades: Trade[]) => {
    setTrades(importedTrades);
    saveTradesToStorage(importedTrades);
  };

  // ──────────────────────────────────────────────
  //  Pending Orders
  // ──────────────────────────────────────────────

  const addPendingOrder = (order: Omit<PendingOrder, "id" | "status">): PendingOrder => {
    const newOrder: PendingOrder = {
      ...order,
      id: `pending_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      status: "PENDING",
    };

    setPendingOrders((prev) => {
      const next = [newOrder, ...prev];
      savePendingOrdersToStorage(next);
      return next;
    });

    return newOrder;
  };

  const cancelPendingOrder = (id: string) => {
    setPendingOrders((prev) => {
      const next = prev.filter((o) => o.id !== id);
      savePendingOrdersToStorage(next);
      return next;
    });
  };

  const fillPendingOrder = (id: string, fillPrice: number) => {
    const order = pendingOrders.find((o) => o.id === id);
    if (!order) return;

    // Create an OPEN trade from the pending order
    const todayStr = new Date().toISOString().split("T")[0];
    const timeStr = new Date().toTimeString().split(" ")[0].substring(0, 5);

    addTrade({
      date: todayStr,
      time: timeStr,
      symbol: order.instrument,
      side: order.side,
      strategy: order.strategy,
      entryPrice: fillPrice,
      stopLoss: order.stopLoss,
      targetPrice: order.takeProfit,
      quantity: order.quantity,
      fees: 5,
      status: "OPEN",
      orderType: "LIMIT",
      notes: `Limit order filled at $${fillPrice.toFixed(2)}`,
    });

    // Remove from pending
    cancelPendingOrder(id);
  };

  return (
    <TradeContext.Provider
      value={{
        trades,
        startingCapital,
        pendingOrders,
        addTrade,
        updateTrade,
        deleteTrade,
        closePosition,
        updateTradeStopLoss,
        updateTradeTargetPrice,
        addPendingOrder,
        cancelPendingOrder,
        fillPendingOrder,
        loadSampleTrades,
        clearTrades,
        exportTrades,
        importTrades,
        updateStartingCapital,
        resetAccount,
        isInitialized,
      }}
    >
      {children}
    </TradeContext.Provider>
  );
}

export function useTrades() {
  const context = useContext(TradeContext);
  if (!context) {
    throw new Error("useTrades must be used within a TradeProvider");
  }
  return context;
}
