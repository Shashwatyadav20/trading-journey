import { PendingOrder } from "./types";
import { tradingEventBus } from "../websocket/trading";

export class PendingOrderStore {
  private orders: Map<string, PendingOrder> = new Map();

  add(order: PendingOrder): void {
    this.orders.set(order.id, order);
    tradingEventBus.emit("pendingOrderCreated", order);
  }

  get(id: string): PendingOrder | undefined {
    return this.orders.get(id);
  }

  getByUser(userId: string): PendingOrder[] {
    return Array.from(this.orders.values()).filter(o => o.userId === userId);
  }

  getAllPending(): PendingOrder[] {
    return Array.from(this.orders.values()).filter(o => o.status === "PENDING");
  }

  update(order: PendingOrder): void {
    this.orders.set(order.id, order);
    tradingEventBus.emit("pendingOrderUpdated", order);
  }

  tryTransitionToFilled(id: string): boolean {
    const order = this.orders.get(id);
    if (!order) return false;
    
    if (order.status !== "PENDING") {
      return false;
    }

    order.status = "FILLED";
    order.updatedAt = new Date().toISOString();
    return true;
  }

  finishFill(order: PendingOrder, positionId: string): void {
    order.filledAt = new Date().toISOString();
    order.positionId = positionId;
    this.orders.set(order.id, order);
    tradingEventBus.emit("pendingOrderFilled", order);
  }

  tryTransitionToCancelled(id: string): boolean {
    const order = this.orders.get(id);
    if (!order) return false;
    
    if (order.status !== "PENDING") {
      return false;
    }

    order.status = "CANCELLED";
    order.updatedAt = new Date().toISOString();
    this.orders.set(order.id, order);
    tradingEventBus.emit("pendingOrderCancelled", order);
    return true;
  }
  
  /**
   * Restores a pending order from the database during startup recovery.
   * Unlike add(), this method:
   *   - Preserves the existing database ID (no new UUID generated)
   *   - Does NOT emit any trading events (recovery is silent)
   *   - Is idempotent: skips if the ID already exists in the store
   */
  restore(order: PendingOrder): void {
    if (!this.orders.has(order.id)) {
      this.orders.set(order.id, order);
      // Intentionally no tradingEventBus.emit — recovery is silent
    }
  }

  clear(): void {
    this.orders.clear();
  }
}

export const pendingOrderStore = new PendingOrderStore();
