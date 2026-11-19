#!/usr/bin/env bash
# Creates a throwaway database, loads the Supabase stand-in + the real migration, and runs the sync tests.
# Usage: DATABASE_URL=postgres://postgres@localhost:5432 tests/run-cloud-tests.sh
set -euo pipefail
cd "$(dirname "$0")/.."
BASE=${DATABASE_URL:-postgres://postgres@localhost:5433}
DB=noveltyos_test
psql "$BASE/postgres" -qc "drop database if exists $DB" -c "create database $DB"
psql "$BASE/$DB" -q -v ON_ERROR_STOP=1 -f tests/supabase-stub.sql
for f in supabase/migrations/*.sql; do psql "$BASE/$DB" -q -v ON_ERROR_STOP=1 -f "$f"; done
DATABASE_URL="$BASE/$DB" node --no-warnings --import ./tests/ts-resolve.mjs tests/sync.test.mts
