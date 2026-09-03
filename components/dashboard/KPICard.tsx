"use client";

import React from "react";
import { TrendingUp, TrendingDown, Minus, Info } from "lucide-react";

export interface KPICardProps {
  title: string;
  value: string;
  subtext?: string;
  trend?: "positive" | "negative" | "neutral";
  icon: React.ElementType;
  badgeText?: string;
  accentColor?: "cyan" | "emerald" | "amber" | "rose" | "indigo" | "slate";
}

export default function KPICard({
  title,
  value,
  subtext,
  trend = "neutral",
  icon: Icon,
  badgeText,
  accentColor = "cyan",
}: KPICardProps) {
  const getAccentStyles = () => {
    switch (accentColor) {
      case "emerald":
        return {
          iconBg: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
          glow: "group-hover:border-emerald-500/30",
          badge: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
        };
      case "rose":
        return {
          iconBg: "bg-rose-500/10 text-rose-400 border-rose-500/20",
          glow: "group-hover:border-rose-500/30",
          badge: "bg-rose-500/10 text-rose-400 border-rose-500/20",
        };
      case "amber":
        return {
          iconBg: "bg-amber-500/10 text-amber-400 border-amber-500/20",
          glow: "group-hover:border-amber-500/30",
          badge: "bg-amber-500/10 text-amber-400 border-amber-500/20",
        };
      case "indigo":
        return {
          iconBg: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20",
          glow: "group-hover:border-indigo-500/30",
          badge: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20",
        };
      case "slate":
        return {
          iconBg: "bg-slate-800/80 text-slate-400 border-slate-700/50",
          glow: "group-hover:border-slate-700",
          badge: "bg-slate-800 text-slate-400 border-slate-700",
        };
      case "cyan":
      default:
        return {
          iconBg: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
          glow: "group-hover:border-cyan-500/30",
          badge: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
        };
    }
  };

  const accent = getAccentStyles();

  return (
    <div
      className={`
        p-4 rounded-xl bg-slate-900/70 border border-slate-800/80 
        flex flex-col justify-between gap-2.5 group hover:bg-slate-900/90 
        transition-all duration-200 relative overflow-hidden ${accent.glow}
      `}
    >
      {/* Top Header */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-400 font-mono tracking-tight truncate">
          {title}
        </span>
        <div className={`p-2 rounded-lg border text-xs shrink-0 ${accent.iconBg}`}>
          <Icon className="w-4 h-4" />
        </div>
      </div>

      {/* Main KPI Value */}
      <div className="space-y-1">
        <div className="text-xl sm:text-2xl font-bold font-mono text-slate-100 tracking-tight truncate">
          {value}
        </div>

        {/* Subtext or Badge */}
        <div className="flex items-center justify-between text-[11px] font-mono">
          {subtext && (
            <span
              className={`flex items-center gap-1 font-medium ${
                trend === "positive"
                  ? "text-emerald-400"
                  : trend === "negative"
                  ? "text-rose-400"
                  : "text-slate-400"
              }`}
            >
              {trend === "positive" && <TrendingUp className="w-3 h-3 shrink-0" />}
              {trend === "negative" && <TrendingDown className="w-3 h-3 shrink-0" />}
              {trend === "neutral" && <Minus className="w-3 h-3 shrink-0" />}
              <span className="truncate">{subtext}</span>
            </span>
          )}

          {badgeText && (
            <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${accent.badge}`}>
              {badgeText}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
