// ============================================================
//  CIB — Supabase User Seeder (Fixed — uses INSERT not upsert)
//  File location: scripts/seed-users.js
//
//  Run: node scripts/seed-users.js
//
//  BEFORE RUNNING:
//  1. npm install @supabase/supabase-js
//  2. Replace SUPABASE_URL and SUPABASE_KEY below with yours
//     (Supabase → Settings → API)
// ============================================================

import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

// ── PASTE YOUR VALUES HERE ────────────────────────────────────
const SUPABASE_URL = 'https://nyxnoexxueoutpambduy.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im55eG5vZXh4dWVvdXRwYW1iZHV5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY5MzM5MjUsImV4cCI6MjA5MjUwOTkyNX0.iogR0A0vLpZ-DUBFXT-3JP-EL_ggxWbmidhKqYv5KBw'
// ─────────────────────────────────────────────────────────────

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex')
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

const users = [
  { badge: 'CIB-COMMANDER',  password: sha256('Diraj269'),      name: 'Diraj Lakota',     rank: 'Commander',   division: 'Command' },
  { badge: 'CIB-VICE-00',    password: sha256('Elias26104'),    name: 'Elias Makya',      rank: 'Head of CID', division: 'CID'     },
  { badge: 'CIB-VICE-01',    password: sha256('Jadda26136'),    name: 'Jadda Quetzalli',  rank: 'Secretary',   division: 'CID'     },
  { badge: 'CIB-VICE-02',    password: sha256('Scott70414'),    name: 'Scott Hawkes',     rank: 'Detective 3', division: 'CID'     },
  { badge: 'CIB-VICE-03',    password: sha256('Julian26119'),   name: 'Julian Flux',      rank: 'Detective 3', division: 'CID'     },
  { badge: 'CIB-VICE-04',    password: sha256('Aiden70406'),    name: 'Aiden Parker',     rank: 'Detective 3', division: 'CID'     },
  { badge: 'CIB-GEORGE-00',  password: sha256('Meifanny70104'),name: 'Meifanny Lorenta', rank: 'Head of GRD', division: 'GRD'     },
  { badge: 'CIB-GEORGE-01',  password: sha256('Tarsha70407'),   name: 'Tarsha Kim',       rank: 'Detective 3', division: 'GRD'     },
  { badge: 'CIB-GEORGE-02',  password: sha256('Leon70402'),     name: 'Leon McMoran',     rank: 'Detective 3', division: 'GRD'     },
  { badge: 'CIB-GEORGE-03',  password: sha256('Martin70405'),   name: 'Martin Kareem',    rank: 'Detective 3', division: 'GRD'     },
  { badge: 'CIB-GEORGE-04',  password: sha256('Amar70444'),     name: 'Amar Giovanni',    rank: 'Detective 3', division: 'GRD'     },
  { badge: 'CIB-GEORGE-05',  password: sha256('Cage26147'),     name: 'Cage Cockswood',   rank: 'Detective 3', division: 'GRD'     },
]

async function seedUsers() {
  console.log('🔐 Seeding CIB users into Supabase...\n')

  // Step 1: wipe existing rows so re-running never duplicates
  const { error: delErr } = await supabase
    .from('users')
    .delete()
    .neq('badge', '___NEVER_EXISTS___')

  if (delErr) {
    console.warn('⚠️  Could not clear table:', delErr.message)
    console.warn('   (Safe to ignore if table is empty)\n')
  } else {
    console.log('🗑️  Cleared existing rows\n')
  }

  // Step 2: insert all users fresh
  const { error } = await supabase.from('users').insert(users)

  if (error) {
    console.error('\n❌ Insert failed:', error.message)
    console.error('\n── WHAT WENT WRONG ─────────────────────────────────────')

    if (error.message.includes('row-level security')) {
      console.error('🔒 RLS is blocking inserts. Fix it in Supabase SQL Editor:')
      console.error('\n   Option 1 — Disable RLS completely (easier):')
      console.error('   ALTER TABLE users DISABLE ROW LEVEL SECURITY;\n')
      console.error('   Option 2 — Add a permissive policy:')
      console.error('   CREATE POLICY "allow_all" ON users FOR ALL USING (true);\n')
    }

    if (error.message.includes('does not exist')) {
      console.error('📋 Table "users" not found. Create it in Supabase:')
      console.error('   Table Editor → New Table → name: users')
      console.error('   Columns: badge (text), password (text),')
      console.error('            name (text), rank (text), division (text)\n')
    }

    if (error.message.includes('Invalid API key') || error.message.includes('JWT')) {
      console.error('🔑 Wrong API key. Check:')
      console.error('   Supabase → Settings → API → copy "anon public" key\n')
    }

  } else {
    console.log(`✅ Inserted ${users.length} users successfully:\n`)
    users.forEach(u =>
      console.log(`   ✓ ${u.badge.padEnd(20)} ${u.name.padEnd(20)} [${u.division}]`)
    )
    console.log('\n🎉 Done! Database is ready.')
    console.log('   Next: set Vercel environment variables and deploy.')
  }
}

seedUsers()
