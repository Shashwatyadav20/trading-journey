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
} from "lucide-react";

export type NavTabId =
  | "dashboard"
  | "journal"
  | "live-charts"
  | "strategies"
  | "analytics"
  | "calendar"
  | "monthly-review"
  | "settings";

export interface NavItem {
  id: NavTabId;
  label: string;
  icon: React.ElementType;
  badge?: string;
}

export const NAV_ITEMS: NavItem[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "journal", label: "Trade Journal", icon: BookOpen },
  { id: "live-charts", label: "Live Charts", icon: Activity, badge: "Live" },
  { id: "strategies", label: "Strategies", icon: Zap },
  { id: "analytics", label: "Analytics", icon: BarChart3 },
  { id: "calendar", label: "Calendar", icon: Calendar },
  { id: "monthly-review", label: "Monthly Review", icon: PieChart },
  { id: "settings", label: "Settings", icon: Settings },
];

interface SidebarProps {
  activeTab: NavTabId;
  onSelectTab: (tab: NavTabId) => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export default function Sidebar({
  activeTab,
  onSelectTab,
  mobileOpen,
  onCloseMobile,
  collapsed,
  onToggleCollapse,
}: SidebarProps) {
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

        {/* Navigation Items */}
        <nav className="flex-1 px-3 py-4 space-y-1.5 overflow-y-auto">
          <div className={`px-3 mb-2 text-[10px] font-semibold tracking-wider text-slate-500 uppercase font-mono ${collapsed ? "hidden lg:block text-center" : ""}`}>
            {collapsed ? "•••" : "Terminal Menu"}
          </div>

          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  onSelectTab(item.id);
                  onCloseMobile();
                }}
                title={collapsed ? item.label : undefined}
                className={`
                  w-full flex items-center gap-3 px-3 py-2.5 rounded-xl font-medium text-sm transition-all duration-200 group relative
                  ${
                    isActive
                      ? "bg-gradient-to-r from-cyan-500/15 to-emerald-500/10 text-cyan-300 border border-cyan-500/30 shadow-md shadow-cyan-950/40 active-nav-glow"
                      : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/40 border border-transparent"
                  }
                  ${collapsed ? "justify-center" : ""}
                `}
              >
                {/* Active Indicator Bar */}
                {isActive && (
                  <span className="absolute left-0 top-2 bottom-2 w-1 bg-gradient-to-b from-cyan-400 to-emerald-400 rounded-r-full shadow-sm shadow-cyan-400" />
                )}

                <Icon
                  className={`w-5 h-5 shrink-0 transition-transform duration-200 ${
                    isActive
                      ? "text-cyan-400 scale-110"
                      : "text-slate-400 group-hover:text-slate-200 group-hover:scale-105"
                  }`}
                />

                {!collapsed && (
                  <span className="truncate flex-1 text-left">
                    {item.label}
                  </span>
                )}

                {!collapsed && item.badge && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono font-medium">
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
                  <span>Live Account</span>
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
