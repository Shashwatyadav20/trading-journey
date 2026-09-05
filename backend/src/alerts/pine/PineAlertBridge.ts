import { PineLiquidityEngine } from "./PineLiquidityEngine";
import { PineAlertEvent, ActiveLevel } from "./PineTypes";

/**
 * PineAlertBridge
 * ===============
 * Observes live price ticks and compares against active Pine levels produced by
 * PineLiquidityEngine. This class is a READ-ONLY observer — it NEVER mutates
 * any internal state of the engine.
 *
 * ─── Alert Semantics ─────────────────────────────────────────────────────────
 *
 * LEVEL_TOUCHED (EQH, EQL, PWH, PWL, SWH, SWL):
 *   Emitted when the live market price is within 0.05% of the level price.
 *
 * ZONE_ENTERED (PREMIUM or DISCOUNT):
 *   Pine's P/D zone occupies [pdZoneBot, pdZoneTop].
 *   The equilibrium midpoint pdEq = (pdZoneTop + pdZoneBot) / 2 divides it into:
 *     Premium sub-zone:  pdEq  <= price <= pdZoneTop
 *     Discount sub-zone: pdZoneBot <= price <= pdEq
 *
 *   ZONE_ENTERED fires when price transitions FROM outside the zone INTO either
 *   sub-zone. The event label explicitly reports "Premium Zone" or "Discount Zone"
 *   to preserve the distinction.
 *
 *   A separate dedup key is used per sub-zone so a price moving from Discount
 *   to Premium (or vice versa) triggers a fresh ZONE_ENTERED event.
 *
 * EQUILIBRIUM_TOUCHED (EQUILIBRIUM):
 *   Emitted when the live market price is within 0.05% of the 50% equilibrium
 *   line. This does NOT require a directional crossing — it fires whenever
 *   the price is within proximity. A 60-second dedup window prevents spam.
 *   (A directional crossing cannot be reliably detected from a single tick
 *   without maintaining the previous tick price, which would mutate bridge
 *   state unrelated to Pine analytical state.)
 */
export class PineAlertBridge {
  private engineMap: Map<string, PineLiquidityEngine> = new Map();
  private alertedLevelMap: Map<string, number> = new Map(); // dedup key → last alerted ts
  private onAlertCallback: ((alert: PineAlertEvent) => void) | null = null;

  constructor() {}

  public registerEngine(instrument: string, engine: PineLiquidityEngine): void {
    this.engineMap.set(instrument, engine);
  }

  public onAlert(callback: (alert: PineAlertEvent) => void): void {
    this.onAlertCallback = callback;
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
    const generatedAlerts: PineAlertEvent[] = [];

    for (const level of activeLevels) {
      const alertsForLevel = this.evaluateLevel(
        instrument,
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

    return generatedAlerts;
  }

  private evaluateLevel(
    instrument: string,
    currentPrice: number,
    timestamp: string,
    level: ActiveLevel,
    pdState: ReturnType<PineLiquidityEngine["getPDZoneState"]>
  ): PineAlertEvent[] {
    const results: PineAlertEvent[] = [];

    if (level.type === "EQUILIBRIUM") {
      // EQUILIBRIUM_TOUCHED: within 0.05% of the equilibrium line
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
      // ZONE_ENTERED: price must be inside the zone, and the sub-zone label is preserved.
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
      const tol = level.price * 0.0005; // 0.05% proximity
      if (Math.abs(currentPrice - level.price) <= tol) {
        const dedupeKey = `${instrument}-${level.id}-LEVEL_TOUCHED`;
        if (this.tryEmit(dedupeKey, timestamp)) {
          results.push({
            instrument,
            levelLabel: level.label,
            levelPrice: level.price,
            marketPrice: currentPrice,
            timeframe: level.timeframe,
            event: "LEVEL_TOUCHED",
            timestamp,
          });
        }
      }
    }

    return results;
  }

  /**
   * Returns true and records the timestamp if the dedup window (60 seconds)
   * has expired for this key. Returns false without side-effects if within window.
   */
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
