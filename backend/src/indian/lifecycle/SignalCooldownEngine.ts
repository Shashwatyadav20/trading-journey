export interface CooldownState {
  isCoolingDown: boolean;
  remainingSeconds: number;
  lastSignalKey: string | null;
  lastSignalTimestamp: number | null;
}

export class SignalCooldownEngine {
  private cooldownMs: number;
  private lastSignalMap: Map<string, number> = new Map();

  constructor(cooldownSeconds = 300) {
    this.cooldownMs = cooldownSeconds * 1000;
  }

  public setCooldownSeconds(seconds: number) {
    this.cooldownMs = seconds * 1000;
  }

  /**
   * Checks whether a proposed strategy setup key is currently in cooldown.
   */
  public checkCooldown(signalKey: string): CooldownState {
    const lastTime = this.lastSignalMap.get(signalKey);
    if (!lastTime) {
      return {
        isCoolingDown: false,
        remainingSeconds: 0,
        lastSignalKey: null,
        lastSignalTimestamp: null,
      };
    }

    const elapsedMs = Date.now() - lastTime;
    if (elapsedMs < this.cooldownMs) {
      const remainingSeconds = Math.ceil((this.cooldownMs - elapsedMs) / 1000);
      return {
        isCoolingDown: true,
        remainingSeconds,
        lastSignalKey: signalKey,
        lastSignalTimestamp: lastTime,
      };
    }

    return {
      isCoolingDown: false,
      remainingSeconds: 0,
      lastSignalKey: signalKey,
      lastSignalTimestamp: lastTime,
    };
  }

  /**
   * Records a generated signal execution to start cooldown for that key.
   */
  public recordSignal(signalKey: string) {
    this.lastSignalMap.set(signalKey, Date.now());
  }

  public clearCooldowns() {
    this.lastSignalMap.clear();
  }

  public reset() {
    this.clearCooldowns();
  }

  public shouldAllowSignal(signal: any): { allow: boolean; reason?: string } {
    const key = `${signal.symbol}_${signal.action}`;
    const cd = this.checkCooldown(key);
    if (cd.isCoolingDown) {
      return {
        allow: false,
        reason: `COOLDOWN_ACTIVE: Signal key '${key}' is cooling down for ${cd.remainingSeconds}s`,
      };
    }
    return { allow: true };
  }

  public recordSignalExecution(signal: any) {
    const key = `${signal.symbol}_${signal.action}`;
    this.recordSignal(key);
  }
}

export const signalCooldownEngine = new SignalCooldownEngine();
