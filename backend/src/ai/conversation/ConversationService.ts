import crypto from "node:crypto";
import {
  getAdminSupabaseClient,
  isSupabaseConfigured,
} from "../../db/supabaseClient";
import {
  AIConversationRecord,
  AIMessageRecord,
  ConversationForbiddenError,
  ConversationNotFoundError,
  validateConversationId,
  validateConversationTitle,
} from "./ConversationSchema";
import { normalizeEvidenceSymbol } from "../evidence/EvidenceSchema";
import { UnifiedIntelligenceContext } from "../context/UnifiedContextSchema";

export interface ConversationServiceOptions {
  forceInMemory?: boolean;
  supabaseClient?: any;
}

function deterministicUuid(seed: string): string {
  const hex = crypto.createHash("sha256").update(seed).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class ConversationService {
  private readonly forceInMemory: boolean;
  private readonly supabaseOverride?: any;
  private readonly conversations = new Map<string, AIConversationRecord>();
  private readonly messages = new Map<string, AIMessageRecord[]>();
  private readonly standaloneContexts = new Map<string, UnifiedIntelligenceContext[]>();

  public constructor(options: ConversationServiceOptions = {}) {
    this.forceInMemory = options.forceInMemory ?? false;
    this.supabaseOverride = options.supabaseClient;
  }

  private useSupabase(): boolean {
    if (this.forceInMemory) return false;
    return Boolean(this.supabaseOverride) || isSupabaseConfigured();
  }

  private getSupabase(): any {
    return this.supabaseOverride ?? getAdminSupabaseClient();
  }

  public async createConversation(
    userId: string,
    title?: string,
    lastIntent: string | null = null
  ): Promise<AIConversationRecord> {
    const now = new Date().toISOString();
    const record: AIConversationRecord = {
      id: crypto.randomUUID(),
      userId,
      title: validateConversationTitle(title),
      lastIntent,
      createdAt: now,
      updatedAt: now,
    };

    if (this.useSupabase()) {
      const supabase: any = this.getSupabase();
      const { data, error } = await supabase
        .from("ai_conversations")
        .insert({
          id: record.id,
          user_id: record.userId,
          title: record.title,
          last_intent: record.lastIntent,
          created_at: record.createdAt,
          updated_at: record.updatedAt,
        })
        .select("*")
        .single();
      if (error) {
        throw new Error(`Failed to create AI conversation: ${error.message}`);
      }
      return mapConversationRow(data);
    }

    this.conversations.set(record.id, record);
    this.messages.set(record.id, []);
    return record;
  }

  public async listConversations(
    userId: string,
    pagination: { limit: number; offset: number }
  ): Promise<{ conversations: AIConversationRecord[]; total: number }> {
    if (this.useSupabase()) {
      const supabase: any = this.getSupabase();
      const { data, error, count } = await supabase
        .from("ai_conversations")
        .select("*", { count: "exact" })
        .eq("user_id", userId)
        .or("last_intent.is.null,last_intent.neq.STANDALONE_TERMINAL_CONTEXT")
        .order("updated_at", { ascending: false })
        .range(pagination.offset, pagination.offset + pagination.limit - 1);
      if (error) {
        throw new Error(`Failed to list AI conversations: ${error.message}`);
      }
      return {
        conversations: (data ?? []).map(mapConversationRow),
        total: typeof count === "number" ? count : (data ?? []).length,
      };
    }

    const userConvs = Array.from(this.conversations.values())
      .filter((c) => c.userId === userId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return {
      conversations: userConvs.slice(
        pagination.offset,
        pagination.offset + pagination.limit
      ),
      total: userConvs.length,
    };
  }

  public async getConversation(
    userId: string,
    conversationId: string,
    messagePagination: { limit: number; offset: number } = {
      limit: 50,
      offset: 0,
    }
  ): Promise<{
    conversation: AIConversationRecord;
    messages: AIMessageRecord[];
    totalMessages: number;
  }> {
    const validId = validateConversationId(conversationId);
    const conv = await this.requireOwnedConversation(userId, validId);

    if (this.useSupabase()) {
      const supabase: any = this.getSupabase();
      const { data, error, count } = await supabase
        .from("ai_messages")
        .select("*", { count: "exact" })
        .eq("conversation_id", validId)
        .eq("user_id", userId)
        .order("created_at", { ascending: true })
        .range(
          messagePagination.offset,
          messagePagination.offset + messagePagination.limit - 1
        );
      if (error) {
        throw new Error(`Failed to load conversation messages: ${error.message}`);
      }
      return {
        conversation: conv,
        messages: (data ?? []).map(mapMessageRow),
        totalMessages: typeof count === "number" ? count : (data ?? []).length,
      };
    }

    const allMsgs = this.messages.get(validId) ?? [];
    return {
      conversation: conv,
      messages: allMsgs.slice(
        messagePagination.offset,
        messagePagination.offset + messagePagination.limit
      ),
      totalMessages: allMsgs.length,
    };
  }

  public async appendMessage(
    userId: string,
    conversationId: string,
    params: {
      role: "user" | "assistant";
      content: string;
      structuredResponse?: Record<string, unknown> | null;
      agentExecutions?: Array<Record<string, unknown>> | null;
      unifiedContext?: Record<string, unknown> | null;
      tokenUsage?: AIMessageRecord["tokenUsage"];
      lastIntent?: string | null;
    }
  ): Promise<AIMessageRecord> {
    const validId = validateConversationId(conversationId);
    const conv = await this.requireOwnedConversation(userId, validId);
    const now = new Date().toISOString();

    const structuredWithContext =
      params.structuredResponse && params.unifiedContext
        ? {
            ...params.structuredResponse,
            unifiedContext: params.unifiedContext,
          }
        : params.structuredResponse ?? null;

    const msg: AIMessageRecord = {
      id: crypto.randomUUID(),
      conversationId: validId,
      userId,
      role: params.role,
      content: params.content,
      structuredResponse: structuredWithContext,
      agentExecutions: params.agentExecutions ?? null,
      unifiedContext:
        params.unifiedContext ??
        ((structuredWithContext as Record<string, unknown> | null)
          ?.unifiedContext as Record<string, unknown> | undefined) ??
        null,
      tokenUsage: params.tokenUsage ?? null,
      createdAt: now,
    };

    if (this.useSupabase()) {
      const supabase: any = this.getSupabase();
      const { data, error } = await supabase
        .from("ai_messages")
        .insert({
          id: msg.id,
          conversation_id: msg.conversationId,
          user_id: msg.userId,
          role: msg.role,
          content: msg.content,
          structured_response: msg.structuredResponse,
          agent_executions: msg.agentExecutions,
          token_usage: msg.tokenUsage,
          created_at: msg.createdAt,
        })
        .select("*")
        .single();
      if (error) {
        throw new Error(`Failed to append AI message: ${error.message}`);
      }

      await supabase
        .from("ai_conversations")
        .update({
          updated_at: now,
          ...(params.lastIntent !== undefined
            ? { last_intent: params.lastIntent }
            : {}),
        })
        .eq("id", validId)
        .eq("user_id", userId);

      return mapMessageRow(data);
    }

    const list = this.messages.get(validId) ?? [];
    list.push(msg);
    this.messages.set(validId, list);
    conv.updatedAt = now;
    if (params.lastIntent !== undefined) {
      conv.lastIntent = params.lastIntent;
    }
    return msg;
  }

  public async deleteConversation(
    userId: string,
    conversationId: string
  ): Promise<void> {
    const validId = validateConversationId(conversationId);
    await this.requireOwnedConversation(userId, validId);

    if (this.useSupabase()) {
      const supabase: any = this.getSupabase();
      const { error } = await supabase
        .from("ai_conversations")
        .delete()
        .eq("id", validId)
        .eq("user_id", userId);
      if (error) {
        throw new Error(`Failed to delete AI conversation: ${error.message}`);
      }
      return;
    }

    this.conversations.delete(validId);
    this.messages.delete(validId);
  }

  private async requireOwnedConversation(
    userId: string,
    conversationId: string
  ): Promise<AIConversationRecord> {
    if (this.useSupabase()) {
      const supabase: any = this.getSupabase();
      const { data, error } = await supabase
        .from("ai_conversations")
        .select("*")
        .eq("id", conversationId)
        .maybeSingle();
      if (error) {
        throw new Error(`Failed to fetch conversation: ${error.message}`);
      }
      if (!data) {
        throw new ConversationNotFoundError("Conversation not found.");
      }
      const mapped = mapConversationRow(data);
      if (mapped.userId !== userId) {
        throw new ConversationForbiddenError(
          "You do not have access to this conversation."
        );
      }
      return mapped;
    }

    const conv = this.conversations.get(conversationId);
    if (!conv) {
      throw new ConversationNotFoundError("Conversation not found.");
    }
    if (conv.userId !== userId) {
      throw new ConversationForbiddenError(
        "You do not have access to this conversation."
      );
    }
    return conv;
  }

  public async recordUnifiedContext(
    userId: string,
    context: UnifiedIntelligenceContext
  ): Promise<void> {
    if (!userId || !context || context.userId !== userId) return;
    const existing = this.standaloneContexts.get(userId) ?? [];
    if (!existing.some((c) => c.contextId === context.contextId)) {
      existing.push(context);
      this.standaloneContexts.set(userId, existing);
    }

    if (!this.useSupabase()) {
      return;
    }

    const supabase: any = this.getSupabase();
    const anchorConversationId = deterministicUuid(`standalone_terminal:${userId}`);
    const messageId = UUID_REGEX.test(context.contextId)
      ? context.contextId
      : deterministicUuid(`standalone_ctx:${userId}:${context.contextId}`);
    const now = context.createdAt || new Date().toISOString();

    const { error: convErr } = await supabase
      .from("ai_conversations")
      .upsert(
        {
          id: anchorConversationId,
          user_id: userId,
          title: "Institutional Research Terminal",
          last_intent: "STANDALONE_TERMINAL_CONTEXT",
          created_at: now,
          updated_at: now,
        },
        { onConflict: "id", ignoreDuplicates: false }
      );
    if (convErr) {
      throw new Error(
        `Failed to persist standalone terminal conversation anchor: ${convErr.message}`
      );
    }

    const { error: msgErr } = await supabase
      .from("ai_messages")
      .upsert(
        {
          id: messageId,
          conversation_id: anchorConversationId,
          user_id: userId,
          role: "assistant",
          content: `Institutional Research Context: ${context.symbol}`,
          structured_response: {
            standaloneTerminal: true,
            symbol: context.symbol,
            contextId: context.contextId,
            unifiedContext: context,
          },
          agent_executions: context.agentExecutions ?? null,
          token_usage: null,
          created_at: now,
        },
        { onConflict: "id", ignoreDuplicates: true }
      );
    if (msgErr) {
      throw new Error(
        `Failed to persist standalone research context: ${msgErr.message}`
      );
    }
  }

  public async findPreviousUnifiedContexts(
    userId: string,
    symbol: string,
    excludeContextId?: string
  ): Promise<UnifiedIntelligenceContext[]> {
    const normSymbol = normalizeEvidenceSymbol(symbol);
    if (!normSymbol) return [];

    const seenIds = new Set<string>();
    const results: UnifiedIntelligenceContext[] = [];
    const addIfValid = (ctx: UnifiedIntelligenceContext | undefined) => {
      if (
        ctx &&
        ctx.userId === userId &&
        ctx.symbol === normSymbol &&
        (!excludeContextId || ctx.contextId !== excludeContextId) &&
        !seenIds.has(ctx.contextId)
      ) {
        seenIds.add(ctx.contextId);
        results.push(ctx);
      }
    };

    for (const st of this.standaloneContexts.get(userId) ?? []) {
      addIfValid(st);
    }

    if (this.useSupabase()) {
      try {
        const supabase: any = this.getSupabase();
        const { data, error } = await supabase
          .from("ai_messages")
          .select("structured_response, created_at")
          .eq("user_id", userId)
          .eq("role", "assistant")
          .order("created_at", { ascending: false })
          .limit(30);
        if (!error && Array.isArray(data)) {
          for (const row of data) {
            const ctx = row?.structured_response?.unifiedContext as
              | UnifiedIntelligenceContext
              | undefined;
            addIfValid(ctx);
          }
        }
      } catch {
        // fall through to return collected contexts
      }
      return results.sort(
        (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)
      );
    }

    const userConvIds = new Set(
      Array.from(this.conversations.values())
        .filter((c) => c.userId === userId)
        .map((c) => c.id)
    );
    for (const [convId, msgs] of this.messages.entries()) {
      if (!userConvIds.has(convId)) continue;
      for (const m of msgs) {
        if (m.role !== "assistant") continue;
        const ctx = (m.unifiedContext ??
          (m.structuredResponse as any)?.unifiedContext) as
          | UnifiedIntelligenceContext
          | undefined;
        addIfValid(ctx);
      }
    }
    return results.sort(
      (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)
    );
  }

  public async listUserUnifiedContexts(
    userId: string,
    options?: { symbol?: string | null; limit?: number; offset?: number }
  ): Promise<{ contexts: UnifiedIntelligenceContext[]; total: number }> {
    const filterSymbol =
      options?.symbol && options.symbol.trim()
        ? normalizeEvidenceSymbol(options.symbol.trim())
        : null;
    const limit = Math.max(1, Math.min(options?.limit ?? 20, 1000));
    const offset = Math.max(0, options?.offset ?? 0);

    const seenIds = new Set<string>();
    const allContexts: UnifiedIntelligenceContext[] = [];
    const addIfValid = (ctx: UnifiedIntelligenceContext | undefined) => {
      if (
        ctx &&
        ctx.userId === userId &&
        (!filterSymbol || ctx.symbol === filterSymbol) &&
        !seenIds.has(ctx.contextId)
      ) {
        seenIds.add(ctx.contextId);
        allContexts.push(ctx);
      }
    };

    for (const st of this.standaloneContexts.get(userId) ?? []) {
      addIfValid(st);
    }

    if (this.useSupabase()) {
      try {
        const supabase: any = this.getSupabase();
        const batchSize = 200;
        const maxScan = 2000;
        for (let scanOffset = 0; scanOffset < maxScan; scanOffset += batchSize) {
          const { data, error } = await supabase
            .from("ai_messages")
            .select("structured_response, created_at")
            .eq("user_id", userId)
            .eq("role", "assistant")
            .order("created_at", { ascending: false })
            .range(scanOffset, scanOffset + batchSize - 1);
          if (error || !Array.isArray(data) || data.length === 0) {
            break;
          }
          for (const row of data) {
            const ctx = row?.structured_response?.unifiedContext as
              | UnifiedIntelligenceContext
              | undefined;
            addIfValid(ctx);
          }
          if (data.length < batchSize) {
            break;
          }
        }
      } catch {
        // ignore Supabase read error and return in-memory contexts
      }
    } else {
      const userConvIds = new Set(
        Array.from(this.conversations.values())
          .filter((c) => c.userId === userId)
          .map((c) => c.id)
      );
      for (const [convId, msgs] of this.messages.entries()) {
        if (!userConvIds.has(convId)) continue;
        for (const m of msgs) {
          if (m.role !== "assistant") continue;
          const ctx = (m.unifiedContext ??
            (m.structuredResponse as any)?.unifiedContext) as
            | UnifiedIntelligenceContext
            | undefined;
          addIfValid(ctx);
        }
      }
    }

    allContexts.sort(
      (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)
    );
    return {
      contexts: allContexts.slice(offset, offset + limit),
      total: allContexts.length,
    };
  }

  public clearMemoryForTesting(): void {
    this.conversations.clear();
    this.messages.clear();
    this.standaloneContexts.clear();
  }
}

function mapConversationRow(row: any): AIConversationRecord {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    title: String(row.title),
    lastIntent: row.last_intent ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapMessageRow(row: any): AIMessageRecord {
  const structured = row.structured_response ?? null;
  const unifiedContext =
    structured && typeof structured === "object" && "unifiedContext" in structured
      ? (structured.unifiedContext as Record<string, unknown> | null)
      : null;
  return {
    id: String(row.id),
    conversationId: String(row.conversation_id),
    userId: String(row.user_id),
    role: row.role === "assistant" ? "assistant" : "user",
    content: String(row.content),
    structuredResponse: structured,
    agentExecutions: row.agent_executions ?? null,
    unifiedContext,
    tokenUsage: row.token_usage ?? null,
    createdAt: String(row.created_at),
  };
}

export const conversationService = new ConversationService();

