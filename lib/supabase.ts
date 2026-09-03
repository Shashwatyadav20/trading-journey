import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error(
    'Missing Supabase environment variables. ' +
    'Ensure NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are set in .env.local'
  );
}

/**
 * Browser-safe Supabase client.
 * Uses only public/publishable credentials — safe to use in client components.
 * Import this singleton throughout the application instead of creating new clients.
 */
export const supabase = createClient(supabaseUrl, supabasePublishableKey);
