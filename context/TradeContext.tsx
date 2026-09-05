"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { Trade, TradeSide, TradeStatus, MistakeTag, PendingOrder } from "../types/trade";
import { useAuth } from "./AuthContext";
import {
  loadTradesFromStorage,
  saveTradesToStorage,
  clearTradesStorage,
  exportTradesToFile,
  loadPendingOrdersFromStorage,
  savePendingOrdersToStorage,
  clearPendingOrdersStorage,
} from "../lib/storage";
import {
  fetchTradesCloud,
  upsertTradeCloud,
  deleteTradeCloud,
  fetchPendingOrdersCloud,
  upsertPendingOrderCloud,
  deletePendingOrderCloud,
  fetchAccountCloud,
  updateAccountCloud,
  mapDbToTrade,
  mapDbToPendingOrder,
} from "../lib/cloudSync";
import { supabase } from "../lib/supabase";

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
];

export interface CreateTradeInput {
  date: string;
  time?: string;
  symbol: string;
  side: TradeSide;
  strategy: string;
  signalId?: string;
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

export type SyncStatus = "synced" | "syncing" | "error" | "offline";

interface TradeContextType {
  trades: Trade[];
  startingCapital: number;
  pendingOrders: PendingOrder[];
  syncStatus: SyncStatus;
  syncError: string | null;
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
  refreshCloudData: () => Promise<void>;
  isInitialized: boolean;
}

const TradeContext = createContext<TradeContextType | undefined>(undefined);

export function computeTradeMetrics(input: CreateTradeInput): {
  pnl: number;
  rMultiple: number;
  status: TradeStatus;
} {
  const fees = input.fees ?? 0;
  const entry = input.entryPrice;
  const exit = input.exitPrice ?? entry;
  const qty = input.quantity;
  const side = input.side;

  if (input.status === "OPEN") {
    return { pnl: 0, rMultiple: 0, status: "OPEN" };
  }

  // Gross PnL
  const grossPnl = side === "LONG" ? (exit - entry) * qty : (entry - exit) * qty;

  // Net PnL = Gross PnL - Fees
  const pnl = grossPnl - fees;

  const status: TradeStatus = pnl > 0 ? "WIN" : pnl < 0 ? "LOSS" : "BREAKEVEN";

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
  const { user, loading: authLoading } = useAuth();
  const [trades, setTrades] = useState<Trade[]>([]);
  const [startingCapital, setStartingCapital] = useState<number>(500);
  const [pendingOrders, setPendingOrders] = useState<PendingOrder[]>([]);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("offline");
  const [syncError, setSyncError] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState<boolean>(false);

  // Load Cloud / Storage data when Auth state finishes loading
  const refreshCloudData = useCallback(async () => {
    if (authLoading) {
      console.log("[TRADE] refreshCloudData skipped — auth is loading");
      return;
    }

    if (user) {
      console.log(`[CLOUD] fetching trades for user: ${user.id}`);
      setSyncStatus("syncing");
      try {
        const { trades: cloudTrades, error: tradesErr } = await fetchTradesCloud(user.id);
        const localTrades = loadTradesFromStorage();

        if (tradesErr) {
          console.error(`[CLOUD] fetchTradesCloud failed: ${tradesErr}`);
          setSyncStatus("error");
          setSyncError(tradesErr);
          // Fall back to local trades on cloud error so data is not lost
          if (localTrades.length > 0) {
            console.log(`[LOCAL] Falling back to local trades count: ${localTrades.length}`);
            setTrades(localTrades);
          }
        } else if (cloudTrades.length > 0) {
          console.log(`[CLOUD] fetched trades count: ${cloudTrades.length}`);
          console.log(`[TRADE] setting cloud trades count: ${cloudTrades.length}`);
          setTrades(cloudTrades);
          saveTradesToStorage(cloudTrades);
          setSyncStatus("synced");
          setSyncError(null);
        } else if (localTrades.length > 0) {
          // Cloud trades are empty, but local backup has trades -> auto-upload local backup to cloud!
          console.log(`[CLOUD] Cloud trades empty. Auto-uploading ${localTrades.length} local backup trades to Supabase...`);
          for (const t of localTrades) {
            await upsertTradeCloud(t, user.id);
          }
          const { trades: reFetched } = await fetchTradesCloud(user.id);
          const finalTrades = reFetched.length > 0 ? reFetched : localTrades;
          setTrades(finalTrades);
          saveTradesToStorage(finalTrades);
          setSyncStatus("synced");
          setSyncError(null);
        } else {
          setTrades([]);
          setSyncStatus("synced");
          setSyncError(null);
        }

        const cloudPending = await fetchPendingOrdersCloud(user.id);
        setPendingOrders(cloudPending);

        const cloudCapital = await fetchAccountCloud(user.id);
        if (cloudCapital !== null) {
          setStartingCapital(cloudCapital);
        } else {
          await updateAccountCloud(500, user.id);
          setStartingCapital(500);
        }
      } catch (err: any) {
        console.error("[TRADE] Failed to load cloud data from Supabase:", err);
        setSyncStatus("error");
        setSyncError(err?.message || "Failed to load cloud trades");
        const localBackup = loadTradesFromStorage();
        if (localBackup.length > 0) {
          setTrades(localBackup);
        }
      }
    } else {
      setSyncStatus("offline");
      setSyncError(null);
      const localTrades = loadTradesFromStorage();
      console.log(`[LOCAL] localStorage trades count: ${localTrades.length}`);
      setTrades(localTrades);
      setPendingOrders(loadPendingOrdersFromStorage());
      if (typeof window !== "undefined") {
        const storedCap = localStorage.getItem(CAPITAL_STORAGE_KEY);
        if (storedCap) {
          const parsed = parseFloat(storedCap);
          if (!isNaN(parsed) && parsed > 0) {
            setStartingCapital(parsed);
          }
        }
      }
    }
    setIsInitialized(true);
  }, [user, authLoading]);

  useEffect(() => {
    refreshCloudData();
  }, [refreshCloudData]);

  // Reconciliation on tab focus, network reconnect, or visibility change
  useEffect(() => {
    const handleReconcile = () => {
      if (document.visibilityState === "visible") {
        console.log("[RECONCILIATION] Tab active or network online — refreshing authoritative cloud data...");
        refreshCloudData();
      }
    };

    window.addEventListener("focus", handleReconcile);
    window.addEventListener("online", handleReconcile);
    document.addEventListener("visibilitychange", handleReconcile);

    return () => {
      window.removeEventListener("focus", handleReconcile);
      window.removeEventListener("online", handleReconcile);
      document.removeEventListener("visibilitychange", handleReconcile);
    };
  }, [refreshCloudData]);

  // Set up Supabase Realtime subscription for logged-in user
  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel(`trading-realtime-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "trades",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          if (payload.eventType === "INSERT" || payload.eventType === "UPDATE") {
            const incomingTrade = mapDbToTrade(payload.new);
            console.log(`[REALTIME] Trade event=${payload.eventType} trade_id=${incomingTrade.id}`);
            setTrades((prev) => {
              const exists = prev.some((t) => t.id === incomingTrade.id);
              const nextTrades = exists
                ? prev.map((t) => (t.id === incomingTrade.id ? incomingTrade : t))
                : [incomingTrade, ...prev];
              saveTradesToStorage(nextTrades);
              return nextTrades;
            });
          } else if (payload.eventType === "DELETE") {
            const deletedId = payload.old.id;
            console.log(`[REALTIME] Trade DELETE trade_id=${deletedId}`);
            setTrades((prev) => {
              const nextTrades = prev.filter((t) => t.id !== deletedId);
              saveTradesToStorage(nextTrades);
              return nextTrades;
            });
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "pending_orders",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          if (payload.eventType === "INSERT" || payload.eventType === "UPDATE") {
            const incomingOrder = mapDbToPendingOrder(payload.new);
            setPendingOrders((prev) => {
              const exists = prev.some((o) => o.id === incomingOrder.id);
              return exists
                ? prev.map((o) => (o.id === incomingOrder.id ? incomingOrder : o))
                : [incomingOrder, ...prev];
            });
          } else if (payload.eventType === "DELETE") {
            const deletedId = payload.old.id;
            setPendingOrders((prev) => prev.filter((o) => o.id !== deletedId));
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "account",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const newData = payload.new as any;
          if (newData && newData.starting_capital) {
            setStartingCapital(Number(newData.starting_capital));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  const updateStartingCapital = (amount: number) => {
    setStartingCapital(amount);
    if (user) {
      updateAccountCloud(amount, user.id);
    } else if (typeof window !== "undefined") {
      localStorage.setItem(CAPITAL_STORAGE_KEY, amount.toString());
    }
  };

  const resetAccount = () => {
    setTrades([]);
    setPendingOrders([]);
    clearTradesStorage();
    clearPendingOrdersStorage();
    if (user) {
      trades.forEach((t) => deleteTradeCloud(t.id, user.id));
      pendingOrders.forEach((p) => deletePendingOrderCloud(p.id, user.id));
      updateAccountCloud(500, user.id);
    }
    updateStartingCapital(500);
  };

  const addTrade = (input: CreateTradeInput): Trade => {
    const fees = input.fees ?? 0;
    const { pnl, rMultiple, status } = computeTradeMetrics({ ...input, fees });
    const newTrade: Trade = {
      ...input,
      id: `trade_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      fees,
      exitPrice: input.exitPrice ?? input.entryPrice,
      pnl,
      rMultiple,
      status: input.status || "OPEN",
    };

    console.log(`[TRADE] addTrade called for ${newTrade.symbol} (${newTrade.side}) id=${newTrade.id}`);

    setTrades((prev) => {
      const nextTrades = [newTrade, ...prev];
      // ALWAYS save to local backup as well as cloud to prevent data loss on reload
      saveTradesToStorage(nextTrades);
      console.log(`[LOCAL] Saved trade to local backup. Total count: ${nextTrades.length}`);
      return nextTrades;
    });

    if (user) {
      console.log(`[CLOUD] calling upsertTradeCloud for trade ${newTrade.id} and user ${user.id}`);
      setSyncStatus("syncing");
      upsertTradeCloud(newTrade, user.id).then((res) => {
        if (res.success) {
          console.log(`[CLOUD] Trade ${newTrade.id} successfully synced to Supabase!`);
          setSyncStatus("synced");
          setSyncError(null);
        } else {
          console.error(`[CLOUD] Trade ${newTrade.id} FAILED to sync to Supabase: ${res.error}`);
          setSyncStatus("error");
          setSyncError(res.error || "Cloud Save Failed");
        }
      });
    }

    return newTrade;
  };

  const updateTrade = (id: string, input: CreateTradeInput) => {
    const fees = input.fees ?? 0;
    const { pnl, rMultiple, status } = computeTradeMetrics({ ...input, fees });
    let updatedTrade: Trade | null = null;

    setTrades((prev) => {
      const nextTrades = prev.map((t) => {
        if (t.id === id) {
          updatedTrade = {
            ...t,
            ...input,
            exitPrice: input.exitPrice ?? input.entryPrice,
            fees,
            pnl,
            rMultiple,
            status: input.status || t.status,
          };
          return updatedTrade;
        }
        return t;
      });
      saveTradesToStorage(nextTrades);
      return nextTrades;
    });

    if (user && updatedTrade) {
      const targetTrade: Trade = updatedTrade;
      setSyncStatus("syncing");
      upsertTradeCloud(targetTrade, user.id).then((res) => {
        if (res.success) {
          setSyncStatus("synced");
          setSyncError(null);
        } else {
          setSyncStatus("error");
          setSyncError(res.error || "Cloud Update Failed");
        }
      });
    }
  };

  const closePosition = (id: string, exitPrice: number) => {
    const exitTimeStr = new Date().toTimeString().split(" ")[0].substring(0, 5);
    let updatedTrade: Trade | null = null;

    console.log(`[TRADE] closePosition called for trade id=${id} exitPrice=${exitPrice}`);

    setTrades((prev) => {
      const nextTrades = prev.map((t) => {
        if (t.id !== id) return t;

        const updatedInput: CreateTradeInput = {
          ...t,
          exitPrice,
          status: undefined,
        };

        const { pnl, rMultiple, status } = computeTradeMetrics(updatedInput);

        let holdingTime = "15m";
        if (t.time) {
          const [eH, eM] = t.time.split(":").map(Number);
          const [xH, xM] = exitTimeStr.split(":").map(Number);
          const totalMinutes = Math.max((xH * 60 + xM) - (eH * 60 + eM), 1);
          if (totalMinutes >= 60) {
            const hrs = Math.floor(totalMinutes / 60);
            const mins = totalMinutes % 60;
            holdingTime = `${hrs}h ${mins}m`;
          } else {
            holdingTime = `${totalMinutes}m`;
          }
        }

        updatedTrade = {
          ...t,
          exitPrice,
          exitTime: exitTimeStr,
          holdingTime,
          pnl,
          rMultiple,
          status,
        };

        return updatedTrade;
      });

      saveTradesToStorage(nextTrades);
      return nextTrades;
    });

    if (user && updatedTrade) {
      const targetTrade: Trade = updatedTrade;
      console.log(`[CLOUD] calling upsertTradeCloud for closed trade ${targetTrade.id}`);
      setSyncStatus("syncing");
      upsertTradeCloud(targetTrade, user.id).then((res) => {
        if (res.success) {
          console.log(`[CLOUD] Closed trade ${targetTrade.id} successfully synced to Supabase!`);
          setSyncStatus("synced");
          setSyncError(null);
        } else {
          console.error(`[CLOUD] Closed trade ${targetTrade.id} FAILED to sync to Supabase: ${res.error}`);
          setSyncStatus("error");
          setSyncError(res.error || "Failed to persist closed trade.");
        }
      });
    }
  };

  const updateTradeStopLoss = (id: string, newSL: number) => {
    let updatedTrade: Trade | null = null;
    setTrades((prev) => {
      const nextTrades = prev.map((t) => {
        if (t.id === id) {
          updatedTrade = { ...t, stopLoss: newSL };
          return updatedTrade;
        }
        return t;
      });
      saveTradesToStorage(nextTrades);
      return nextTrades;
    });

    if (user && updatedTrade) {
      upsertTradeCloud(updatedTrade, user.id);
    }
  };

  const updateTradeTargetPrice = (id: string, newTP: number) => {
    let updatedTrade: Trade | null = null;
    setTrades((prev) => {
      const nextTrades = prev.map((t) => {
        if (t.id === id) {
          updatedTrade = { ...t, targetPrice: newTP };
          return updatedTrade;
        }
        return t;
      });
      saveTradesToStorage(nextTrades);
      return nextTrades;
    });

    if (user && updatedTrade) {
      upsertTradeCloud(updatedTrade, user.id);
    }
  };

  const deleteTrade = (id: string) => {
    setTrades((prev) => {
      const nextTrades = prev.filter((t) => t.id !== id);
      saveTradesToStorage(nextTrades);
      return nextTrades;
    });

    if (user) {
      deleteTradeCloud(id, user.id);
    }
  };

  const loadSampleTrades = () => {
    setTrades(SAMPLE_TRADES);
    saveTradesToStorage(SAMPLE_TRADES);
    if (user) {
      SAMPLE_TRADES.forEach((t) => upsertTradeCloud(t, user.id));
    }
  };

  const clearTrades = () => {
    if (user) {
      trades.forEach((t) => deleteTradeCloud(t.id, user.id));
    }
    clearTradesStorage();
    setTrades([]);
  };

  const exportTrades = () => {
    exportTradesToFile(trades);
  };

  const importTrades = (importedTrades: Trade[]) => {
    setTrades(importedTrades);
    saveTradesToStorage(importedTrades);
    if (user) {
      importedTrades.forEach((t) => upsertTradeCloud(t, user.id));
    }
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

    if (user) {
      upsertPendingOrderCloud(newOrder, user.id);
    }

    return newOrder;
  };

  const cancelPendingOrder = (id: string) => {
    setPendingOrders((prev) => {
      const next = prev.filter((o) => o.id !== id);
      savePendingOrdersToStorage(next);
      return next;
    });

    if (user) {
      deletePendingOrderCloud(id, user.id);
    }
  };

  const fillPendingOrder = (id: string, fillPrice: number) => {
    const order = pendingOrders.find((o) => o.id === id);
    if (!order) return;

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
      fees: 0,
      status: "OPEN",
      orderType: "LIMIT",
      notes: `Limit order filled at $${fillPrice.toFixed(2)}`,
    });

    cancelPendingOrder(id);
  };

  return (
    <TradeContext.Provider
      value={{
        trades,
        startingCapital,
        pendingOrders,
        syncStatus,
        syncError,
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
        refreshCloudData,
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
