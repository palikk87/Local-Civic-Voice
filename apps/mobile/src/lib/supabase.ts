import AsyncStorage from '@react-native-async-storage/async-storage'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { fetch as expoFetch } from 'expo/fetch'

import type { Database } from './database.types'

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? ''
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? ''

const isValidUrl = supabaseUrl.startsWith('https://') && !supabaseUrl.includes('placeholder')
const isValidKey = supabaseAnonKey.length > 20 && !supabaseAnonKey.includes('placeholder')

// Supabase master switch.
//
// This gates BOTH auth and data: auth-context.tsx routes signup, login, logout,
// password reset and profile writes through supabase.auth whenever this is true,
// and every hook in hooks.ts / timeline-service.ts queries Supabase instead of
// the Hono backend. Turning it on is a SWAP, not an addition — if the Supabase
// project is unreachable, nobody can log in.
//
// So it needs three things to be true, not just credentials being present:
//   1. EXPO_PUBLIC_SUPABASE_ENABLED=true   (explicit opt-in, set in the ENV tab)
//   2. a valid https project URL
//   3. a key that looks real
//
// With the flag unset the app uses Better Auth + the Hono/Prisma backend, which
// is the state it has been running in. Flip the flag in the Vibecode ENV tab to
// cut over — no code change needed, and no redeploy to undo it.
const enabledFlag = (process.env.EXPO_PUBLIC_SUPABASE_ENABLED ?? '').trim().toLowerCase()
const isExplicitlyEnabled = enabledFlag === 'true' || enabledFlag === '1'

const isConfigured = isExplicitlyEnabled && isValidUrl && isValidKey

// Only create a real client when credentials are present — creating one with
// placeholder URLs causes the GoTrue client to make DNS requests on init.
export const supabase: SupabaseClient<Database> = isConfigured
  ? createClient<Database>(supabaseUrl, supabaseAnonKey, {
      auth: {
        storage: AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
      global: {
        fetch: expoFetch as typeof fetch,
      },
    })
  : (null as unknown as SupabaseClient<Database>)

export const isSupabaseConfigured = (): boolean => isConfigured

// Auth helper functions — callers should check isSupabaseConfigured() first
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
