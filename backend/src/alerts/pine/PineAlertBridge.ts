import { PineLiquidityEngine } from "./PineLiquidityEngine";
import { PineAlertEvent, ActiveLevel, Candle } from "./PineTypes";
import { sendTelegramMessage, isTelegramConfigured } from "../../alerts/telegram/TelegramClient";

export function isXauWeekend(timestamp: string | Date): boolean {
  try {
    const dt = typeof timestamp === "string" ? new Date(timestamp) : timestamp;
    if (isNaN(dt.getTime())) return false;
    const day = dt.getUTCDay(); // 0 = Sunday, 6 = Saturday
    return day === 0 || day === 6;
  } catch {
    return false;
  }
}

/**
 * Formats a UTC ISO timestamp as "DD MMM YYYY HH:mm IST" for display.
 */
function formatTimestampIST_Long(isoTimestamp: string): string {
  try {
    const dt = new Date(isoTimestamp);
    const istOffsetMs = 5.5 * 60 * 60 * 1_000;
    const ist = new Date(dt.getTime() + istOffsetMs);
    const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const dd = String(ist.getUTCDate()).padStart(2, "0");
    const mmm = MONTHS[ist.getUTCMonth()];
    const yyyy = ist.getUTCFullYear();
    const hh = String(ist.getUTCHours()).padStart(2, "0");
    const mm = String(ist.getUTCMinutes()).padStart(2, "0");
    return `${dd} ${mmm} ${yyyy} ${hh}:${mm} IST`;
  } catch {
    return isoTimestamp;
  }
}

/**
 * Returns human-readable level type string for Telegram message.
 */
export function getLevelTypeDisplay(level: ActiveLevel): string {
  if (level.type === "SWH") return "15M+ Swing High";
  if (level.type === "SWL") return "15M+ Swing Low";
  if (level.type === "PWH") return "PWH";
  if (level.type === "PWL") return "PWL";
  if (level.type === "PDH") return "PDH";
  if (level.type === "PDL") return "PDL";
  if (level.type === "PMH") return "PMH";
  if (level.type === "PML") return "PML";
  if (level.type === "ASIA_H") return "Asia High";
  if (level.type === "ASIA_L") return "Asia Low";
  if (level.type === "LONDON_H") return "London High";
  if (level.type === "LONDON_L") return "London Low";
  if (level.type === "NY_H") return "NY High";
  if (level.type === "NY_L") return "NY Low";
  const labelClean = level.label.split("  ")[0];
  return labelClean || level.type;
}

/**
 * Formats Telegram LEVEL_TOUCHED alert message.
 */
export function formatLevelTouchedTelegramMessage(
  instrument: string,
  levelPrice: number,
  levelTypeDisplay: string,
  currentPrice: number,
  timestamp: string,
  timeframe: string,
  isWick: boolean = false
): string {
  const timeStr = formatTimestampIST_Long(timestamp);
  const title = isWick ? `🔔 Trading Journey — Pine Level Touched (Candle Wick)` : `🔔 Trading Journey — Pine Level Touched`;
  const eventName = isWick ? `LEVEL_TOUCHED_WICK` : `LEVEL_TOUCHED`;
  const priceLabel = isWick ? `Wick Price` : `Current Price`;
  return [
    title,
    ``,
    `Instrument: ${instrument}`,
    `Type: ${levelTypeDisplay}`,
    `Event: ${eventName}`,
    `Level Price: ${levelPrice.toFixed(2)}`,
    `${priceLabel}: ${currentPrice.toFixed(2)}`,
    `Timeframe: ${timeframe}`,
    `Time: ${timeStr}`,
  ].join("\n");
}

/**
 * PineAlertBridge
 * ===============
 * Observes live price ticks and compares against active Pine levels produced by
 * PineLiquidityEngine. This class is a READ-ONLY observer — it NEVER mutates
 * any internal state of the engine.
 *
 * Real-Time Touch Semantics (LEVEL_TOUCHED):
 * - Evaluated on every live market tick for BTC/USD and XAU/USD.
 * - Resistance levels (EQH, PWH, SWH, PDH, PMH, Session Highs):
 *     If previousPrice < level AND currentPrice >= level (or starting on level),
 *     emit LEVEL_TOUCHED alert.
 * - Support levels (EQL, PWL, SWL, PDL, PML, Session Lows):
 *     If previousPrice > level AND currentPrice <= level (or starting on level),
 *     emit LEVEL_TOUCHED alert.
 * - Duplicate protection & Level Consumption:
 *     Triggers exactly ONE alert and consumes the level immediately.
 * - Dispatches Telegram notification immediately.
 */
export class PineAlertBridge {
  private engineMap: Map<string, PineLiquidityEngine> = new Map();
  private alertedLevelMap: Map<string, number> = new Map(); // for zone/eq dedup
  private levelTouchStateMap: Map<string, "armed" | "triggered"> = new Map();
  private levelLastTriggeredTimeMap: Map<string, string> = new Map();
  private previousPriceMap: Map<string, number | null> = new Map();
  private onAlertCallback: ((alert: PineAlertEvent) => void) | null = null;

  public static getLevelStateKey(instrument: string, levelOrId: ActiveLevel | string): string {
    if (typeof levelOrId !== "string") {
      return `${instrument}-${levelOrId.type}-${levelOrId.price.toFixed(2)}`;
    }
    const rawId = levelOrId;
    if (rawId.startsWith(`${instrument}-`)) {
      return rawId;
    }
    const parts = rawId.split("-");
    if (parts.length >= 2) {
      const typeUpper = parts[0].toUpperCase();
      const priceStr = parts[parts.length - 1];
      const priceNum = parseFloat(priceStr);
      if (!isNaN(priceNum)) {
        return `${instrument}-${typeUpper}-${priceNum.toFixed(2)}`;
      }
    }
    return `${instrument}-${rawId}`;
  }

  private getMinuteBucketIso(isoTimestamp: string): string {
    try {
      const ms = Math.floor(new Date(isoTimestamp).getTime() / 60000) * 60000;
      return new Date(ms).toISOString();
    } catch {
      return isoTimestamp;
    }
  }

  constructor() {}

  public registerEngine(instrument: string, engine: PineLiquidityEngine): void {
    this.engineMap.set(instrument, engine);
  }

  public onAlert(callback: (alert: PineAlertEvent) => void): void {
    this.onAlertCallback = callback;
  }

  public setPreviousPrice(instrument: string, price: number): void {
    this.previousPriceMap.set(instrument, price);
  }

  public getLevelTouchState(instrument: string, levelId: string): "armed" | "triggered" {
    const stateKey = PineAlertBridge.getLevelStateKey(instrument, levelId);
    return this.levelTouchStateMap.get(stateKey) ?? this.levelTouchStateMap.get(`${instrument}-${levelId}`) ?? "armed";
  }

  public resetState(): void {
    this.levelTouchStateMap.clear();
    this.levelLastTriggeredTimeMap.clear();
    this.previousPriceMap.clear();
    this.alertedLevelMap.clear();
  }

  public checkLivePrice(
    instrument: string,
    currentPrice: number,
    timestamp: string
  ): PineAlertEvent[] {
    const engine = this.engineMap.get(instrument);
    if (!engine) return [];

    // Weekend XAU suppression: XAU market is closed on Sat/Sun
    if (instrument === "XAU/USD" && isXauWeekend(timestamp)) {
      this.previousPriceMap.set(instrument, currentPrice);
      return [];
    }

    const activeLevels = engine.getActiveLevels(instrument);
    const previousPrice = this.previousPriceMap.get(instrument) ?? null;
    const generatedAlerts: PineAlertEvent[] = [];

    // Clean up stale level states for levels no longer active
    const currentLevelStateKeys = new Set(
      activeLevels.map((l) => PineAlertBridge.getLevelStateKey(instrument, l))
    );
    for (const key of this.levelTouchStateMap.keys()) {
      if (key.startsWith(`${instrument}-`)) {
        const isRawKeyStillActive = activeLevels.some((l) => `${instrument}-${l.id}` === key);
        if (!currentLevelStateKeys.has(key) && !isRawKeyStillActive) {
          this.levelTouchStateMap.delete(key);
          this.levelLastTriggeredTimeMap.delete(key);
        }
      }
    }

    for (const level of activeLevels) {
      const alertsForLevel = this.evaluateLevel(
        instrument,
        previousPrice,
        currentPrice,
        timestamp,
        level,
        engine
      );
      for (const alert of alertsForLevel) {
        generatedAlerts.push(alert);
        if (this.onAlertCallback) {
          this.onAlertCallback(alert);
        }
      }
    }

    this.previousPriceMap.set(instrument, currentPrice);

    return generatedAlerts;
  }

  private evaluateLevel(
    instrument: string,
    previousPrice: number | null,
    currentPrice: number,
    timestamp: string,
    level: ActiveLevel,
    engine: PineLiquidityEngine
  ): PineAlertEvent[] {
    const results: PineAlertEvent[] = [];
    const stateKey = PineAlertBridge.getLevelStateKey(instrument, level);
    const rawKey = `${instrument}-${level.id}`;
    const currentState = this.levelTouchStateMap.get(stateKey) ?? this.levelTouchStateMap.get(rawKey) ?? "armed";

    const isResistance =
      level.type === "EQH" ||
      level.type === "PWH" ||
      level.type === "SWH" ||
      level.type === "PDH" ||
      level.type === "PMH" ||
      level.type === "ASIA_H" ||
      level.type === "LONDON_H" ||
      level.type === "NY_H";

    const levelPrice = level.price;
    const currentMinuteIso = this.getMinuteBucketIso(timestamp);

    if (isResistance) {
      const isTouchFromBelow = previousPrice !== null ? (previousPrice < levelPrice && currentPrice >= levelPrice) : false;
      const isExactStart = (previousPrice === null || previousPrice === levelPrice) && currentPrice >= levelPrice;
      const isTouched = isTouchFromBelow || isExactStart;

      if (currentState === "armed" && isTouched) {
        this.levelTouchStateMap.set(stateKey, "triggered");
        this.levelTouchStateMap.set(rawKey, "triggered");
        this.levelLastTriggeredTimeMap.set(stateKey, currentMinuteIso);
        this.levelLastTriggeredTimeMap.set(rawKey, currentMinuteIso);

        const typeDisplay = getLevelTypeDisplay(level);
        const alertMessage = formatLevelTouchedTelegramMessage(
          instrument,
          levelPrice,
          typeDisplay,
          currentPrice,
          timestamp,
          level.timeframe
        );

        console.log(
          `[PINE-TOUCH]\ninstrument=${instrument}\nlevelType=${typeDisplay}\nlevelPrice=${levelPrice.toFixed(2)}\npreviousPrice=${previousPrice !== null ? previousPrice.toFixed(2) : "null"}\ncurrentPrice=${currentPrice.toFixed(2)}\ntimeframe=${level.timeframe}\nevent=LEVEL_TOUCHED`
        );

        sendTelegramMessage(alertMessage).then((res) => {
          console.log(`[PINE-TOUCH]\ntelegram sent=${res.sent}`);
          if (!res.sent && isTelegramConfigured()) {
            console.warn(`[PINE-TOUCH] Telegram dispatch failed for level ${level.id}. Reverting level touch state.`);
            this.levelTouchStateMap.set(stateKey, "armed");
            this.levelTouchStateMap.set(rawKey, "armed");
          }
        }).catch((err) => {
          console.error(`[PINE-TOUCH]\ntelegram sent=false`, err);
          if (isTelegramConfigured()) {
            this.levelTouchStateMap.set(stateKey, "armed");
            this.levelTouchStateMap.set(rawKey, "armed");
          }
        });

        results.push({
          instrument,
          levelLabel: level.label,
          levelPrice,
          marketPrice: currentPrice,
          timeframe: level.timeframe,
          event: "LEVEL_TOUCHED",
          timestamp,
        });
      } else if (currentState === "triggered" && currentPrice < levelPrice) {
        const lastTriggeredMinute = this.levelLastTriggeredTimeMap.get(stateKey) ?? this.levelLastTriggeredTimeMap.get(rawKey);
        if (!lastTriggeredMinute || currentMinuteIso !== lastTriggeredMinute) {
          this.levelTouchStateMap.set(stateKey, "armed");
          this.levelTouchStateMap.set(rawKey, "armed");
        }
      }
    } else {
      const isTouchFromAbove = previousPrice !== null ? (previousPrice > levelPrice && currentPrice <= levelPrice) : false;
      const isExactStart = (previousPrice === null || previousPrice === levelPrice) && currentPrice <= levelPrice;
      const isTouched = isTouchFromAbove || isExactStart;

      if (currentState === "armed" && isTouched) {
        this.levelTouchStateMap.set(stateKey, "triggered");
        this.levelTouchStateMap.set(rawKey, "triggered");
        this.levelLastTriggeredTimeMap.set(stateKey, currentMinuteIso);
        this.levelLastTriggeredTimeMap.set(rawKey, currentMinuteIso);

        const typeDisplay = getLevelTypeDisplay(level);
        const alertMessage = formatLevelTouchedTelegramMessage(
          instrument,
          levelPrice,
          typeDisplay,
          currentPrice,
          timestamp,
          level.timeframe
        );

        console.log(
          `[PINE-TOUCH]\ninstrument=${instrument}\nlevelType=${typeDisplay}\nlevelPrice=${levelPrice.toFixed(2)}\npreviousPrice=${previousPrice !== null ? previousPrice.toFixed(2) : "null"}\ncurrentPrice=${currentPrice.toFixed(2)}\ntimeframe=${level.timeframe}\nevent=LEVEL_TOUCHED`
        );

        sendTelegramMessage(alertMessage).then((res) => {
          console.log(`[PINE-TOUCH]\ntelegram sent=${res.sent}`);
          if (!res.sent && isTelegramConfigured()) {
            console.warn(`[PINE-TOUCH] Telegram dispatch failed for level ${level.id}. Reverting level touch state.`);
            this.levelTouchStateMap.set(stateKey, "armed");
            this.levelTouchStateMap.set(rawKey, "armed");
          }
        }).catch((err) => {
          console.error(`[PINE-TOUCH]\ntelegram sent=false`, err);
          if (isTelegramConfigured()) {
            this.levelTouchStateMap.set(stateKey, "armed");
            this.levelTouchStateMap.set(rawKey, "armed");
          }
        });

        results.push({
          instrument,
          levelLabel: level.label,
          levelPrice,
          marketPrice: currentPrice,
          timeframe: level.timeframe,
          event: "LEVEL_TOUCHED",
          timestamp,
        });
      } else if (currentState === "triggered" && currentPrice > levelPrice) {
        const lastTriggeredMinute = this.levelLastTriggeredTimeMap.get(stateKey) ?? this.levelLastTriggeredTimeMap.get(rawKey);
        if (!lastTriggeredMinute || currentMinuteIso !== lastTriggeredMinute) {
          this.levelTouchStateMap.set(stateKey, "armed");
          this.levelTouchStateMap.set(rawKey, "armed");
        }
      }
    }

    return results;
  }

  public evaluateCandleWick(
    instrument: string,
    candle: Candle,
    candleMinuteTimestamp?: string
  ): PineAlertEvent[] {
    const engine = this.engineMap.get(instrument);
    if (!engine) return [];

    const targetTimestamp = candleMinuteTimestamp || candle.timestamp;
    if (instrument === "XAU/USD" && isXauWeekend(targetTimestamp)) {
      return [];
    }

    const activeLevels = engine.getActiveLevels(instrument);
    const generatedAlerts: PineAlertEvent[] = [];
    const targetMinuteIso = this.getMinuteBucketIso(targetTimestamp);

    const currentLevelStateKeys = new Set(
      activeLevels.map((l) => PineAlertBridge.getLevelStateKey(instrument, l))
    );
    for (const key of this.levelTouchStateMap.keys()) {
      if (key.startsWith(`${instrument}-`)) {
        const isRawKeyStillActive = activeLevels.some((l) => `${instrument}-${l.id}` === key);
        if (!currentLevelStateKeys.has(key) && !isRawKeyStillActive) {
          this.levelTouchStateMap.delete(key);
          this.levelLastTriggeredTimeMap.delete(key);
        }
      }
    }

    for (const level of activeLevels) {
      const stateKey = PineAlertBridge.getLevelStateKey(instrument, level);
      const rawKey = `${instrument}-${level.id}`;
      const lastTriggeredMinuteIso = this.levelLastTriggeredTimeMap.get(stateKey) ?? this.levelLastTriggeredTimeMap.get(rawKey);

      if (lastTriggeredMinuteIso && lastTriggeredMinuteIso === targetMinuteIso) {
        continue;
      }

      let currentState = this.levelTouchStateMap.get(stateKey) ?? this.levelTouchStateMap.get(rawKey) ?? "armed";

      const isResistance =
        level.type === "EQH" ||
        level.type === "PWH" ||
        level.type === "SWH" ||
        level.type === "PDH" ||
        level.type === "PMH" ||
        level.type === "ASIA_H" ||
        level.type === "LONDON_H" ||
        level.type === "NY_H";

      const levelPrice = level.price;
      const previousPrice = this.previousPriceMap.get(instrument) ?? null;

      if (currentState === "triggered" && lastTriggeredMinuteIso && targetMinuteIso !== lastTriggeredMinuteIso) {
        const openedOnNonTriggeredSide = isResistance
          ? (candle.open < levelPrice || (previousPrice !== null && previousPrice < levelPrice))
          : (candle.open > levelPrice || (previousPrice !== null && previousPrice > levelPrice));
        if (openedOnNonTriggeredSide) {
          currentState = "armed";
          this.levelTouchStateMap.set(stateKey, "armed");
          this.levelTouchStateMap.set(rawKey, "armed");
        }
      }

      if (isResistance) {
        const isTouched = candle.high >= levelPrice;

        if (currentState === "armed" && isTouched) {
          this.levelTouchStateMap.set(stateKey, "triggered");
          this.levelTouchStateMap.set(rawKey, "triggered");
          this.levelLastTriggeredTimeMap.set(stateKey, targetMinuteIso);
          this.levelLastTriggeredTimeMap.set(rawKey, targetMinuteIso);

          const typeDisplay = getLevelTypeDisplay(level);
          const alertMessage = formatLevelTouchedTelegramMessage(
            instrument,
            levelPrice,
            typeDisplay,
            candle.high,
            candle.timestamp,
            level.timeframe,
            true
          );

          console.log(
            `[PINE-TOUCH-WICK]\ninstrument=${instrument}\nlevelType=${typeDisplay}\nlevelPrice=${levelPrice.toFixed(2)}\ncandleHigh=${candle.high.toFixed(2)}\ncandleLow=${candle.low.toFixed(2)}\ntimeframe=${level.timeframe}\nevent=LEVEL_TOUCHED_WICK`
          );

          sendTelegramMessage(alertMessage).then((res) => {
            console.log(`[PINE-TOUCH-WICK]\ntelegram sent=${res.sent}`);
            if (!res.sent && isTelegramConfigured()) {
              console.warn(`[PINE-TOUCH-WICK] Telegram dispatch failed for level ${level.id}. Reverting level touch state.`);
              this.levelTouchStateMap.set(stateKey, "armed");
              this.levelTouchStateMap.set(rawKey, "armed");
            }
          }).catch((err) => {
            console.error(`[PINE-TOUCH-WICK]\ntelegram sent=false`, err);
            if (isTelegramConfigured()) {
              this.levelTouchStateMap.set(stateKey, "armed");
              this.levelTouchStateMap.set(rawKey, "armed");
            }
          });

          const alertEvent: PineAlertEvent = {
            instrument,
            levelLabel: level.label,
            levelPrice,
            marketPrice: candle.high,
            timeframe: level.timeframe,
            event: "LEVEL_TOUCHED",
            timestamp: candle.timestamp,
          };

          generatedAlerts.push(alertEvent);
          if (this.onAlertCallback) {
            this.onAlertCallback(alertEvent);
          }
        }
      } else {
        const isTouched = candle.low <= levelPrice;

        if (currentState === "armed" && isTouched) {
          this.levelTouchStateMap.set(stateKey, "triggered");
          this.levelTouchStateMap.set(rawKey, "triggered");
          this.levelLastTriggeredTimeMap.set(stateKey, targetMinuteIso);
          this.levelLastTriggeredTimeMap.set(rawKey, targetMinuteIso);

          const typeDisplay = getLevelTypeDisplay(level);
          const alertMessage = formatLevelTouchedTelegramMessage(
            instrument,
            levelPrice,
            typeDisplay,
            candle.low,
            candle.timestamp,
            level.timeframe,
            true
          );

          console.log(
            `[PINE-TOUCH-WICK]\ninstrument=${instrument}\nlevelType=${typeDisplay}\nlevelPrice=${levelPrice.toFixed(2)}\ncandleHigh=${candle.high.toFixed(2)}\ncandleLow=${candle.low.toFixed(2)}\ntimeframe=${level.timeframe}\nevent=LEVEL_TOUCHED_WICK`
          );

          sendTelegramMessage(alertMessage).then((res) => {
            console.log(`[PINE-TOUCH-WICK]\ntelegram sent=${res.sent}`);
            if (!res.sent && isTelegramConfigured()) {
              console.warn(`[PINE-TOUCH-WICK] Telegram dispatch failed for level ${level.id}. Reverting level touch state.`);
              this.levelTouchStateMap.set(stateKey, "armed");
              this.levelTouchStateMap.set(rawKey, "armed");
            }
          }).catch((err) => {
            console.error(`[PINE-TOUCH-WICK]\ntelegram sent=false`, err);
            if (isTelegramConfigured()) {
              this.levelTouchStateMap.set(stateKey, "armed");
              this.levelTouchStateMap.set(rawKey, "armed");
            }
          });

          const alertEvent: PineAlertEvent = {
            instrument,
            levelLabel: level.label,
            levelPrice,
            marketPrice: candle.low,
            timeframe: level.timeframe,
            event: "LEVEL_TOUCHED",
            timestamp: candle.timestamp,
          };

          generatedAlerts.push(alertEvent);
          if (this.onAlertCallback) {
            this.onAlertCallback(alertEvent);
          }
        }
      }
    }

    return generatedAlerts;
  }

  private tryEmit(dedupeKey: string, timestamp: string): boolean {
    const lastAlerted = this.alertedLevelMap.get(dedupeKey) ?? 0;
    const now = new Date(timestamp).getTime();
    if (now - lastAlerted > 60_000) {
      this.alertedLevelMap.set(dedupeKey, now);
      return true;
    }
    return false;
  }
}
