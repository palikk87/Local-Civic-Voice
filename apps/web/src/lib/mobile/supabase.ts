/**
 * Legacy feature gate. Permanently off, and no longer backed by anything.
 * Mirrors apps/mobile/src/lib/supabase.ts — see that file for the full history.
 *
 * The `@supabase/supabase-js` client this used to build is gone. The database
 * is reached as plain Postgres by the backend and by nothing else, so neither
 * client depends on a particular vendor's API and the connection string can be
 * repointed at any Postgres without an application change.
 *
 * `isSupabaseConfigured()` remains because Feed and Profile branch on it to
 * choose between server data and local mock data.
 */

export const isSupabaseConfigured = (): boolean => false
