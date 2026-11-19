import fs from "node:fs";
import path from "node:path";
import type { OhlcvCandle } from "../entry/EntrySetupTypes.js";
import { sanitizeIntraday1hSeries, toIstDateAndTime } from "../momentum/Strategy03IntradayEventEvaluator.js";

export interface FourHourCandle extends OhlcvCandle {
  timeframe: "4H";
  isComplete: boolean;
  constituentBarCount: number;
  sessionBlockType?: "AM_240M" | "PM_135M";
  blockDurationMinutes?: number;
}

/**
 * Resamples completed NSE 1H session candles into completed 4H NSE session blocks:
 * - Morning 4H block: 09:15–13:14 IST (4 completed 1H bars)
 * - Afternoon 4H block: 13:15–15:30 IST (3 completed 1H bars)
 * Incomplete blocks (e.g. partial live session) are marked isComplete=false and never used for confirmed READY signals.
 */
export function buildCompleted4hCandlesFromSessionBars(raw1h: OhlcvCandle[]): FourHourCandle[] {
  const { candles } = sanitizeIntraday1hSeries(raw1h);
  const groups = new Map<string, { istDate: string; block: "AM" | "PM"; bars: OhlcvCandle[] }>();

  for (const c of candles) {
    const { istDate, minutesOfDay } = toIstDateAndTime(c.timestamp);
    const block: "AM" | "PM" = minutesOfDay < 13 * 60 + 15 ? "AM" : "PM";
    const key = `${istDate}_${block}`;
    const g = groups.get(key) ?? { istDate, block, bars: [] };
    g.bars.push(c);
    groups.set(key, g);
  }

  const sortedKeys = [...groups.keys()].sort();
  const out: FourHourCandle[] = [];
  for (const key of sortedKeys) {
    const g = groups.get(key)!;
    const expectedMinBars = g.block === "AM" ? 4 : 3;
    const isComplete = g.bars.length >= expectedMinBars;
    out.push({
      timeframe: "4H",
      timestamp: g.bars[0].timestamp,
      open: g.bars[0].open,
      high: Math.max(...g.bars.map((b) => b.high)),
      low: Math.min(...g.bars.map((b) => b.low)),
      close: g.bars[g.bars.length - 1].close,
      volume: g.bars.reduce((a, b) => a + b.volume, 0),
      isComplete,
      constituentBarCount: g.bars.length,
      sessionBlockType: g.block === "AM" ? "AM_240M" : "PM_135M",
      blockDurationMinutes: g.block === "AM" ? 240 : 135,
    });
  }
  return out;
}

export function load4hCacheForSymbol(cache4hDir: string, symbol: string): FourHourCandle[] {
  const p = path.join(cache4hDir, `${symbol}_4h.json`);
  if (!fs.existsSync(p)) return [];
  const parsed = JSON.parse(fs.readFileSync(p, "utf8")) as FourHourCandle[];
  return Array.isArray(parsed) ? parsed : [];
}

