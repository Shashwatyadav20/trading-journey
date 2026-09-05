import { Position } from "./types";
import { tradingEventBus } from "../websocket/trading";

export class PositionStore {
  private positions: Map<string, Position> = new Map();

  add(position: Position): void {
    const isNew = !this.positions.has(position.id);
    this.positions.set(position.id, position);
    if (isNew) {
      tradingEventBus.emit("positionCreated", position);
    }
  }

  get(id: string): Position | undefined {
    return this.positions.get(id);
  }

  getByUser(userId: string): Position[] {
    return Array.from(this.positions.values()).filter(p => p.userId === userId);
  }

  getAllOpen(): Position[] {
    return Array.from(this.positions.values()).filter(p => p.status === "OPEN");
  }

  remove(id: string): void {
    this.positions.delete(id);
  }

  update(position: Position): void {
    this.positions.set(position.id, position);
    tradingEventBus.emit("positionUpdated", position);
  }

  /**
   * Transitions a position to CLOSING if it is currently OPEN.
   * This provides atomic protection against duplicate closes.
   * Returns false if the position cannot be closed.
   */
  tryTransitionToClosing(id: string): boolean {
    const position = this.positions.get(id);
    if (!position) return false;
    
    if (position.status !== "OPEN") {
      return false; // Already closing or closed
    }

    position.status = "CLOSING";
    position.updatedAt = new Date().toISOString();
    return true;
  }

  finishClose(position: Position): void {
    position.status = "CLOSED";
    position.updatedAt = new Date().toISOString();
    this.positions.set(position.id, position);
    tradingEventBus.emit("positionClosed", position);
  }
  
  /**
   * Restores a position from the database during startup recovery.
   * Unlike add(), this method:
   *   - Preserves the existing database ID (no new UUID generated)
   *   - Does NOT emit any trading events (recovery is silent)
   *   - Is idempotent: skips if the ID already exists in the store
   */
  restore(position: Position): void {
    if (!this.positions.has(position.id)) {
      this.positions.set(position.id, position);
      // Intentionally no tradingEventBus.emit — recovery is silent
    }
  }

  // For testing purposes
  clear(): void {
    this.positions.clear();
  }
}

export const positionStore = new PositionStore();
