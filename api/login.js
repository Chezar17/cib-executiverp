// ============================================================
//  CIB — Unified Login API
//  File location: api/login.js
//
//  This single file handles TWO actions, selected by query param:
//
//  POST /api/login                          → normal login
//  POST /api/login?action=change-password   → change password
//
//  WHY ONE FILE:
//  Fewer cold-start functions on Vercel, shared imports,
//  shared helpers, one place to audit auth logic.
//
//  ── LOGIN FLOW ───────────────────────────────────────────
//  1. Frontend sends  { badge, password }  (password = SHA-256 hash)
//  2. We verify badge + hash against users table in Supabase
//  3. On match → generate session token, store in sessions table
//  4. If must_change_password = true → return temp token + flag
//  5. Frontend intercepts flag, shows change-password modal
//
//  ── CHANGE PASSWORD FLOW ─────────────────────────────────
//  1. Frontend sends  { badge, current_hash, new_hash }
//     with header  x-session-token: <temp token>
//  2. We verify temp session token belongs to badge
//  3. We verify current_hash matches DB
//  4. We update password + clear must_change_password flag
//  5. We delete the temp session (force re-login)
//  6. Frontend re-prompts login with cleared modal
// ============================================================

import { createClient }    from '@supabase/supabase-js'
import crypto               from 'crypto'
import {
  allowMethods,
  applyCors,
  handlePreflight,
  rejectForeignOrigin,
} from './_lib/http.js'

// ── Environment variables (set in Vercel dashboard) ──────────
const SUPABASE_URL   = process.env.SUPABASE_URL
const SUPABASE_KEY   = process.env.SUPABASE_ANON_KEY
const SESSION_SECRET = process.env.SESSION_SECRET

// ── Shared helpers ────────────────────────────────────────────
function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex')
}

function generateToken(badge) {
  const payload = `${badge}:${Date.now()}:${SESSION_SECRET}`
  return sha256(payload)
}

function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_KEY)
}

// ══════════════════════════════════════════════════════════════
//  MAIN HANDLER — routes to login or change-password
// ══════════════════════════════════════════════════════════════
export default async function handler(req, res) {

  // ── CORS + preflight ─────────────────────────────────────────
  applyCors(res, {
    methods: 'POST, OPTIONS',
    headers: 'Content-Type, x-session-token',
  })
  if (handlePreflight(req, res)) return
  if (rejectForeignOrigin(req, res)) return
  if (!allowMethods(req, res, ['POST'])) return

  // ── Route by ?action= query param ────────────────────────────
  const action = req.query?.action || 'login'

  if (action === 'change-password') {
    return handleChangePassword(req, res)
  }

  // Default: normal login
  return handleLogin(req, res)
}

// ══════════════════════════════════════════════════════════════
//  ACTION 1 — LOGIN
//  POST /api/login
//  Body: { badge: string, password: string (SHA-256 hash) }
// ══════════════════════════════════════════════════════════════
async function handleLogin(req, res) {
  try {
    const { badge, password } = req.body

    // ── Input validation ────────────────────────────────────────
    if (!badge || !password) {
      return res.status(400).json({ error: 'Badge and password are required' })
    }
    if (typeof badge !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'Invalid input' })
    }

    const badgeTrimmed   = badge.trim().toUpperCase()
    // Password arrives already SHA-256 hashed from the browser
    // We hash it again server-side so the DB never stores raw hashes
    // that were sent over the wire as-is
    const passwordHash   = sha256(password)

    const supabase = getSupabase()

    // ── Look up user ─────────────────────────────────────────────
    const { data: user, error: userErr } = await supabase
      .from('users')
      .select('id, badge, name, rank, division, classification, must_change_password')
      .eq('badge', badgeTrimmed)
      .eq('password', passwordHash)
      .single()

    if (userErr || !user) {
      // Deliberately vague — don't reveal which field was wrong
      return res.status(401).json({ error: 'Invalid badge number or password' })
    }

    // ── Generate session token ───────────────────────────────────
    const token     = generateToken(user.badge)
    const expiresAt = Date.now() + (30 * 60 * 1000)   // 30 minutes

    // ── Store session in DB ──────────────────────────────────────
    await supabase
      .from('sessions')
      .insert([{
        token,
        badge:      user.badge,
        expires_at: new Date(expiresAt).toISOString(),
        created_at: new Date().toISOString(),
      }])

    // ── Return response ──────────────────────────────────────────
    // If must_change_password is true, the token is TEMPORARY —
    // only valid for the /api/login?action=change-password call.
    // The frontend must NOT store it as a real session yet.
    return res.status(200).json({
      success:   true,
      token,
      expiresAt,
      user: {
        badge:               user.badge,
        name:                user.name,      // ← from users.name column
        rank:                user.rank,
        division:            user.division,
        classification:      user.classification || '',
        must_change_password: user.must_change_password || false,
      }
    })

  } catch (err) {
    console.error('[login] Error:', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
}

// ══════════════════════════════════════════════════════════════
//  ACTION 2 — CHANGE PASSWORD
//  POST /api/login?action=change-password
//  Header: x-session-token: <temp token from login>
//  Body:   { badge, current_hash, new_hash }
//          (both hashes = SHA-256 of the raw passwords)
// ══════════════════════════════════════════════════════════════
async function handleChangePassword(req, res) {
  try {
    // ── Must carry the temp session token ────────────────────────
    const token = req.headers['x-session-token']
    if (!token) {
      return res.status(401).json({ error: 'Unauthorized — session token required' })
    }

    const { badge, current_hash, new_hash } = req.body

    // ── Input validation ─────────────────────────────────────────
    if (!badge || !current_hash || !new_hash) {
      return res.status(400).json({ error: 'Badge, current and new password are required' })
    }
    if (current_hash === new_hash) {
      return res.status(400).json({ error: 'New password must be different from the current password' })
    }

    const supabase     = getSupabase()
    const badgeTrimmed = badge.trim().toUpperCase()

    // ── Verify temp session token belongs to this badge ──────────
    const { data: session, error: sessErr } = await supabase
      .from('sessions')
      .select('badge, expires_at')
      .eq('token', token)
      .single()

    if (sessErr || !session) {
      return res.status(401).json({ error: 'Invalid or expired session token' })
    }
    if (session.badge !== badgeTrimmed) {
      return res.status(403).json({ error: 'Session token does not match badge' })
    }
    if (new Date(session.expires_at) < new Date()) {
      // Clean up expired session then reject
      await supabase.from('sessions').delete().eq('token', token)
      return res.status(401).json({ error: 'Session expired — please log in again' })
    }

    // ── Verify the current password is correct ───────────────────
    // Hash the incoming current_hash again (same double-hash as login)
    const currentHashDb = sha256(current_hash)

    const { data: user, error: userErr } = await supabase
      .from('users')
      .select('id, badge')
      .eq('badge', badgeTrimmed)
      .eq('password', currentHashDb)
      .single()

    if (userErr || !user) {
      return res.status(401).json({ error: 'Current password is incorrect' })
    }

    // ── Update to new password + clear the flag ──────────────────
    const newHashDb = sha256(new_hash)    // double-hash new password too

    const { error: updateErr } = await supabase
      .from('users')
      .update({
        password:             newHashDb,
        must_change_password: false,
        password_changed_at:  new Date().toISOString(),
        updated_at:           new Date().toISOString(),
      })
      .eq('id', user.id)

    if (updateErr) {
      console.error('[change-password] Update error:', updateErr)
      return res.status(500).json({ error: 'Failed to update password' })
    }

    // ── Delete the temp session (force fresh login) ──────────────
    await supabase.from('sessions').delete().eq('token', token)

    return res.status(200).json({ success: true })

  } catch (err) {
    console.error('[change-password] Error:', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
