import { createClient } from '@supabase/supabase-js'
import { SUPABASE_KEY, SUPABASE_URL } from './config.js'

export function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_KEY)
}
