import { createClient } from '@supabase/supabase-js'
import { SUPABASE_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL } from './config.js'

const serviceClientOpts = {
  auth: { persistSession: false, autoRefreshToken: false },
}

export function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_KEY)
}

/**
 * Prefer for server routes after custom auth (Bearer / cookie): uses service role when set so RLS
 * does not block inserts. Fallback is anon — will fail under strict RLS.
 */
export function getSupabaseService() {
  const key =
    typeof SUPABASE_SERVICE_ROLE_KEY === 'string' &&
    SUPABASE_SERVICE_ROLE_KEY.length > 0
      ? SUPABASE_SERVICE_ROLE_KEY
      : SUPABASE_KEY
  return createClient(SUPABASE_URL, key, serviceClientOpts)
}
