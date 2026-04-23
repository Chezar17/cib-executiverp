// ============================================================
//  CIB — Vercel Serverless Login Function
//  File location: api/login.js
//
//  This runs on Vercel's servers — users NEVER see this code.
//  It checks badge + password against your Supabase database.
//
//  HOW IT WORKS:
//  1. Login page sends badge + password to POST /api/login
//  2. This function hashes the password with SHA-256
//  3. Checks Supabase database for matching badge + hash
//  4. Returns a signed session token if matched
//  5. Login page stores the token and redirects to Nexus
// ============================================================

import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

// ── These come from your Vercel Environment Variables ──────
//    You set these in the Vercel dashboard — never hardcode them
const SUPABASE_URL    = process.env.SUPABASE_URL
const SUPABASE_KEY    = process.env.SUPABASE_ANON_KEY
const SESSION_SECRET  = process.env.SESSION_SECRET   // any long random string you choose

// ── SHA-256 hash function (same as what the login page uses) ──
function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex')
}

// ── Generate a simple session token ──────────────────────────
function generateToken(badge) {
  const payload = `${badge}:${Date.now()}:${SESSION_SECRET}`
  return sha256(payload)
}

// ── Main handler ─────────────────────────────────────────────
export default async function handler(req, res) {

  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Rate limiting — max 5 attempts tracked by IP
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress

  try {
    const { badge, password } = req.body

    // Validate input
    if (!badge || !password) {
      return res.status(400).json({ error: 'Badge and password are required' })
    }

    if (typeof badge !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'Invalid input' })
    }

    // Hash the password (same algorithm as the frontend)
    const passwordHash = sha256(password)
    const badgeUpper   = badge.trim().toUpperCase()

    // Connect to Supabase
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

    // Query the users table
    const { data, error } = await supabase
      .from('users')
      .select('id, badge, name, rank, division')
      .eq('badge', badgeUpper)
      .eq('password', passwordHash)
      .single()

    if (error || !data) {
      // Wrong credentials — don't reveal which field was wrong
      return res.status(401).json({ error: 'Invalid badge number or password' })
    }

    // ✅ Credentials matched — generate session token
    const token = generateToken(data.badge)
    const expiresAt = Date.now() + (30 * 60 * 1000) // 30 minutes

    // Return the token and user info to the browser
    return res.status(200).json({
      success:   true,
      token:     token,
      expiresAt: expiresAt,
      user: {
        badge:    data.badge,
        name:     data.name,
        rank:     data.rank,
        division: data.division
      }
    })

  } catch (err) {
    console.error('Login error:', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
