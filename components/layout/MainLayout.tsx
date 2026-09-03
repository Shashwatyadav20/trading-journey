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
import { TradeProvider } from "../../context/TradeContext";

export default function MainLayout() {
  const [activeTab, setActiveTab] = useState<NavTabId>("dashboard");
  const [mobileOpen, setMobileOpen] = useState<boolean>(false);
  const [collapsed, setCollapsed] = useState<boolean>(false);

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
    <TradeProvider>
      <div className="min-h-screen bg-[#090d16] text-slate-100 flex flex-col font-sans selection:bg-cyan-500/30 selection:text-cyan-200">
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
            </div>
            <div>
              Active Tab: <span className="text-cyan-400 capitalize">{activeTab.replace("-", " ")}</span>
            </div>
          </footer>
        </div>
      </div>
    </TradeProvider>
  );
}
