# D3 — Kubernetes

**Goal:** Yathra runs on Kubernetes from one Helm chart — the API, the web app, their
scheduled jobs, PostgreSQL and Redis — with zero-downtime upgrades, migrations that cannot race
the code, secrets that are safe to keep in Git, and pods locked down to Kubernetes' strictest
security profile. Everything is proven on a local cluster that runs the same k3s as the server.

## What was added

| Path | What it does |
|------|--------------|
| [`deploy/charts/yathra`](../../deploy/charts/yathra) | The Helm chart, with a JSON schema that rejects typos and bad values in any environment's settings |
| [`deploy/environments/local`](../../deploy/environments/local) | Values for the local cluster (D4 adds staging and production) |
| [`deploy/platform`](../../deploy/platform) | Cluster-wide components: cert-manager, the CloudNativePG operator, the Sealed Secrets controller, Let's Encrypt issuers, Traefik settings |
| [`deploy/local/k3d.yaml`](../../deploy/local/k3d.yaml) | A local k3s cluster in Docker, pinned to the server's k3s version |
| [`deploy/Makefile`](../../deploy/Makefile) | `make up`, `make seed`, `make down`, … |
| [`deploy/scripts/new-app-secret.sh`](../../deploy/scripts/new-app-secret.sh) | Generates an environment's keys and seals them for one cluster |
| `infra.yml` → *Helm chart* job | Lint, schema-validate every environment, check every object against the Kubernetes 1.36 API, Trivy misconfiguration gate |

Also changed, because Kubernetes exposed them:

- **The frontend calls the API at `/api/v1` on its own host**, so one image serves every
  environment (it used to have the API's address compiled in).
- **A security fix:** rate limits could be bypassed with a forged `X-Forwarded-For` header
  (details below).

```
                         http(s)://<host>
                               │
                     Traefik ingress (k3s)  ── cert-manager: Let's Encrypt certificate
          ┌────────────────────┼─────────────────────────────┐
   /api  /static  /django-admin                              /
          │                                                  │
   Service yathra-api :8000                         Service yathra-web :3000
   Deployment yathra-api (gunicorn)                 Deployment yathra-web (Next.js)
     └ init: wait-for-migrations
          │            │
          │            └── Service yathra-redis → Deployment (cache, rate-limit counters)
          └── Service yathra-db-rw → CloudNativePG Cluster yathra-db (PostgreSQL 17, volume)
                                        └ Secret yathra-db-app  (generated password, "uri")
   Job       yathra-migrate-<tag hash>     manage.py migrate, once per image tag
   CronJobs  expire-seat-holds (1 min) · send-notifications (1 min) ·
             reconcile-payments (5 min) · refresh-route-paths (hourly)
   Secret    yathra-app  ← SealedSecret (encrypted, committed)
```

## How a release rolls out

1. `helm upgrade` (or, from D4, Argo CD) applies the new image tag.
2. A **new migration Job** starts — its name contains a hash of the tag, so every release gets
   exactly one, and Kubernetes' rule that Jobs cannot be edited is never in the way.
3. A **new API pod** starts. Its init container runs `manage.py migrate --check` in a loop and
   only lets the pod start once the schema is up to date. **Old pods keep serving.**
4. The new pod passes its **readiness** probe (database and cache reachable) and joins the
   Service. Only then is an old pod stopped (`maxUnavailable: 0`, `maxSurge: 1`).
5. The old pod's `preStop` pause gives the ingress a few seconds to stop sending it requests
   before gunicorn shuts down — no dropped connections.

Because old and new code briefly share one database, migrations must be **backward compatible**
(*expand → migrate → contract*): add a column in one release, start using it, and only drop the
old one in a later release.

## Concepts, and why each choice was made

**Helm, with a schema.** The chart is the template; each environment is a short values file
listing only what differs. `values.schema.json` makes Helm refuse `backend.replica: 2` (typo)
or `logFormat: xml` (not allowed) at render time, instead of silently ignoring them.

**One host, and the frontend calls `/api/v1`.** The ingress sends `/api`, `/static` and the
Django admin path to the API and everything else to the web app. The browser calls the API on
its own origin, so there is no CORS, the refresh cookie is first-party, the Content-Security-
Policy only needs `'self'`, and — the real win — one frontend image works on any domain:
*build once, deploy everywhere*.

**Three probes, three questions.**
- *Startup:* has the process finished booting? (Generous, so a slow start is not a crash.)
- *Liveness:* is the process alive? It checks nothing else (`/api/v1/health/live/`). If it
  checked the database, a database outage would make Kubernetes restart every API pod at once.
- *Readiness:* can it serve right now? Database and cache (`/api/v1/health/`). A failing pod is
  taken out of the Service but not restarted.
- The kubelet sends probes with the pod's IP as the `Host` header, which Django's
  `ALLOWED_HOSTS` rejects with a 400. The probes send the site's host name instead.

**Migrations without Helm hooks.** Hooks (`pre-upgrade`) look tempting, but on a first install a
pre-install hook runs before the database exists, and Argo CD (D4) translates hooks in its own
way. A Job per image tag plus a "wait until migrated" init container works identically under
Helm and Argo CD, on install and on upgrade.

**CronJobs for the scheduled commands.** `concurrencyPolicy: Forbid` (never two copies of the
same command), `startingDeadlineSeconds` (a missed slot is skipped, not piled up), Sri Lanka
time zone, short history. They wait for migrations too: testing showed a job firing between a
new release and its migration (`relation "bookings_booking" does not exist`).

**An operator for PostgreSQL.** CloudNativePG is a Kubernetes *operator*: it watches `Cluster`
objects and does what a DBA would — creates the database and owner, generates the password and
publishes it as a Secret (`yathra-db-app`, key `uri` = a ready connection URL), runs failover,
backups (D6) and upgrades. No database password is ever typed or stored anywhere.

**Redis as a cache only.** Rate-limit counters and cached responses — nothing that must survive
a restart, so no persistence, an LRU eviction policy and a memory cap.

**Sealed Secrets.** Secrets cannot go into Git in plain text (base64 is not encryption). The
controller in the cluster holds a private key; `kubeseal` encrypts with its public key, and only
that controller can decrypt. The encrypted `SealedSecret` is safe to commit, and Argo CD (D4) can
apply it like any other file. The keys are random and generated per environment by
`new-app-secret.sh`, never seen by a person.

**The "restricted" Pod Security Standard**, enforced on the namespace — Kubernetes rejects any
pod that does not comply:
- runs as a non-root numeric user (the images' own `app`/`nextjs` users: 999 and 100),
- read-only root filesystem (only `/tmp` and Next.js' cache directory are writable volumes),
- no privilege escalation, every Linux capability dropped, the default seccomp profile,
- no Kubernetes API token mounted (`automountServiceAccountToken: false`) — the app never
  talks to the Kubernetes API, so a compromised pod gets no credentials for it.

**Requests and memory limits, but no CPU limits.** Requests reserve capacity and let the
scheduler plan. A memory limit stops a leak from taking the node down. CPU limits throttle a
pod even when the node is idle and are widely recommended against for latency-sensitive apps.

**Real client addresses through the ingress.** The API rate-limits sign-ins, sign-in codes and
"Find my booking" per client address. Two things make that work behind Traefik:
1. `externalTrafficPolicy: Local` on Traefik's Service, so the client's real address reaches
   Traefik instead of an internal one (otherwise every visitor shares one limit).
2. `TRUSTED_PROXY_COUNT=1`, so Django takes the address Traefik appended to `X-Forwarded-For`.

**The bug this uncovered.** Designing (2) showed that Django REST framework's `NUM_PROXIES` was
unset, and in that case DRF identifies callers by the *whole* `X-Forwarded-For` header — which
the client controls. Sending a different made-up value with each request escaped every
per-address limit, including the brute-force protection on sign-in. Fixed for every
deployment, not just Kubernetes; a regression test fails on the old behaviour.

**HTTPS.** cert-manager requests Let's Encrypt certificates and renews them. Start an
environment on the `letsencrypt-staging` issuer (untrusted certificates, generous limits) and
switch to `letsencrypt-prod` once it works. On the server, Traefik redirects all plain HTTP to
HTTPS *except* Let's Encrypt's challenge requests (`allowACMEByPass`), which must stay on HTTP.

**Local parity.** k3d runs the very same k3s version in Docker, with the same Traefik, local-path
storage and network-policy controller. Two Windows details are handled in `k3d.yaml`: the API is
bound to `127.0.0.1` (k3d's default address resolves to the LAN IP, which the firewall blocks)
and the site is on port 80, so the test payment gateway's return URLs line up.

## Accepted scanner findings

The Trivy gate fails on HIGH or CRITICAL; there are none. The remaining lower findings are
deliberate:

| Finding | Why it stays |
|---------|--------------|
| CPU not limited | Deliberate, see above |
| UID/GID ≤ 10000 | The images' own non-root users (999, 100); they are not root, which is what matters |
| Image from an untrusted registry | Trivy's default list does not include `ghcr.io` |
| ConfigMap with sensitive content | False positive: it matches the name `DJANGO_LOG_LEVEL` |

## What testing on the local cluster found

1. **The rate-limit bypass** above.
2. **Duplicate labels** on the components (kubeconform refused the manifests).
3. **A migration race** for the CronJobs on first install — fixed with the same wait.
4. **The startup probe's 1-second default timeout** was too short for gunicorn's first request.
5. **k3d on Windows** pointed kubectl at a firewalled LAN address.
6. **The test gateway's return URL** missed the port the local cluster used — now port 80.

Then the whole customer journey ran against the cluster: search → seat hold → booking →
checkout → test-gateway payment → **confirmed**, QR e-ticket, PDF ticket (rendered by ReportLab
on a read-only filesystem), and the ticket text message delivered by the notification worker.
An upgrade rolled out with the new pod ready before the old one stopped.

## Running it locally

Needs Docker Desktop, plus `k3d`, `kubectl`, `helm`, `kubeseal` and `openssl`
([setup-wsl.sh](../../infra/scripts/setup-wsl.sh) installs all but k3d and Docker; inside WSL,
turn on *Docker Desktop → Settings → Resources → WSL integration* for Ubuntu).

```bash
cd deploy && make up
```

```bash
make seed
```

Open <http://yathra.localhost>. `make seed` prints the demo accounts' password (the accounts
are listed in [setup.md](../setup.md)). `make status` shows pods, jobs and the database;
`make down` deletes the cluster.

## On the Oracle server

D4 makes this automatic with Argo CD. By hand, it would be: `deploy/platform/install.sh oracle`,
create the namespace with the restricted label, `new-app-secret.sh` the secret, and
`helm upgrade --install` with that environment's host and `tls.enabled=true`.

## For your CV

- Packaged a Django + Next.js platform as a Helm chart (values schema, per-environment values)
  with zero-downtime rolling updates, startup/liveness/readiness probes, CronJobs, and a
  migration strategy that cannot race the code — no Helm hooks, so it works unchanged under
  Argo CD.
- Ran PostgreSQL on Kubernetes with the CloudNativePG operator (generated credentials,
  no passwords in Git) and managed secrets with Sealed Secrets.
- Hardened every workload to the Kubernetes "restricted" Pod Security Standard (non-root,
  read-only root filesystem, no capabilities, no service-account tokens), validated in CI with
  kubeconform and Trivy.
- Found and fixed a rate-limit bypass (forged `X-Forwarded-For`) while designing client-IP
  handling behind the ingress.

## Questions you should be able to answer

- Liveness vs readiness vs startup probe — what happens when each fails?
- Why does this chart avoid Helm hooks for migrations? What makes a migration safe to run while
  the previous release is still serving?
- What does `maxUnavailable: 0` with `maxSurge: 1` do during a rollout? What is `preStop` for?
- What is a Kubernetes operator? What does CloudNativePG do that a plain StatefulSet would not?
- Why is a Kubernetes Secret not secure in Git, and how does Sealed Secrets fix that? What
  happens to the sealed files if the cluster (and its key) is lost?
- What does the "restricted" Pod Security Standard require?
- Why set memory limits but not CPU limits?
- How can `X-Forwarded-For` be forged, and how many entries of it should an app trust?
- Why serve the API and the web app from one host?
