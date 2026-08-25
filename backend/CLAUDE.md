<ONE_WATER_SOURCE>
  HARD RULE: this backend IS the one water source. Mobile and web are two faucets on it. Turn on
  either and the same water comes out — same endpoints, same data shapes, same rules.

  Before adding or changing anything: grep `webapp/mobile/src/` for the endpoint the mobile app
  already calls and use THAT. Do not create a new route to serve the web app when mobile is
  already served — that splits the water source in two. If a route genuinely doesn't exist yet,
  say so and confirm before adding it.

  Any rule enforced here (auth, roles, permissions, validation) applies to BOTH faucets by
  definition — never gate a rule on which client is calling. And any instruction given about one
  client applies to the other too. See root CLAUDE.md <FEATURE_PARITY_BOTH_FAUCETS>.
</ONE_WATER_SOURCE>

<stack>
  Bun runtime, Hono web framework, Zod validation.
</stack>

<structure>
  src/index.ts     — App entry, middleware, route mounting
  src/routes/      — Route modules (create as needed)
</structure>

<routes>
  Create routes in src/routes/ and mount them in src/index.ts.

  Example route file (src/routes/todos.ts):
  ```typescript
  import { Hono } from "hono";
  import { zValidator } from "@hono/zod-validator";
  import { z } from "zod";

  const todosRouter = new Hono();

  todosRouter.get("/", (c) => {
    return c.json({ todos: [] });
  });

  todosRouter.post(
    "/",
    zValidator("json", z.object({ title: z.string() })),
    (c) => {
      const { title } = c.req.valid("json");
      return c.json({ todo: { id: "1", title } });
    }
  );

  export { todosRouter };
  ```

  Mount in src/index.ts:
  ```typescript
  import { todosRouter } from "./routes/todos";
  app.route("/api/todos", todosRouter);
  ```

  IMPORTANT: Make sure all endpoints and routes are prefixed with `/api/`
</routes>

<shared_types>
  Define all API contracts in src/types.ts as Zod schemas.
  This file is the single source of truth — both backend and frontend import from here.
</shared_types>

<curl_testing>
  ALWAYS test APIs with cURL after implementing.
  Use $BACKEND_URL environment variable, never localhost.
  Verify response matches the Zod schema before telling frontend it's ready.
</curl_testing>

<database>
  A database IS configured: Supabase Postgres, via Prisma. Do NOT run the database-auth skill —
  it sets up SQLite and reintroduces `prisma db push`, both of which break this project.

  Connection: DATABASE_URL (pooled) and DIRECT_URL (unpooled, for migrations). Neither has a
  fallback — a missing value fails the boot rather than resolving to something else. The old
  SUPABASE_DATABASE_URL indirection is gone along with the template that made it necessary.

  There is exactly one migration and it builds the schema from empty. `prisma migrate deploy`
  brings up a brand new database with no baseline file and no manual step; CI proves this on
  every push.

  <never_db_push>
    NEVER run `prisma db push` against this database, with or without --accept-data-loss.

    This database is SHARED with the AYE & NAY mobile project. `db push` makes the database
    match whichever schema is pushed and DELETES everything that schema lacks. Two projects
    pushing two different schemas means every boot destroys the other side's objects. On
    2026-08-08 this dropped User.banned here (423 rows) and dropped AdminSession plus three
    GovernmentReference columns on the mobile side, which broke admin login and 500'd /api/feed
    and /api/government-references/trending.

    Schema changes go through migrations, run deliberately:
      bunx prisma migrate dev --create-only --name <name>   # write it
      # read the generated SQL before applying
      bunx prisma migrate deploy                            # apply it

    Two rules for every migration here, because another project writes to this database too:
    1. ADDITIVE ONLY. No DROP TABLE, DROP COLUMN, or destructive ALTER. If something looks
       unused by this backend, assume it belongs to mobile.
    2. IDEMPOTENT. Use IF NOT EXISTS / IF EXISTS everywhere so it is safe to re-run.

    Keep schema.prisma a strict SUPERSET of the live database. That way, if a template sync
    re-adds the push line to scripts/start, the worst it can do is create missing objects
    instead of destroying real data. Columns kept solely for this reason are commented as such
    (e.g. User.banned) — do not "tidy them up" because this backend never reads them.
  </never_db_push>
</database>