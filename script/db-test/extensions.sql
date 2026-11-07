-- Extensions the working database has in public; the test Postgres needs them before any test migrates
-- (test ctxs run with search_path pg_temp, where CREATE EXTENSION would fail).
-- vector first: pg_search declares it as a required extension.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_search;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;
CREATE EXTENSION IF NOT EXISTS pg_ivm;
CREATE EXTENSION IF NOT EXISTS postgis;
