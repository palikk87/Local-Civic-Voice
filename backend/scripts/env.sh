#!/bin/bash
# Shared environment setup for backend scripts.
#
# This file used to be regenerated from the Vibecode backend template, which in
# production unconditionally did:
#
#     export DATABASE_FILE="${DATA_DIR}/production.db"
#     export DATABASE_URL="file:${DATABASE_FILE}"
#
# The template assumed every backend was local SQLite. This project is Supabase
# Postgres, so that export silently replaced the real database: the server
# refused to boot and every /api/* call on the live site returned 502. The
# workaround was to read SUPABASE_DATABASE_URL instead — a variable the template
# did not touch — which is why prisma/schema.prisma and src/env.ts still use
# that name.
#
# Now that the project is off Vibecode, nothing regenerates this file and
# nothing clobbers DATABASE_URL. The SUPABASE_DATABASE_URL indirection is kept
# because production is configured with it today; see db/README.md for how to
# collapse it back to plain DATABASE_URL when convenient.

ENVIRONMENT="${ENVIRONMENT:-development}"

if [[ "${ENVIRONMENT}" == "production" ]]; then
  echo "Starting in production mode..."
  export NODE_ENV="production"
else
  echo "Starting in development mode..."
  export NODE_ENV="development"
fi
