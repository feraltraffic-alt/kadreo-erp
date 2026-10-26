#!/bin/sh
# The application connects as a non-owner role so row-level security applies (spec 5.1 p. 3).
# Flyway migrates as the database owner (POSTGRES_USER).
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
CREATE ROLE kadreo_app LOGIN PASSWORD '${APP_DB_PASSWORD:-kadreo_app}';
GRANT CONNECT ON DATABASE "$POSTGRES_DB" TO kadreo_app;
SQL
