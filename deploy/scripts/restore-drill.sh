#!/usr/bin/env bash
# Restore drill: prove the backups can actually be restored, and measure how long it takes.
#
#   deploy/scripts/restore-drill.sh <namespace>        e.g. yathra-staging
#
#   1. takes a fresh backup of the environment's database,
#   2. counts the rows of every table in the live database,
#   3. builds a NEW PostgreSQL cluster from the object store alone (base backup + WAL),
#   4. counts the rows again in the restored copy and compares,
#   5. reports the time to restore, then deletes the copy (KEEP=1 keeps it).
#
# The live database is only read from. A backup that has never been restored is a hope, not a
# backup — run this monthly, and after any change to the backup set-up.
set -euo pipefail

NS=${1:?usage: restore-drill.sh <namespace>}
DB=${DB_CLUSTER:-yathra-db}
DRILL="$DB-drill"
STAMP=$(date -u +%Y%m%d%H%M%S)
WORK=$(mktemp -d)

step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
cleanup() {
  rm -rf "$WORK"
  if [[ "${KEEP:-0}" != 1 ]]; then
    kubectl -n "$NS" delete cluster "$DRILL" --ignore-not-found --wait=false >/dev/null
  fi
}
trap cleanup EXIT

# Exact row counts of every table, one line per table: "<table>|<rows>".
COUNT_SQL="SELECT table_name || '|' || (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', table_schema, table_name), false, true, '')))[1]::text FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name"
counts() { kubectl -n "$NS" exec "$1" -c postgres -- psql -d yathra -tAc "$COUNT_SQL"; }

step "1. A fresh backup of $NS/$DB"
kubectl -n "$NS" apply -f - <<EOF
apiVersion: postgresql.cnpg.io/v1
kind: Backup
metadata:
  name: $DB-drill-$STAMP
spec:
  cluster:
    name: $DB
  method: plugin
  pluginConfiguration:
    name: barman-cloud.cloudnative-pg.io
EOF
kubectl -n "$NS" wait "backup/$DB-drill-$STAMP" --for=jsonpath='{.status.phase}'=completed --timeout=15m

step "2. Row counts in the live database"
primary=$(kubectl -n "$NS" get cluster "$DB" -o jsonpath='{.status.currentPrimary}')
counts "$primary" >"$WORK/live"
echo "$(wc -l <"$WORK/live") tables, $(awk -F'|' '{s += $2} END {print s}' "$WORK/live") rows"

step "3. Restore into a new cluster, $DRILL, from the object store"
image=$(kubectl -n "$NS" get cluster "$DB" -o jsonpath='{.spec.imageName}')
size=$(kubectl -n "$NS" get cluster "$DB" -o jsonpath='{.spec.storage.size}')
started=$(date +%s)
kubectl -n "$NS" apply -f - <<EOF
apiVersion: postgresql.cnpg.io/v1
kind: Cluster
metadata:
  name: $DRILL
  labels:
    app.kubernetes.io/part-of: yathra-restore-drill
spec:
  instances: 1
  imageName: $image
  storage:
    size: $size
  bootstrap:
    recovery:
      source: origin
  externalClusters:
    - name: origin
      plugin:
        name: barman-cloud.cloudnative-pg.io
        parameters:
          barmanObjectName: $DB-backups
          serverName: $DB
  resources:
    requests:
      cpu: 100m
      memory: 256Mi
    limits:
      memory: 512Mi
EOF
kubectl -n "$NS" wait "cluster/$DRILL" --for=condition=Ready --timeout=20m
restore_seconds=$(($(date +%s) - started))

step "4. Row counts in the restored copy"
counts "$DRILL-1" >"$WORK/restored"

if diff -u "$WORK/live" "$WORK/restored" >"$WORK/diff"; then
  echo "Every table matches ($(wc -l <"$WORK/live") tables)."
  result=PASSED
else
  # Rows written after the backup appear only once their WAL is archived (within 5 minutes).
  echo "Differences (live → restored):"
  cat "$WORK/diff"
  result=DIFFERENT
fi

step "5. Result"
echo "Restore drill $result — backup $DB-drill-$STAMP restored in ${restore_seconds}s (recovery time)."
[[ "$result" == PASSED ]]
