#!/usr/bin/env bash
#
# The claim the whole migration story rests on: an empty Postgres, one command,
# a schema equivalent to schema.prisma.
#
# WHY THIS IS A FILE AND NOT ONLY A CI STEP. It was only a CI step, and so two
# commits in a row shipped a migration whose `updatedAt` column carried
# `DEFAULT CURRENT_TIMESTAMP` while schema.prisma declared no default. Local
# `bun run verify` was fifteen checks green; CI was red on the sixteenth, which
# local had no way to run. A gate that a developer cannot run before pushing is
# a gate that fails after pushing.
#
# Builds its own throwaway database so it can be run at any time against any
# working tree. Never touches DATABASE_URL from the environment — this project
# shares its database with another one, and a drift check that ran against
# production would be the most expensive kind of correct.
set -euo pipefail

HOST="${DRIFT_PGHOST:-127.0.0.1}"
PORT="${DRIFT_PGPORT:-5432}"
USER="${DRIFT_PGUSER:-postgres}"
export PGPASSWORD="${DRIFT_PGPASSWORD:-postgres}"

# Distinct per run, so two of these in parallel — or one left behind by an
# interrupted run — cannot collide.
DB="driftcheck_$$"

cleanup() {
  psql -h "$HOST" -p "$PORT" -U "$USER" -d postgres \
    -c "DROP DATABASE IF EXISTS \"$DB\";" >/dev/null 2>&1 || true
}
trap cleanup EXIT

psql -h "$HOST" -p "$PORT" -U "$USER" -d postgres -c "CREATE DATABASE \"$DB\";" >/dev/null

URL="postgresql://$USER:$PGPASSWORD@$HOST:$PORT/$DB"
export DATABASE_URL="$URL"
export DIRECT_URL="$URL"

bunx prisma migrate deploy >/dev/null

# --exit-code: 0 no difference, 2 there is one. Anything the migrations build
# that the schema does not describe (or the reverse) stops here.
if ! bunx prisma migrate diff \
      --from-url "$URL" \
      --to-schema-datamodel prisma/schema.prisma \
      --exit-code; then
  echo ""
  echo "The migrations and schema.prisma disagree — see the difference above."
  echo "Fix the MIGRATION to match the schema. Never edit a migration that has"
  echo "already been applied to a real database, and never reshape the database"
  echo "directly with a schema-push command — this database is shared with"
  echo "another project, so a push takes the other project's tables with it."
  exit 1
fi

echo "No drift: the migrations build exactly what schema.prisma describes."
