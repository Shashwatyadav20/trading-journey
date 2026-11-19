export type VerificationStatus = "VERIFIED" | "UNVERIFIED" | "MISSING" | "STALE" | "CONFLICTED";

export interface Strategy03EvidenceContract {
  sourceName: string;
  sourceUrlOrFilingId: string;
  reportingPeriod: string;
  publishedAt: string | null;
  retrievedAt: string;
  verificationStatus: VerificationStatus;
  confidence: number;
  hasSourceConflict: boolean;
}

export function isTimestampStale(
  publishedAt: string | null,
  maxAgeDays: number,
  nowMs: number = Date.now()
): boolean {
  if (!publishedAt) return true;
  const pubMs = Date.parse(publishedAt);
  if (!Number.isFinite(pubMs)) return true;
  const ageDays = (nowMs - pubMs) / (1000 * 60 * 60 * 24);
  return ageDays > maxAgeDays;
}

export async function fetchWithBackoff(
  url: string,
  init: RequestInit = {},
  options?: { maxRetries?: number; baseDelayMs?: number; timeoutMs?: number }
): Promise<Response> {
  const maxRetries = options?.maxRetries ?? 2;
  const baseDelayMs = options?.baseDelayMs ?? 400;
  const timeoutMs = options?.timeoutMs ?? 8000;

  let lastError: unknown = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 429 || res.status >= 500) {
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, baseDelayMs * Math.pow(2, attempt)));
          continue;
        }
      }
      return res;
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, baseDelayMs * Math.pow(2, attempt)));
        continue;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Network request failed after retries");
}

