# Runbook

What to do when something goes wrong, and how to do the routine jobs. Every alert in
[05-observability.md](05-observability.md) has a section here. Commands assume
`KUBECONFIG=~/.kube/yathra.yaml` and `NS=yathra-production` (or `yathra-staging`).

First look, whatever the problem:

```bash
kubectl -n $NS get pods,jobs
```

```bash
kubectl -n argocd get applications
```

Grafana (`make -C deploy grafana`) → **Yathra — $NS**: traffic, errors, latency, restarts and the
API's warnings and errors in one place.

---

## Alerts

### YathraApiDown — the API has no healthy pods (critical)

1. `kubectl -n $NS get pods -l app.kubernetes.io/name=api` — what state are they in?
   - **`Init:0/1` for a long time**: the pods are waiting for migrations. Check the migration Job
     (below, *A migration failed*).
   - **`CrashLoopBackOff`**: `kubectl -n $NS logs deploy/yathra-api -c api --previous` shows the
     error. A bad release → roll back (below).
   - **`Running` but not ready**: readiness checks the database and cache — see
     *YathraDatabaseDown*, and `kubectl -n $NS get pods -l app.kubernetes.io/name=redis`.
   - **`Pending`**: the node is out of memory or CPU — `kubectl describe pod` says which;
     `kubectl top pods -A --sort-by=memory` shows who is using it.
2. Is the whole server down? The *Uptime* workflow in GitHub Actions fails too, and
   `make -C infra ssh` does not connect → Oracle console → *Compute → Instances*: start it.

### YathraHighErrorRate — over 5% of responses are 5xx (warning)

1. Grafana → *Logs* panel, or:
   `kubectl -n $NS logs deploy/yathra-api -c api --since=15m | grep ERROR`
   Each line carries a `request_id`; the same id is in the response's `X-Request-ID` header.
2. Started with a release? `kubectl -n argocd get application yathra-<env> -o jsonpath='{.status.sync.revision}'`
   → roll back (below).
3. Started without a release? Usually the database or an outside service (payment gateway,
   routing service) — the error lines name it.

### YathraSlowResponses — p95 over one second (warning)

1. Grafana → *CPU by pod* and *Memory by pod*. API pods at their limit → more pods
   (`backend.replicas`, or autoscaling) or more gunicorn `backend.workers`, by pull request.
   The load test measured ~40 requests/s per pod before slowing down.
2. One slow view (Grafana → *Response time*, or Prometheus:
   `topk(5, histogram_quantile(0.95, sum by (le, view) (rate(django_http_requests_latency_seconds_by_view_method_bucket{namespace="$NS"}[5m]))))`)
   → a slow query; the database's own metrics (connections) and `EXPLAIN` it.

### YathraDatabaseDown — PostgreSQL is not responding (critical)

1. `kubectl -n $NS get cluster yathra-db` and `kubectl -n $NS describe cluster yathra-db` —
   CloudNativePG says what it is doing (restarting, recovering, out of disk).
2. `kubectl -n $NS logs yathra-db-1 -c postgres --tail=100`.
3. **Disk full**: raise `postgres.storage.size` by pull request (the volume grows in place).
4. **Data lost or corrupted**: restore from backup (below).

### YathraScheduledJobFailing — a CronJob run failed (warning)

`kubectl -n $NS logs job/<the failed job>`. The jobs are safe to re-run; to run one now:
`kubectl -n $NS create job --from=cronjob/yathra-send-notifications manual-$(date +%s)`.
Failed runs stay listed (the last three) until a later run succeeds.

### YathraCertificateExpiring — under 14 days left (warning)

cert-manager renews 30 days ahead, so renewal has been failing for two weeks.
`kubectl -n $NS describe certificate` and `kubectl -n $NS get challenges` — usually the domain
no longer points at the server, or port 80 is blocked (Let's Encrypt checks over plain HTTP).

---

## Routine operations

### Deploy

Merge to `main`: CI builds the images and commits the new tag to staging; Argo CD rolls it
out. Production: `deploy/scripts/promote.sh`, then merge the pull request it links to.

### Roll back

Production: `deploy/scripts/promote.sh sha-<previous tag>` and merge — or revert the promotion
commit. Staging: revert the `deploy(staging)` commit. Argo CD applies either within two minutes.
**The database is not rolled back** — which is why migrations must stay backward compatible.

### A migration failed

`kubectl -n $NS logs job/yathra-migrate-<hash>`. The new API pods wait, the old ones keep
serving, so nothing is down. Fix the migration and release again; the next image tag gets a
new migration Job.

### Restore the database

Backups: every WAL segment is archived continuously, plus a full backup nightly at 02:00; kept
7 days. To restore, create a new cluster from the object store — exactly what the drill does:
`KEEP=1 deploy/scripts/restore-drill.sh $NS` leaves the restored copy, `yathra-db-drill`,
running. To restore to a moment *before* a mistake, add a recovery target to the drill
cluster's `bootstrap.recovery`:

```yaml
recoveryTarget:
  targetTime: "2026-10-02 14:30:00+05:30"
```

Then point the app at it: `postgres.enabled: false` with `postgres.external.secretName:
yathra-db-drill-app` — or, simpler, take a fresh backup of the copy and make it the new
`yathra-db` during a short maintenance window.

### Restore drill (monthly)

`deploy/scripts/restore-drill.sh $NS` — backs up, restores into a new cluster, compares the row
count of every table, prints the recovery time, and cleans up. Record the time below.

| Date | Environment | Result | Recovery time |
|------|-------------|--------|---------------|
| 2026-10-02 | local (k3d) | Passed — 33 tables, 1,664 rows identical | 60 s |

### Rotate the app's keys

`deploy/scripts/new-app-secret.sh $NS deploy/environments/<env>/secrets.yaml --values`, commit
by pull request. New `DJANGO_SECRET_KEY` signs everyone out (sessions and tokens are signed
with it).

### The node's IP changed / SSH or kubectl time out

`make -C infra my-ip`, update `admin_cidrs` in `infra/terraform/cluster/terraform.tfvars`,
`make -C infra apply`.

### Rebuild everything from scratch

`make -C infra apply configure`, then `deploy/argocd/install.sh oracle`, then seal the secrets
again (a new cluster has a new Sealed Secrets key), then restore the database from backup.
