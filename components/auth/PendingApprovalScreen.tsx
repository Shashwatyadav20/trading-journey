"use client";

import React from "react";
import { Shield, Clock, LogOut, TrendingUp, CheckCircle2, Mail } from "lucide-react";
import { useAuth } from "@/context/AuthContext";

export default function PendingApprovalScreen() {
  const { user, signOut } = useAuth();

  const handleSignOut = async () => {
    await signOut();
  };

  return (
    <div className="min-h-screen bg-[#090d16] flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background grid */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            "linear-gradient(#00e5ff 1px, transparent 1px), linear-gradient(90deg, #00e5ff 1px, transparent 1px)",
          backgroundSize: "60px 60px",
        }}
      />

      {/* Glow effects */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-cyan-500/5 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 left-1/4 w-[400px] h-[200px] bg-amber-500/5 rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10 w-full max-w-md">
        {/* Card */}
        <div className="bg-[#0d1322]/90 border border-amber-500/20 rounded-2xl shadow-2xl shadow-amber-950/20 p-8 space-y-6 backdrop-blur-sm">

          {/* Logo + App Name */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500/20 to-blue-600/20 border border-cyan-500/30 flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-cyan-400" />
            </div>
            <div>
              <span className="text-base font-bold text-slate-100 tracking-tight">Trading Journey</span>
              <span className="block text-[10px] font-mono text-slate-500">Professional Terminal v1.0</span>
            </div>
          </div>

          {/* Divider */}
          <div className="h-px bg-gradient-to-r from-transparent via-amber-500/30 to-transparent" />

          {/* Icon + Heading */}
          <div className="flex flex-col items-center text-center space-y-4 py-2">
            {/* Animated pending icon */}
            <div className="relative">
              <div className="w-20 h-20 rounded-full bg-amber-500/10 border-2 border-amber-500/30 flex items-center justify-center">
                <Shield className="w-9 h-9 text-amber-400" />
              </div>
              <div className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-amber-500/20 border border-amber-500/40 flex items-center justify-center">
                <Clock className="w-3 h-3 text-amber-400 animate-pulse" />
              </div>
            </div>

            <div className="space-y-2">
              <h1 className="text-xl font-bold text-slate-100 tracking-tight">
                Account Pending Approval
              </h1>
              <p className="text-sm text-slate-400 leading-relaxed max-w-sm">
                Your account has been created successfully, but access to Trading Journey
                is waiting for administrator approval.
              </p>
            </div>
          </div>

          {/* Status info box */}
          <div className="bg-[#090d16] border border-slate-800/80 rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-2 text-xs font-mono text-slate-400">
              <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              <span className="text-amber-400 font-semibold">Status: Awaiting Admin Approval</span>
            </div>

            <div className="h-px bg-slate-800/80" />

            <div className="flex items-center gap-2 text-xs font-mono">
              <Mail className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
              <span className="text-slate-500">Account:</span>
              <span className="text-cyan-400 truncate">{user?.email ?? "—"}</span>
            </div>

            <div className="space-y-2 pt-1">
              <div className="flex items-start gap-2 text-xs text-slate-500">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500/70 mt-0.5 flex-shrink-0" />
                <span>Account created in Supabase Auth</span>
              </div>
              <div className="flex items-start gap-2 text-xs text-slate-500">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500/70 mt-0.5 flex-shrink-0" />
                <span>Your credentials are saved securely</span>
              </div>
              <div className="flex items-start gap-2 text-xs text-slate-400">
                <Clock className="w-3.5 h-3.5 text-amber-400/70 mt-0.5 flex-shrink-0" />
                <span>Waiting for administrator to grant access</span>
              </div>
            </div>
          </div>

          {/* Info message */}
          <p className="text-xs text-slate-500 text-center leading-relaxed">
            Once approved, you will automatically gain access to the full Trading Journey application.
            You may log back in later to check your status.
          </p>

          {/* Sign out button */}
          <button
            onClick={handleSignOut}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl border border-slate-700/60 text-slate-400 hover:text-rose-400 hover:border-rose-500/30 hover:bg-rose-500/5 transition-all duration-200 text-sm font-medium"
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        </div>

        {/* Footer note */}
        <p className="text-center text-[10px] font-mono text-slate-600 mt-4">
          Trading Journey · Secure Cloud Terminal · Admin-Gated Access
        </p>
      </div>
    </div>
  );
}
