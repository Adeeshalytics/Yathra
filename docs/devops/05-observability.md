# D5 — Observability

**Goal:** know that the site is up, how it is doing, and why when it is not — before a user
says so. Metrics, logs, dashboards and alerts, all as code, all free, and shipped with the
application so every new environment arrives already watched.

## What was added

| Path | What it does |
|------|--------------|
| [`apps/core/metrics.py`](../../backend/apps/core/metrics.py) | `/metrics` for Prometheus (internal only) and `yathra_events_total`, a counter of every business event |
| [`config/gunicorn.py`](../../backend/config/gunicorn.py) | Pools the metrics of gunicorn's worker processes |
| [`templates/monitoring.yaml`](../../deploy/charts/yathra/templates/monitoring.yaml) | Per environment: what to scrape (API, PostgreSQL), six alert rules, the dashboard |
| [`dashboards/yathra.json`](../../deploy/charts/yathra/dashboards/yathra.json) | The Grafana dashboard: traffic, business, platform, logs |
| [`deploy/tests/alerts.test.yaml`](../../deploy/tests/alerts.test.yaml) | Unit tests for the alert rules |
| [`deploy/platform/values`](../../deploy/platform/values) `kube-prometheus-stack`, `loki`, `alloy` | The monitoring stack, sized for one 12 GB node |
| [`.github/workflows/uptime.yml`](../../.github/workflows/uptime.yml) | Checks each site from outside every 15 minutes |

```
 API pods ──/metrics──┐            every pod's stdout ──► Alloy ──► Loki (7 days)
 PostgreSQL :9187 ────┤                                                │
 kube-state-metrics ──┼──► Prometheus (7 days) ──► alert rules ──► Alertmanager ──► (Discord)
 node-exporter ───────┤            │                                   │
 cert-manager ────────┘            └──────────────► Grafana ◄──────────┘
                                                   dashboards, logs, alerts

 GitHub Actions, every 15 min ──► https://<host>/api/v1/health/ ──► e-mail on failure
```

## The four signals

**Traffic, errors, latency** (the "golden signals"), from django-prometheus' middleware:
requests per second, the share of 5xx responses, and response-time percentiles per view.

**Business events.** The app already logs every important event with `log_event`
(`booking.created`, `payment.captured`, `seat.locked`, `auth.login_failed`, …). One added line
turns each of them into `yathra_events_total{event="…"}`, so dashboards show bookings and
payments per hour, and a spike in failed sign-ins is visible at a glance — no second set of
instrumentation calls scattered through the code. Event names are a fixed list written in the
code, so they are safe as a metric label (a label from user input could create unlimited
series and exhaust Prometheus' memory).

**Saturation:** memory and CPU per pod, container restarts, database connections, failed
scheduled jobs — from cAdvisor, kube-state-metrics and CloudNativePG's exporter.

**Logs:** every container's output, searchable in Grafana by namespace, pod and container. The
API logs JSON on the server, so the dashboard's log panel filters by `level`.

## Concepts, and why each choice was made

**Pull, not push.** Prometheus *scrapes* `/metrics` on each pod every 30 seconds. A
`ServiceMonitor` (API) and a `PodMonitor` (database) tell the Prometheus Operator what to
scrape — they live in the app's chart, so a new environment is scraped from its first minute.

**`/metrics` stays internal.** It is not routed by the ingress, and it answers only *direct*
requests from a private address: anything that came through a proxy carries
`X-Forwarded-For`, and gets a 404. Two independent locks, so a routing change cannot expose it.

**Scraping by pod IP.** Prometheus addresses each pod by IP, and Django rejects unknown `Host`
headers. The chart adds the pod's own IP (from the Kubernetes downward API) to
`DJANGO_ALLOWED_HOSTS` for that pod only.

**Several worker processes, one set of numbers.** gunicorn runs several workers; each has its
own counters, and a scrape reaches only one. With `PROMETHEUS_MULTIPROC_DIR`, every worker
writes its values to files that `/metrics` adds up, and `config/gunicorn.py` clears the
directory at start-up and retires the files of workers that exit. Verified: three failed
sign-ins, answered by different workers, show as `auth.login_failed = 3`.

**Alert on symptoms, with a delay.** Each rule has a `for:` duration so a one-scrape blip does
not page anyone, and alerts describe what a user would notice:

| Alert | Fires when | Severity |
|-------|-----------|----------|
| YathraApiDown | no API pod scraped for 5 minutes | critical |
| YathraHighErrorRate | over 5% of responses are 5xx for 10 minutes | warning |
| YathraSlowResponses | p95 latency over 1 s for 10 minutes | warning |
| YathraDatabaseDown | CloudNativePG reports PostgreSQL down for 2 minutes | critical |
| YathraScheduledJobFailing | a run of one of the CronJobs failed | warning |
| YathraCertificateExpiring | the TLS certificate has under 14 days left (renewal is failing) | warning |

Plus kube-prometheus-stack's standard rules (crash-looping pods, full disks, node pressure, …),
minus the ones about control-plane parts k3s does not expose.

**Alert rules are unit-tested.** `promtool test rules` feeds synthetic metrics to the real
rules and checks which alerts fire, with which labels and messages — including that they stay
quiet when they should (1% errors, fast responses, a failed migration Job that is not a
CronJob). CI runs the tests on every pull request. To prove the tests themselves bite, the
rules were broken on purpose (threshold 20% instead of 5%, no 5-minute delay): both broken
rules were caught.

**Logs without privileges.** Alloy reads pod logs through the Kubernetes API, so it runs as one
ordinary pod — not a DaemonSet with the node's log directory mounted. Loki keeps them 7 days on
local disk.

**Deterministic renders.** The Grafana chart normally creates an admin password at random on
every render; under Argo CD that changed a checksum on Grafana's pod on every sync and restarted
it forever. Grafana's login is switched off (it is reachable only by port-forward), so no admin
account is created at all, and the renders are stable.

**A check from outside.** If the server goes down, Prometheus and its alerts go down with it.
The *Uptime* workflow runs on GitHub's machines every 15 minutes and fails — so GitHub e-mails
you — when a site's health endpoint does not answer.

## Using it

```bash
cd deploy && make grafana
```

Open <http://localhost:3000> → *Dashboards* → **Yathra — yathra-local** (or `-staging`,
`-production` on the server). *Explore* → Loki for any log; *Alerting* for what is firing.

## Getting alerts on your phone (optional, free)

Alertmanager already evaluates and groups alerts; it only needs somewhere to send them. With
Discord: create a server, *Edit channel → Integrations → Webhooks → New webhook*, copy its URL.
Seal it for the cluster (only the cluster can read it):

```bash
kubectl create secret generic alertmanager-discord -n monitoring --from-literal=webhook-url='<the URL>' --dry-run=client -o yaml | kubeseal --format yaml > deploy/platform/alertmanager-discord.sealed.yaml
```

Then, in `deploy/platform/values/kube-prometheus-stack.yaml`, mount it and route to it:

```yaml
alertmanager:
  alertmanagerSpec:
    secrets: [alertmanager-discord]
  config:
    route:
      receiver: discord
    receivers:
      - name: discord
        discord_configs:
          - webhook_url_file: /etc/alertmanager/secrets/alertmanager-discord/webhook-url
```

Commit both (and apply the sealed file, or add it to an Argo CD Application), and every alert
reaches the channel.

## What testing on the local cluster found

- Argo CD installed the whole stack in sync waves; everything *Synced/Healthy*.
- Prometheus scrapes the API (`up = 1`) and PostgreSQL (`cnpg_collector_up = 1`, connections by
  state); request metrics by status, the event counter, and cert-manager's metrics all arrive.
- Loki receives logs from every namespace; Grafana has the dashboard and its three data sources;
  the alert rules load healthy (five locally — the certificate rule exists only with TLS on); Alertmanager shows its *Watchdog* test alert, proving the
  pipeline end to end.
- Bugs fixed along the way: Grafana restarting on every sync (above), WhiteNoise's position in
  the middleware list (it relied on `SecurityMiddleware` being first), the scrape logging a line
  every 30 seconds.
- Capacity: the whole local cluster — Argo CD, the platform, monitoring and one environment —
  uses about 4.3 GB. The 12 GB server runs two environments with room to spare.

## For your CV

- Built observability for a Django/Next.js platform on Kubernetes: Prometheus (golden signals
  plus business-event metrics), Loki and Grafana Alloy for logs, Grafana dashboards and
  Alertmanager — all as code, shipped in the application's Helm chart and deployed by Argo CD.
- Wrote alert rules for API availability, error rate, latency, database health, failing
  scheduled jobs and certificate expiry, unit-tested with `promtool` in CI.
- Added external uptime checks with scheduled GitHub Actions.

## Questions you should be able to answer

- What are the four golden signals, and where does each come from here?
- Pull vs push metrics — why does Prometheus scrape?
- Why can't a user ID or a URL with IDs be a Prometheus label? Why is the event name safe?
- How do metrics work when gunicorn runs four worker processes?
- Why do alert rules have a `for:` duration? Why alert on symptoms rather than causes?
- How would you prove an alert rule fires — without breaking production?
- Why is an external uptime check needed when Prometheus already alerts?
