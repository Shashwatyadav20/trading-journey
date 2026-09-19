import { NiftySpreadPosition, DailyRiskState, PaperSessionRecord } from "../types";
import { PaperJournalEntry } from "../audit/PaperJournalStore";
import { SignalAuditEntry } from "../audit/SignalAuditStore";

export interface SystemPersistedState {
  version: string;
  lastUpdated: string;
  dailyRisk: DailyRiskState | null;
  sessions: PaperSessionRecord[];
  openPositions: NiftySpreadPosition[];
  closedPositions: NiftySpreadPosition[];
  journalEntries: PaperJournalEntry[];
  auditLogs: SignalAuditEntry[];
}

export class PaperPersistenceManager {
  private inMemoryStore: Map<string, any> = new Map();
  private version = "1.0.0-PHASE13";

  constructor() {
    this.inMemoryStore.set("version", this.version);
  }

  public saveItem<T>(key: string, value: T): void {
    const serialized = JSON.stringify(value);
    this.inMemoryStore.set(key, serialized);
  }

  public getItem<T>(key: string): T | null {
    const raw = this.inMemoryStore.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  public persistDailyRisk(riskState: DailyRiskState): void {
    this.saveItem("daily_risk", riskState);
  }

  public loadDailyRisk(): DailyRiskState | null {
    return this.getItem<DailyRiskState>("daily_risk");
  }

  public persistPositions(openPositions: NiftySpreadPosition[], closedPositions: NiftySpreadPosition[]): void {
    this.saveItem("open_positions", openPositions);
    this.saveItem("closed_positions", closedPositions);
  }

  public loadOpenPositions(): NiftySpreadPosition[] {
    return this.getItem<NiftySpreadPosition[]>("open_positions") || [];
  }

  public loadClosedPositions(): NiftySpreadPosition[] {
    return this.getItem<NiftySpreadPosition[]>("closed_positions") || [];
  }

  public persistSessions(sessions: PaperSessionRecord[]): void {
    this.saveItem("paper_sessions", sessions);
  }

  public loadSessions(): PaperSessionRecord[] {
    return this.getItem<PaperSessionRecord[]>("paper_sessions") || [];
  }

  public getFullSnapshot(): SystemPersistedState {
    return {
      version: this.version,
      lastUpdated: new Date().toISOString(),
      dailyRisk: this.loadDailyRisk(),
      sessions: this.loadSessions(),
      openPositions: this.loadOpenPositions(),
      closedPositions: this.loadClosedPositions(),
      journalEntries: this.getItem<PaperJournalEntry[]>("journal_entries") || [],
      auditLogs: this.getItem<SignalAuditEntry[]>("audit_logs") || [],
    };
  }

  public clearAllData(): void {
    this.inMemoryStore.clear();
    this.inMemoryStore.set("version", this.version);
  }
}

export const paperPersistenceManager = new PaperPersistenceManager();
