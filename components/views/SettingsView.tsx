"use client";

import React from "react";
import DataBackupCard from "../settings/DataBackupCard";
import AccountPanelCard from "../account/AccountPanelCard";
import { Settings as SettingsIcon, User, Shield, Bell, Database, Palette, HardDrive } from "lucide-react";

export default function SettingsView() {
  return (
    <div className="space-y-6">
      {/* Banner Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl bg-gradient-to-r from-slate-900/90 via-slate-900/60 to-cyan-950/30 border border-slate-800/80 shadow-xl">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <SettingsIcon className="w-5 h-5 text-cyan-400" />
            <h2 className="text-xl font-bold text-slate-100 tracking-tight">
              Terminal Settings & Data Backup
            </h2>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 font-mono border border-cyan-500/20 font-medium">
              100% Client-Side
            </span>
          </div>
          <p className="text-xs text-slate-400">
            Manage data backups, risk limits, display themes, and trader profile preferences.
          </p>
        </div>
      </div>

      {/* Main Settings Section */}
      <div className="space-y-6">
        {/* $500 Account Panel Component */}
        <AccountPanelCard />

        {/* Frontend Data Backup Component */}
        <DataBackupCard />

        {/* Risk & Account Settings Wireframe Card */}
        <div className="p-6 rounded-2xl bg-slate-900/70 border border-slate-800/80 space-y-5 font-mono text-xs shadow-xl">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-200 uppercase tracking-wider font-sans border-b border-slate-800/80 pb-3">
            <User className="w-4 h-4 text-cyan-400" />
            <span>Trader Profile & Terminal Preferences</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-slate-400 block">Trader Name</label>
              <input
                type="text"
                value="SHASHWAT YADAV"
                disabled
                className="w-full px-3 py-2 rounded-xl bg-slate-950/60 border border-slate-800/60 text-slate-200"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-slate-400 block">Base Capital ($)</label>
              <input
                type="text"
                value="$100,000.00"
                disabled
                className="w-full px-3 py-2 rounded-xl bg-slate-950/60 border border-slate-800/60 text-slate-200"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
