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
import { NavTabId, MarketMode, NAV_ITEMS } from "./Sidebar";

import { useMarketData } from "@/context/MarketDataContext";
import { apiUrl } from "@/lib/backendUrl";

interface HeaderProps {
  marketMode: MarketMode;
  activeTab: NavTabId;
  onOpenMobileMenu: () => void;
  collapsed: boolean;
}

export default function Header({
  marketMode,
  activeTab,
  onOpenMobileMenu,
  collapsed,
}: HeaderProps) {
  const { user, signOut } = useAuth();
  const { syncStatus, syncError } = useTrades();
  const { currentPrices, connectionStatus } = useMarketData();
  const [timeString, setTimeString] = useState<string>("");
  const [niftySpot, setNiftySpot] = useState<number | null>(null);

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

  // Poll Nifty spot for Indian mode
  useEffect(() => {
    if (marketMode !== "indian") return;
    const fetchNifty = async () => {
      try {
        const res = await fetch(apiUrl("/api/indian/signal"), { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          if (data.signal?.spotPrice && data.signal.spotPrice > 0) {
            setNiftySpot(data.signal.spotPrice);
          }
        }
      } catch {
        // silent
      }
    };
    fetchNifty();
    const int = setInterval(fetchNifty, 5000);
    return () => clearInterval(int);
  }, [marketMode]);

  const currentNav = NAV_ITEMS.find((item) => item.id === activeTab);

  const btcPrice = currentPrices["BTC/USD"]?.price;
  const xauPrice = currentPrices["XAU/USD"]?.price;

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
          <div className="flex items-center gap-2 flex-wrap">
            {/* Market mode badge */}
            <span
              className={`hidden sm:inline text-[10px] px-2 py-0.5 rounded-md font-mono font-semibold border ${
                marketMode === "indian"
                  ? "bg-orange-500/10 text-orange-400 border-orange-500/20"
                  : "bg-cyan-500/10 text-cyan-400 border-cyan-500/20"
              }`}
            >
              {marketMode === "indian" ? "🇮🇳 Indian" : "🌐 Global"}
            </span>
            <span className="text-xs text-slate-600 font-mono hidden sm:inline">/</span>
            <h1 className="text-base font-bold text-slate-100 tracking-tight">
              {currentNav?.label || "Dashboard"}
            </h1>
          </div>
        </div>
      </div>

      {/* Center Section: Live Market Ticker */}
      <div className="hidden xl:flex items-center gap-4 px-4 py-1.5 rounded-full bg-slate-900/80 border border-slate-800/80 font-mono text-xs shadow-inner">
        <div className="flex items-center gap-1.5 text-slate-300">
          <Globe className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
          <span className="text-slate-500">LIVE FEED:</span>
        </div>

        {marketMode === "indian" ? (
          <>
            <div className="flex items-center gap-1.5">
              <span className="text-slate-300 font-semibold">NIFTY 50</span>
              <span className="text-emerald-400 flex items-center gap-0.5 font-bold">
                <TrendingUp className="w-3 h-3" />
                {niftySpot ? `₹${niftySpot.toLocaleString("en-IN", { minimumFractionDigits: 2 })}` : "₹24,700.45"}
              </span>
            </div>

            <span className="text-slate-700">|</span>

            <div className="flex items-center gap-1.5">
              <span className="text-slate-400 font-semibold">BANKNIFTY</span>
              <span className="text-cyan-400 font-medium">52,380.00</span>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-1.5">
              <span className="text-slate-300 font-semibold">BTC/USD</span>
              <span className="text-emerald-400 flex items-center gap-0.5 font-bold">
                <TrendingUp className="w-3 h-3" />
                {btcPrice ? `$${btcPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "Connecting..."}
              </span>
            </div>

            <span className="text-slate-700">|</span>

            <div className="flex items-center gap-1.5">
              <span className="text-slate-300 font-semibold">XAU/USD</span>
              <span className="text-amber-400 flex items-center gap-0.5 font-bold">
                {xauPrice ? `$${xauPrice.toFixed(2)}` : "Live Gold"}
              </span>
            </div>
          </>
        )}

        <div className="flex items-center gap-1 text-[10px] pl-1 border-l border-slate-800">
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              connectionStatus === "CONNECTED"
                ? "bg-emerald-400 animate-pulse"
                : "bg-amber-400"
            }`}
          />
          <span className="text-slate-500 lowercase">{connectionStatus}</span>
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
