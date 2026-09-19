"use client";

import React from "react";
import {
  LayoutDashboard,
  BookOpen,
  Zap,
  BarChart3,
  Calendar,
  PieChart,
  Settings,
  TrendingUp,
  X,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  Activity,
  Globe2,
  Flag,
  LineChart,
  ListOrdered,
  FlaskConical,
  ShieldAlert,
  Layers3,
} from "lucide-react";

// ─── Market Mode ─────────────────────────────────────────────────────────────
export type MarketMode = "indian" | "forex";

// ─── All possible nav tab IDs ─────────────────────────────────────────────────
export type NavTabId =
  // Forex / Global tabs
  | "dashboard"
  | "journal"
  | "live-charts"
  | "strategies"
  | "analytics"
  | "calendar"
  | "monthly-review"
  | "settings"
  // Indian Market tabs
  | "im-overview"
  | "im-paper-trading"
  | "im-option-chain"
  | "im-strategy"
  | "im-positions"
  | "im-backtest";

export interface NavItem {
  id: NavTabId;
  label: string;
  icon: React.ElementType;
  badge?: string;
}

// Forex / Global nav items
export const FOREX_NAV_ITEMS: NavItem[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "journal", label: "Trade Journal", icon: BookOpen },
  { id: "live-charts", label: "Live Charts", icon: Activity, badge: "Live" },
  { id: "strategies", label: "Strategies", icon: Zap },
  { id: "analytics", label: "Analytics", icon: BarChart3 },
  { id: "calendar", label: "Calendar", icon: Calendar },
  { id: "monthly-review", label: "Monthly Review", icon: PieChart },
  { id: "settings", label: "Settings", icon: Settings },
];

// Indian Market nav items
export const INDIAN_NAV_ITEMS: NavItem[] = [
  { id: "im-overview", label: "Overview", icon: LayoutDashboard },
  { id: "im-paper-trading", label: "Paper Trading", icon: ShieldAlert, badge: "Paper" },
  { id: "im-option-chain", label: "Option Chain", icon: Layers3, badge: "Live" },
  { id: "im-strategy", label: "Strategy & Signals", icon: LineChart },
  { id: "im-positions", label: "Positions", icon: ListOrdered },
  { id: "im-backtest", label: "Backtest", icon: FlaskConical },
  { id: "settings", label: "Settings", icon: Settings },
];

// Legacy export so Header.tsx can still call NAV_ITEMS.find()
export const NAV_ITEMS: NavItem[] = [...FOREX_NAV_ITEMS, ...INDIAN_NAV_ITEMS];

interface SidebarProps {
  marketMode: MarketMode;
  onSelectMarketMode: (mode: MarketMode) => void;
  activeTab: NavTabId;
  onSelectTab: (tab: NavTabId) => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export default function Sidebar({
  marketMode,
  onSelectMarketMode,
  activeTab,
  onSelectTab,
  mobileOpen,
  onCloseMobile,
  collapsed,
  onToggleCollapse,
}: SidebarProps) {
  const navItems = marketMode === "indian" ? INDIAN_NAV_ITEMS : FOREX_NAV_ITEMS;

  return (
    <>
      {/* Mobile Overlay Backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm lg:hidden transition-opacity duration-300"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      )}

      {/* Sidebar Container */}
      <aside
        className={`
          fixed top-0 bottom-0 left-0 z-50 flex flex-col bg-[#0d1322]/95 border-r border-slate-800/80 backdrop-blur-xl transition-all duration-300 ease-in-out
          ${mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}
          ${collapsed ? "lg:w-20" : "lg:w-64"}
          w-72
        `}
      >
        {/* Brand Header */}
        <div className="flex items-center justify-between h-16 px-4 border-b border-slate-800/80 shrink-0">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-emerald-500 text-slate-950 shadow-lg shadow-cyan-500/20 shrink-0">
              <TrendingUp className="w-5 h-5 font-bold" />
            </div>
            {!collapsed && (
              <div className="flex flex-col whitespace-nowrap overflow-hidden">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-base tracking-tight text-slate-100">
                    Trading<span className="text-cyan-400">Journey</span>
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-400 font-mono border border-cyan-500/20">
                    PRO
                  </span>
                </div>
                <span className="text-xs text-slate-400 font-mono">
                  v1.0 Terminal
                </span>
              </div>
            )}
          </div>

          {/* Mobile Close Button */}
          <button
            onClick={onCloseMobile}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800/60 lg:hidden"
            aria-label="Close sidebar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ── Market Mode Switcher ── */}
        {!collapsed ? (
          <div className="px-3 pt-3 pb-1 shrink-0">
            <p className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase font-mono mb-1.5 px-1">
              Market
            </p>
            <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-slate-900/70 border border-slate-800/60">
              {/* Indian Market button */}
              <button
                id="market-mode-indian"
                onClick={() => {
                  onSelectMarketMode("indian");
                  onSelectTab("im-overview");
                }}
                className={`
                  flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-xs font-semibold font-mono transition-all duration-200
                  ${marketMode === "indian"
                    ? "bg-gradient-to-r from-orange-500/20 to-amber-500/10 text-orange-300 border border-orange-500/30 shadow-sm"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/40"
                  }
                `}
                title="Indian Market (NIFTY)"
              >
                <Flag className="w-3.5 h-3.5 shrink-0" />
                <span>India</span>
              </button>

              {/* Forex / Global button */}
              <button
                id="market-mode-forex"
                onClick={() => {
                  onSelectMarketMode("forex");
                  onSelectTab("dashboard");
                }}
                className={`
                  flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-xs font-semibold font-mono transition-all duration-200
                  ${marketMode === "forex"
                    ? "bg-gradient-to-r from-cyan-500/20 to-emerald-500/10 text-cyan-300 border border-cyan-500/30 shadow-sm"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/40"
                  }
                `}
                title="Forex / Global Markets"
              >
                <Globe2 className="w-3.5 h-3.5 shrink-0" />
                <span>Global</span>
              </button>
            </div>
          </div>
        ) : (
          /* Collapsed: show icon-only switcher */
          <div className="px-2 pt-3 pb-1 flex flex-col gap-1 shrink-0">
            <button
              id="market-mode-indian-collapsed"
              onClick={() => {
                onSelectMarketMode("indian");
                onSelectTab("im-overview");
              }}
              title="Indian Market"
              className={`
                flex items-center justify-center w-full py-1.5 rounded-lg transition-colors duration-200
                ${marketMode === "indian"
                  ? "bg-orange-500/20 text-orange-300 border border-orange-500/30"
                  : "text-slate-500 hover:text-slate-300 hover:bg-slate-800/40"
                }
              `}
            >
              <Flag className="w-4 h-4" />
            </button>
            <button
              id="market-mode-forex-collapsed"
              onClick={() => {
                onSelectMarketMode("forex");
                onSelectTab("dashboard");
              }}
              title="Forex / Global"
              className={`
                flex items-center justify-center w-full py-1.5 rounded-lg transition-colors duration-200
                ${marketMode === "forex"
                  ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
                  : "text-slate-500 hover:text-slate-300 hover:bg-slate-800/40"
                }
              `}
            >
              <Globe2 className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Navigation Items */}
        <nav className="flex-1 px-3 py-2 space-y-1.5 overflow-y-auto">
          <div className={`px-3 mb-2 text-[10px] font-semibold tracking-wider text-slate-500 uppercase font-mono ${collapsed ? "hidden lg:block text-center" : ""}`}>
            {collapsed ? "•••" : marketMode === "indian" ? "Indian Market" : "Forex / Global"}
          </div>

          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                id={`nav-${item.id}`}
                onClick={() => {
                  onSelectTab(item.id);
                  onCloseMobile();
                }}
                title={collapsed ? item.label : undefined}
                className={`
                  w-full flex items-center gap-3 px-3 py-2.5 rounded-xl font-medium text-sm transition-all duration-200 group relative
                  ${
                    isActive
                      ? marketMode === "indian"
                        ? "bg-gradient-to-r from-orange-500/15 to-amber-500/10 text-orange-300 border border-orange-500/30 shadow-md shadow-orange-950/40"
                        : "bg-gradient-to-r from-cyan-500/15 to-emerald-500/10 text-cyan-300 border border-cyan-500/30 shadow-md shadow-cyan-950/40"
                      : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/40 border border-transparent"
                  }
                  ${collapsed ? "justify-center" : ""}
                `}
              >
                {/* Active Indicator Bar */}
                {isActive && (
                  <span
                    className={`absolute left-0 top-2 bottom-2 w-1 rounded-r-full shadow-sm ${
                      marketMode === "indian"
                        ? "bg-gradient-to-b from-orange-400 to-amber-400 shadow-orange-400"
                        : "bg-gradient-to-b from-cyan-400 to-emerald-400 shadow-cyan-400"
                    }`}
                  />
                )}

                <Icon
                  className={`w-5 h-5 shrink-0 transition-transform duration-200 ${
                    isActive
                      ? marketMode === "indian"
                        ? "text-orange-400 scale-110"
                        : "text-cyan-400 scale-110"
                      : "text-slate-400 group-hover:text-slate-200 group-hover:scale-105"
                  }`}
                />

                {!collapsed && (
                  <span className="truncate flex-1 text-left">
                    {item.label}
                  </span>
                )}

                {!collapsed && item.badge && (
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-medium border ${
                      item.badge === "Paper"
                        ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                        : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Footer / User Profile & Desktop Collapse Toggle */}
        <div className="p-3 border-t border-slate-800/80 shrink-0 space-y-3">
          {/* User Status Card */}
          <div className="flex items-center gap-3 p-2 rounded-xl bg-slate-900/60 border border-slate-800/60">
            <div className="relative shrink-0">
              <div className="w-9 h-9 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center font-bold text-xs text-cyan-400 font-mono">
                TJ
              </div>
              <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-slate-900 pulse-dot" />
            </div>

            {!collapsed && (
              <div className="flex flex-col min-w-0 flex-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-200 truncate">
                    Alex Mercer
                  </span>
                  <ShieldCheck className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                </div>
                <div className="flex items-center gap-1.5 text-[11px] text-slate-400 font-mono">
                  <Activity className="w-3 h-3 text-emerald-400" />
                  <span>Paper Mode</span>
                </div>
              </div>
            )}
          </div>

          {/* Desktop Sidebar Collapse Toggle */}
          <button
            onClick={onToggleCollapse}
            className="hidden lg:flex w-full items-center justify-center gap-2 py-1.5 rounded-lg text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 transition-colors border border-slate-800/40 font-mono"
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? (
              <ChevronRight className="w-4 h-4" />
            ) : (
              <>
                <ChevronLeft className="w-4 h-4" />
                <span>Collapse Sidebar</span>
              </>
            )}
          </button>
        </div>
      </aside>
    </>
  );
}
