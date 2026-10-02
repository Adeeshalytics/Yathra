# D6 — Reliability

**Goal:** the platform keeps working when traffic grows, when something inside the cluster is
compromised or misconfigured, and when data is lost — and each of those claims is *measured*,
not assumed. Network policies, a load test, autoscaling, continuous database backups with a
proven restore, and a runbook for the bad days.

## What was added

| Path | What it does |
|------|--------------|
| [`templates/networkpolicy.yaml`](../../deploy/charts/yathra/templates/networkpolicy.yaml) | Deny all inbound traffic to an environment's pods except the paths the app uses |
| [`deploy/tests/load/browse.js`](../../deploy/tests/load/browse.js) | k6 load test of the browsing journey, with pass/fail objectives (`make load-test`) |
| `backend.autoscaling` in the chart | A HorizontalPodAutoscaler for the API |
| [`templates/backup.yaml`](../../deploy/charts/yathra/templates/backup.yaml), [`barman-cloud`](../../deploy/argocd/base/barman-cloud.yaml) | Continuous WAL archiving + nightly base backups to object storage |
| [`infra/terraform/cluster/backups.tf`](../../infra/terraform/cluster/backups.tf) | The Oracle bucket and its S3-style keys |
| [`deploy/scripts/restore-drill.sh`](../../deploy/scripts/restore-drill.sh) | Backs up, restores into a new cluster, compares every table, times it |
| Two alerts | WAL archiving failing; no good backup in 26 hours (unit-tested) |
| [`runbook.md`](runbook.md) | What to do for every alert, and the routine operations |

## Network policies: zero trust inside the cluster

By default every pod in Kubernetes can connect to every other pod. If the web app — or any
pod — were compromised, it could reach the database directly. The chart now starts each
environment from **deny all inbound**, then allows exactly:

| To | From | Port |
|----|------|------|
| web | the ingress controller (Traefik, `kube-system`) | 3000 |
| API | the ingress controller; Prometheus (`monitoring`) | 8000 |
| Redis | this release's own pods | 6379 |
| PostgreSQL | this release's pods and the database pods; the CloudNativePG operator; Prometheus | 5432; 8000; 9187 |

Outbound traffic stays open: the API must reach DNS, the payment gateway, the routing service
and mail. k3s enforces policies with its built-in controller (kube-router).

**Tested** on the local cluster from two throwaway pods — one in another namespace, one in the
same namespace without the app's labels: API, web, PostgreSQL and Redis all refused them.
Through the ingress the site worked; Prometheus kept scraping; the operator kept the database
healthy; the scheduled jobs kept completing.

## Load testing: what one pod can take

[k6](https://k6.io) runs virtual users through *search a route → open a trip → load its seat
map*, with think time between steps. The run **fails** unless fewer than 1% of requests fail
and the slowest 5% take under 500 ms — the service-level objectives, written as code.

| Run | Requests/s | p95 | Errors | Notes |
|-----|-----------|-----|--------|-------|
| 20 users, 1 API pod | 16 | **107 ms** (search 125, seats 80) | 0% | All objectives met |
| 80 users, 1 API pod | 40 | 867 ms | 0% | API at 1.5 CPU cores, PostgreSQL at 0.5 → the bottleneck is the API's workers |
| 80 users, autoscaling 1→3 pods | **62** | 515 ms (median search **81 ms**, was 658) | 0% | Scaled to 3 pods within ~70 s |

**Two findings on the way:**
- The first run had 29% failures — all `429 Too Many Requests`, with every latency target met.
  The per-address rate limit works, and a load test from one machine is one address. Less
  obviously, DRF's `UserRateThrottle` *also* limits anonymous requests, per address, at the
  "user" rate (600/min) — raising only the anonymous rate was not enough. The local environment
  raises both, with a comment saying why.
- The test's first run failed fast and loudly ("No seeded routes found") on an unseeded cluster,
  instead of measuring empty searches.

## Autoscaling

A HorizontalPodAutoscaler adds API pods when their average CPU passes 70% of the request, up to
three, and removes them only after five calm minutes (scale up fast, down slowly, so one lull
does not throw away capacity the next burst needs). The chart then stops setting a replica
count — otherwise Argo CD and the autoscaler would keep undoing each other.

It is **on for the local cluster and off on the Oracle server**: one 2-core node gives extra pods
more concurrency but no more CPU. The CPU request is 200m so that staging and production both
fit that node — requests are reservations, and everything that is scheduled must fit.

## Backups: point-in-time recovery

CloudNativePG's **Barman Cloud plugin** (the operator's built-in backup support is deprecated in
its favour) sends:
- every **WAL segment** — PostgreSQL's log of every change — to object storage as it is written, and
- a full **base backup** every night at 02:00 Sri Lanka time.

A base backup plus the WAL after it can rebuild the database as it was at *any moment* in the
retention window (7 days), not just at 02:00. Storage: Oracle Object Storage through its
S3-compatible API (bucket and key pair created by Terraform), RustFS on the local cluster.

**The restore drill** (`make restore-drill`, or `deploy/scripts/restore-drill.sh <namespace>`):
1. takes a fresh backup,
2. counts the rows of every table in the live database,
3. builds a **new** PostgreSQL cluster from the object store alone,
4. counts again in the copy and compares, table by table,
5. prints the recovery time and deletes the copy.

**Result on the local cluster:** 33 tables and 1,664 rows, every table identical in the copy;
**restored in 60 seconds**. So: RPO (data that could be lost) ≈ the WAL not yet archived — under
five minutes, and seconds when the database is busy; RTO (time to restore) ≈ one minute at
today's size, plus pointing the app at the restored copy.

**What the first attempt found:** the backups were not working. Barman does not create buckets,
and the bucket did not exist — yet CloudNativePG's status said *"Continuous archiving is
working"* while every upload failed with `NoSuchBucket`. Two fixes came out of it: the local
store now creates its bucket (and Terraform creates the real one), and Prometheus now alerts when
PostgreSQL's own archiver statistics show the latest attempt failing — a status message is not
evidence. This is exactly why the drill exists: a backup that has never been restored is a hope.

## Going live — your part

1. `make -C infra apply` creates the bucket and key (needs `user_ocid` in `terraform.tfvars`).
2. In `deploy/environments/{staging,production}/values.yaml`, replace `NAMESPACE` in
   `backup.endpointURL` with the output of
   `terraform -chdir=infra/terraform/cluster output -raw backup_endpoint`.
3. Seal the keys for each environment and commit through a pull request:

   ```bash
   deploy/scripts/seal-backup-credentials.sh yathra-staging deploy/environments/staging/backup-credentials.yaml
   ```

   ```bash
   deploy/scripts/seal-backup-credentials.sh yathra-production deploy/environments/production/backup-credentials.yaml
   ```

4. After the first night, run `deploy/scripts/restore-drill.sh yathra-production` and record the
   result in the [runbook](runbook.md#restore-drill-monthly).

## For your CV

- Hardened a Kubernetes platform with default-deny network policies, verified by testing both
  allowed and forbidden paths from inside and outside the namespace.
- Load-tested with k6 against SLOs (p95 < 500 ms, < 1% errors), found the bottleneck (API
  workers, not the database), and added CPU-based horizontal autoscaling — throughput +55%,
  median latency 8× lower at four times the baseline load.
- Implemented continuous PostgreSQL backups with point-in-time recovery (CloudNativePG, Barman,
  S3-compatible object storage via Terraform) and an automated restore drill that verifies every
  table and measures recovery time; the first drill exposed silently failing backups.
- Wrote the operational runbook for every production alert.

## Questions you should be able to answer

- What does a default-deny network policy protect against? Why leave egress open here?
- What is the difference between a load test and a stress test? What did each tell you?
- Why scale up fast and down slowly? Why is autoscaling off on a single small node?
- What is WAL archiving, and how does it make point-in-time recovery possible?
- What are RPO and RTO? What are they for this set-up?
- Why is a restore drill necessary when backups "succeed"?
