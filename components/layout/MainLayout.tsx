"use client";

import React, { useState, useEffect } from "react";
import Sidebar, { NavTabId, MarketMode } from "./Sidebar";
import Header from "./Header";

// ── Forex / Global views ──────────────────────────────────────────────────────
import DashboardView from "../views/DashboardView";
import JournalView from "../views/JournalView";
import LiveChartsView from "../views/LiveChartsView";
import StrategiesView from "../views/StrategiesView";
import AnalyticsView from "../views/AnalyticsView";
import CalendarView from "../views/CalendarView";
import MonthlyReviewView from "../views/MonthlyReviewView";
import SettingsView from "../views/SettingsView";

// ── Indian Market views ───────────────────────────────────────────────────────
import IMOverviewView from "../indian-market/IMOverviewView";
import { IMPaperTradingView } from "../indian-market/IMPaperTradingView";
import IMOptionChain from "../indian-market/IMOptionChain";
import IMStrategy from "../indian-market/IMStrategy";
import IMPositions from "../indian-market/IMPositions";
import IMBacktestView from "../indian-market/IMBacktestView";

// ── Providers ─────────────────────────────────────────────────────────────────
import { TradeProvider, useTrades } from "../../context/TradeContext";
import { AuthProvider, useAuth } from "../../context/AuthContext";
import { MarketDataProvider } from "../../context/MarketDataContext";
import AuthModal from "../auth/AuthModal";
import MigrationModal from "../auth/MigrationModal";
import PendingApprovalScreen from "../auth/PendingApprovalScreen";
import { Loader2, TrendingUp } from "lucide-react";

// ─── LocalStorage persistence keys ───────────────────────────────────────────
const MARKET_MODE_KEY = "tj-market-mode";
const ACTIVE_TAB_KEY  = "tj-active-tab";

// ─── Helper: safely load persisted value from localStorage ───────────────────
function loadPersisted<T extends string>(key: string, fallback: T, allowed: T[]): T {
  if (typeof window === "undefined") return fallback;
  const saved = localStorage.getItem(key) as T | null;
  return saved && allowed.includes(saved) ? saved : fallback;
}

// ─── All valid tab IDs per mode (used to validate persisted value) ────────────
const FOREX_TABS: NavTabId[]  = ["dashboard","journal","live-charts","strategies","analytics","calendar","monthly-review","settings"];
const INDIAN_TABS: NavTabId[] = ["im-overview","im-paper-trading","im-option-chain","im-strategy","im-positions","im-backtest","settings"];

function MainContent() {
  const { user, loading, approved, approvalLoading } = useAuth();
  const { refreshCloudData } = useTrades();

  // ── Persistent market mode ─────────────────────────────────────────────────
  const [marketMode, setMarketMode] = useState<MarketMode>(() =>
    loadPersisted<MarketMode>(MARKET_MODE_KEY, "forex", ["indian", "forex"])
  );

  // ── Persistent active tab ──────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<NavTabId>(() => {
    const mode = loadPersisted<MarketMode>(MARKET_MODE_KEY, "forex", ["indian", "forex"]);
    const allowed = mode === "indian" ? INDIAN_TABS : FOREX_TABS;
    return loadPersisted<NavTabId>(ACTIVE_TAB_KEY, mode === "indian" ? "im-overview" : "dashboard", allowed);
  });

  const [mobileOpen, setMobileOpen] = useState<boolean>(false);
  const [collapsed, setCollapsed] = useState<boolean>(false);

  // Persist selections whenever they change
  useEffect(() => {
    localStorage.setItem(MARKET_MODE_KEY, marketMode);
  }, [marketMode]);

  useEffect(() => {
    localStorage.setItem(ACTIVE_TAB_KEY, activeTab);
  }, [activeTab]);

  // ── Auth guards ────────────────────────────────────────────────────────────

  // STEP 1: Auth session is still resolving → show spinner
  if (loading) {
    return (
      <div className="min-h-screen bg-[#090d16] flex flex-col items-center justify-center space-y-4">
        <div className="w-12 h-12 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 animate-pulse">
          <TrendingUp className="w-6 h-6" />
        </div>
        <div className="flex items-center gap-2 text-slate-400 font-mono text-xs">
          <Loader2 className="w-4 h-4 text-cyan-400 animate-spin" />
          <span>Authenticating Supabase Session...</span>
        </div>
      </div>
    );
  }

  // STEP 2: Not logged in → show auth modal
  if (!user) {
    return <AuthModal />;
  }

  // STEP 3: Logged in, but approval status is still loading → show spinner
  // CRITICAL: Do NOT render trading dashboard until approval is confirmed.
  if (approvalLoading || approved === null) {
    return (
      <div className="min-h-screen bg-[#090d16] flex flex-col items-center justify-center space-y-4">
        <div className="w-12 h-12 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 animate-pulse">
          <TrendingUp className="w-6 h-6" />
        </div>
        <div className="flex items-center gap-2 text-slate-400 font-mono text-xs">
          <Loader2 className="w-4 h-4 text-cyan-400 animate-spin" />
          <span>Checking account authorization...</span>
        </div>
      </div>
    );
  }

  // STEP 4: Approval check complete — user is NOT approved
  if (approved === false) {
    return <PendingApprovalScreen />;
  }

  // ── STEP 5: approved === true → render full trading application ────────────
  //
  // IMPORTANT: Views are always mounted and never unmounted on tab switch.
  // We use CSS visibility (display:none / display:contents) to show/hide views
  // instead of conditional rendering. This prevents:
  //   • WebSocket reconnections on every tab change
  //   • data re-fetching useEffects re-firing
  //   • animation flicker caused by unmount+remount cycles

  const show = (tab: NavTabId) => ({ style: { display: activeTab === tab ? undefined : "none" } as React.CSSProperties });

  return (
    <div className="min-h-screen bg-[#090d16] text-slate-100 flex flex-col font-sans selection:bg-cyan-500/30 selection:text-cyan-200">
      {/* LocalStorage Data Migration Modal */}
      <MigrationModal onMigrationComplete={() => refreshCloudData()} />

      {/* Sidebar Component */}
      <Sidebar
        marketMode={marketMode}
        onSelectMarketMode={(mode) => setMarketMode(mode)}
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed(!collapsed)}
      />

      {/* Main Content Area Wrapper */}
      <div
        className={`
          flex-1 flex flex-col transition-all duration-300 ease-in-out
          ${collapsed ? "lg:pl-20" : "lg:pl-64"}
        `}
      >
        {/* Header Top Bar Component */}
        <Header
          marketMode={marketMode}
          activeTab={activeTab}
          onOpenMobileMenu={() => setMobileOpen(true)}
          collapsed={collapsed}
        />

        {/* ── Main Content Views (persistently mounted) ── */}
        <main className="flex-1 p-4 sm:p-6 md:p-8 max-w-7xl w-full mx-auto space-y-6">

          {/* ── Forex / Global views ──────────────────── */}
          <div {...show("dashboard")}><DashboardView /></div>
          <div {...show("journal")}><JournalView /></div>
          <div {...show("live-charts")}><LiveChartsView /></div>
          <div {...show("strategies")}><StrategiesView /></div>
          <div {...show("analytics")}><AnalyticsView /></div>
          <div {...show("calendar")}><CalendarView /></div>
          <div {...show("monthly-review")}><MonthlyReviewView /></div>

          {/* ── Indian Market views ───────────────────── */}
          <div {...show("im-overview")}><IMOverviewView /></div>
          <div {...show("im-paper-trading")}><IMPaperTradingView /></div>
          <div {...show("im-option-chain")}><IMOptionChain /></div>
          <div {...show("im-strategy")}><IMStrategy /></div>
          <div {...show("im-positions")}><IMPositions /></div>
          <div {...show("im-backtest")}><IMBacktestView /></div>

          {/* Settings is shared across both modes */}
          <div {...show("settings")}><SettingsView /></div>

        </main>

        {/* Status Footer */}
        <footer className="py-3 px-6 border-t border-slate-800/60 bg-[#0d1322]/50 text-center text-xs font-mono text-slate-500 flex flex-col sm:flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 pulse-dot" />
            <span>Trading Journey v1.0 Terminal</span>
            <span className="text-cyan-400/80">• Cloud Synced</span>
          </div>
          <div>
            Mode:{" "}
            <span className={`capitalize font-semibold ${marketMode === "indian" ? "text-orange-400" : "text-cyan-400"}`}>
              {marketMode === "indian" ? "🇮🇳 Indian Market" : "🌐 Forex / Global"}
            </span>
            {" "}·{" "}
            Tab: <span className="text-cyan-400 capitalize">{activeTab.replace("im-", "").replace(/-/g, " ")}</span>
          </div>
        </footer>
      </div>
    </div>
  );
}

export default function MainLayout() {
  return (
    <AuthProvider>
      <TradeProvider>
        <MarketDataProvider>
          <MainContent />
        </MarketDataProvider>
      </TradeProvider>
    </AuthProvider>
  );
}
