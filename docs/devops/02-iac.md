# D2 — Infrastructure as code

**Goal:** the whole server — network, firewall, machine, operating-system hardening and the
Kubernetes (k3s) install — is described in files in this repository. Anyone with the
credentials can rebuild it from nothing with a handful of commands, and it costs nothing.

## What was added

| Path | What it does |
|------|--------------|
| [`infra/terraform/bootstrap`](../../infra/terraform/bootstrap) | Run once: the `yathra` compartment, the bucket holding Terraform state, and the cost guardrails (tenancy quotas + budget alerts) |
| [`infra/terraform/cluster`](../../infra/terraform/cluster) | The network (VCN, subnet, internet gateway, network security group) and the Ampere A1 Arm node |
| [`infra/ansible`](../../infra/ansible) | Turns the fresh Ubuntu server into a hardened k3s node: patches, SSH hardening, automatic security updates, fail2ban, host firewall, k3s |
| [`infra/Makefile`](../../infra/Makefile) | The workflow as short commands (`make help`) |
| [`infra/scripts/setup-wsl.sh`](../../infra/scripts/setup-wsl.sh) | One-time workstation setup in WSL: Terraform, kubectl, Ansible (checksums verified), SSH key, Oracle API key |
| [`.github/workflows/infra.yml`](../../.github/workflows/infra.yml) | CI for the infrastructure code — no cloud credentials involved |

```
                     Internet
                        │
         ┌──────────────┴───────────────────────────────── Oracle Cloud, ap-hyderabad-1 ──┐
         │  VCN 10.10.0.0/16                                                              │
         │   └─ public subnet 10.10.1.0/24                                                │
         │       └─ NSG: 80, 443 from anywhere · 22, 6443 from admin_cidrs only           │
         │           └─ yathra-node-1  VM.Standard.A1.Flex  2 OCPU / 12 GB / 100 GB       │
         │               ├─ host firewall (iptables): 80, 443, 6443, pod + service ranges │
         │               └─ k3s  (Traefik ingress, CoreDNS, local-path storage, metrics)  │
         │                                                                                │
         │  Object Storage: yathra-tfstate (versioned) ← Terraform state + lock           │
         │  Tenancy: quota policy FreeTierGuardrails · budget yathra-monthly → e-mail     │
         └────────────────────────────────────────────────────────────────────────────────┘
```

## Decision: Pay As You Go, fenced in to the free allowance

Creating the free Arm server kept failing with **"Out of host capacity"**. Free-only accounts
are widely reported to come last when capacity is scarce, and upgrading to Pay As You Go is the
usual fix. Always Free resources stay free, but the account *can* now be billed — so the project
fences itself in with three layers, each catching what the one before might miss:

| Layer | Where | When it acts | What it stops |
|-------|-------|--------------|---------------|
| Variable validation | `cluster/variables.tf` | `terraform plan` | A typo like `node_ocpus = 4` fails before OCI is asked |
| Tenancy quotas | `bootstrap/main.tf` | Every create request, from any tool | OCI itself refuses anything beyond the free compute and disk allowance, even from the console |
| Budget alerts | `bootstrap/main.tf` | After the fact | E-mail on the first cent actually billed, and when the month is forecast over budget |

**The sizing.** Oracle's free Arm allowance is 1,500 OCPU-hours and 9,000 GB-hours a month. A
month is about 730 hours, so that is **2 OCPUs and 12 GB running all month**. Anything bigger is
billed. (Older guides say 4 OCPUs / 24 GB — the allowance was halved.)

**A gotcha the quotas had to handle.** The quota policy zeroes all compute, then allows the A1
allowance back. Hyderabad has a single availability domain, and single-AD regions enforce the
*regional* quota names (`standard-a1-core-regional-count`), not only the per-AD ones. A policy
with only the per-AD names would have blocked our own server with `QuotaExceeded`.

**Idle reclamation.** Oracle may reclaim an Always Free instance that is idle for 7 days — CPU
(95th percentile), network *and* memory all under 20%. A k3s node running the app and, from D5,
monitoring uses well over 20% of 12 GB, so it does not qualify. Everything is in code anyway:
a reclaimed node is `make apply && make configure` away.

## Concepts, and why each choice was made

**Declarative infrastructure.** Terraform files describe *what should exist*; `terraform plan`
compares that with what does exist and shows the difference; `apply` makes the difference
happen. Run it twice and the second run changes nothing. Clicking in the console is the
opposite: nobody can see later what was done, or repeat it.

**State, remote state and locking.** Terraform records what it created (and the IDs) in a state
file. Kept on a laptop, it gets lost, and two people can apply at once and corrupt it. Here it
lives in an Object Storage bucket with **versioning** (every write keeps the old version, so a
bad apply can be undone) and **locking** (Terraform's native `oci` backend writes a lock object
with a conditional `If-None-Match` request, so a second apply waits instead of colliding).

**The bootstrap problem.** The bucket that stores state has to exist before any stack can store
state in it — including the stack that creates it. So `bootstrap` keeps its own small state
locally (OCIDs only, no secrets) and everything else uses the bucket. The account-specific
backend settings are passed with `-backend-config=backend.hcl` (a *partial backend
configuration*), which `make bootstrap` writes from the bootstrap outputs.

**Stacks that share nothing.** The cluster stack finds the compartment by name with a data
source instead of reading the bootstrap state. The two can be planned, applied and destroyed
independently — `make destroy` removes the server and network but leaves the guardrails.

**Pinned versions everywhere.** `.terraform.lock.hcl` pins the exact provider build and its
checksums for Linux, macOS and Windows (CI runs `init -lockfile=readonly`, so a changed provider
fails instead of being silently trusted). k3s, Terraform, kubectl and Ansible are pinned too.
Upgrades are deliberate changes to a file, reviewed like any other.

**`ignore_changes` on the image.** Oracle publishes a new Ubuntu image every few weeks. Without
`lifecycle { ignore_changes = [source_details[0].source_id] }`, each one would make Terraform
want to rebuild the server. Security patches arrive through unattended-upgrades instead.

**Terraform provisions, Ansible configures.** Terraform is good at cloud APIs (create a network,
a VM). Ansible is good at what happens *inside* a machine (packages, files, services). Both are
idempotent: the firewall role was tested against a copy of Oracle's real `rules.v4` — the first
run changed 4 things, the second run changed 0.

**Three firewalls, one job each.**
- *Default security list* — every new VCN gets one that allows SSH from the whole internet.
  Terraform takes it over and leaves egress only.
- *Network security group* — the perimeter. 80/443 from anywhere; 22 (SSH) and 6443 (Kubernetes
  API) from `admin_cidrs` only.
- *Host firewall* (iptables on the node) — defence in depth. Oracle's Ubuntu images end both the
  INPUT and FORWARD chains with `REJECT`. Left alone, that blocks the web ports, stops pods from
  reaching the API server (so cluster DNS fails) and drops all pod traffic. The Ansible role
  opens exactly what k3s needs. Oracle's own docs warn not to use `ufw` on these images: it
  removes rules the boot volume depends on.

**Instance metadata, v2 only.** `are_legacy_imds_endpoints_disabled = true` turns off the
unauthenticated metadata endpoint. A server-side request forgery bug in an app could otherwise
be used to read the instance's metadata.

**k3s choices** (`roles/k3s/templates/config.yaml.j2`):
- `secrets-encryption: true` — Kubernetes Secrets are encrypted at rest in the datastore, not
  just base64-encoded.
- `system-reserved` / `kube-reserved` / `eviction-hard` — memory and CPU held back for the OS and
  Kubernetes, so a runaway pod gets evicted instead of freezing the node.
- `tls-san` — the API certificate is valid for the public IP, so `kubectl` works remotely.
- The install script comes from the same release tag as the binary (not the moving
  `get.k3s.io`), and verifies the binary's checksum.

**CI without credentials.** `infra.yml` formats, validates against the provider schema, lints
(tflint, ansible-lint `production` profile) and scans for misconfigurations (Trivy) — all
without access to the Oracle account. `plan` and `apply` run from your machine only. A CI
system that can change your cloud account is a prime target; this one cannot.

## First run

Everything below runs **inside WSL Ubuntu** (open "Ubuntu" from the Start menu). The repository
is at `/mnt/c/Projects/bus-booking-system`.

1. **Upgrade the Oracle account** to Pay As You Go and wait until the console says it is done.

2. **Install the tools and create the keys** (asks for your WSL password once):

   ```bash
   cd /mnt/c/Projects/bus-booking-system && bash infra/scripts/setup-wsl.sh
   ```

   It prints a public key: in the Oracle console, *Profile → My profile → API keys → Add API
   key → Paste a public key*. Then paste the user and tenancy OCIDs the console shows. Open a
   new terminal afterwards so `~/.local/bin` is on your `PATH`.

3. **Fill in the variables:**

   ```bash
   cd /mnt/c/Projects/bus-booking-system/infra
   cp terraform/bootstrap/terraform.tfvars.example terraform/bootstrap/terraform.tfvars
   cp terraform/cluster/terraform.tfvars.example terraform/cluster/terraform.tfvars
   make my-ip
   ```

   Edit both `terraform.tfvars` files (`nano terraform/bootstrap/terraform.tfvars`): your tenancy
   OCID, the e-mail for budget alerts, and the `make my-ip` output as `admin_cidrs`.

4. **Bootstrap** — read the plan, then type `yes`:

   ```bash
   make bootstrap
   ```

5. **The network and the node:**

   ```bash
   make init
   ```

   ```bash
   make plan
   ```

   ```bash
   make apply
   ```

   If it ends with `Out of host capacity`, the network is already created — only the node is
   waiting. `make apply-retry` tries again every 10 minutes until it succeeds.

6. **Configure the node** (a reboot after the first patch run is normal):

   ```bash
   make configure
   ```

7. **Check:**

   ```bash
   make nodes
   ```

   One node, `Ready`. `make ssh` logs in to it.

**See the guardrails work:** `terraform -chdir=terraform/cluster plan -var node_ocpus=4` fails
at validation; in the console, *Governance → Quota policies* lists `FreeTierGuardrails`.

## Day two

- **Your home IP changed** (SSH or kubectl time out): update `admin_cidrs` from `make my-ip`,
  then `make apply`. Only the NSG rules change.
- **Upgrade k3s:** change `k3s_version` in `ansible/group_vars/all.yml`, then `make configure`.
- **Rebuild from scratch:** `make destroy`, `make apply`, `make configure`. Servers are cattle,
  not pets.
- **Check the bill:** console → *Billing & Cost Management → Cost analysis*. It should read 0.

## Troubleshooting

| Symptom | Cause |
|---------|-------|
| `401-NotAuthenticated` | The API key in the console does not match `~/.oci/config` (fingerprint, user or tenancy OCID) |
| `Out of host capacity` | Oracle has no free A1 capacity right now — `make apply-retry` |
| `QuotaExceeded` | The guardrails did their job: something asked for more than the free allowance |
| SSH or kubectl time out | Your public IP is no longer in `admin_cidrs` |
| Pods cannot resolve DNS | The host firewall role did not run or was undone — `make configure` |

## Known limitations (later phases)

- Terraform signs requests with *your* admin user's API key. A dedicated IAM user whose policy
  only allows managing the `yathra` compartment would limit the damage of a leaked key.
- Admin access is by source IP, which breaks whenever a home connection changes address. A
  private overlay network (for example Tailscale's free plan) would remove 22 and 6443 from the
  internet altogether.

## For your CV

- Provisioned Oracle Cloud infrastructure with Terraform (VCN, subnet, network security groups,
  Arm compute) using remote state in Object Storage with locking and versioning, and pinned,
  checksummed provider lock files.
- Implemented cost guardrails as code — tenancy quota policies and budget alerts — to run a Pay
  As You Go account at zero cost.
- Automated server hardening and Kubernetes (k3s) installation with idempotent Ansible roles
  (SSH hardening, unattended security updates, fail2ban, host firewall, secrets encryption at
  rest), linted at ansible-lint's production profile in CI.

## Questions you should be able to answer

- What is Terraform state, why keep it remote, and what do locking and versioning protect from?
- How did you create the state bucket with Terraform, if Terraform needs the bucket for state?
- `terraform plan` shows a server will be *replaced*. What could cause that, and how do you stop
  a new image from causing it?
- What is the difference between Terraform and Ansible? Why use both?
- What does "idempotent" mean, and how would you show a playbook is?
- Security list vs network security group vs host firewall — what does each protect?
- What are OCI quotas, and how are they different from a budget?
- Why disable the legacy metadata endpoint (IMDSv1)?
- What does `secrets-encryption` change about how Kubernetes stores a Secret?
- Why does CI run `validate` and `tflint` but never `plan` or `apply`?
