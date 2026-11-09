"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  ActiveSymbolTradeContext,
  SymbolAiShieldReport,
  computeReportContentHash,
} from "../lib/indian/aiNewsReversalEngine";

export interface UseAiNewsReversalWorkerOptions {
  activeTrades: ActiveSymbolTradeContext[];
  pollIntervalMs?: number;
  enabled?: boolean;
  onAutoExitTriggered?: (report: SymbolAiShieldReport) => void;
}

function getReportContentSignature(r: SymbolAiShieldReport): string {
  if (r.contentHash) return r.contentHash;
  return computeReportContentHash({
    symbol: r.symbol,
    topHeadline: r.topHeadline,
    sentimentScore: r.sentimentScore,
    shieldStatus: r.shieldStatus,
    shouldAutoExit: r.shouldAutoExit,
    badgeText: r.badgeText,
  });
}

export function useAiNewsReversalWorker({
  activeTrades,
  pollIntervalMs = 25000,
  enabled = true,
  onAutoExitTriggered,
}: UseAiNewsReversalWorkerOptions) {
  const [aiShieldReports, setAiShieldReports] = useState<Record<string, SymbolAiShieldReport>>({});
  const [isScanningNews, setIsScanningNews] = useState<boolean>(false);
  const [lastNewsScanIst, setLastNewsScanIst] = useState<string | null>(null);

  const tradesRef = useRef<ActiveSymbolTradeContext[]>(activeTrades);
  useEffect(() => {
    tradesRef.current = activeTrades;
  }, [activeTrades]);

  const onAutoExitRef = useRef(onAutoExitTriggered);
  useEffect(() => {
    onAutoExitRef.current = onAutoExitTriggered;
  }, [onAutoExitTriggered]);

  const prevHashesRef = useRef<Record<string, string>>({});
  const prevReportsRef = useRef<Record<string, SymbolAiShieldReport>>({});
  const triggeredExitHashesRef = useRef<Set<string>>(new Set());

  const runNewsScan = useCallback(async (simulateCatalystSymbol?: string) => {
    const currentTrades = tradesRef.current;
    if (!currentTrades || currentTrades.length === 0) return;

    setIsScanningNews(true);
    try {
      const res = await fetch("/api/indian/news-reader", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trades: currentTrades,
          simulateCatalystSymbol: simulateCatalystSymbol || null,
        }),
        cache: "no-store",
      });
      if (!res.ok) return;
      const json = await res.json();
      if (!json?.success || !json.reports) return;

      const incomingReports = json.reports as Record<string, SymbolAiShieldReport>;
      let hasGenuineContentChange = false;
      const nextReports: Record<string, SymbolAiShieldReport> = { ...prevReportsRef.current };

      for (const [sym, incomingReport] of Object.entries(incomingReports)) {
        const currentSig = getReportContentSignature(incomingReport);
        const prevSig = prevHashesRef.current[sym];

        if (!prevSig || prevSig !== currentSig) {
          hasGenuineContentChange = true;
          prevHashesRef.current[sym] = currentSig;
          nextReports[sym] = {
            ...incomingReport,
            lastContentChangeIst:
              incomingReport.evaluatedAtIst || new Date().toLocaleTimeString("en-IN", { hour12: false }),
          };
        } else {
          // Content is identical: preserve previous stable reference and timestamp
          if (prevReportsRef.current[sym]) {
            nextReports[sym] = prevReportsRef.current[sym];
          } else {
            nextReports[sym] = incomingReport;
          }
        }
      }

      // PREVENT REDUNDANT RE-RENDER & TIMESTAMP LOOPS:
      // Only update state when there is a real headline, sentiment, or catalyst change!
      if (hasGenuineContentChange || Object.keys(prevReportsRef.current).length === 0) {
        prevReportsRef.current = nextReports;
        setAiShieldReports(nextReports);
        setLastNewsScanIst(new Date().toLocaleTimeString("en-IN", { hour12: false }));
      }

      // Process auto-exits without duplicate firing
      if (Array.isArray(json.triggeredExits) && json.triggeredExits.length > 0 && onAutoExitRef.current) {
        json.triggeredExits.forEach((report: SymbolAiShieldReport) => {
          const exitKey = `${report.symbol}:${report.exitStatusTag}:${report.topHeadline}`;
          if (!triggeredExitHashesRef.current.has(exitKey)) {
            triggeredExitHashesRef.current.add(exitKey);
            onAutoExitRef.current?.(report);
          }
        });
      }
    } catch {
      // background worker resilient to transient network errors
    } finally {
      setIsScanningNews(false);
    }
  }, []);

  // Poll when active trades exist
  const activeSymbolsSignature = activeTrades
    .map((t) => String(t.symbol || "").toUpperCase().replace(/\.NS$/i, "").replace(/\.BO$/i, ""))
    .filter(Boolean)
    .sort()
    .join(",");

  useEffect(() => {
    if (!enabled || !activeSymbolsSignature) return;
    runNewsScan();
    const timer = setInterval(() => {
      runNewsScan();
    }, pollIntervalMs);
    return () => clearInterval(timer);
  }, [enabled, activeSymbolsSignature, pollIntervalMs, runNewsScan]);

  return {
    aiShieldReports,
    isScanningNews,
    lastNewsScanIst,
    runNewsScan,
  };
}

