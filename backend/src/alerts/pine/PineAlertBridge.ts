import { PineLiquidityEngine } from "./PineLiquidityEngine";
import { PineAlertEvent, ActiveLevel } from "./PineTypes";
import { sendTelegramMessage } from "../../alerts/telegram/TelegramClient";

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
  timestamp: string
): string {
  const timeStr = formatTimestampIST_Long(timestamp);
  return [
    `🔔 Trading Journey — Pine Level Touched`,
    ``,
    `Instrument: ${instrument}`,
    `Level: ${levelPrice.toFixed(2)}`,
    `Type: ${levelTypeDisplay}`,
    `Event: LEVEL_TOUCHED`,
    `Price: ${currentPrice.toFixed(2)}`,
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
 * - Resistance levels (EQH, PWH, SWH):
 *     If previousPrice < level AND currentPrice >= level (or starting on level),
 *     emit LEVEL_TOUCHED alert.
 * - Support levels (EQL, PWL, SWL):
 *     If previousPrice > level AND currentPrice <= level (or starting on level),
 *     emit LEVEL_TOUCHED alert.
 * - Duplicate protection: State machine per active level (`armed` vs `triggered`).
 *     Re-arms when price moves clearly away from level.
 * - Dispatches Telegram notification immediately.
 */
export class PineAlertBridge {
  private engineMap: Map<string, PineLiquidityEngine> = new Map();
  private alertedLevelMap: Map<string, number> = new Map(); // for zone/eq dedup
  private levelTouchStateMap: Map<string, "armed" | "triggered"> = new Map();
  private previousPriceMap: Map<string, number | null> = new Map();
  private onAlertCallback: ((alert: PineAlertEvent) => void) | null = null;

  constructor() {}

  public registerEngine(instrument: string, engine: PineLiquidityEngine): void {
    this.engineMap.set(instrument, engine);
  }

  public onAlert(callback: (alert: PineAlertEvent) => void): void {
    this.onAlertCallback = callback;
  }

  public getLevelTouchState(instrument: string, levelId: string): "armed" | "triggered" {
    const key = `${instrument}-${levelId}`;
    return this.levelTouchStateMap.get(key) ?? "armed";
  }

  public resetState(): void {
    this.levelTouchStateMap.clear();
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

    // READ-ONLY: engine state is never mutated here
    const activeLevels = engine.getActiveLevels();
    const pdState = engine.getPDZoneState();
    const previousPrice = this.previousPriceMap.get(instrument) ?? null;
    const generatedAlerts: PineAlertEvent[] = [];

    // Clean up stale level states for levels no longer active
    const currentLevelKeys = new Set(activeLevels.map((l) => `${instrument}-${l.id}`));
    for (const key of this.levelTouchStateMap.keys()) {
      if (key.startsWith(`${instrument}-`) && !currentLevelKeys.has(key)) {
        this.levelTouchStateMap.delete(key);
      }
    }

    for (const level of activeLevels) {
      const alertsForLevel = this.evaluateLevel(
        instrument,
        previousPrice,
        currentPrice,
        timestamp,
        level,
        pdState
      );
      for (const alert of alertsForLevel) {
        generatedAlerts.push(alert);
        if (this.onAlertCallback) {
          this.onAlertCallback(alert);
        }
      }
    }

    // Update previous price after evaluating all levels for this tick
    this.previousPriceMap.set(instrument, currentPrice);

    return generatedAlerts;
  }

  private evaluateLevel(
    instrument: string,
    previousPrice: number | null,
    currentPrice: number,
    timestamp: string,
    level: ActiveLevel,
    pdState: ReturnType<PineLiquidityEngine["getPDZoneState"]>
  ): PineAlertEvent[] {
    const results: PineAlertEvent[] = [];

    if (level.type === "EQUILIBRIUM") {
      const eqPrice = level.price;
      const tol = eqPrice * 0.0005;
      if (Math.abs(currentPrice - eqPrice) <= tol) {
        const dedupeKey = `${instrument}-eq-${eqPrice}-EQUILIBRIUM_TOUCHED`;
        if (this.tryEmit(dedupeKey, timestamp)) {
          results.push({
            instrument,
            levelLabel: level.label,
            levelPrice: eqPrice,
            marketPrice: currentPrice,
            timeframe: level.timeframe,
            event: "EQUILIBRIUM_TOUCHED",
            timestamp,
          });
        }
      }
    } else if (level.type === "PREMIUM" || level.type === "DISCOUNT") {
      if (!pdState.active || pdState.top === null || pdState.bottom === null || pdState.equilibrium === null) {
        return results;
      }

      const isInPremium = currentPrice >= pdState.equilibrium && currentPrice <= pdState.top;
      const isInDiscount = currentPrice >= pdState.bottom && currentPrice <= pdState.equilibrium;

      if (level.type === "PREMIUM" && isInPremium) {
        const dedupeKey = `${instrument}-premium-ZONE_ENTERED`;
        if (this.tryEmit(dedupeKey, timestamp)) {
          results.push({
            instrument,
            levelLabel: "Premium Zone",
            levelPrice: pdState.top,
            marketPrice: currentPrice,
            timeframe: level.timeframe,
            event: "ZONE_ENTERED",
            timestamp,
          });
        }
      }

      if (level.type === "DISCOUNT" && isInDiscount) {
        const dedupeKey = `${instrument}-discount-ZONE_ENTERED`;
        if (this.tryEmit(dedupeKey, timestamp)) {
          results.push({
            instrument,
            levelLabel: "Discount Zone",
            levelPrice: pdState.bottom,
            marketPrice: currentPrice,
            timeframe: level.timeframe,
            event: "ZONE_ENTERED",
            timestamp,
          });
        }
      }
    } else {
      // Horizontal liquidity level: EQH, EQL, PWH, PWL, SWH, SWL
      const key = `${instrument}-${level.id}`;
      const currentState = this.levelTouchStateMap.get(key) ?? "armed";
      const isResistance = level.type === "EQH" || level.type === "PWH" || level.type === "SWH";
      const levelPrice = level.price;

      if (isResistance) {
        // Resistance semantics: previousPrice < levelPrice AND currentPrice >= levelPrice
        const isTouchFromBelow = previousPrice !== null ? (previousPrice < levelPrice && currentPrice >= levelPrice) : false;
        const isExactStart = (previousPrice === null || previousPrice === levelPrice) && currentPrice >= levelPrice;
        const isTouched = isTouchFromBelow || isExactStart;

        if (currentState === "armed" && isTouched) {
          this.levelTouchStateMap.set(key, "triggered");

          const typeDisplay = getLevelTypeDisplay(level);
          const alertMessage = formatLevelTouchedTelegramMessage(
            instrument,
            levelPrice,
            typeDisplay,
            currentPrice,
            timestamp
          );

          // Structured Debug Logging
          console.log(
            `[PINE-TOUCH]\ninstrument=${instrument}\nlevelType=${typeDisplay}\nlevelPrice=${levelPrice.toFixed(2)}\npreviousPrice=${previousPrice !== null ? previousPrice.toFixed(2) : "null"}\ncurrentPrice=${currentPrice.toFixed(2)}\nevent=LEVEL_TOUCHED`
          );

          // Dispatch Telegram notification immediately
          sendTelegramMessage(alertMessage).then((res) => {
            console.log(`[PINE-TOUCH]\ntelegram sent=${res.sent}`);
          }).catch((err) => {
            console.error(`[PINE-TOUCH]\ntelegram sent=false`, err);
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
          // Re-arm when price moves clearly below resistance level
          this.levelTouchStateMap.set(key, "armed");
        }
      } else {
        // Support semantics: previousPrice > levelPrice AND currentPrice <= levelPrice
        const isTouchFromAbove = previousPrice !== null ? (previousPrice > levelPrice && currentPrice <= levelPrice) : false;
        const isExactStart = (previousPrice === null || previousPrice === levelPrice) && currentPrice <= levelPrice;
        const isTouched = isTouchFromAbove || isExactStart;

        if (currentState === "armed" && isTouched) {
          this.levelTouchStateMap.set(key, "triggered");

          const typeDisplay = getLevelTypeDisplay(level);
          const alertMessage = formatLevelTouchedTelegramMessage(
            instrument,
            levelPrice,
            typeDisplay,
            currentPrice,
            timestamp
          );

          // Structured Debug Logging
          console.log(
            `[PINE-TOUCH]\ninstrument=${instrument}\nlevelType=${typeDisplay}\nlevelPrice=${levelPrice.toFixed(2)}\npreviousPrice=${previousPrice !== null ? previousPrice.toFixed(2) : "null"}\ncurrentPrice=${currentPrice.toFixed(2)}\nevent=LEVEL_TOUCHED`
          );

          // Dispatch Telegram notification immediately
          sendTelegramMessage(alertMessage).then((res) => {
            console.log(`[PINE-TOUCH]\ntelegram sent=${res.sent}`);
          }).catch((err) => {
            console.error(`[PINE-TOUCH]\ntelegram sent=false`, err);
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
          // Re-arm when price moves clearly above support level
          this.levelTouchStateMap.set(key, "armed");
        }
      }
    }

    return results;
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
