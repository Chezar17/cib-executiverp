// ============================================================
//  CIB — Hardened Login Function  (api/login.js)
//
//  SECURITY IMPROVEMENTS OVER OLD VERSION:
//  ✅ Server-side brute-force lockout (stored in Supabase)
//  ✅ Session token saved to Supabase sessions table
//  ✅ CORS locked to your domain only
//  ✅ Origin check (CSRF protection)
//  ✅ Token has real server-enforced expiry
//  ✅ classification returned so frontend can gate page access
//
//  FRONTEND (Page_Login.html) — after a successful login response,
//  make sure you save classification to sessionStorage like this:
//
//    sessionStorage.setItem('cib_token',          data.token)
//    sessionStorage.setItem('cib_badge',          data.user.badge)
//    sessionStorage.setItem('cib_classification', data.user.classification)
//
// ============================================================

import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

const SUPABASE_URL   = process.env.SUPABASE_URL
const SUPABASE_KEY   = process.env.SUPABASE_ANON_KEY
const SESSION_SECRET = process.env.SESSION_SECRET

// ── YOUR VERCEL DOMAIN — change this to your real URL ────────
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://your-app.vercel.app'

const MAX_ATTEMPTS   = 5          // max failed logins before lockout
const LOCKOUT_MINS   = 5          // how long the lockout lasts
const SESSION_MINS   = 30         // how long a login session lasts

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex')
}

function generateToken(badge) {
  const payload = `${badge}:${Date.now()}:${SESSION_SECRET}:${Math.random()}`
  return sha256(payload)
}

export default async function handler(req, res) {

  // ── CORS — only allow requests from your own domain ────────
  const origin = req.headers.origin || ''
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN)
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  // ── CSRF — reject if request comes from a foreign origin ───
  if (origin && origin !== ALLOWED_ORIGIN) {
    return res.status(403).json({ error: 'Forbidden' })
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // ── Get client IP ─────────────────────────────────────────
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown')
               .split(',')[0].trim()

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

  try {
    const { badge, password } = req.body

    if (!badge || !password || typeof badge !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'Badge and password are required' })
    }

    const badgeTrimmed = badge.trim()

    // ── SERVER-SIDE LOCKOUT CHECK ─────────────────────────────
    // Count failed attempts from this IP in the last LOCKOUT_MINS minutes
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

    // ── CHECK CREDENTIALS IN DATABASE ────────────────────────
    const passwordHash = password  // already SHA-256 hashed by frontend

    const { data: user, error } = await supabase
      .from('users')
      .select('id, badge, name, rank, division, classification')
      .eq('badge', badgeTrimmed)
      .eq('password', passwordHash)
      .single()

    if (error || !user) {
      // ── Log this failed attempt to the database ─────────────
      await supabase
        .from('login_attempts')
        .insert([{ ip, badge: badgeTrimmed }])

      const remaining = MAX_ATTEMPTS - (count + 1)
      return res.status(401).json({
        error: remaining > 0
          ? `Invalid credentials. ${remaining} attempt(s) remaining.`
          : `Too many failed attempts. Try again in ${LOCKOUT_MINS} minutes.`
      })
    }

    // ── CREDENTIALS OK — create session ───────────────────────
    const token     = generateToken(user.badge)
    const expiresAt = new Date(Date.now() + SESSION_MINS * 60 * 1000)

    // Save token to Supabase sessions table
    await supabase
      .from('sessions')
      .insert([{
        token,
        badge:      user.badge,
        expires_at: expiresAt.toISOString()
      }])

    // Clear old failed attempts for this IP on successful login
    await supabase
      .from('login_attempts')
      .delete()
      .eq('ip', ip)

    return res.status(200).json({
      success:   true,
      token:     token,
      expiresAt: expiresAt.getTime(),
      user: {
        badge:          user.badge,
        name:           user.name,
        rank:           user.rank,
        division:       user.division,
        classification: user.classification || ''   // ← used by gang.html & future pages for access control
      }
    })

  } catch (err) {
    console.error('Login error:', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
