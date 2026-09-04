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
 * Returns the singleton admin Supabase client.
 * Only call this from backend (Node.js) code.
 */
export function getAdminSupabaseClient(): ReturnType<typeof createClient> {
  if (!_adminClient) {
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
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
