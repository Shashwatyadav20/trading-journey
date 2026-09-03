"use client";

import React, { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { loadTradesFromStorage, loadPendingOrdersFromStorage } from "@/lib/storage";
import { loadDrawingsFromStorage } from "@/lib/drawingStorage";
import {
  upsertTradeCloud,
  upsertPendingOrderCloud,
  upsertDrawingCloud,
  updateAccountCloud,
} from "@/lib/cloudSync";
import { CloudUpload, CheckCircle, Database, Loader2, X } from "lucide-react";

interface MigrationModalProps {
  onMigrationComplete: () => void;
}

export default function MigrationModal({ onMigrationComplete }: MigrationModalProps) {
  const { user } = useAuth();
  const [hasData, setHasData] = useState<boolean>(false);
  const [tradeCount, setTradeCount] = useState<number>(0);
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [drawingCount, setDrawingCount] = useState<number>(0);
  const [migrating, setMigrating] = useState<boolean>(false);
  const [dismissed, setDismissed] = useState<boolean>(false);

  useEffect(() => {
    if (!user) return;

    const migrationKey = `trading-journey-migrated-${user.id}`;
    const alreadyMigrated = localStorage.getItem(migrationKey);

    if (alreadyMigrated === "true") {
      setHasData(false);
      return;
    }

    const localTrades = loadTradesFromStorage();
    const localPending = loadPendingOrdersFromStorage();
    const localDrawings = loadDrawingsFromStorage();

    if (localTrades.length > 0 || localPending.length > 0 || localDrawings.length > 0) {
      setTradeCount(localTrades.length);
      setPendingCount(localPending.length);
      setDrawingCount(localDrawings.length);
      setHasData(true);
    }
  }, [user]);

  if (!hasData || dismissed || !user) return null;

  const handleMigrate = async () => {
    setMigrating(true);
    try {
      const localTrades = loadTradesFromStorage();
      const localPending = loadPendingOrdersFromStorage();
      const localDrawings = loadDrawingsFromStorage();

      // Upload trades
      for (const trade of localTrades) {
        await upsertTradeCloud(trade, user.id);
      }

      // Upload pending orders
      for (const order of localPending) {
        await upsertPendingOrderCloud(order, user.id);
      }

      // Upload drawings
      for (const drawing of localDrawings) {
        await upsertDrawingCloud(drawing, user.id);
      }

      // Sync local capital if saved
      const savedCap = localStorage.getItem("trading-journey-starting-capital");
      if (savedCap) {
        const parsed = parseFloat(savedCap);
        if (!isNaN(parsed) && parsed > 0) {
          await updateAccountCloud(parsed, user.id);
        }
      }

      // Mark migration complete in localStorage
      localStorage.setItem(`trading-journey-migrated-${user.id}`, "true");

      onMigrationComplete();
      setHasData(false);
    } catch (err) {
      console.error("Migration error:", err);
      alert("Failed to migrate some local records to cloud. Please check connection and retry.");
    } finally {
      setMigrating(false);
    }
  };

  const handleSkip = () => {
    if (user) {
      localStorage.setItem(`trading-journey-migrated-${user.id}`, "true");
    }
    setDismissed(true);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#05080e]/80 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-[#0d1322] border border-cyan-500/30 rounded-2xl shadow-2xl shadow-cyan-950/30 p-6 space-y-5 animate-fadeIn">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
              <CloudUpload className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-100">
                Migrate Local Data to Cloud
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                We detected offline trading data on this device.
              </p>
            </div>
          </div>
          <button
            onClick={handleSkip}
            className="text-slate-500 hover:text-slate-300 p-1 rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 bg-[#090d16] border border-slate-800 rounded-xl space-y-2 text-xs font-mono text-slate-300">
          <div className="flex justify-between items-center py-1 border-b border-slate-800/60">
            <span className="text-slate-400 flex items-center gap-2">
              <Database className="w-3.5 h-3.5 text-cyan-400" /> Trades
            </span>
            <span className="font-bold text-cyan-300">{tradeCount} records</span>
          </div>
          <div className="flex justify-between items-center py-1 border-b border-slate-800/60">
            <span className="text-slate-400 flex items-center gap-2">
              <Database className="w-3.5 h-3.5 text-cyan-400" /> Pending Orders
            </span>
            <span className="font-bold text-cyan-300">{pendingCount} records</span>
          </div>
          <div className="flex justify-between items-center py-1">
            <span className="text-slate-400 flex items-center gap-2">
              <Database className="w-3.5 h-3.5 text-cyan-400" /> Chart Drawings
            </span>
            <span className="font-bold text-cyan-300">{drawingCount} records</span>
          </div>
        </div>

        <p className="text-xs text-slate-400">
          Syncing your local trades to Supabase enables access across all your devices (phones, laptops, tablets) securely. Local data will remain safely backed up.
        </p>

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            onClick={handleSkip}
            disabled={migrating}
            className="py-2 px-4 text-xs font-medium text-slate-400 hover:text-slate-200 transition-colors"
          >
            Skip for Now
          </button>
          <button
            onClick={handleMigrate}
            disabled={migrating}
            className="py-2.5 px-5 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-bold text-xs rounded-xl shadow-md shadow-cyan-950/40 flex items-center gap-2 transition-all disabled:opacity-50"
          >
            {migrating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-slate-950" />
                <span>Migrating Data...</span>
              </>
            ) : (
              <>
                <CheckCircle className="w-4 h-4" />
                <span>Upload & Sync Data</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
