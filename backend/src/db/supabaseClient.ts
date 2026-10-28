/**
 * Server-side Supabase admin client using the service-role key.
 *
 * SECURITY: This file is BACKEND-ONLY.
 * - The service-role key bypasses ALL Row Level Security.
 * - NEVER import this into frontend code.
 * - NEVER place SUPABASE_SERVICE_ROLE_KEY in NEXT_PUBLIC_* variables.
 * - NEVER log or return the key value.
 */
import { createClient } from "@supabase/supabase-js";
import { env } from "../config/env";

let _adminClient: ReturnType<typeof createClient> | null = null;

/**
 * TEST-ONLY override for isSupabaseConfigured().
 * Set to false to force in-memory mode in tests; null to restore real env-var check.
 * NEVER set this in production code.
 */
let _configuredOverride: boolean | null = null;

export function setSupabaseConfiguredOverride(override: boolean | null): void {
  _configuredOverride = override;
}

export function isSupabaseConfigured(): boolean {
  if (_configuredOverride !== null) {
    return _configuredOverride;
  }
  return Boolean(
    env.SUPABASE_URL &&
    env.SUPABASE_SERVICE_ROLE_KEY &&
    !env.SUPABASE_URL.includes("placeholder")
  );
}

/**
 * Returns the singleton admin Supabase client.
 * Only call this from backend (Node.js) code.
 */
export function getAdminSupabaseClient(): ReturnType<typeof createClient> {
  if (!_adminClient) {
    if (!isSupabaseConfigured()) {
      throw new Error(
        "[Supabase] SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set. " +
        "Copy backend/.env.example to backend/.env and fill in the values."
      );
    }

    _adminClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        // Disable session persistence — server-side clients don't need sessions
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  return _adminClient;
}

export function setAdminSupabaseClient(client: ReturnType<typeof createClient> | null): void {
  _adminClient = client;
}
