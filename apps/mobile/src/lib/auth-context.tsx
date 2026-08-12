import { useQueryClient, useMutation, useQuery } from '@tanstack/react-query'
import { Session, User } from '@supabase/supabase-js'
import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react'

import { supabase, isSupabaseConfigured } from './supabase'
import type { Profile } from './database.types'

interface AuthContextType {
  user: User | null
  profile: Profile | null
  session: Session | null
  isLoading: boolean
  isAuthenticated: boolean
  signUp: (email: string, password: string, username: string, displayName: string) => Promise<{ error: Error | null }>
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>
  signOut: () => Promise<void>
  resetPassword: (email: string) => Promise<{ error: Error | null }>
  updateProfile: (updates: Partial<Profile>) => Promise<{ error: Error | null }>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const queryClient = useQueryClient()

  // Fetch user profile
  const { data: profile } = useQuery({
    queryKey: ['profile', user?.id],
    queryFn: async () => {
      if (!user?.id) return null
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single()
      if (error) throw error
      return data
    },
    enabled: !!user?.id && isSupabaseConfigured(),
    staleTime: 1000 * 60 * 5, // 5 minutes
  })

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setIsLoading(false)
      return
    }

    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setUser(session?.user ?? null)
      setIsLoading(false)
    })

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        setSession(session)
        setUser(session?.user ?? null)

        // Invalidate profile query on auth change
        if (session?.user?.id) {
          queryClient.invalidateQueries({ queryKey: ['profile', session.user.id] })
        }
      }
    )

    return () => subscription.unsubscribe()
  }, [queryClient])

  const signUp = async (
    email: string,
    password: string,
    username: string,
    displayName: string
  ): Promise<{ error: Error | null }> => {
    if (!isSupabaseConfigured()) {
      return { error: new Error('Supabase not configured') }
    }

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          username,
          display_name: displayName,
        },
      },
    })

    return { error: error ? new Error(error.message) : null }
  }

  const signIn = async (email: string, password: string): Promise<{ error: Error | null }> => {
    if (!isSupabaseConfigured()) {
      return { error: new Error('Supabase not configured') }
    }

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    return { error: error ? new Error(error.message) : null }
  }

  const signOutFn = async () => {
    if (!isSupabaseConfigured()) return

    await supabase.auth.signOut()
    queryClient.clear()
  }

  const resetPassword = async (email: string): Promise<{ error: Error | null }> => {
    if (!isSupabaseConfigured()) {
      return { error: new Error('Supabase not configured') }
    }

    const { error } = await supabase.auth.resetPasswordForEmail(email)
    return { error: error ? new Error(error.message) : null }
  }

  const updateProfile = async (updates: Partial<Profile>): Promise<{ error: Error | null }> => {
    if (!isSupabaseConfigured() || !user?.id) {
      return { error: new Error('Not authenticated') }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('profiles') as any)
      .update(updates)
      .eq('id', user.id)

    if (!error) {
      queryClient.invalidateQueries({ queryKey: ['profile', user.id] })
    }

    return { error: error ? new Error(error.message) : null }
  }

  const value: AuthContextType = {
    user,
    profile: profile ?? null,
    session,
    isLoading,
    isAuthenticated: !!user,
    signUp,
    signIn,
    signOut: signOutFn,
    resetPassword,
    updateProfile,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

// Hook for protected routes
export function useRequireAuth() {
  const { isAuthenticated, isLoading } = useAuth()
  return { isAuthenticated, isLoading, requiresAuth: !isAuthenticated && !isLoading }
}
