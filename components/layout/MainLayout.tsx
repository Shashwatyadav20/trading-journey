"use client";

import React, { useState } from "react";
import Sidebar, { NavTabId } from "./Sidebar";
import Header from "./Header";
import DashboardView from "../views/DashboardView";
import JournalView from "../views/JournalView";
import LiveChartsView from "../views/LiveChartsView";
import StrategiesView from "../views/StrategiesView";
import AnalyticsView from "../views/AnalyticsView";
import CalendarView from "../views/CalendarView";
import MonthlyReviewView from "../views/MonthlyReviewView";
import SettingsView from "../views/SettingsView";
import { TradeProvider, useTrades } from "../../context/TradeContext";
import { AuthProvider, useAuth } from "../../context/AuthContext";
import AuthModal from "../auth/AuthModal";
import MigrationModal from "../auth/MigrationModal";
import PendingApprovalScreen from "../auth/PendingApprovalScreen";
import { Loader2, TrendingUp } from "lucide-react";

function MainContent() {
  const { user, loading, approved, approvalLoading } = useAuth();
  const { refreshCloudData } = useTrades();
  const [activeTab, setActiveTab] = useState<NavTabId>("dashboard");
  const [mobileOpen, setMobileOpen] = useState<boolean>(false);
  const [collapsed, setCollapsed] = useState<boolean>(false);

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

  // STEP 5: approved === true → render full trading application
  const renderActiveView = () => {
    switch (activeTab) {
      case "dashboard":
        return <DashboardView />;
      case "journal":
        return <JournalView />;
      case "live-charts":
        return <LiveChartsView />;
      case "strategies":
        return <StrategiesView />;
      case "analytics":
        return <AnalyticsView />;
      case "calendar":
        return <CalendarView />;
      case "monthly-review":
        return <MonthlyReviewView />;
      case "settings":
        return <SettingsView />;
      default:
        return <DashboardView />;
    }
  };

  return (
    <div className="min-h-screen bg-[#090d16] text-slate-100 flex flex-col font-sans selection:bg-cyan-500/30 selection:text-cyan-200">
      {/* LocalStorage Data Migration Modal */}
      <MigrationModal onMigrationComplete={() => refreshCloudData()} />

      {/* Sidebar Component */}
      <Sidebar
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
          activeTab={activeTab}
          onOpenMobileMenu={() => setMobileOpen(true)}
          collapsed={collapsed}
        />

        {/* Main Content View */}
        <main className="flex-1 p-4 sm:p-6 md:p-8 max-w-7xl w-full mx-auto space-y-6">
          {renderActiveView()}
        </main>

        {/* Status Footer */}
        <footer className="py-3 px-6 border-t border-slate-800/60 bg-[#0d1322]/50 text-center text-xs font-mono text-slate-500 flex flex-col sm:flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 pulse-dot" />
            <span>Trading Journey v1.0 Terminal</span>
            <span className="text-cyan-400/80">• Cloud Synced</span>
          </div>
          <div>
            Active Tab: <span className="text-cyan-400 capitalize">{activeTab.replace("-", " ")}</span>
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
        <MainContent />
      </TradeProvider>
    </AuthProvider>
  );
}
