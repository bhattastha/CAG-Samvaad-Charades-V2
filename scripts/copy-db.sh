#!/usr/bin/env bash
# Copies every public table from OLD to NEW Postgres (same schema already migrated on NEW). Usage: OLD=... NEW=... copy-db.sh
set -euo pipefail
: "${OLD:?}" "${NEW:?}"
DIR=$(mktemp -d /root/dbcopy.XXXX)
# tables in foreign-key order (parents first)
ORDER=$(psql "$OLD" -At -c "
WITH RECURSIVE t AS (SELECT c.oid, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r'),
d AS (SELECT conrelid AS child, confrelid AS parent FROM pg_constraint WHERE contype='f' AND conrelid<>confrelid),
lvl AS (SELECT oid, 0 AS l FROM t WHERE oid NOT IN (SELECT child FROM d)
        UNION ALL SELECT d.child, lvl.l+1 FROM d JOIN lvl ON d.parent=lvl.oid)
SELECT t.relname FROM t JOIN (SELECT oid, max(l) l FROM lvl GROUP BY oid) m USING (oid) ORDER BY m.l, t.relname;")
REV=$(echo "$ORDER" | tac | paste -sd, -)
psql "$NEW" -q -c "TRUNCATE $REV CASCADE;"
for T in $ORDER; do
  COLS=$(psql "$OLD" -At -c "SELECT string_agg(quote_ident(column_name), ',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema='public' AND table_name='$T' AND column_name IN (SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='$T')")
  NEWCOLS=$(psql "$NEW" -At -c "SELECT string_agg(column_name, ',') FROM information_schema.columns WHERE table_schema='public' AND table_name='$T'")
  KEEP=$(echo "$COLS" | tr ',' '\n' | while read -r c; do b=${c//\"/}; echo ",$NEWCOLS," | grep -q ",$b," && echo "$c"; done | paste -sd, -)
  psql "$OLD" -q -c "\copy (SELECT $KEEP FROM $T) TO '$DIR/$T.csv' WITH (FORMAT csv)"
  psql "$NEW" -q -c "\copy $T ($KEEP) FROM '$DIR/$T.csv' WITH (FORMAT csv)"
  A=$(psql "$OLD" -At -c "SELECT count(*) FROM $T"); B=$(psql "$NEW" -At -c "SELECT count(*) FROM $T")
  echo "$T old=$A new=$B $([ "$A" = "$B" ] && echo OK || echo MISMATCH)"
done
# serial / identity sequences follow the copied max ids
psql "$NEW" -At -c "SELECT format('SELECT setval(%L, COALESCE((SELECT max(%I) FROM %I), 1));', pg_get_serial_sequence(table_name, column_name), column_name, table_name) FROM information_schema.columns WHERE table_schema='public' AND pg_get_serial_sequence(table_name, column_name) IS NOT NULL" | psql "$NEW" -q -At >/dev/null
rm -rf "$DIR"
echo done
