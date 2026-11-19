import { sanitizeUntrustedText } from "../evidence/EvidenceSchema";

export class ConversationValidationError extends Error {
  public readonly statusCode = 400;
  public readonly code = "CONVERSATION_VALIDATION_ERROR";

  public constructor(message: string) {
    super(message);
    this.name = "ConversationValidationError";
  }
}

export class ConversationNotFoundError extends Error {
  public readonly statusCode = 404;
  public readonly code = "CONVERSATION_NOT_FOUND";

  public constructor(message: string) {
    super(message);
    this.name = "ConversationNotFoundError";
  }
}

export class ConversationForbiddenError extends Error {
  public readonly statusCode = 403;
  public readonly code = "CONVERSATION_FORBIDDEN";

  public constructor(message: string) {
    super(message);
    this.name = "ConversationForbiddenError";
  }
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateConversationId(id: unknown): string {
  if (typeof id !== "string" || !UUID_REGEX.test(id.trim())) {
    throw new ConversationValidationError(
      "Invalid conversation ID format (expected UUID)."
    );
  }
  return id.trim();
}

export function validatePagination(query: Record<string, unknown>): {
  limit: number;
  offset: number;
} {
  const rawLimit = query.limit !== undefined ? Number(query.limit) : 20;
  const rawOffset = query.offset !== undefined ? Number(query.offset) : 0;

  if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 100) {
    throw new ConversationValidationError(
      "Pagination limit must be an integer between 1 and 100."
    );
  }
  if (!Number.isInteger(rawOffset) || rawOffset < 0) {
    throw new ConversationValidationError(
      "Pagination offset must be a non-negative integer."
    );
  }

  return { limit: rawLimit, offset: rawOffset };
}

export function validateConversationTitle(rawTitle: unknown): string {
  if (typeof rawTitle !== "string" || rawTitle.trim().length === 0) {
    return "New AI Research Session";
  }
  return sanitizeUntrustedText(rawTitle).slice(0, 120) || "New AI Research Session";
}

export interface AIConversationRecord {
  id: string;
  userId: string;
  title: string;
  lastIntent: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AIMessageRecord {
  id: string;
  conversationId: string;
  userId: string;
  role: "user" | "assistant";
  content: string;
  structuredResponse: Record<string, unknown> | null;
  agentExecutions: Array<Record<string, unknown>> | null;
  unifiedContext?: Record<string, unknown> | null;
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  } | null;
  createdAt: string;
}

