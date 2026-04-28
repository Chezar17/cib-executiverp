// ============================================================
//  CIB — Hardened Login + Change-Password Function  (api/login.js)
//
//  ROUTES (distinguished by ?action= query param):
//  POST /api/login              → standard login
//  POST /api/login?action=change-password → change password (requires valid token)
//
//  DATABASE — users table must have a `must_change_password` boolean column:
//    ALTER TABLE users ADD COLUMN must_change_password BOOLEAN DEFAULT FALSE;
//
//  SECURITY IMPROVEMENTS OVER OLD VERSION:
//  ✅ Server-side brute-force lockout (stored in Supabase)
//  ✅ Session token saved to Supabase sessions table
//  ✅ CORS locked to your domain only
//  ✅ Origin check (CSRF protection)
//  ✅ Token has real server-enforced expiry
//  ✅ classification returned so frontend can gate page access
//  ✅ must_change_password flag returned to prompt forced password reset
//  ✅ Change-password endpoint validates old password + token before allowing update
//
//  FRONTEND — after a successful login response, save like this:
//    sessionStorage.setItem('cib_token',               data.token)
//    sessionStorage.setItem('cib_badge',               data.user.badge)
//    sessionStorage.setItem('cib_classification',      data.user.classification)
//    sessionStorage.setItem('cib_must_change_password', data.user.mustChangePassword)
//
// ============================================================

import crypto from 'crypto'
import { SESSION_SECRET } from './_lib/config.js'
import {
  allowMethods,
  applyCors,
  getClientIp,
  handlePreflight,
  rejectForeignOrigin,
} from './_lib/http.js'
import { getSupabase } from './_lib/supabase.js'

const MAX_ATTEMPTS  = 5   // max failed logins before lockout
const LOCKOUT_MINS  = 5   // how long the lockout lasts
const SESSION_MINS  = 30  // how long a login session lasts

// ── Crypto helpers ────────────────────────────────────────────
function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex')
}

function generateToken(badge) {
  const payload = `${badge}:${Date.now()}:${SESSION_SECRET}:${Math.random()}`
  return sha256(payload)
}

// ── Token validation helper ───────────────────────────────────
async function validateToken(supabase, token) {
  if (!token) return null
  const { data: session } = await supabase
    .from('sessions')
    .select('badge, expires_at')
    .eq('token', token)
    .single()
  if (!session) return null
  if (new Date(session.expires_at) < new Date()) return null
  return session.badge
}

// ─────────────────────────────────────────────────────────────
//  HANDLER
// ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {

  // ── CORS ─────────────────────────────────────────────────────
  applyCors(res, { methods: 'POST, OPTIONS', headers: 'Content-Type, Authorization' })
  if (handlePreflight(req, res)) return
  if (rejectForeignOrigin(req, res)) return
  if (!allowMethods(req, res, ['POST'])) return

  const action = req.query?.action   // undefined  → login  |  'change-password' → change pw
  const supabase = getSupabase()

  // ════════════════════════════════════════════════════════════
  //  ROUTE: change-password
  // ════════════════════════════════════════════════════════════
  if (action === 'change-password') {
    return handleChangePassword(req, res, supabase)
  }

  // ════════════════════════════════════════════════════════════
  //  ROUTE: login (default)
  // ════════════════════════════════════════════════════════════
  return handleLogin(req, res, supabase)
}

// ─────────────────────────────────────────────────────────────
//  LOGIN
// ─────────────────────────────────────────────────────────────
async function handleLogin(req, res, supabase) {
  const ip = getClientIp(req)

  try {
    const { badge, password } = req.body

    if (!badge || !password || typeof badge !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'Badge and password are required' })
    }

    const badgeTrimmed = badge.trim()

    // ── Server-side lockout check ─────────────────────────────
    const windowStart = new Date(Date.now() - LOCKOUT_MINS * 60 * 1000).toISOString()
    const { count } = await supabase
      .from('login_attempts')
      .select('*', { count: 'exact', head: true })
      .eq('ip', ip)
      .gte('attempted_at', windowStart)

    if (count >= MAX_ATTEMPTS) {
      return res.status(429).json({
        error: `Too many failed attempts. Try again in ${LOCKOUT_MINS} minutes.`
      })
    }

    // ── Check credentials ─────────────────────────────────────
    const passwordHash = password   // already SHA-256 hashed by frontend

    const { data: user, error } = await supabase
      .from('users')
      .select('id, badge, name, rank, division, classification, must_change_password')
      .eq('badge', badgeTrimmed)
      .eq('password', passwordHash)
      .single()

    if (error || !user) {
      // Log failed attempt
      await supabase.from('login_attempts').insert([{ ip, badge: badgeTrimmed }])
      const remaining = MAX_ATTEMPTS - (count + 1)
      return res.status(401).json({
        error: remaining > 0
          ? `Invalid credentials. ${remaining} attempt(s) remaining.`
          : `Too many failed attempts. Try again in ${LOCKOUT_MINS} minutes.`
      })
    }

    // ── Credentials OK — create session ──────────────────────
    const token     = generateToken(user.badge)
    const expiresAt = new Date(Date.now() + SESSION_MINS * 60 * 1000)

    const { error: sessionErr } = await supabase
      .from('sessions')
      .insert([{ token, badge: user.badge, expires_at: expiresAt.toISOString() }])

    if (sessionErr) {
      console.error('Session insert error:', sessionErr)
      return res.status(500).json({
        error: 'Failed to create session. Make sure the "sessions" table exists in Supabase.'
      })
    }

    // Clear old failed attempts on successful login
    await supabase.from('login_attempts').delete().eq('ip', ip)

    return res.status(200).json({
      success:   true,
      token:     token,
      expiresAt: expiresAt.getTime(),
      user: {
        badge:             user.badge,
        name:              user.name,
        rank:              user.rank,
        division:          user.division,
        classification:    user.classification || '',
        mustChangePassword: !!user.must_change_password   // ← tells frontend to show change-pw popup
      }
    })

  } catch (err) {
    console.error('Login error:', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
}

// ─────────────────────────────────────────────────────────────
//  CHANGE PASSWORD
//  POST /api/login?action=change-password
//  Headers: Authorization: Bearer <token>
//  Body: { badge, oldPassword, newPassword }
//    - badge       : user's badge (string)
//    - oldPassword : SHA-256 hash of the OLD password (hashed client-side)
//    - newPassword : SHA-256 hash of the NEW password (hashed client-side)
// ─────────────────────────────────────────────────────────────
async function handleChangePassword(req, res, supabase) {
  try {
    const authHeader = req.headers['authorization'] || ''
    const token      = authHeader.replace(/^Bearer\s+/i, '').trim()

    // ── Validate session token ────────────────────────────────
    const tokenBadge = await validateToken(supabase, token)
    if (!tokenBadge) {
      return res.status(401).json({ error: 'Invalid or expired session. Please log in again.' })
    }

    const { badge, oldPassword, newPassword } = req.body

    if (!badge || !oldPassword || !newPassword ||
        typeof badge !== 'string' ||
        typeof oldPassword !== 'string' ||
        typeof newPassword !== 'string') {
      return res.status(400).json({ error: 'badge, oldPassword, and newPassword are required.' })
    }

    const badgeTrimmed = badge.trim()

    // Token must belong to the same user making the request (prevent privilege escalation)
    if (tokenBadge !== badgeTrimmed) {
      return res.status(403).json({ error: 'Token does not match the provided badge.' })
    }

    // ── Verify old password is correct ────────────────────────
    const { data: user, error: userErr } = await supabase
      .from('users')
      .select('id, badge')
      .eq('badge', badgeTrimmed)
      .eq('password', oldPassword)
      .single()

    if (userErr || !user) {
      return res.status(401).json({ error: 'Current password is incorrect.' })
    }

    // ── Prevent reuse of the same password ───────────────────
    if (oldPassword === newPassword) {
      return res.status(400).json({ error: 'New password must be different from the current password.' })
    }

    // ── Update password and clear the flag ───────────────────
    const { error: updateErr } = await supabase
      .from('users')
      .update({
        password:            newPassword,
        must_change_password: false
      })
      .eq('badge', badgeTrimmed)

    if (updateErr) {
      console.error('Password update error:', updateErr)
      return res.status(500).json({ error: 'Failed to update password. Please try again.' })
    }

    // ── Invalidate ALL existing sessions for this user ────────
    // Forces re-login with the new password — clean security hygiene
    await supabase.from('sessions').delete().eq('badge', badgeTrimmed)

    return res.status(200).json({
      success: true,
      message: 'Password updated successfully. Please log in again with your new password.'
    })

  } catch (err) {
    console.error('Change-password error:', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
