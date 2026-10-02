# DevOps track

Taking Yathra from "runs on my laptop" to "runs in the cloud, deployed automatically, watched
and backed up" — using free services only. Each phase is built, reviewed and written up before
the next starts. Every phase note ends with what it is worth on a CV and the questions you
should be able to answer about it.

| Phase | What it adds | Status |
|-------|--------------|--------|
| **D1 — CI** | GitHub Actions: lint, tests on real Postgres, production image builds, Trivy / CodeQL / gitleaks scans, Dependabot, multi-arch images on GHCR with signed provenance | [Notes](01-ci.md) |
| **D2 — Infrastructure as code** | Terraform for Oracle Cloud (network, Arm node, remote state with locking, quota + budget guardrails), Ansible to harden the server and install k3s | [Notes](02-iac.md) |
| **D3 — Kubernetes** | Helm chart (API, web, migration Job, CronJobs, CloudNativePG, Redis, ingress), cert-manager, Sealed Secrets, "restricted" pod security, tested end to end on a local k3d cluster | [Notes](03-kubernetes.md) |
| **D4 — GitOps** | Argo CD app-of-apps: CI commits the image tag, staging syncs itself, production is promoted by pull request, rollback is `git revert`; bootstrapped from an empty cluster | [Notes](04-gitops.md) |
| **D5 — Observability** | Prometheus (golden signals + business-event metrics), Loki + Alloy logs, Grafana dashboard and unit-tested alert rules shipped in the chart, external uptime checks | [Notes](05-observability.md) |
| D6 — Reliability | Nightly backups to object storage + a restore drill, k6 load test of search → hold → book, autoscaling, network policies, runbook | Planned |

## Free services this relies on

| Need | Service | Notes |
|------|---------|-------|
| CI minutes, ARM runners, image registry | GitHub Actions, GHCR | Unlimited for public repositories |
| Servers | Oracle Cloud Always Free, on a Pay As You Go account | Arm (A1): 2 OCPUs and 12 GB all month; 200 GB of disk; 20 GB of object storage (10 GB standard on Pay As You Go). The account is upgraded because free-only accounts kept getting "Out of host capacity"; quotas and budget alerts keep it at zero ([D2](02-iac.md)) |
| DNS, TLS | Cloudflare (free plan), Let's Encrypt | |
| Domain | See below | |
| E-mail | Brevo or Resend free tier | Texts stay on the console backend (Notify.lk is paid) |
| Payments | PayHere sandbox | The public site is a demo; it runs `config.settings.staging` |

### Domain options without the GitHub Student Pack

1. **DuckDNS** (`yathra.duckdns.org`) — instant, free, works with Let's Encrypt. Use it to get
   going.
2. **is-a.dev** (`yourname.is-a.dev`) — free developer subdomain, requested by pull request.
   Looks good on a CV; the site has to be a developer/portfolio project.
3. **eu.org** (`yathra.eu.org`) — a free real domain whose name servers you can point at
   Cloudflare. Approval takes weeks, so apply early.
4. **Cheapest paid** — a `.xyz` or similar for about USD 1–2 for the first year, if you want a
   proper domain now.

Without a domain at all, `<ip>.sslip.io` hostnames work for testing.
