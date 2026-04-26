export const SUPABASE_URL = process.env.SUPABASE_URL
export const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY
export const SESSION_SECRET = process.env.SESSION_SECRET || ''
export const ALLOWED_ORIGIN =
  process.env.ALLOWED_ORIGIN || 'https://your-app.vercel.app'

export const CLEARANCE_LEVELS = ['top_secret', 'secret', 'confidential']
