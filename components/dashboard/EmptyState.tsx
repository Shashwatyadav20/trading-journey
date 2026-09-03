"use client";

import React from "react";
import { FolderOpen, Plus, Sparkles, Activity } from "lucide-react";

interface EmptyStateProps {
  onToggleSampleData?: () => void;
  isSampleDataActive?: boolean;
}

export default function EmptyState({
  onToggleSampleData,
  isSampleDataActive = false,
}: EmptyStateProps) {
  return (
    <div className="p-8 rounded-2xl bg-slate-900/60 border border-slate-800/80 text-center space-y-4 max-w-lg mx-auto my-6 shadow-xl">
      <div className="w-14 h-14 rounded-2xl bg-slate-800/80 border border-slate-700/60 flex items-center justify-center mx-auto text-cyan-400">
        <FolderOpen className="w-7 h-7" />
      </div>

      <div className="space-y-1.5">
        <h3 className="text-base font-bold text-slate-100 tracking-tight">
          No trades recorded yet
        </h3>
        <p className="text-xs text-slate-400 leading-relaxed font-mono">
          Your trade log is currently empty. As soon as you start logging trades in Step 4, all 12 KPI metrics and equity curves will calculate automatically.
        </p>
      </div>

      {onToggleSampleData && (
        <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-3">
          <button
            onClick={onToggleSampleData}
            className="w-full sm:w-auto px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-cyan-400 font-semibold text-xs border border-cyan-500/30 transition-colors flex items-center justify-center gap-2 font-mono"
          >
            <Sparkles className="w-4 h-4 text-cyan-400" />
            <span>{isSampleDataActive ? "Clear Sample Trades" : "Load Sample Trades Preview"}</span>
          </button>
        </div>
      )}
    </div>
  );
}
