// Web port of mobile/src/lib/supabase.ts
//
// Behavioural parity with mobile, web idiom: localStorage instead of AsyncStorage,
// the platform fetch instead of expo/fetch, and detectSessionInUrl enabled because
// on web the OAuth/magic-link callback arrives in the URL hash.

import { createClient, SupabaseClient } from '@supabase/supabase-js'

import type { Database } from './database.types'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? ''
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''

const isValidUrl = supabaseUrl.startsWith('https://') && !supabaseUrl.includes('placeholder')
const isValidKey = supabaseAnonKey.length > 20 && !supabaseAnonKey.includes('placeholder')

// Supabase master switch — same three conditions as mobile (see
// webapp/mobile/src/lib/supabase.ts for the full reasoning).
//
// This gates BOTH auth and data. Turning it on is a SWAP away from Better Auth +
// the Hono/Prisma backend, not an addition: if the Supabase project is
// unreachable, nobody can log in. So it requires an explicit opt-in flag on top
// of valid credentials.
//
// Set VITE_SUPABASE_ENABLED=true in the Vibecode ENV tab to cut over.
const enabledFlag = (import.meta.env.VITE_SUPABASE_ENABLED ?? '').trim().toLowerCase()
const isExplicitlyEnabled = enabledFlag === 'true' || enabledFlag === '1'

const isConfigured = isExplicitlyEnabled && isValidUrl && isValidKey

// Only construct a real client when enabled — instantiating one against a
// placeholder or dead host makes the auth client fire DNS requests on init.
export const supabase: SupabaseClient<Database> = isConfigured
  ? createClient<Database>(supabaseUrl, supabaseAnonKey, {
      auth: {
        storage: window.localStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
    })
  : (null as unknown as SupabaseClient<Database>)

export const isSupabaseConfigured = (): boolean => isConfigured

// Auth helpers — callers must check isSupabaseConfigured() first.
// Signatures match mobile so both faucets behave identically.
export const signUpWithEmail = async (
  email: string,
  password: string,
  metadata: { username: string; display_name: string }
) => {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: metadata },
  })
  return { data, error }
}

export const signInWithEmail = async (email: string, password: string) => {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  return { data, error }
}

export const signOut = async () => {
  const { error } = await supabase.auth.signOut()
  return { error }
}

export const resetPassword = async (email: string) => {
  const { data, error } = await supabase.auth.resetPasswordForEmail(email)
  return { data, error }
}

export const getCurrentUser = async () => {
  const { data: { user }, error } = await supabase.auth.getUser()
  return { user, error }
}

export const getCurrentSession = async () => {
  const { data: { session }, error } = await supabase.auth.getSession()
  return { session, error }
}
