#!/usr/bin/env bash
#
# The forbidden schema command must not appear in anything executable.
#
# WHY. Two backends shared one Postgres instance and each reshaped the database
# to match its own schema at boot, so whichever booted last won: 423 rows of
# User.banned destroyed, twelve GovernmentReference columns and the AdminSession
# table dropped and recreated 507 times in 16 days. That database is still
# shared with another project.
#
# WHY IT IS A FILE. It was a CI job only, and CI is the wrong place to learn
# this. The same gap sent two commits to a red build over a migration default,
# and then a third over this very scan — which caught a warning message in a
# script I had just written to close the first gap. Every gate CI runs should
# be runnable here, before pushing.
#
# Lines carrying `guard-self` are skipped: this file and the workflow both have
# to name the thing they forbid in order to search for it.
set -uo pipefail

cd "$(dirname "$0")/.."

# guard-self on the pattern below — it is the phrase being searched for.
if grep -rnE 'prisma[[:space:]]+db[[:space:]]+push' \
     --include='*.sh' --include='start' --include='Dockerfile' \
     --include='package.json' --include='*.yml' --include='*.yaml' \
     . 2>/dev/null | grep -v 'guard-self' | grep -vE '^[^:]+:[0-9]+:[[:space:]]*#'; then
  echo ""
  echo "The forbidden schema command is in an executable file, listed above."
  echo "Use 'prisma migrate deploy'. If the line only mentions the command in"
  echo "prose, reword it — or mark that line guard-self if it genuinely must"
  echo "spell it out."
  exit 1
fi

echo "No schema-push command in any executable file."
