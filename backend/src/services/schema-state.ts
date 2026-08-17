/**
 * Has every migration in this build actually run against the database?
 *
 * The commit stamp on /health answers "is this the right code". This answers
 * the question underneath it, which is the one that stays silent longest: the
 * container can be running the newest commit while the database is still
 * shaped like an older one. `prisma migrate deploy` runs in CMD before the
 * server starts, so a failure there means the server never boots — but a
 * partially applied migration, a rolled-back one, or a database swapped out
 * from under a running container all leave a live, healthy-looking API serving
 * against a schema it was not written for.
 *
 * Nobody clicks a migration. Without this, the first symptom is a column that
 * does not exist, surfacing as a 500 on whichever endpoint touches it first.
 *
 * Read-only, and deliberately so: this database is shared with another project.
 * It reads the migrations directory that shipped in the image and compares it
 * to Prisma's own ledger. It never writes, and never applies anything.
 */

import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "../prisma";

export interface SchemaState {
  /** Migrations present in this build. */
  expected: number;
  /** Of those, how many the database has recorded as finished. */
  applied: number;
  /** In this build but not applied — the dangerous set. */
  pending: string[];
  /** Applied but started and never finished; Prisma marks these. */
  failed: string[];
  /** The newest migration this build carries. */
  latest: string | null;
  /** Null when the ledger could not be read at all. */
  reachable: boolean;
}

/** Migration directory names, which sort chronologically by construction. */
function migrationsOnDisk(): string[] {
  for (const dir of [join(process.cwd(), "prisma", "migrations"), join(import.meta.dir, "..", "..", "prisma", "migrations")]) {
    if (!existsSync(dir)) continue;
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  }
  return [];
}

/**
 * Cached, because /health is polled by the platform's own health check and this
 * costs a query. Thirty seconds is short enough that a bad deploy is visible
 * within one refresh and long enough that polling does not add load.
 *
 * HEALTH_SCHEMA_TTL_MS=0 turns it off, which is what the tests do so they can
 * change the ledger and see the answer change.
 */
let cached: { at: number; state: SchemaState } | null = null;
const TTL_MS = Number(process.env.HEALTH_SCHEMA_TTL_MS ?? 30_000);

export async function schemaState(): Promise<SchemaState> {
  if (cached && TTL_MS > 0 && Date.now() - cached.at < TTL_MS) return cached.state;

  const expected = migrationsOnDisk();
  const latest = expected.at(-1) ?? null;

  let rows: { migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }[];
  try {
    rows = await prisma.$queryRaw<typeof rows>`
      SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations"
    `;
  } catch {
    const state: SchemaState = {
      expected: expected.length,
      applied: 0,
      pending: [],
      failed: [],
      latest,
      reachable: false,
    };
    cached = { at: Date.now(), state };
    return state;
  }

  const finished = new Set(
    rows.filter((row) => row.finished_at !== null && row.rolled_back_at === null).map((r) => r.migration_name),
  );
  const failed = rows
    .filter((row) => row.finished_at === null || row.rolled_back_at !== null)
    .map((row) => row.migration_name);

  const state: SchemaState = {
    expected: expected.length,
    applied: expected.filter((name) => finished.has(name)).length,
    pending: expected.filter((name) => !finished.has(name)),
    failed,
    latest,
    reachable: true,
  };
  cached = { at: Date.now(), state };
  return state;
}
