"use client";

import React, { useState } from "react";
import { ChartDrawing, DrawingType } from "../../types/chart";
import {
  Pencil,
  Minus,
  ShieldAlert,
  Target,
  DollarSign,
  Trash2,
  X,
  Type,
  Layers,
  Check,
} from "lucide-react";

interface ChartDrawingToolbarProps {
  drawings: ChartDrawing[];
  onAddDrawing: (drawing: Omit<ChartDrawing, "id">) => void;
  onDeleteDrawing: (id: string) => void;
  onClearAllDrawings: () => void;
  currentMarketPrice?: number;
}

export default function ChartDrawingToolbar({
  drawings,
  onAddDrawing,
  onDeleteDrawing,
  onClearAllDrawings,
  currentMarketPrice = 0,
}: ChartDrawingToolbarProps) {
  const [showAddModal, setShowAddModal] = useState(false);
  const [showManager, setShowManager] = useState(false);

  const [selectedType, setSelectedType] = useState<DrawingType>("SUPPORT");
  const [priceInput, setPriceInput] = useState<number>(currentMarketPrice);
  const [labelInput, setLabelInput] = useState<string>("Support Zone");

  const openAddTool = (type: DrawingType, defaultLabel: string) => {
    setSelectedType(type);
    setLabelInput(defaultLabel);
    setPriceInput(currentMarketPrice);
    setShowAddModal(true);
  };

  const handleCreateDrawing = () => {
    let color = "#38bdf8"; // cyan-400
    let lineStyle = 0; // solid

    if (selectedType === "SUPPORT") {
      color = "#38bdf8"; // cyan
    } else if (selectedType === "RESISTANCE") {
      color = "#f59e0b"; // amber
    } else if (selectedType === "ENTRY") {
      color = "#10b981"; // emerald
    } else if (selectedType === "STOP_LOSS") {
      color = "#ef4444"; // red
      lineStyle = 2; // dashed
    } else if (selectedType === "TAKE_PROFIT") {
      color = "#10b981"; // emerald
      lineStyle = 2; // dashed
    } else if (selectedType === "TEXT_LABEL") {
      color = "#e2e8f0"; // slate-200
    }

    onAddDrawing({
      type: selectedType,
      price: priceInput,
      label: labelInput,
      color,
      lineStyle,
    });

    setShowAddModal(false);
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 p-2 bg-[#0d1322]/90 border border-slate-800/80 rounded-xl font-mono text-xs">
      {/* Toolbar Tools */}
      <div className="flex items-center gap-1 overflow-x-auto py-0.5">
        <span className="text-[10px] text-slate-400 font-bold px-2 flex items-center gap-1 font-sans">
          <Pencil className="w-3 h-3 text-cyan-400" />
          Tools:
        </span>

        {/* Support */}
        <button
          onClick={() => openAddTool("SUPPORT", "Support Zone")}
          className="px-2 py-1 rounded-lg bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 border border-cyan-500/20 text-[11px] font-medium flex items-center gap-1 transition-colors"
        >
          <Minus className="w-3 h-3" />
          Support
        </button>

        {/* Resistance */}
        <button
          onClick={() => openAddTool("RESISTANCE", "Resistance Zone")}
          className="px-2 py-1 rounded-lg bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 border border-amber-500/20 text-[11px] font-medium flex items-center gap-1 transition-colors"
        >
          <Minus className="w-3 h-3" />
          Resistance
        </button>

        {/* Entry Line */}
        <button
          onClick={() => openAddTool("ENTRY", "Entry Level")}
          className="px-2 py-1 rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/20 text-[11px] font-medium flex items-center gap-1 transition-colors"
        >
          <DollarSign className="w-3 h-3" />
          Entry
        </button>

        {/* Stop Loss Line */}
        <button
          onClick={() => openAddTool("STOP_LOSS", "Stop Loss")}
          className="px-2 py-1 rounded-lg bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 border border-rose-500/20 text-[11px] font-medium flex items-center gap-1 transition-colors"
        >
          <ShieldAlert className="w-3 h-3" />
          SL Line
        </button>

        {/* Take Profit Line */}
        <button
          onClick={() => openAddTool("TAKE_PROFIT", "Take Profit")}
          className="px-2 py-1 rounded-lg bg-teal-500/10 text-teal-400 hover:bg-teal-500/20 border border-teal-500/20 text-[11px] font-medium flex items-center gap-1 transition-colors"
        >
          <Target className="w-3 h-3" />
          TP Line
        </button>

        {/* Text Annotation */}
        <button
          onClick={() => openAddTool("TEXT_LABEL", "Chart Note")}
          className="px-2 py-1 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700 text-[11px] font-medium flex items-center gap-1 transition-colors"
        >
          <Type className="w-3 h-3 text-cyan-400" />
          Text Label
        </button>
      </div>

      {/* Drawings Count & Manager Actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setShowManager(true)}
          className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] border border-slate-700 flex items-center gap-1.5"
        >
          <Layers className="w-3 h-3 text-cyan-400" />
          <span>Drawings ({drawings.length})</span>
        </button>

        {drawings.length > 0 && (
          <button
            onClick={onClearAllDrawings}
            className="px-2 py-1 rounded-lg bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 border border-rose-500/20 text-[11px] flex items-center gap-1"
            title="Clear All Drawings"
          >
            <Trash2 className="w-3 h-3" />
            Clear
          </button>
        )}
      </div>

      {/* Modal: Add Drawing */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="w-full max-w-sm p-5 rounded-2xl bg-[#0d1322] border border-slate-800 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <span className="font-bold text-slate-100 text-xs font-sans flex items-center gap-2">
                <Pencil className="w-4 h-4 text-cyan-400" />
                Add {selectedType.replace("_", " ")}
              </span>
              <button
                onClick={() => setShowAddModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-[10px] text-slate-400 block">Price Level ($)</label>
                <input
                  type="number"
                  value={priceInput}
                  onChange={(e) => setPriceInput(parseFloat(e.target.value) || 0)}
                  className="w-full px-3 py-1.5 rounded-xl bg-slate-950/60 border border-slate-800 text-slate-100 font-bold"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] text-slate-400 block">Label / Note</label>
                <input
                  type="text"
                  value={labelInput}
                  onChange={(e) => setLabelInput(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-xl bg-slate-950/60 border border-slate-800 text-slate-100 font-bold"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                onClick={() => setShowAddModal(false)}
                className="px-3 py-1.5 rounded-xl text-slate-400 hover:bg-slate-800 border border-slate-700"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateDrawing}
                className="px-3 py-1.5 rounded-xl bg-cyan-500 text-slate-950 font-bold hover:bg-cyan-400 shadow-md shadow-cyan-500/20 flex items-center gap-1"
              >
                <Check className="w-3.5 h-3.5" />
                Add to Chart
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal / Drawer: Drawings Manager */}
      {showManager && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="w-full max-w-md p-5 rounded-2xl bg-[#0d1322] border border-slate-800 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <span className="font-bold text-slate-100 text-xs font-sans flex items-center gap-2">
                <Layers className="w-4 h-4 text-cyan-400" />
                Active Chart Drawings ({drawings.length})
              </span>
              <button
                onClick={() => setShowManager(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
              {drawings.length === 0 ? (
                <div className="p-4 text-center text-slate-500 text-xs">
                  No active chart drawings. Click drawing tools to add levels.
                </div>
              ) : (
                drawings.map((dr) => (
                  <div
                    key={dr.id}
                    className="p-2.5 rounded-xl bg-slate-900/60 border border-slate-800/60 flex items-center justify-between"
                  >
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2.5 h-2.5 rounded-full"
                          style={{ backgroundColor: dr.color }}
                        />
                        <span className="font-bold text-slate-200">{dr.label}</span>
                      </div>
                      <span className="text-[10px] text-slate-400 block font-mono">
                        ${dr.price.toFixed(2)} ({dr.type})
                      </span>
                    </div>

                    <button
                      onClick={() => onDeleteDrawing(dr.id)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800"
                      title="Delete Drawing"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-slate-800">
              {drawings.length > 0 && (
                <button
                  onClick={() => {
                    onClearAllDrawings();
                    setShowManager(false);
                  }}
                  className="px-3 py-1.5 rounded-xl bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 border border-rose-500/20 text-xs"
                >
                  Clear All
                </button>
              )}
              <button
                onClick={() => setShowManager(false)}
                className="px-4 py-1.5 rounded-xl bg-slate-800 text-slate-200 hover:bg-slate-700 ml-auto"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
