/**
 * Legacy feature gate. Permanently off, and no longer backed by anything.
 *
 * This module used to construct a `@supabase/supabase-js` client and export
 * auth helpers alongside it — a second, parallel authentication system that
 * could be switched on with an environment variable. It was never switched on;
 * Better Auth against the Hono/Prisma backend is and always has been the real
 * one. The dormant copy caused a live bug on its own (two session providers
 * mounted at once, three screens reading the dead one), which is on the record
 * in `auth-context.tsx`.
 *
 * The SDK is gone now, deliberately. Whoever hosts the database, it is reached
 * as plain Postgres over a connection string, by the backend, and by nothing
 * else. No client here talks to a vendor API — which is what makes the database
 * repointable at any Postgres without touching application code.
 *
 * `isSupabaseConfigured()` survives as a named constant because several screens
 * branch on it to choose between server data and local mock data. Deleting it
 * would mean editing feature logic in several files to say `false` in longhand.
 * When those branches are cleaned up, this file goes with them.
 */

export const isSupabaseConfigured = (): boolean => false
