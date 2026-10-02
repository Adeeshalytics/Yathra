# Going live — the complete checklist

Everything in the repository is built and tested (D1–D6). What is left needs **your accounts**
(GitHub settings, Oracle Cloud, a domain), so it is done by hand, once. Work through the parts in
order; each step says what to do, where, and how to check it worked. Time: about 2–3 hours,
plus any waiting for Oracle.

The details and the *why* of every step are in the phase notes (`docs/devops/01`–`06`). The
[runbook](runbook.md) is for after launch.

**Conventions.** `▶ WSL` means run it in the *Ubuntu* app (Start menu → Ubuntu), where the repo
is at `/mnt/c/Projects/bus-booking-system`. `▶ Browser` means a web page. Replace anything in
`<angle brackets>`.

---

## Part 0 — Bring your copy up to date (5 min)

1. ▶ Browser — merge the pull request for the `docs/go-live` branch (it adds this file and
   points staging and production at the current image `sha-82647a2`):
   <https://github.com/Adeeshalytics/Yathra/pull/new/docs/go-live> → *Create pull request* →
   wait for the checks to go green → *Merge*.
2. ▶ Git Bash or WSL, in the repository:

   ```bash
   git switch main && git pull
   ```

3. Clean up branches you no longer need (optional):

   ```bash
   git branch -D devops/d1-ci devops/d2-iac devops/d3-k8s devops/d4-gitops devops/d5-observability devops/d6-reliability docs/go-live
   ```

---

## Part 1 — GitHub settings (20 min)

All in ▶ Browser at <https://github.com/Adeeshalytics/Yathra/settings>.

### 1.1 Security features

*Settings → Advanced Security*: turn **on** Dependabot alerts, Dependabot security updates,
Secret scanning, Push protection. Leave **CodeQL "Default setup" off** (the repo has its own
CodeQL workflow; turning default setup on breaks it).

### 1.2 Make the images public

The cluster pulls the app's images without a password, so they must be public.
Your profile (top right) → *Your profile* → *Packages* → **yathra-backend** → *Package settings*
(right side) → *Danger Zone* → *Change visibility* → **Public**. Repeat for **yathra-frontend**.

Check: open a private browser window at <https://github.com/Adeeshalytics/Yathra/pkgs/container/yathra-backend> — it shows.

### 1.3 The deploy key (lets CI move staging to each new image)

1. ▶ Git Bash (any folder):

   ```bash
   ssh-keygen -t ed25519 -N "" -C "yathra-ci-deploy" -f yathra-deploy-key
   ```

2. *Settings → Deploy keys → Add deploy key*. Title: `ci-deploy-staging`. Key: the contents of
   `yathra-deploy-key.pub` (`cat yathra-deploy-key.pub`). Tick **Allow write access**. *Add key*.
3. *Settings → Secrets and variables → Actions → New repository secret*. Name: `DEPLOY_KEY`.
   Secret: the **whole** contents of `yathra-deploy-key` (the file *without* `.pub`, including the
   `-----BEGIN` and `-----END` lines). *Add secret*.
4. Delete both files: `rm yathra-deploy-key yathra-deploy-key.pub`.

### 1.4 Protect `main`

*Settings → Rules → Rulesets → New ruleset → New branch ruleset*:

- Name: `main`. Enforcement status: **Active**.
- *Bypass list → Add bypass*: **Deploy keys** (so CI's tag commit can go in), and **Repository
  admin** (you, for emergencies — but use pull requests normally).
- *Target branches → Add target → Include default branch*.
- Tick **Restrict deletions**, **Block force pushes**, **Require a pull request before merging**
  (required approvals: 0 — you work alone), **Require status checks to pass**. Add these checks
  (type the names; they appear once each has run):
  `Backend`, `Frontend`, `Secret scan`, `Image scan (backend)`, `Image scan (frontend)`,
  `Terraform`, `Ansible`, `Helm chart`, `Analyze (python)`, `Analyze (javascript-typescript)`,
  `Analyze (actions)`.
- *Create*.

Check: the next merge to `main` shows a *Deploy to staging* job in *Actions → CI* that commits
`deploy(staging): sha-… [skip ci]` to `main`.

### 1.5 Dependabot pull requests

Dependabot opens update PRs every Monday. Rule of thumb:
- **minor/patch group PRs** (titles like "bump the … group"): merge when all checks are green.
- **major versions** are already held back by the config. If one still appears, comment
  `@dependabot ignore this major version` on it.

---

## Part 2 — Oracle Cloud account (15 min + waiting)

1. ▶ Browser — <https://cloud.oracle.com> → sign in → ☰ → *Billing & Cost Management* →
   *Upgrade and Manage Payment* → **Upgrade to Pay As You Go**. Wait for the e-mail / the
   page to say the upgrade is complete (minutes to a day).

   Nothing will cost money: Terraform creates quota rules that make anything outside the free
   allowance impossible to create, and budget alerts e-mail you on the first cent.

2. ▶ WSL — install the tools and create your keys (asks for your Ubuntu password once):

   ```bash
   cd /mnt/c/Projects/bus-booking-system && bash infra/scripts/setup-wsl.sh
   ```

   It prints a **public** key. ▶ Browser: Oracle console → your profile (top right) → *My
   profile* → *API keys* → *Add API key* → *Paste a public key* → paste → *Add*. The console
   shows a *Configuration file preview*: copy the `user=` and `tenancy=` values into the script
   when it asks.

3. Close the Ubuntu window and open a new one (so the new tools are on your PATH). Check:

   ```bash
   terraform version && kubectl version --client && helm version --short && ansible --version | head -1
   ```

---

## Part 3 — Build the server (30–60 min)

All ▶ WSL, in `/mnt/c/Projects/bus-booking-system/infra`.

1. Your settings files:

   ```bash
   cd /mnt/c/Projects/bus-booking-system/infra
   cp terraform/bootstrap/terraform.tfvars.example terraform/bootstrap/terraform.tfvars
   cp terraform/cluster/terraform.tfvars.example terraform/cluster/terraform.tfvars
   make my-ip
   ```

   Edit them (`nano terraform/bootstrap/terraform.tfvars`, save with Ctrl+O, Enter, Ctrl+X):
   - bootstrap: `tenancy_ocid`, `budget_alert_email`.
   - cluster: `tenancy_ocid`, `user_ocid` (the `user=` line of `~/.oci/config`), and
     `admin_cidrs = ["<the make my-ip output>"]`.

2. The foundation (compartment, state bucket, cost guardrails). Read what it will create, type
   `yes`:

   ```bash
   make bootstrap
   ```

3. The network, the server and the backup bucket:

   ```bash
   make init && make plan
   ```

   ```bash
   make apply
   ```

   **If it ends with "Out of host capacity"**: the network is already made; only the server is
   waiting for Oracle to have room. Run `make apply-retry` and leave it — it tries every 10
   minutes and stops by itself when the server is created.

4. Harden the server and install Kubernetes (a reboot in the middle is normal):

   ```bash
   make configure
   ```

5. Check — one node, `Ready`:

   ```bash
   make nodes
   ```

6. Note the server's address — you need it next:

   ```bash
   terraform -chdir=terraform/cluster output -raw node_public_ip; echo
   ```

---

## Part 4 — Domains (10 min)

Free with DuckDNS (or use any domain you own — point two `A` records at the server).

1. ▶ Browser — <https://www.duckdns.org> → sign in (GitHub or Google).
2. Add two sub-domains, e.g. `yathra` and `yathra-staging` (pick free names). For **both**, type
   the server's address from Part 3 step 6 into *current ip* → *update ip*.
3. Put them in the repo (▶ any editor):
   - `deploy/environments/production/values.yaml` → `host: yathra.duckdns.org`
   - `deploy/environments/staging/values.yaml` → `host: yathra-staging.duckdns.org`

   (use your names, without `https://`).
4. Check from Git Bash: `nslookup yathra.duckdns.org` shows the server's address.

Don't commit yet — Part 5 adds more to the same pull request.

---

## Part 5 — Deploy with Argo CD (30 min)

All ▶ WSL, in `/mnt/c/Projects/bus-booking-system`.

1. Point kubectl at the server for this window:

   ```bash
   cd /mnt/c/Projects/bus-booking-system && export KUBECONFIG=~/.kube/yathra.yaml
   ```

2. Install Argo CD and hand it the cluster:

   ```bash
   deploy/argocd/install.sh oracle
   ```

   Watch it install the monitoring stack, cert-manager, the database operator and the rest
   (5–15 minutes). `Ctrl+C` stops watching, not the install:

   ```bash
   watch kubectl -n argocd get applications
   ```

   The platform apps become *Synced / Healthy*. `yathra-staging` and `yathra-production` will
   not be healthy yet — they still need their secrets (next step).

3. Seal each environment's app keys (only this cluster can decrypt them):

   ```bash
   deploy/scripts/new-app-secret.sh yathra-staging deploy/environments/staging/secrets.yaml --values
   deploy/scripts/new-app-secret.sh yathra-production deploy/environments/production/secrets.yaml --values
   ```

4. Backups: set the storage address and seal its keys.

   ```bash
   terraform -chdir=infra/terraform/cluster output -raw backup_endpoint; echo
   ```

   In both `deploy/environments/{staging,production}/values.yaml`, replace the whole
   `endpointURL:` value with that output. Then:

   ```bash
   deploy/scripts/seal-backup-credentials.sh yathra-staging deploy/environments/staging/backup-credentials.yaml
   deploy/scripts/seal-backup-credentials.sh yathra-production deploy/environments/production/backup-credentials.yaml
   ```

5. Commit Parts 4 and 5 through a pull request:

   ```bash
   git switch -c go-live/environments
   git add deploy/environments
   git commit -m "deploy: domains, sealed secrets and backup storage for staging and production"
   git push -u origin go-live/environments
   ```

   Open the link it prints, create the pull request, wait for green checks, merge.

6. Argo CD picks it up within two minutes. Check:

   ```bash
   kubectl -n argocd get applications
   kubectl -n yathra-staging get pods
   ```

   All pods `Running` (the `migrate` Job `Completed`).

7. Demo data for each site (prints the demo accounts' password — keep it):

   ```bash
   make -C deploy seed NAMESPACE=yathra-staging
   make -C deploy seed NAMESPACE=yathra-production
   ```

8. ▶ Browser — open `https://yathra-staging.duckdns.org`. The browser warns about the
   certificate: **expected** — it is Let's Encrypt's *staging* (test) certificate. Click through,
   search Colombo → Kandy, book with the test gateway.

---

## Part 6 — Real certificates and the first production release (15 min)

1. Once both sites load (with the warning), switch to trusted certificates: in both
   `deploy/environments/{staging,production}/values.yaml` change
   `clusterIssuer: letsencrypt-staging` → `clusterIssuer: letsencrypt-prod`. Commit through a
   pull request (as in Part 5 step 5), merge. A minute later both sites have a padlock.

   If a certificate stays pending: `kubectl -n yathra-production describe certificate` — usually
   the domain does not point at the server yet.

2. From now on, every merge to `main` reaches **staging** by itself. To release to
   **production**:

   ```bash
   deploy/scripts/promote.sh
   ```

   Open the link it prints → pull request → merge. Argo CD deploys it.

---

## Part 7 — Check everything works (15 min)

| Check | How | Expect |
|-------|-----|--------|
| Sites | Browser | Both load with a padlock; booking with the test gateway works |
| Argo CD | `make -C deploy argocd-ui`, open <http://localhost:8443> (user `admin`, password printed) | Every app *Synced / Healthy* |
| Grafana | `make -C deploy grafana`, open <http://localhost:3000> → Dashboards → *Yathra — yathra-production* | Traffic, bookings, logs |
| Uptime | GitHub → *Actions → Uptime* (runs every 15 min) | Green |
| Costs | Oracle console → *Billing & Cost Management → Cost Analysis* | 0.00 |
| Backups | The morning after: `kubectl -n yathra-production get backups` | A `completed` backup |
| Restore | `deploy/scripts/restore-drill.sh yathra-production` | `Restore drill PASSED`; record it in the [runbook](runbook.md) |

Optional: alerts to your phone through Discord — [05-observability.md, "Getting alerts"](05-observability.md#getting-alerts-on-your-phone-optional-free).

---

## Keeping it running

| When | What |
|------|------|
| Every Monday | Merge the green Dependabot PRs (Part 1.5) |
| Your home IP changes (SSH or kubectl time out) | `make -C infra my-ip` → update `admin_cidrs` in `infra/terraform/cluster/terraform.tfvars` → `make -C infra apply` |
| An alert, or the site is down | The [runbook](runbook.md) |
| Monthly | Restore drill (Part 7), record the result |
| A release broke production | `deploy/scripts/promote.sh sha-<previous tag>` → merge |
| Every ~60 days | Commit something (even a Dependabot merge): GitHub pauses scheduled workflows (Uptime, CodeQL) in repositories with no activity for 60 days |

**Oracle may reclaim an idle free server.** A running site with monitoring stays above Oracle's
idle threshold. If the server ever disappears, everything is code: `make -C infra apply
configure`, `deploy/argocd/install.sh oracle`, re-seal the secrets (Part 5 steps 3–4 — a new
cluster has a new sealing key) and restore the database from backup (runbook → *Restore the
database*).

## When something goes wrong during setup

| Message | Fix |
|---------|-----|
| `401-NotAuthenticated` | The key in Oracle doesn't match `~/.oci/config` — re-run `setup-wsl.sh` after deleting `~/.oci/config`, re-add the public key |
| `Out of host capacity` | `make apply-retry` and wait |
| `QuotaExceeded` | The free-tier guardrail did its job — something asked for more than 2 OCPUs / 12 GB / 200 GB |
| SSH / kubectl time out | Your IP changed — see *Keeping it running* |
| `kubeseal: cannot fetch certificate` | Argo CD hasn't installed Sealed Secrets yet — wait for `sealed-secrets` to be *Healthy* |
| Pods `ImagePullBackOff` | The images aren't public (Part 1.2) |
| Site shows 404 from Traefik | The `host:` in the values file doesn't match the address in the browser |
| Pods `CreateContainerConfigError` | The app's Secret is missing — Part 5 step 3, merged? |
| Push to `main` rejected | That's the ruleset working — use a branch and a pull request |
