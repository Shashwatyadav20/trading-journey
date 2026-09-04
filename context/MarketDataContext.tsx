"use client";

import React, { createContext, useContext, useState, useEffect, useRef } from "react";

export type PriceStatus = "LIVE" | "STALE" | "OFFLINE";
export type ConnectionStatus = "CONNECTING" | "CONNECTED" | "RECONNECTING" | "DISCONNECTED";

export interface MarketPrice {
  instrument: string;
  price: number;
  timestamp: string;
  source: string;
  sourceSymbol: string;
  isProxy: boolean;
  status: PriceStatus;
}

interface MarketDataContextType {
  currentPrices: Record<string, MarketPrice>;
  getPrice: (instrument: string) => MarketPrice | undefined;
  connectionStatus: ConnectionStatus;
  lastUpdated: Date | null;
}

const MarketDataContext = createContext<MarketDataContextType | undefined>(undefined);

export function MarketDataProvider({ children }: { children: React.ReactNode }) {
  const [currentPrices, setCurrentPrices] = useState<Record<string, MarketPrice>>({});
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("CONNECTING");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isUnmountingRef = useRef<boolean>(false);
  const reconnectAttemptsRef = useRef<number>(0);

  const getWebSocketUrl = () => {
    if (process.env.NEXT_PUBLIC_WS_URL) {
      return process.env.NEXT_PUBLIC_WS_URL;
    }
    const backendUrl =
      process.env.NEXT_PUBLIC_BACKEND_URL ||
      process.env.NEXT_PUBLIC_API_URL ||
      "http://localhost:4000";

    const protocol = backendUrl.startsWith("https") ? "wss:" : "ws:";
    const host = backendUrl.replace(/^https?:\/\//, "");
    return `${protocol}//${host}/ws/market`;
  };

  const connect = () => {
    if (typeof window === "undefined" || isUnmountingRef.current) return;

    // Clean up existing socket if any before creating a new one
    if (wsRef.current) {
      wsRef.current.onopen = null;
      wsRef.current.onmessage = null;
      wsRef.current.onerror = null;
      wsRef.current.onclose = null;
      if (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING) {
        wsRef.current.close();
      }
      wsRef.current = null;
    }

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    const isFirstAttempt = reconnectAttemptsRef.current === 0;
    setConnectionStatus(isFirstAttempt ? "CONNECTING" : "RECONNECTING");

    try {
      const url = getWebSocketUrl();
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (isUnmountingRef.current) {
          ws.close();
          return;
        }
        reconnectAttemptsRef.current = 0; // Reset attempts on successful connection
        setConnectionStatus("CONNECTED");
      };

      ws.onmessage = (event) => {
        if (isUnmountingRef.current) return;
        try {
          const message = JSON.parse(event.data);
          if (message.type === "priceUpdate" && message.data) {
            const priceData: MarketPrice = message.data;

            setCurrentPrices((prev) => ({
              ...prev,
              [priceData.instrument]: priceData,
            }));

            setLastUpdated(new Date());
          }
        } catch (err) {
          console.error("[MarketData] Failed to parse WebSocket message", err);
        }
      };

      ws.onerror = () => {
        // Silently handled; onclose will manage reconnection
      };

      ws.onclose = () => {
        if (isUnmountingRef.current) return;

        wsRef.current = null;
        reconnectAttemptsRef.current += 1;
        
        // Exponential backoff up to max 5s (1s, 2s, 3s, 5s)
        const delay = Math.min(1000 * reconnectAttemptsRef.current, 5000);
        setConnectionStatus("RECONNECTING");

        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, delay);
      };
    } catch (err) {
      if (!isUnmountingRef.current) {
        setConnectionStatus("DISCONNECTED");
        reconnectAttemptsRef.current += 1;
        const delay = Math.min(1000 * reconnectAttemptsRef.current, 5000);
        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, delay);
      }
    }
  };

  useEffect(() => {
    isUnmountingRef.current = false;
    connect();

    return () => {
      isUnmountingRef.current = true;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.onopen = null;
        wsRef.current.onmessage = null;
        wsRef.current.onerror = null;
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
      setConnectionStatus("DISCONNECTED");
    };
  }, []);

  const getPrice = (instrument: string) => {
    return currentPrices[instrument];
  };

  return (
    <MarketDataContext.Provider
      value={{
        currentPrices,
        getPrice,
        connectionStatus,
        lastUpdated,
      }}
    >
      {children}
    </MarketDataContext.Provider>
  );
}

export function useMarketData() {
  const context = useContext(MarketDataContext);
  if (!context) {
    throw new Error("useMarketData must be used within a MarketDataProvider");
  }
  return context;
}

