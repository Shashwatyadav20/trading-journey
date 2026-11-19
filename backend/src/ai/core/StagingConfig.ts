export interface AIStagingConfig {
  stagingMode: boolean;
  maxConcurrentRequests: number;
  maxAgentsPerRequest: number;
  maxProviderAttempts: number;
  cacheEnabled: boolean;
  usageTrackingEnabled: boolean;
}

function parseBoolEnv(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw.trim() === "") return fallback;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
  if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  return fallback;
}

function parseBoundedIntEnv(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw.trim());
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    return fallback;
  }
  return parsed;
}

/**
 * Reads application-level AI staging configuration from environment variables.
 * These are application safety/efficiency limits, not claims about provider quotas.
 */


export function getAIStagingConfig(): AIStagingConfig {
  const stagingMode = parseBoolEnv(process.env.AI_STAGING_MODE, false);

  const defaultConcurrent = stagingMode ? 1 : 2;
  const defaultMaxAgents = stagingMode ? 3 : 4;
  const defaultMaxAttempts = 2;

  return {
    stagingMode,
    maxConcurrentRequests: parseBoundedIntEnv(
      process.env.AI_STAGING_MAX_CONCURRENT_REQUESTS,
      defaultConcurrent,
      1,
      10
    ),
    maxAgentsPerRequest: parseBoundedIntEnv(
      process.env.AI_STAGING_MAX_AGENTS_PER_REQUEST,
      defaultMaxAgents,
      1,
      7
    ),
    maxProviderAttempts: parseBoundedIntEnv(
      process.env.AI_STAGING_MAX_PROVIDER_ATTEMPTS,
      defaultMaxAttempts,
      1,
      4
    ),
    cacheEnabled: parseBoolEnv(process.env.AI_STAGING_CACHE_ENABLED, true),
    usageTrackingEnabled: parseBoolEnv(process.env.AI_STAGING_USAGE_TRACKING, true),
  };
}

