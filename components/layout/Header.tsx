"use client";

import React, { useState, useEffect } from "react";
import {
  Menu,
  Search,
  Bell,
  Plus,
  Clock,
  Globe,
  TrendingUp,
  TrendingDown,
  Sparkles,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useTrades } from "@/context/TradeContext";
import { LogOut, User as UserIcon, Loader2, AlertCircle } from "lucide-react";
import { NavTabId, NAV_ITEMS } from "./Sidebar";

interface HeaderProps {
  activeTab: NavTabId;
  onOpenMobileMenu: () => void;
  collapsed: boolean;
}

export default function Header({
  activeTab,
  onOpenMobileMenu,
  collapsed,
}: HeaderProps) {
  const { user, signOut } = useAuth();
  const { syncStatus, syncError } = useTrades();
  const [timeString, setTimeString] = useState<string>("");

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTimeString(
        now.toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        }) + " UTC"
      );
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  const currentNav = NAV_ITEMS.find((item) => item.id === activeTab);

  return (
    <header
      className={`
        sticky top-0 z-30 flex items-center justify-between h-16 px-4 md:px-6
        bg-[#0d1322]/80 backdrop-blur-md border-b border-slate-800/80
        transition-all duration-300
      `}
    >
      {/* Left Section: Mobile Menu Toggle & Title */}
      <div className="flex items-center gap-3">
        <button
          onClick={onOpenMobileMenu}
          className="p-2 rounded-xl text-slate-300 hover:text-slate-100 hover:bg-slate-800/60 lg:hidden border border-slate-800/60 transition-colors"
          aria-label="Open navigation menu"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 font-mono hidden sm:inline">
              Terminal /
            </span>
            <h1 className="text-base font-bold text-slate-100 tracking-tight">
              {currentNav?.label || "Dashboard"}
            </h1>
          </div>
        </div>
      </div>

      {/* Center Section: Live Market Ticker simulation */}
      <div className="hidden xl:flex items-center gap-4 px-4 py-1.5 rounded-full bg-slate-900/80 border border-slate-800/80 font-mono text-xs">
        <div className="flex items-center gap-1.5 text-slate-300">
          <Globe className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
          <span className="text-slate-500">MARKETS:</span>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-slate-300 font-semibold">BTC/USD</span>
          <span className="text-emerald-400 flex items-center gap-0.5">
            <TrendingUp className="w-3 h-3" /> $89,450 (+2.1%)
          </span>
        </div>

        <span className="text-slate-700">|</span>

        <div className="flex items-center gap-1.5">
          <span className="text-slate-300 font-semibold">NQ1!</span>
          <span className="text-emerald-400 flex items-center gap-0.5">
            <TrendingUp className="w-3 h-3" /> 20,840 (+0.5%)
          </span>
        </div>

        <span className="text-slate-700">|</span>

        <div className="flex items-center gap-1.5">
          <span className="text-slate-300 font-semibold">SPX</span>
          <span className="text-rose-400 flex items-center gap-0.5">
            <TrendingDown className="w-3 h-3" /> 5,910 (-0.1%)
          </span>
        </div>
      </div>

      {/* Right Section: Time, User Badge & Logout */}
      <div className="flex items-center gap-2 sm:gap-3">
        {/* Live Terminal Clock */}
        <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900/60 border border-slate-800/60 text-xs font-mono text-slate-300">
          <Clock className="w-3.5 h-3.5 text-cyan-400" />
          <span>{timeString || "00:00:00 UTC"}</span>
        </div>

        {/* User Cloud Account Badge & Logout */}
        {user && (
          <div className="flex items-center gap-2 pl-2 border-l border-slate-800">
            <div className="hidden md:flex flex-col text-right font-mono">
              <span className="text-[11px] text-cyan-400 font-bold max-w-[140px] truncate">
                {user.email}
              </span>
              <span className="text-[9px] flex items-center justify-end gap-1">
                {syncStatus === "synced" ? (
                  <>
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="text-emerald-400 font-bold">Cloud Synced</span>
                  </>
                ) : syncStatus === "syncing" ? (
                  <>
                    <Loader2 className="w-3 h-3 text-cyan-400 animate-spin" />
                    <span className="text-cyan-400">Syncing...</span>
                  </>
                ) : syncStatus === "error" ? (
                  <>
                    <AlertCircle className="w-3 h-3 text-rose-400" />
                    <span className="text-rose-400 font-bold" title={syncError || "Sync Error"}>
                      Sync Error
                    </span>
                  </>
                ) : (
                  <>
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
                    <span className="text-slate-400">Local Mode</span>
                  </>
                )}
              </span>
            </div>

            <button
              onClick={() => signOut()}
              title="Sign Out of Cloud Account"
              className="p-2 rounded-xl text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 border border-slate-800/60 hover:border-rose-500/30 transition-all cursor-pointer flex items-center gap-1.5 text-xs font-medium"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">Logout</span>
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
