"use client";

import React, { useState, useEffect } from "react";
import IMHeader from "./IMHeader";
import IMStatusBadge from "./IMStatusBadge";
import {
  Play,
  Loader2,
  AlertCircle,
  BarChart3,
  Upload,
  FileText,
  ShieldCheck,
  Target,
  Layers,
  Activity,
  CheckCircle2,
  XCircle,
  ListFilter,
  Calendar,
  Zap,
  Award,
} from "lucide-react";

type DatasetSourceType = "REAL_HISTORICAL" | "SYNTHETIC" | "UNKNOWN";
type TabType =
  | "DATA_QUALITY"
  | "OVERVIEW"
  | "TRADE_LOG"
  | "DAILY_PNL"
  | "STRATEGY_RESULTS"
  | "NO_TRADE_ANALYSIS"
  | "RISK_STATS"
  | "OUT_OF_SAMPLE"
  | "WALK_FORWARD";

export default function IMBacktestView() {
  const [backtestResult, setBacktestResult] = useState<any>(null);
  const [dataQualityReport, setDataQualityReport] = useState<any>(null);
  const [dataSourceStatus, setDataSourceStatus] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [csvContent, setCsvContent] = useState("");
  const [declaredSource, setDeclaredSource] = useState<DatasetSourceType>("UNKNOWN");
  const [validatedMetadata, setValidatedMetadata] = useState<any>(null);
  const [previewRows, setPreviewRows] = useState<any[]>([]);
  const [importError, setImportError] = useState<string | null>(null);
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>("OVERVIEW");

  useEffect(() => {
    fetchDataSourceStatus();
  }, []);

  const fetchDataSourceStatus = async () => {
    try {
      const res = await fetch("http://localhost:4000/api/indian/backtest/data-source-status");
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setDataSourceStatus(data);
        }
      }
    } catch {
      // fallback
    }
  };

  const handleDownloadTemplate = () => {
    if (dataSourceStatus?.csvTemplate) {
      setCsvContent(dataSourceStatus.csvTemplate);
      setImportNotice("Canonical CSV Template loaded into editor.");
    }
  };

  const handleRunBacktest = async () => {
    try {
      setLoading(true);
      setImportError(null);
      const res = await fetch("http://localhost:4000/api/indian/backtest/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.backtest) {
          setBacktestResult(data.backtest);
          setDataQualityReport(null);
        }
      }
    } catch {
      // error handling
    } finally {
      setLoading(false);
    }
  };

  const handleValidateCsv = async () => {
    if (!csvContent.trim()) {
      setImportError("Please paste or upload valid CSV content.");
      return;
    }

    try {
      setLoading(true);
      setImportError(null);
      setImportNotice(null);

      const res = await fetch("http://localhost:4000/api/indian/backtest/validate-csv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csvContent, declaredSource }),
      });

      const data = await res.json();
      if (data.metadata) {
        setValidatedMetadata(data.metadata);
        setDataQualityReport(data.metadata);
        setPreviewRows(data.metadata.previewRows || []);
      }

      if (data.success) {
        setImportNotice(`Dataset validated successfully. Quality State: ${data.qualityState}`);
      } else {
        setImportError(data.errors ? data.errors.join(", ") : "Validation failed.");
      }
    } catch (err: any) {
      setImportError(`CSV Validation error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleImportCsv = async () => {
    if (!csvContent.trim()) {
      setImportError("Please paste or upload valid CSV content.");
      return;
    }

    if (declaredSource === "UNKNOWN") {
      setImportError("REAL HISTORICAL BACKTEST BLOCKED: Please select Declared Source (REAL HISTORICAL DATA or SYNTHETIC).");
      return;
    }

    try {
      setLoading(true);
      setImportError(null);
      setImportNotice(null);

      const res = await fetch("http://localhost:4000/api/indian/backtest/import-csv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csvContent, declaredSource }),
      });

      const data = await res.json();
      if (data.datasetQuality) {
        setValidatedMetadata(data.datasetQuality);
        setDataQualityReport(data.datasetQuality);
        if (data.datasetQuality.previewRows) {
          setPreviewRows(data.datasetQuality.previewRows);
        }
      }

      if (data.status === "INSUFFICIENT_DATA" || data.status === "INVALID") {
        setImportError(`BACKTEST BLOCKED: ${data.error || "Dataset quality issues."}`);
        setBacktestResult(null);
        setActiveTab("DATA_QUALITY");
        return;
      }

      if (res.ok && data.success && data.backtest) {
        setBacktestResult(data.backtest);
        setImportNotice(
          `CSV Imported successfully! Dataset ID: ${data.datasetId} (Hash: ${data.datasetHash}). Source: ${declaredSource}.`
        );
      } else {
        setImportError(
          data.error ||
            `Import failed: ${data.details ? data.details.join(", ") : "Invalid CSV format"}`
        );
      }
    } catch (err: any) {
      setImportError(`CSV Import error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const training = backtestResult?.trainingMetrics;
  const outOfSample = backtestResult?.outOfSampleMetrics;
  const overall = backtestResult?.overallMetrics;
  const stratComp = backtestResult?.strategyComparison;
  const targetAnalysis = overall?.dailyTargetAnalysis;
  const riskVal = backtestResult?.riskValidation;
  const robustness = backtestResult?.robustnessAnalysis;
  const verdict = backtestResult?.finalVerdict;
  const walkForward = backtestResult?.walkForwardResults;
  const trades = backtestResult?.trades || [];
  const noTradeReasons = overall?.noTradeReasons || [];
  const isSynthetic = backtestResult ? backtestResult.dataSource !== "REAL_HISTORICAL_DATA" : true;

  const dataStatusText = isSynthetic ? "SYNTHETIC / PAPER ESTIMATION" : "REAL HISTORICAL DATA";
  const backtestStatusText = loading ? "RUNNING" : backtestResult ? "COMPLETE" : "REAL DATA REQUIRED";
  const verdictStatus = verdict?.verdict || "REAL_DATA_REQUIRED";

  return (
    <div className="space-y-6 font-mono">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-slate-100 tracking-tight">
              GENUINE HISTORICAL NIFTY BACKTESTING
            </h2>
            <IMStatusBadge status="WALK-FORWARD" size="sm" />
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            70/30 In-Sample & Out-Of-Sample Validation • Zero Look-Ahead Bias Enforced
          </p>
        </div>

        <button
          onClick={handleRunBacktest}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/30 transition-all disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />
          ) : (
            <Play className="w-4 h-4 text-cyan-400" />
          )}
          <span>RUN SAMPLE SIMULATION</span>
        </button>
      </div>

      <IMHeader />

      {/* Historical Data Source Panel */}
      <div className="p-4 rounded-2xl bg-[#11192e]/90 border border-slate-800 space-y-3 font-mono">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-cyan-400" />
            <h3 className="text-xs font-bold text-slate-100 uppercase tracking-wider">
              HISTORICAL DATA SOURCE & QUALITY STATUS
            </h3>
          </div>
          <button
            onClick={handleDownloadTemplate}
            className="px-2.5 py-1 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-[11px] font-bold text-cyan-300 hover:bg-cyan-500/20 transition-all"
          >
            LOAD CSV TEMPLATE
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800">
            <span className="text-[9px] text-slate-500 block uppercase">Provider</span>
            <span className={`font-bold ${dataSourceStatus?.historicalProviderAvailable ? "text-emerald-400" : "text-amber-400"}`}>
              {dataSourceStatus?.historicalProviderName || "NOT CONFIGURED"}
            </span>
          </div>

          <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800">
            <span className="text-[9px] text-slate-500 block uppercase">Real Data</span>
            <span className={`font-bold ${dataSourceStatus?.realDataAvailable ? "text-emerald-400" : "text-rose-400"}`}>
              {dataSourceStatus?.realDataAvailable ? "AVAILABLE" : "NOT AVAILABLE"}
            </span>
          </div>

          <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800">
            <span className="text-[9px] text-slate-500 block uppercase">CSV Import</span>
            <span className="font-bold text-emerald-400">READY</span>
          </div>

          <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800">
            <span className="text-[9px] text-slate-500 block uppercase">Backtest</span>
            <span className={`font-bold ${dataSourceStatus?.backtestReady ? "text-emerald-400" : "text-amber-400"}`}>
              {dataSourceStatus?.backtestReady ? "READY" : "WAITING FOR DATA"}
            </span>
          </div>
        </div>

        {!dataSourceStatus?.realDataAvailable && (
          <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-[11px] font-bold text-rose-300 text-center uppercase tracking-wider">
            REAL HISTORICAL DATA REQUIRED — STATUS: WAITING FOR REAL DATA
          </div>
        )}
      </div>

      {/* Top-Level Status Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-4 rounded-2xl bg-[#11192e]/90 border border-slate-800 text-xs">
        <div className="flex flex-col gap-1 p-3 rounded-xl bg-slate-900/60 border border-slate-800">
          <span className="text-[9px] text-slate-500 uppercase">DATA STATUS</span>
          <span className={`font-bold ${isSynthetic ? "text-amber-400" : "text-emerald-400"}`}>
            {dataStatusText}
          </span>
        </div>

        <div className="flex flex-col gap-1 p-3 rounded-xl bg-slate-900/60 border border-slate-800">
          <span className="text-[9px] text-slate-500 uppercase">BACKTEST STATUS</span>
          <span className="font-bold text-cyan-400">{backtestStatusText}</span>
        </div>

        <div className="flex flex-col gap-1 p-3 rounded-xl bg-slate-900/60 border border-slate-800">
          <span className="text-[9px] text-slate-500 uppercase">VALIDATION VERDICT</span>
          <span className={
            verdictStatus === "PASS" ? "font-bold text-emerald-400" :
            verdictStatus === "CAUTION" ? "font-bold text-amber-400" :
            verdictStatus === "FAIL" ? "font-bold text-rose-400" : "font-bold text-cyan-400"
          }>
            {verdictStatus.replace(/_/g, " ")}
          </span>
        </div>
      </div>

      {/* Historical Data Import Center Panel */}
      <div className="p-5 rounded-2xl bg-[#11192e]/90 border border-slate-800 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Upload className="w-4 h-4 text-cyan-400" />
            <h3 className="text-sm font-bold text-slate-100 uppercase tracking-wider">
              HISTORICAL NIFTY OPTION DATA IMPORT CENTER
            </h3>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">Declared Source:</span>
            <select
              value={declaredSource}
              onChange={(e) => setDeclaredSource(e.target.value as DatasetSourceType)}
              className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs font-bold text-slate-200 focus:outline-none focus:border-cyan-500"
            >
              <option value="UNKNOWN">UNKNOWN (Locked)</option>
              <option value="REAL_HISTORICAL">REAL HISTORICAL DATA</option>
              <option value="SYNTHETIC">SYNTHETIC / PAPER DATA</option>
            </select>
          </div>
        </div>

        <p className="text-xs text-slate-400">
          Required headers: <code className="text-cyan-300 font-bold">timestamp, expiry, strike, optionType, ltp</code> (Flexible aliases supported: <code className="text-slate-400">datetime, strike_price, type, close, bid, ask, oi, iv</code>).
        </p>

        <textarea
          rows={3}
          value={csvContent}
          onChange={(e) => setCsvContent(e.target.value)}
          placeholder={`timestamp,expiry,strike,optionType,ltp,bid,ask,volume,oi,iv\n2026-09-13T10:00:00Z,2026-09-24,24500,PE,35.5,35.0,36.0,12000,65000,14.5\n2026-09-13T10:00:00Z,2026-09-24,24700,PE,85.0,84.5,85.5,25000,110000,15.2`}
          className="w-full p-3 rounded-xl bg-slate-900/80 border border-slate-700/80 text-xs text-slate-200 focus:outline-none focus:border-cyan-500/50"
        />

        {importError && (
          <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
            <XCircle className="w-4 h-4 shrink-0 text-rose-400" />
            <span>{importError}</span>
          </div>
        )}

        {importNotice && (
          <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
            <span>{importNotice}</span>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={handleDownloadTemplate}
            className="flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-xs bg-slate-900 border border-slate-700 text-slate-200 hover:bg-slate-800 transition-all"
          >
            <FileText className="w-4 h-4 text-cyan-400" />
            <span>DOWNLOAD CSV TEMPLATE</span>
          </button>

          <button
            onClick={handleValidateCsv}
            disabled={loading || !csvContent.trim()}
            className="flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-xs bg-slate-900 border border-slate-700 text-slate-200 hover:bg-slate-800 transition-all disabled:opacity-50"
          >
            <ShieldCheck className="w-4 h-4 text-cyan-400" />
            <span>VALIDATE DATASET</span>
          </button>

          <button
            onClick={handleImportCsv}
            disabled={loading || !csvContent.trim() || declaredSource === "UNKNOWN"}
            className="flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-xs bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/30 transition-all disabled:opacity-50"
          >
            <Upload className="w-4 h-4 text-emerald-400" />
            <span>UPLOAD HISTORICAL CSV & RUN BACKTEST</span>
          </button>
        </div>
      </div>

      {/* Prominent Synthetic Data Warning Badge */}
      {isSynthetic ? (
        <div className="flex items-start gap-3 p-4 rounded-2xl bg-amber-500/10 border border-amber-500/40 text-xs text-amber-300">
          <AlertCircle className="w-5 h-5 shrink-0 text-amber-400 mt-0.5" />
          <div>
            <div className="font-bold text-amber-400 uppercase tracking-wider mb-1 flex items-center gap-2">
              <span>SYNTHETIC ESTIMATION MODE — NOT REAL HISTORICAL PERFORMANCE</span>
            </div>
            <span>
              Real historical option-chain dataset is not currently loaded. Premium values are estimated via paper spot pricing models. Import a real historical option CSV above to run full backtest validation.
            </span>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-300">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <span>REAL HISTORICAL OPTION DATASET LOADED • Backtest evaluation active on real historical quotes.</span>
        </div>
      )}

      {/* 9 Tab Navigation Bar */}
      <div className="flex flex-wrap gap-2 border-b border-slate-800 pb-2">
        <button
          onClick={() => setActiveTab("DATA_QUALITY")}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
            activeTab === "DATA_QUALITY"
              ? "bg-cyan-500/20 border border-cyan-500/40 text-cyan-300"
              : "bg-slate-900/60 text-slate-400 hover:text-slate-200"
          }`}
        >
          1. DATA QUALITY
        </button>
        <button
          onClick={() => setActiveTab("OVERVIEW")}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
            activeTab === "OVERVIEW"
              ? "bg-cyan-500/20 border border-cyan-500/40 text-cyan-300"
              : "bg-slate-900/60 text-slate-400 hover:text-slate-200"
          }`}
        >
          2. OVERVIEW
        </button>
        <button
          onClick={() => setActiveTab("TRADE_LOG")}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
            activeTab === "TRADE_LOG"
              ? "bg-cyan-500/20 border border-cyan-500/40 text-cyan-300"
              : "bg-slate-900/60 text-slate-400 hover:text-slate-200"
          }`}
        >
          3. TRADE LOG
        </button>
        <button
          onClick={() => setActiveTab("DAILY_PNL")}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
            activeTab === "DAILY_PNL"
              ? "bg-cyan-500/20 border border-cyan-500/40 text-cyan-300"
              : "bg-slate-900/60 text-slate-400 hover:text-slate-200"
          }`}
        >
          4. DAILY P&L
        </button>
        <button
          onClick={() => setActiveTab("STRATEGY_RESULTS")}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
            activeTab === "STRATEGY_RESULTS"
              ? "bg-cyan-500/20 border border-cyan-500/40 text-cyan-300"
              : "bg-slate-900/60 text-slate-400 hover:text-slate-200"
          }`}
        >
          5. STRATEGY RESULTS
        </button>
        <button
          onClick={() => setActiveTab("NO_TRADE_ANALYSIS")}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
            activeTab === "NO_TRADE_ANALYSIS"
              ? "bg-cyan-500/20 border border-cyan-500/40 text-cyan-300"
              : "bg-slate-900/60 text-slate-400 hover:text-slate-200"
          }`}
        >
          6. NO-TRADE ANALYSIS
        </button>
        <button
          onClick={() => setActiveTab("RISK_STATS")}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
            activeTab === "RISK_STATS"
              ? "bg-cyan-500/20 border border-cyan-500/40 text-cyan-300"
              : "bg-slate-900/60 text-slate-400 hover:text-slate-200"
          }`}
        >
          7. RISK STATISTICS
        </button>
        <button
          onClick={() => setActiveTab("OUT_OF_SAMPLE")}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
            activeTab === "OUT_OF_SAMPLE"
              ? "bg-cyan-500/20 border border-cyan-500/40 text-cyan-300"
              : "bg-slate-900/60 text-slate-400 hover:text-slate-200"
          }`}
        >
          8. OUT-OF-SAMPLE (30%)
        </button>
        <button
          onClick={() => setActiveTab("WALK_FORWARD")}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
            activeTab === "WALK_FORWARD"
              ? "bg-cyan-500/20 border border-cyan-500/40 text-cyan-300"
              : "bg-slate-900/60 text-slate-400 hover:text-slate-200"
          }`}
        >
          9. WALK-FORWARD
        </button>
      </div>

      {/* TAB 1: DATA QUALITY */}
      {activeTab === "DATA_QUALITY" && (
        <div className="p-6 rounded-2xl bg-[#11192e]/90 border border-slate-800 space-y-4">
          <h3 className="text-sm font-bold text-slate-100 uppercase tracking-wider flex items-center gap-2">
            <Layers className="w-4 h-4 text-cyan-400" />
            1. DATASET QUALITY & ADEQUACY AUDIT
          </h3>

          {dataQualityReport ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800">
                <span className="text-[9px] text-slate-500 block uppercase">Start / End Date</span>
                <span className="font-bold text-slate-200">{dataQualityReport.startDate?.substring(0, 10)} to {dataQualityReport.endDate?.substring(0, 10)}</span>
              </div>
              <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800">
                <span className="text-[9px] text-slate-500 block uppercase">Trading Days / Total Rows</span>
                <span className="font-bold text-slate-200">{dataQualityReport.tradingDays} Days ({dataQualityReport.totalRows} Rows)</span>
              </div>
              <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800">
                <span className="text-[9px] text-slate-500 block uppercase">Expiries / Strikes</span>
                <span className="font-bold text-slate-200">{dataQualityReport.uniqueExpiries} Expiries, {dataQualityReport.uniqueStrikes} Strikes</span>
              </div>
              <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800">
                <span className="text-[9px] text-slate-500 block uppercase">CE / PE Quotes</span>
                <span className="font-bold text-cyan-400">{dataQualityReport.ceRows} CE / {dataQualityReport.peRows} PE</span>
              </div>
              <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800">
                <span className="text-[9px] text-slate-500 block uppercase">Invalid / Duplicate Rows</span>
                <span className="font-bold text-rose-400">{dataQualityReport.invalidRows} Invalid, {dataQualityReport.duplicateRows} Dupes</span>
              </div>
              <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800">
                <span className="text-[9px] text-slate-500 block uppercase">Bid/Ask Availability</span>
                <span className="font-bold text-emerald-400">{dataQualityReport.bidAskAvailabilityPct}%</span>
              </div>
              <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800">
                <span className="text-[9px] text-slate-500 block uppercase">OI Availability</span>
                <span className="font-bold text-emerald-400">{dataQualityReport.oiAvailabilityPct}%</span>
              </div>
              <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800">
                <span className="text-[9px] text-slate-500 block uppercase">IV Availability</span>
                <span className="font-bold text-emerald-400">{dataQualityReport.ivAvailabilityPct}%</span>
              </div>
            </div>
          ) : (
            <div className="text-xs text-slate-400">
              No genuine historical CSV dataset loaded. System currently relies on paper estimation models.
            </div>
          )}
        </div>
      )}

      {/* TAB 2: OVERVIEW */}
      {activeTab === "OVERVIEW" && overall && (
        <div className="p-6 rounded-2xl bg-[#11192e]/90 border border-slate-800 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h3 className="text-sm font-bold text-cyan-400 uppercase tracking-wider flex items-center gap-2">
              <Award className="w-4 h-4 text-cyan-400" />
              2. BACKTEST OVERVIEW & FINAL VERDICT
            </h3>
            <span className="text-xs font-bold text-emerald-400">{overall.totalTrades} Total Trades</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800">
              <span className="text-[9px] text-slate-500 block uppercase">Win Rate / Loss Rate</span>
              <span className="font-bold text-emerald-400">{overall.winRatePct}% / {overall.lossRatePct}%</span>
            </div>
            <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800">
              <span className="text-[9px] text-slate-500 block uppercase">Profit Factor</span>
              <span className="font-bold text-cyan-400">{overall.profitFactor}</span>
            </div>
            <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800">
              <span className="text-[9px] text-slate-500 block uppercase">Gross P&L</span>
              <span className="font-bold text-slate-200">₹{overall.grossPnl}</span>
            </div>
            <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800">
              <span className="text-[9px] text-slate-500 block uppercase">Net P&L (After Charges)</span>
              <span className={`font-bold ${overall.netPnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                ₹{overall.netPnl}
              </span>
            </div>
          </div>

          {verdict && (
            <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-2 text-xs">
              <div className="font-bold text-slate-200 uppercase">{verdict.title}</div>
              <p className="text-slate-400">{verdict.summary}</p>
              {verdict.reasons && verdict.reasons.length > 0 && (
                <ul className="list-disc list-inside text-slate-400 space-y-1">
                  {verdict.reasons.map((r: string, idx: number) => (
                    <li key={idx}>{r}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: TRADE LOG */}
      {activeTab === "TRADE_LOG" && (
        <div className="p-6 rounded-2xl bg-[#11192e]/90 border border-slate-800 space-y-4">
          <h3 className="text-sm font-bold text-slate-100 uppercase tracking-wider flex items-center gap-2">
            <ListFilter className="w-4 h-4 text-cyan-400" />
            3. EXECUTED TRADE LOG ({trades.length} TRADES)
          </h3>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-950 text-slate-500 text-[10px] uppercase">
                <tr>
                  <th className="p-2">Trade ID</th>
                  <th className="p-2">Strategy</th>
                  <th className="p-2">Entry Time</th>
                  <th className="p-2">Exit Time</th>
                  <th className="p-2">Strikes (Sell / Buy)</th>
                  <th className="p-2">Charges</th>
                  <th className="p-2">Exit Reason</th>
                  <th className="p-2">Net P&L</th>
                </tr>
              </thead>
              <tbody>
                {trades.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-4 text-center text-slate-500">
                      No executed trades recorded in current simulation.
                    </td>
                  </tr>
                ) : (
                  trades.map((t: any, idx: number) => (
                    <tr key={idx} className="border-t border-slate-800/60">
                      <td className="p-2 font-bold text-slate-200">{t.id}</td>
                      <td className="p-2 text-cyan-400 font-bold">{t.strategy}</td>
                      <td className="p-2 text-slate-400">{t.entryTime?.substring(0, 16)}</td>
                      <td className="p-2 text-slate-400">{t.exitTime?.substring(0, 16) || "N/A"}</td>
                      <td className="p-2">{t.sellLeg?.strike} / {t.buyLeg?.strike}</td>
                      <td className="p-2 text-amber-400">₹{t.totalCharges}</td>
                      <td className="p-2 text-slate-300">{t.exitReason || "OPEN"}</td>
                      <td className={`p-2 font-bold ${(t.realizedNetPnl || 0) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                        ₹{t.realizedNetPnl ?? 0}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 4: DAILY P&L */}
      {activeTab === "DAILY_PNL" && targetAnalysis && (
        <div className="p-6 rounded-2xl bg-[#11192e]/90 border border-slate-800 space-y-4">
          <h3 className="text-sm font-bold text-slate-100 uppercase tracking-wider flex items-center gap-2">
            <Calendar className="w-4 h-4 text-amber-400" />
            4. DAILY P&L BREAKDOWN & TARGET ANALYSIS
          </h3>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-xs">
            <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800">
              <span className="text-[9px] text-slate-500 block uppercase">Target Rate (≥ ₹1k)</span>
              <span className="font-bold text-amber-400">{targetAnalysis.targetAchievementRatePct}%</span>
            </div>
            <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800">
              <span className="text-[9px] text-slate-500 block uppercase">Avg Daily Net P&L</span>
              <span className="font-bold text-emerald-400">₹{targetAnalysis.averageDailyNetPnl}</span>
            </div>
            <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800">
              <span className="text-[9px] text-slate-500 block uppercase">Median Daily P&L</span>
              <span className="font-bold text-cyan-400">₹{targetAnalysis.medianDailyNetPnl}</span>
            </div>
            <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800">
              <span className="text-[9px] text-slate-500 block uppercase">Best Day P&L</span>
              <span className="font-bold text-emerald-400">₹{targetAnalysis.bestDayPnl}</span>
            </div>
            <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800">
              <span className="text-[9px] text-slate-500 block uppercase">Worst Day P&L</span>
              <span className="font-bold text-rose-400">₹{targetAnalysis.worstDayPnl}</span>
            </div>
            <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800">
              <span className="text-[9px] text-slate-500 block uppercase">Losing Day Rate</span>
              <span className="font-bold text-rose-400">{targetAnalysis.losingDayPct}%</span>
            </div>
          </div>
        </div>
      )}

      {/* TAB 5: STRATEGY RESULTS */}
      {activeTab === "STRATEGY_RESULTS" && stratComp && (
        <div className="p-6 rounded-2xl bg-[#11192e]/90 border border-slate-800 space-y-4">
          <h3 className="text-sm font-bold text-slate-100 uppercase tracking-wider flex items-center gap-2">
            <Layers className="w-4 h-4 text-cyan-400" />
            5. INDEPENDENT STRATEGY RESULTS
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
            <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2">
              <span className="text-xs font-bold text-slate-200">Bull Put Spread Only</span>
              <div className="text-slate-400">Trades: <strong className="text-slate-200">{stratComp.bullPutOnly?.totalTrades}</strong></div>
              <div className="text-slate-400">Win Rate: <strong className="text-emerald-400">{stratComp.bullPutOnly?.winRatePct}%</strong></div>
              <div className="text-slate-400">Net P&L: <strong className="text-cyan-400">₹{stratComp.bullPutOnly?.netPnl}</strong></div>
            </div>

            <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2">
              <span className="text-xs font-bold text-slate-200">Bear Call Spread Only</span>
              <div className="text-slate-400">Trades: <strong className="text-slate-200">{stratComp.bearCallOnly?.totalTrades}</strong></div>
              <div className="text-slate-400">Win Rate: <strong className="text-emerald-400">{stratComp.bearCallOnly?.winRatePct}%</strong></div>
              <div className="text-slate-400">Net P&L: <strong className="text-cyan-400">₹{stratComp.bearCallOnly?.netPnl}</strong></div>
            </div>

            <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2">
              <span className="text-xs font-bold text-slate-200">Iron Condor Only</span>
              <div className="text-slate-400">Trades: <strong className="text-slate-200">{stratComp.ironCondorOnly?.totalTrades}</strong></div>
              <div className="text-slate-400">Win Rate: <strong className="text-emerald-400">{stratComp.ironCondorOnly?.winRatePct}%</strong></div>
              <div className="text-slate-400">Net P&L: <strong className="text-cyan-400">₹{stratComp.ironCondorOnly?.netPnl}</strong></div>
            </div>

            <div className="p-4 rounded-xl bg-cyan-500/10 border border-cyan-500/30 space-y-2">
              <span className="text-xs font-bold text-cyan-300">Regime-Based Selection</span>
              <div className="text-slate-400">Trades: <strong className="text-slate-200">{stratComp.regimeBased?.totalTrades}</strong></div>
              <div className="text-slate-400">Win Rate: <strong className="text-emerald-400">{stratComp.regimeBased?.winRatePct}%</strong></div>
              <div className="text-slate-400">Net P&L: <strong className="text-emerald-400">₹{stratComp.regimeBased?.netPnl}</strong></div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 6: NO-TRADE ANALYSIS */}
      {activeTab === "NO_TRADE_ANALYSIS" && (
        <div className="p-6 rounded-2xl bg-[#11192e]/90 border border-slate-800 space-y-4">
          <h3 className="text-sm font-bold text-slate-100 uppercase tracking-wider flex items-center gap-2">
            <Zap className="w-4 h-4 text-amber-400" />
            6. 17 EXPLICIT NO-TRADE REJECTION REASON BREAKDOWN
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
            {noTradeReasons.map((item: any, idx: number) => (
              <div key={idx} className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-cyan-400">{item.code}</span>
                  <span className="font-bold text-slate-200">{item.count} ({item.percentagePct}%)</span>
                </div>
                <p className="text-[10px] text-slate-400">{item.reason}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 7: RISK STATS */}
      {activeTab === "RISK_STATS" && overall && (
        <div className="p-6 rounded-2xl bg-[#11192e]/90 border border-slate-800 space-y-4">
          <h3 className="text-sm font-bold text-slate-100 uppercase tracking-wider flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            7. RISK AUDIT & CONTROL STATISTICS
          </h3>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800">
              <span className="text-[9px] text-slate-500 block uppercase">Max Consecutive Losses</span>
              <span className="font-bold text-rose-400">{overall.maxConsecutiveLosses} Trades</span>
            </div>
            <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800">
              <span className="text-[9px] text-slate-500 block uppercase">Max Drawdown</span>
              <span className="font-bold text-rose-400">{overall.maxDrawdownPct}%</span>
            </div>
            <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800">
              <span className="text-[9px] text-slate-500 block uppercase">Max Risk / Trade</span>
              <span className="font-bold text-emerald-400">1.0% Capital Cap</span>
            </div>
            <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800">
              <span className="text-[9px] text-slate-500 block uppercase">Daily Profit Lock</span>
              <span className="font-bold text-emerald-400">₹1,000 Cap</span>
            </div>
            <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800">
              <span className="text-[9px] text-slate-500 block uppercase">Daily Loss Lock</span>
              <span className="font-bold text-rose-400">–₹5,000 Cap</span>
            </div>
            <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800">
              <span className="text-[9px] text-slate-500 block uppercase">Max Trades / Day</span>
              <span className="font-bold text-slate-200">3 Trades Cap</span>
            </div>
          </div>
        </div>
      )}

      {/* TAB 8: OUT OF SAMPLE */}
      {activeTab === "OUT_OF_SAMPLE" && outOfSample && (
        <div className="p-6 rounded-2xl bg-[#11192e]/90 border border-slate-800 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h3 className="text-sm font-bold text-violet-400 uppercase tracking-wider flex items-center gap-2">
              <Activity className="w-4 h-4 text-violet-400" />
              8. OUT-OF-SAMPLE VALIDATION (30% UNSEEN TEST PERIOD)
            </h3>
            <span className="text-xs text-slate-400">{outOfSample.totalTrades} Trades</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800">
              <span className="text-[9px] text-slate-500 block uppercase">Win Rate / Loss Rate</span>
              <span className="font-bold text-emerald-400">{outOfSample.winRatePct}% / {outOfSample.lossRatePct}%</span>
            </div>
            <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800">
              <span className="text-[9px] text-slate-500 block uppercase">Profit Factor</span>
              <span className="font-bold text-cyan-400">{outOfSample.profitFactor}</span>
            </div>
            <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800">
              <span className="text-[9px] text-slate-500 block uppercase">Gross P&L</span>
              <span className="font-bold text-slate-200">₹{outOfSample.grossPnl}</span>
            </div>
            <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800">
              <span className="text-[9px] text-slate-500 block uppercase">Charges & Taxes</span>
              <span className="font-bold text-amber-400">₹{outOfSample.totalCharges}</span>
            </div>
            <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800">
              <span className="text-[9px] text-slate-500 block uppercase">Max Drawdown</span>
              <span className="font-bold text-rose-400">{outOfSample.maxDrawdownPct}%</span>
            </div>
            <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800">
              <span className="text-[9px] text-slate-500 block uppercase">Avg Net P&L / Trade</span>
              <span className="font-bold text-emerald-400">₹{outOfSample.avgNetPnlPerTrade}</span>
            </div>
            <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800">
              <span className="text-[9px] text-slate-500 block uppercase">Final Net P&L</span>
              <span className={`font-bold ${outOfSample.netPnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                ₹{outOfSample.netPnl}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* TAB 9: WALK-FORWARD */}
      {activeTab === "WALK_FORWARD" && (
        <div className="p-6 rounded-2xl bg-[#11192e]/90 border border-slate-800 space-y-4">
          <h3 className="text-sm font-bold text-slate-100 uppercase tracking-wider flex items-center gap-2">
            <Activity className="w-4 h-4 text-cyan-400" />
            9. SLIDING WINDOW WALK-FORWARD VALIDATION
          </h3>

          {walkForward ? (
            <div className="space-y-4 text-xs">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800">
                  <span className="text-[9px] text-slate-500 block uppercase">Total Windows</span>
                  <span className="font-bold text-slate-200">{walkForward.totalWindows}</span>
                </div>
                <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800">
                  <span className="text-[9px] text-slate-500 block uppercase">Profitable OOS Windows</span>
                  <span className="font-bold text-emerald-400">{walkForward.profitableOOSWindows}</span>
                </div>
                <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800">
                  <span className="text-[9px] text-slate-500 block uppercase">Stability Score</span>
                  <span className="font-bold text-cyan-400">{walkForward.stabilityScorePct}%</span>
                </div>
                <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800">
                  <span className="text-[9px] text-slate-500 block uppercase">Overall Stability</span>
                  <span className={`font-bold ${walkForward.isStable ? "text-emerald-400" : "text-amber-400"}`}>
                    {walkForward.isStable ? "STABLE (LOW OVERFIT)" : "UNSTABLE (HIGH OVERFIT)"}
                  </span>
                </div>
              </div>

              {walkForward.windows && walkForward.windows.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs text-slate-300">
                    <thead className="bg-slate-950 text-slate-500 text-[10px] uppercase">
                      <tr>
                        <th className="p-2">Window</th>
                        <th className="p-2">Train Start/End</th>
                        <th className="p-2">Test Start/End</th>
                        <th className="p-2">IS Net P&L</th>
                        <th className="p-2">OOS Net P&L</th>
                        <th className="p-2">OOS Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {walkForward.windows.map((w: any, idx: number) => (
                        <tr key={idx} className="border-t border-slate-800/60">
                          <td className="p-2 font-bold text-slate-200">Window #{w.windowId}</td>
                          <td className="p-2 text-slate-400">{w.trainStartDate?.substring(0, 10)} - {w.trainEndDate?.substring(0, 10)}</td>
                          <td className="p-2 text-slate-400">{w.testStartDate?.substring(0, 10)} - {w.testEndDate?.substring(0, 10)}</td>
                          <td className="p-2 font-bold text-slate-200">₹{w.inSampleMetrics?.netPnl}</td>
                          <td className={`p-2 font-bold ${w.outOfSampleMetrics?.netPnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                            ₹{w.outOfSampleMetrics?.netPnl}
                          </td>
                          <td className="p-2">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${w.isProfitableOOS ? "bg-emerald-500/20 text-emerald-300" : "bg-rose-500/20 text-rose-300"}`}>
                              {w.isProfitableOOS ? "PASS" : "FAIL"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : (
            <div className="text-xs text-slate-400">
              Run a backtest simulation to view sliding window walk-forward stability breakdown.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
