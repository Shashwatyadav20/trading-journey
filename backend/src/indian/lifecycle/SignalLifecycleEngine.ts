import { LifecycleState } from "../types";
import { auditLogger } from "../audit/AuditLogger";

export interface StateTransitionEvent {
  id: string;
  timestamp: string;
  fromState: LifecycleState;
  toState: LifecycleState;
  reason: string;
  success: boolean;
  metadata?: Record<string, any>;
}

const VALID_TRANSITIONS: Record<LifecycleState, LifecycleState[]> = {
  WAITING_FOR_DATA: ["DATA_READY", "ERROR"],
  DATA_READY: ["ANALYZING", "NO_TRADE", "ERROR", "CLOSED"],
  ANALYZING: ["SETUP_READY", "NO_TRADE", "ERROR", "CLOSED"],
  SETUP_READY: ["RISK_CHECK", "APPROVED", "NO_TRADE", "BLOCKED", "ERROR", "CLOSED"],
  RISK_CHECK: ["APPROVED", "NO_TRADE", "BLOCKED", "ERROR", "CLOSED"],
  APPROVED: ["PAPER_ENTRY", "BLOCKED", "ERROR", "CLOSED"],
  PAPER_ENTRY: ["POSITION_OPEN", "ERROR", "CLOSED"],
  POSITION_OPEN: ["MONITORING", "EXIT_TRIGGERED", "CLOSING", "CLOSED", "ERROR"],
  MONITORING: ["EXIT_TRIGGERED", "CLOSING", "CLOSED", "ERROR"],
  EXIT_TRIGGERED: ["CLOSING", "CLOSED", "ERROR"],
  CLOSING: ["CLOSED", "ERROR"],
  CLOSED: [], // Terminal state
  NO_TRADE: ["WAITING_FOR_DATA", "DATA_READY"],
  BLOCKED: ["WAITING_FOR_DATA", "DATA_READY"],
  ERROR: ["WAITING_FOR_DATA"],
};


export class SignalLifecycleEngine {
  private currentState: LifecycleState = "WAITING_FOR_DATA";
  private transitionHistory: StateTransitionEvent[] = [];
  private maxHistoryLength = 100;

  public getCurrentState(): LifecycleState {
    return this.currentState;
  }

  public getHistory(): StateTransitionEvent[] {
    return this.getTransitionHistory();
  }

  public transitionTo(
    nextState: LifecycleState,
    reason: string,
    metadata?: Record<string, any>
  ): StateTransitionEvent {
    const fromState = this.currentState;
    const timestamp = new Date().toISOString();
    const eventId = `tx_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    // Validate Transition Rules
    const allowed = VALID_TRANSITIONS[fromState] || [];
    const isAllowed = allowed.includes(nextState) || fromState === nextState;

    if (!isAllowed) {
      const failedEvent: StateTransitionEvent = {
        id: eventId,
        timestamp,
        fromState,
        toState: nextState,
        reason: `INVALID TRANSITION REJECTED: ${fromState} -> ${nextState}. Reason: ${reason}`,
        success: false,
        metadata,
      };

      this.transitionHistory.unshift(failedEvent);
      auditLogger.log("SIGNAL_LIFECYCLE_TRANSITION_REJECTED", eventId, {
        fromState,
        toState: nextState,
        reason,
        ...metadata,
      });

      return failedEvent;
    }

    this.currentState = nextState;

    const event: StateTransitionEvent = {
      id: eventId,
      timestamp,
      fromState,
      toState: nextState,
      reason,
      success: true,
      metadata,
    };

    this.transitionHistory.unshift(event);
    if (this.transitionHistory.length > this.maxHistoryLength) {
      this.transitionHistory = this.transitionHistory.slice(0, this.maxHistoryLength);
    }

    auditLogger.log("SIGNAL_LIFECYCLE_TRANSITION", eventId, {
      fromState,
      toState: nextState,
      reason,
      ...metadata,
    });

    return event;
  }

  public getTransitionHistory(limit = 20): StateTransitionEvent[] {
    return this.transitionHistory.slice(0, limit);
  }

  public resetState() {
    this.currentState = "WAITING_FOR_DATA";
    this.transitionHistory = [];
  }
}

export const signalLifecycleEngine = new SignalLifecycleEngine();

