"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Sparkles,
  X,
  Search,
  RefreshCw,
  ShieldAlert,
  TrendingUp,
  TrendingDown,
  Building2,
  Landmark,
  Layers,
  Send,
  ExternalLink,
  AlertTriangle,
  CheckCircle2,
  Activity,
  Bot,
} from "lucide-react";
import type {
  CompanyResearchReport,
  MacroAndRegulatoryItem,
} from "@/lib/ai/companyResearchEngine";

export const AI_RESEARCH_OPEN_EVENT = "open-ai-research";

export function openAIResearchPanel(symbol?: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(AI_RESEARCH_OPEN_EVENT, {
      detail: { symbol: symbol || "RELIANCE" },
    })
  );
}

const QUICK_SYMBOLS = [
  "RELIANCE",
  "BAJFINANCE",
  "HDFCBANK",
  "TCS",
  "ICICIBANK",
  "SOLARINDS",
  "TRENT",
  "BEL",
];

interface ChatMessage {
  id: string;
  role: "assistant" | "user";
  text: string;
  timestamp: string;
}

const QUICK_PROMPTS = [
  "Summarize 4H OB + Fundamental Conviction",
  "Any RBI / CPI or SEBI risks?",
  "Check FII/Institutional Holding & Valuation",
  "4H Order Block & VWAP Entry Alignment",
];

export default function AIResearchCommandCenter() {
  const [isOpen, setIsOpen] = useState(false);
  const [symbol, setSymbol] = useState("RELIANCE");
  const [searchInput, setSearchInput] = useState("RELIANCE");
  const [report, setReport] = useState<CompanyResearchReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [macroFilter, setMacroFilter] = useState<
    "ALL" | "MACRO_RBI_CPI" | "REGULATORY_SEBI" | "EARNINGS_CATALYST"
  >("ALL");

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);

  const fetchResearch = useCallback(async (targetSym: string, force = false) => {
    const clean = targetSym
      .trim()
      .toUpperCase()
      .replace(/^NSE:/i, "")
      .replace(/\.NS$/i, "")
      .replace(/\.BO$/i, "");
    if (!clean) return;

    setSymbol(clean);
    setSearchInput(clean);
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(
        `/api/ai/company-research?symbol=${encodeURIComponent(clean)}${force ? "&force=true" : ""}`,
        { cache: "no-store" }
      );
      const data = await res.json();
      if (!res.ok || !data.success || !data.report) {
        throw new Error(data.error || "Failed to load live company intelligence");
      }
      const nextReport: CompanyResearchReport = data.report;
      setReport(nextReport);

      const fmtVal = (v: number | null, sfx = "") =>
        v !== null ? `${v}${sfx}` : "N/A";
      setChatMessages([
        {
          id: `init-${clean}-${Date.now()}`,
          role: "assistant",
          timestamp: nextReport.fetchedAtIST,
          text:
            `Live Research Brief loaded for ${nextReport.cleanSymbol} (${nextReport.companyName}).\n` +
            `• Institutional Conviction: ${nextReport.conviction.overallScore}% (${nextReport.conviction.grade.replace(/_/g, " ")})\n` +
            `• Live LTP: ${nextReport.technicals.ltp !== null ? `₹${nextReport.technicals.ltp.toLocaleString("en-IN")}` : "N/A"} · VWAP: ${nextReport.technicals.vwapAlignment} · 4H OB: ${nextReport.technicals.orderBlock4H.direction}\n` +
            `• P/E: ${fmtVal(nextReport.fundamentals.trailingPE, "x")} · ROE: ${fmtVal(nextReport.fundamentals.roePct, "%")} · D/E: ${fmtVal(nextReport.fundamentals.debtToEquity, "x")} · FII/Inst: ${fmtVal(nextReport.institutionalHoldings.institutionsPercentHeld, "%")}`,
        },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to fetch live telemetry");
    } finally {
      setLoading(false);
    }
  }, []);

  // Listen for global open-ai-research events from any desk or dashboard card
  useEffect(() => {
    const handler = (ev: Event) => {
      const custom = ev as CustomEvent<{ symbol?: string }>;
      const targetSym = custom.detail?.symbol || symbol || "RELIANCE";
      setIsOpen(true);
      fetchResearch(targetSym, false);
    };
    window.addEventListener(AI_RESEARCH_OPEN_EVENT, handler);
    return () => window.removeEventListener(AI_RESEARCH_OPEN_EVENT, handler);
  }, [fetchResearch, symbol]);

  // Initial load when opened directly via floating button
  const handleToggleOpen = () => {
    const next = !isOpen;
    setIsOpen(next);
    if (next && !report && !loading) {
      fetchResearch(symbol, false);
    }
  };

  const handleSendQuery = async (customPrompt?: string) => {
    const q = (customPrompt ?? chatInput).trim();
    if (!q || chatLoading) return;

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      text: q,
      timestamp: new Date().toLocaleTimeString("en-IN", { hour12: false }) + " IST",
    };
    setChatMessages((prev) => [...prev, userMsg]);
    if (!customPrompt) setChatInput("");
    setChatLoading(true);

    try {
      const res = await fetch("/api/ai/company-research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, question: q, report }),
      });
      const data = await res.json();
      const answerText =
        data?.answer || "Unable to synthesize live telemetry answer.";
      setChatMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          text: answerText,
          timestamp: data?.fetchedAtIST || new Date().toLocaleTimeString("en-IN", { hour12: false }) + " IST",
        },
      ]);
    } catch {
      setChatMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: "assistant",
          text: "Network error querying live research engine.",
          timestamp: new Date().toLocaleTimeString("en-IN", { hour12: false }) + " IST",
        },
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  const filteredNews = useMemo<MacroAndRegulatoryItem[]>(() => {
    if (!report) return [];
    if (macroFilter === "ALL") return report.newsAndMacro;
    return report.newsAndMacro.filter((n) => n.category === macroFilter);
  }, [report, macroFilter]);

  const convictionColor = useMemo(() => {
    const score = report?.conviction.overallScore ?? 50;
    if (score >= 75) return "text-emerald-400 border-emerald-500/40 bg-emerald-500/10";
    if (score >= 60) return "text-cyan-300 border-cyan-500/40 bg-cyan-500/10";
    if (score >= 42) return "text-amber-300 border-amber-500/40 bg-amber-500/10";
    return "text-rose-400 border-rose-500/40 bg-rose-500/10";
  }, [report]);

  const fmtMetric = (val: number | null | undefined, suffix = "", prefix = "") =>
    val !== null && val !== undefined ? `${prefix}${val.toLocaleString("en-IN")}${suffix}` : "N/A";

  return (
    <>
      {/* Floating AI Copilot Launcher Button */}
      <button
        onClick={handleToggleOpen}
        className="fixed bottom-5 right-5 z-40 flex items-center gap-2 px-4 py-2.5 rounded-full bg-gradient-to-r from-cyan-600 via-indigo-600 to-fuchsia-600 hover:from-cyan-500 hover:to-fuchsia-500 text-white text-xs font-mono font-extrabold shadow-[0_0_25px_rgba(6,182,212,0.45)] border border-cyan-400/40 transition-all cursor-pointer"
        title="Open AI Research & Company Intelligence Copilot"
      >
        <Sparkles className="w-4 h-4 animate-pulse" />
        <span>AI Research Copilot</span>
        {report && (
          <span className="px-1.5 py-0.5 rounded-full bg-black/40 text-[10px] text-cyan-200">
            {report.cleanSymbol} · {report.conviction.overallScore}%
          </span>
        )}
      </button>

      {/* Slide-Over Dark Glassmorphism Copilot Drawer */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-2xl h-full bg-[#070b14]/95 border-l border-cyan-500/30 shadow-2xl flex flex-col font-mono text-slate-100 overflow-hidden">
            {/* Drawer Header */}
            <div className="px-5 py-4 border-b border-slate-800/80 bg-gradient-to-r from-[#0b1224] via-[#0e152b] to-[#160d26] flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-cyan-500/15 border border-cyan-500/40 text-cyan-300">
                  <Bot className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm sm:text-base font-black text-white tracking-tight">
                      AI RESEARCH &amp; COMPANY INTELLIGENCE
                    </h2>
                    <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                      ZERO MOCK · LIVE FEED
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-400">
                    Fundamentals · FII/DII Holdings · 4H OB &amp; VWAP · RBI/CPI/SEBI News
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Symbol Search & Quick Select Strip */}
            <div className="px-5 py-3 border-b border-slate-800/70 bg-[#0b1120]/80 space-y-2.5 shrink-0">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  fetchResearch(searchInput, true);
                }}
                className="flex items-center gap-2"
              >
                <div className="relative flex-1">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value.toUpperCase())}
                    placeholder="Enter NSE Symbol (e.g. RELIANCE, BAJFINANCE, TRENT)..."
                    className="w-full pl-9 pr-3 py-2 rounded-xl bg-[#070b14] border border-slate-700 focus:border-cyan-400 outline-none text-xs text-white"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-3.5 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
                  <span>{loading ? "Scanning..." : "Analyze"}</span>
                </button>
              </form>

              <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
                {QUICK_SYMBOLS.map((sym) => (
                  <button
                    key={sym}
                    onClick={() => fetchResearch(sym, false)}
                    className={`shrink-0 px-2.5 py-1 rounded-lg text-[10px] font-bold border transition-all cursor-pointer ${
                      symbol === sym
                        ? "bg-cyan-500/20 border-cyan-400 text-cyan-200"
                        : "bg-slate-900/80 border-slate-800 text-slate-400 hover:border-slate-600 hover:text-slate-200"
                    }`}
                  >
                    {sym}
                  </button>
                ))}
              </div>
            </div>

            {/* Scrollable Intelligence Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {error && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/40 text-rose-300 text-xs flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {loading && !report && (
                <div className="py-12 text-center text-slate-400 text-xs space-y-2">
                  <RefreshCw className="w-6 h-6 text-cyan-400 animate-spin mx-auto" />
                  <div>Fetching live fundamentals, 4H Order Blocks, FII holdings &amp; regulatory news for {symbol}...</div>
                </div>
              )}

              {report && (
                <>
                  {/* 1. Institutional Conviction Score + Company Header */}
                  <div className="rounded-2xl border border-slate-800 bg-[#0d1424]/90 p-4 space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-lg font-black text-white">
                            {report.cleanSymbol}
                          </span>
                          <span className="text-xs text-slate-400">
                            {report.companyName}
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-500 mt-0.5">
                          {report.fundamentals.sector || "NSE Equity"} ·{" "}
                          {report.fundamentals.industry || "Live Telemetry"} · Synced{" "}
                          {report.fetchedAtIST}
                        </div>
                        <div className="flex items-center gap-2 mt-2">
                          <span className="text-base font-extrabold text-white">
                            {report.technicals.ltp !== null
                              ? `₹${report.technicals.ltp.toLocaleString("en-IN")}`
                              : "LTP N/A"}
                          </span>
                          {report.technicals.changePct !== null && (
                            <span
                              className={`text-xs font-bold flex items-center gap-0.5 ${
                                report.technicals.changePct >= 0
                                  ? "text-emerald-400"
                                  : "text-rose-400"
                              }`}
                            >
                              {report.technicals.changePct >= 0 ? (
                                <TrendingUp className="w-3.5 h-3.5" />
                              ) : (
                                <TrendingDown className="w-3.5 h-3.5" />
                              )}
                              {report.technicals.changePct >= 0 ? "+" : ""}
                              {report.technicals.changePct}%
                            </span>
                          )}
                        </div>
                      </div>

                      <div className={`px-3.5 py-2 rounded-xl border text-right ${convictionColor}`}>
                        <div className="text-[9px] uppercase tracking-wider opacity-80">
                          Institutional Conviction
                        </div>
                        <div className="text-2xl font-black leading-tight">
                          {report.conviction.overallScore}%
                        </div>
                        <div className="text-[10px] font-bold">
                          {report.conviction.grade.replace(/_/g, " ")}
                        </div>
                      </div>
                    </div>

                    {/* 4-Pillar Score Bars */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-slate-800/80">
                      {[
                        { label: "Fundamentals", val: report.conviction.fundamentalScore },
                        { label: "FII / Inst.", val: report.conviction.institutionalScore },
                        { label: "4H OB + VWAP", val: report.conviction.technical4HObVwapScore },
                        { label: "News & Macro", val: report.conviction.sentimentMacroScore },
                      ].map((p) => (
                        <div key={p.label} className="p-2 rounded-lg bg-[#070b14]/80 border border-slate-800/80">
                          <div className="text-[9px] text-slate-400">{p.label}</div>
                          <div className="text-xs font-bold text-white mt-0.5">
                            {p.val !== null ? `${p.val}%` : "N/A"}
                          </div>
                          <div className="w-full h-1 bg-slate-800 rounded-full mt-1 overflow-hidden">
                            <div
                              className="h-full bg-cyan-400 rounded-full"
                              style={{ width: `${p.val ?? 0}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* 2. Fundamentals & FII/DII Holding Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="rounded-xl border border-slate-800 bg-[#0d1424]/80 p-3.5 space-y-2">
                      <div className="flex items-center gap-1.5 text-[11px] font-bold text-cyan-300">
                        <Building2 className="w-3.5 h-3.5" />
                        <span>FUNDAMENTAL HEALTH</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <div className="text-[9px] text-slate-500">Trailing P/E</div>
                          <div className="font-bold">{fmtMetric(report.fundamentals.trailingPE, "x")}</div>
                        </div>
                        <div>
                          <div className="text-[9px] text-slate-500">ROE %</div>
                          <div className="font-bold">{fmtMetric(report.fundamentals.roePct, "%")}</div>
                        </div>
                        <div>
                          <div className="text-[9px] text-slate-500">Debt / Equity</div>
                          <div className="font-bold">{fmtMetric(report.fundamentals.debtToEquity, "x")}</div>
                        </div>
                        <div>
                          <div className="text-[9px] text-slate-500">Qtr Rev Growth</div>
                          <div className="font-bold">{fmtMetric(report.fundamentals.quarterlyRevenueGrowthPct, "%")}</div>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-800 bg-[#0d1424]/80 p-3.5 space-y-2">
                      <div className="flex items-center gap-1.5 text-[11px] font-bold text-fuchsia-300">
                        <Landmark className="w-3.5 h-3.5" />
                        <span>FII / INSTITUTIONAL &amp; 4H OB</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <div className="text-[9px] text-slate-500">Institutions Held</div>
                          <div className="font-bold">{fmtMetric(report.institutionalHoldings.institutionsPercentHeld, "%")}</div>
                        </div>
                        <div>
                          <div className="text-[9px] text-slate-500">Promoter Held</div>
                          <div className="font-bold">{fmtMetric(report.institutionalHoldings.insidersPromoterPercentHeld, "%")}</div>
                        </div>
                        <div>
                          <div className="text-[9px] text-slate-500">VWAP Status</div>
                          <div className="font-bold text-[11px]">{report.technicals.vwapAlignment}</div>
                        </div>
                        <div>
                          <div className="text-[9px] text-slate-500">4H Order Block</div>
                          <div className="font-bold text-[11px]">
                            {report.technicals.orderBlock4H.direction}
                            {report.technicals.orderBlock4H.retestActive ? " (RETEST)" : ""}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* 3. Catalysts & Risk Warnings */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="rounded-xl border border-emerald-500/25 bg-emerald-950/10 p-3 space-y-1.5">
                      <div className="flex items-center gap-1.5 text-[10px] font-bold text-emerald-300">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>KEY CATALYSTS ({report.catalysts.length})</span>
                      </div>
                      {report.catalysts.length === 0 ? (
                        <div className="text-[10px] text-slate-500">No active bullish catalysts detected.</div>
                      ) : (
                        report.catalysts.slice(0, 3).map((c, idx) => (
                          <div key={idx} className="text-[10px] text-slate-300 leading-relaxed">
                            • {c}
                          </div>
                        ))
                      )}
                    </div>

                    <div className="rounded-xl border border-rose-500/25 bg-rose-950/10 p-3 space-y-1.5">
                      <div className="flex items-center gap-1.5 text-[10px] font-bold text-rose-300">
                        <ShieldAlert className="w-3.5 h-3.5" />
                        <span>RISK WARNINGS ({report.riskWarnings.length})</span>
                      </div>
                      {report.riskWarnings.length === 0 ? (
                        <div className="text-[10px] text-slate-500">No active regulatory or bearish warnings.</div>
                      ) : (
                        report.riskWarnings.slice(0, 3).map((r, idx) => (
                          <div key={idx} className="text-[10px] text-slate-300 leading-relaxed">
                            • {r}
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* 4. Live Regulatory & Macro News Feed with CPI/RBI Filters */}
                  <div className="rounded-xl border border-slate-800 bg-[#0d1424]/80 p-3.5 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 text-[11px] font-bold text-amber-300">
                        <Activity className="w-3.5 h-3.5" />
                        <span>LIVE NEWS &amp; MACRO FILTERS</span>
                      </div>
                      <div className="flex items-center gap-1">
                        {[
                          { id: "ALL", label: "All" },
                          { id: "MACRO_RBI_CPI", label: "RBI / CPI" },
                          { id: "REGULATORY_SEBI", label: "SEBI" },
                          { id: "EARNINGS_CATALYST", label: "Results" },
                        ].map((tab) => (
                          <button
                            key={tab.id}
                            onClick={() => setMacroFilter(tab.id as typeof macroFilter)}
                            className={`px-2 py-0.5 rounded text-[9px] font-bold border cursor-pointer ${
                              macroFilter === tab.id
                                ? "bg-amber-500/20 border-amber-400 text-amber-200"
                                : "bg-slate-900 border-slate-800 text-slate-400"
                            }`}
                          >
                            {tab.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                      {filteredNews.length === 0 ? (
                        <div className="text-[10px] text-slate-500">
                          No live headlines matching filter &ldquo;{macroFilter}&rdquo;.
                        </div>
                      ) : (
                        filteredNews.map((item, idx) => (
                          <div
                            key={idx}
                            className="p-2 rounded-lg bg-[#070b14]/80 border border-slate-800/70 flex items-start justify-between gap-2"
                          >
                            <div className="space-y-0.5">
                              <div className="text-[11px] text-slate-200 leading-snug">
                                {item.title}
                              </div>
                              <div className="text-[9px] text-slate-500 flex items-center gap-2">
                                <span>{item.publisher}</span>
                                <span>·</span>
                                <span>{item.publishedAt}</span>
                                <span
                                  className={`px-1.5 py-0.2 rounded ${
                                    item.sentiment === "BULLISH"
                                      ? "bg-emerald-500/15 text-emerald-300"
                                      : item.sentiment === "BEARISH"
                                      ? "bg-rose-500/15 text-rose-300"
                                      : "bg-slate-800 text-slate-400"
                                  }`}
                                >
                                  {item.sentiment}
                                </span>
                              </div>
                            </div>
                            {item.link && (
                              <a
                                href={item.link}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-cyan-400 hover:text-cyan-300 shrink-0 mt-0.5"
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                              </a>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* 5. Interactive AI Copilot Chat */}
                  <div className="rounded-xl border border-cyan-500/30 bg-[#0a101f] p-3.5 space-y-2.5">
                    <div className="flex items-center gap-1.5 text-[11px] font-bold text-cyan-300">
                      <Layers className="w-3.5 h-3.5" />
                      <span>INSTITUTIONAL AI COPILOT CHAT</span>
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      {QUICK_PROMPTS.map((qp) => (
                        <button
                          key={qp}
                          onClick={() => handleSendQuery(qp)}
                          className="px-2 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[10px] text-cyan-200 cursor-pointer"
                        >
                          {qp}
                        </button>
                      ))}
                    </div>

                    <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                      {chatMessages.map((m) => (
                        <div
                          key={m.id}
                          className={`p-2.5 rounded-xl text-[11px] whitespace-pre-wrap leading-relaxed ${
                            m.role === "user"
                              ? "bg-cyan-500/15 border border-cyan-500/30 text-cyan-100 ml-8"
                              : "bg-[#070b14] border border-slate-800 text-slate-200 mr-4"
                          }`}
                        >
                          <div className="text-[9px] text-slate-500 mb-1">
                            {m.role === "user" ? "YOU" : "AI RESEARCH ENGINE"} · {m.timestamp}
                          </div>
                          {m.text}
                        </div>
                      ))}
                    </div>

                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        handleSendQuery();
                      }}
                      className="flex items-center gap-2 pt-1"
                    >
                      <input
                        type="text"
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        placeholder={`Ask about ${symbol} fundamentals, 4H OB, FII holdings, or RBI/CPI risks...`}
                        className="flex-1 px-3 py-2 rounded-xl bg-[#070b14] border border-slate-700 focus:border-cyan-400 outline-none text-xs text-white"
                      />
                      <button
                        type="submit"
                        disabled={chatLoading || !chatInput.trim()}
                        className="px-3 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold flex items-center gap-1 cursor-pointer disabled:opacity-50"
                      >
                        <Send className="w-3.5 h-3.5" />
                      </button>
                    </form>
                  </div>

                  {/* Telemetry Footer */}
                  <div className="text-[9px] text-slate-500 flex flex-wrap items-center justify-between gap-2 pt-1">
                    <span>
                      Sources: {report.dataTelemetry.fundamentalsSource} ·{" "}
                      {report.dataTelemetry.technicalsSource}
                    </span>
                    <span>Zero Mock Policy Active</span>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
