# Civic Voice

Civics app for the USA: a mobile app and a web app sharing one backend and one
Supabase Postgres database.

```
apps/mobile/   Expo / React Native client
apps/web/      Vite + React client (formerly "CivicSpeak")
backend/       Bun + Hono + Prisma API — serves both clients
db/            Database docs, legacy schemas, live-object capture
docs/          Audit and planning documents from the Vibecode era
archive/       Superseded code kept for reference
```

Both clients talk to the same database. A schema change for one reaches the other
immediately — read `db/README.md` before touching anything under
`backend/prisma/`.

## Setup

Requires [Bun](https://bun.sh).

```bash
# Backend
cd backend
cp .env.example .env        # fill in
bun install
bunx prisma generate
bunx prisma migrate deploy
bun run dev                 # :3000

# Web
cd apps/web
cp .env.example .env        # fill in
bun install
bun run dev                 # :8000, proxies /api to :3000

# Mobile
cd apps/mobile
cp .env.example .env        # fill in
bun install
bun run start
```

`.env` files are gitignored. **This repository is public — never commit one.**

## Auth

Two systems currently coexist in the mobile client:

- **Better Auth** (`src/lib/auth/`) — the canonical path. The backend implements
  it, including the `emailOTP` plugin that powers password reset.
- **Supabase Auth** (`src/lib/auth-context.tsx`) — still imported by `_layout.tsx`
  and three tab screens.

`VITE_SUPABASE_ENABLED` / `EXPO_PUBLIC_SUPABASE_ENABLED` gate the switchover.
Leave them false unless you are deliberately migrating; flipping them against an
unresponsive Supabase project locks everyone out of login.

Consolidating onto one system is the obvious next cleanup.

## Messaging

Backed by `Conversation` / `ConversationParticipant` / `Message`. Read state
lives on `ConversationParticipant.lastReadAt`, so marking a thread read is one
UPDATE rather than one per message; the per-message `isRead` in the API is
derived from it.

This replaced an in-memory mock — a hardcoded `current_user`, module-level
arrays, integer id counters — that the mobile client never even called, reading
`timeline-store`'s `generateMockConversations()` instead. Messages now persist
and actually reach the other participant.

## Migration off Vibecode

Both apps were built on Vibecode and exported as ZIPs. Each export contained its
own full copy of the backend, and the copies had diverged. What was reconciled:

**Canonical sources.** The newer mobile client turned out to be the copy nested
inside the *web* export, not the mobile export. The backend from the web export
is a strict superset of the mobile export's — same 26 models, no missing exports,
plus extra routes (`ai`, `delegations`, `login`, `representatives`) and services.

**Restored.** `forgot-password.tsx` was the one genuine capability lost between
the exports — the route file *and* the link to it had been dropped during an auth
redesign. It was restored and rewired from the Supabase path to Better Auth's OTP
flow, which is what the backend actually implements.

**Not lost, just moved.** `searchGovernmentLive` / `searchLegislationLive` /
`fetchDocumentDetails` moved server-side to `/api/government/*/search`.
`useVoteBill` was renamed `useCastVote`. `useRemoveVote` moved to `src/lib/hooks.ts`.

**Removed.** All five `@vibecodeapp/*` packages, the proxy import, the Vite
plugin, and the Metro wrapper. SVG handling — which the Metro wrapper had
provided — is now wired explicitly to `react-native-svg-transformer`.
`EXPO_PUBLIC_VIBECODE_BACKEND_URL` became `EXPO_PUBLIC_BACKEND_URL` (the old name
still works as a fallback), and the `candy-lark.vibecode.run` default host is
gone.

**Fixed.** `scripts/start` no longer runs `prisma db push --accept-data-loss` on
every boot, and `scripts/env.sh` no longer overwrites `DATABASE_URL` with a
SQLite path. Migration history was reassembled and an ordering bug corrected.
See `db/README.md` for both.

## Known gaps

- **Two migrations are written but not yet applied to production.**
  `20260812150000_repair_govref_columns_and_adminsession` and
  `20260812151000_add_direct_messaging` ship in this branch and must be deployed
  (`bunx prisma migrate deploy`) before the Citizen's Brief, delegation tallies,
  admin login, or messaging will work against the live database. Both are
  additive and idempotent. See `db/README.md`.
- Two production search functions are broken and left that way deliberately:
  `get_bill_with_cache_check` throws on every call, and
  `upsert_search_caches_from_bills` targets tables that are not in the schema it
  names. Both read the legacy snake_case schema, not the Prisma tables, and
  nothing in this repo calls either. See `db/live-objects/search-objects.sql`.
- Sharing a post into a DM renders if a message carries `sharedPost`, but nothing
  produces one — the `Message` table has no column for it. The render paths are
  typed and ready; wiring it needs a `sharedPostId` on the backend model.
- Still no tests in any package.
- The two auth systems above should be consolidated.
- `bun install` has not been run against these manifests since the
  `@vibecodeapp/*` packages were removed; those were private-registry packages
  and could not be resolved from outside Vibecode.
