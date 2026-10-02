# D4 — GitOps with Argo CD

**Goal:** Git is the single source of truth for what runs. Nobody runs `helm upgrade` or
`kubectl apply` against the server: Argo CD, running inside the cluster, keeps the cluster equal
to the repository. Every merge to `main` reaches staging by itself; production changes only
when a person merges a pull request; a rollback is a `git revert`.

## What was added

| Path | What it does |
|------|--------------|
| [`deploy/argocd/install.sh`](../../deploy/argocd/install.sh) | Bootstraps a cluster: installs Argo CD and hands it one *root* Application |
| [`deploy/argocd/base`](../../deploy/argocd/base) | Projects, and the platform Applications every cluster runs (cert-manager, CloudNativePG, Sealed Secrets, issuers) |
| [`deploy/argocd/clusters/oracle`](../../deploy/argocd/clusters/oracle), [`…/local`](../../deploy/argocd/clusters/local) | What each cluster runs on top: the Traefik settings and the staging and production environments on the server; the local environment on k3d |
| [`deploy/environments/staging`](../../deploy/environments/staging), [`…/production`](../../deploy/environments/production) | Each environment's values; CI writes the new image tag into staging's |
| `ci.yml` → *Deploy to staging* job | Commits the freshly published image tag to Git |
| [`deploy/scripts/promote.sh`](../../deploy/scripts/promote.sh) | Opens the pull request that moves production to staging's tag |
| [`templates/sealed-secret.yaml`](../../deploy/charts/yathra/templates/sealed-secret.yaml) | Lets an environment's encrypted keys live in Git next to its values |

## How a change reaches production

```
 pull request ──► CI (tests, scans) ──► merge to main
                                              │
                                   CI: build + publish images sha-1a2b3c4
                                              │
                         CI: commit "deploy(staging): sha-1a2b3c4 [skip ci]"
                                              │  (deploy key; the only thing CI writes)
                                              ▼
        Argo CD sees Git change ──► syncs yathra-staging ──► migration Job, rolling update
                                              │
                         you check staging, then:  deploy/scripts/promote.sh
                                              │
                          pull request "deploy(production): sha-… → sha-1a2b3c4"
                                              │  review + merge
                                              ▼
        Argo CD sees Git change ──► syncs yathra-production
```

**CI never touches the cluster.** It has no kubeconfig and no cloud credentials. Argo CD
*pulls* from Git from inside the cluster, so the server needs no inbound access for
deployments at all — a compromised CI system cannot deploy anything that is not committed to
a public repository first.

## The app of apps

```
root  (applied once by install.sh; tracks deploy/argocd/clusters/<cluster>)
 ├─ wave -2  AppProject platform, AppProject yathra
 ├─ wave -1  cert-manager · cloudnative-pg · sealed-secrets        (Helm charts, pinned)
 ├─ wave  0  cluster-issuers · traefik-config                      (need the CRDs above)
 └─ wave  1  yathra-staging · yathra-production                    (our chart + values)
```

Sync waves only order things if Argo CD can tell when a child Application is *healthy*, which
it stopped doing in version 1.8 — so `values/argo-cd.yaml` adds the health check back (the Lua
snippet from Argo CD's documentation).

## Concepts, and why each choice was made

**GitOps in four rules.** The desired state is *declarative* (manifests and values), *versioned*
in Git, *pulled* by an agent in the cluster, and *continuously reconciled* — Argo CD compares
Git with the cluster every two minutes and on every push it notices.

**Drift and self-heal.** If someone changes the cluster by hand (`kubectl scale`, an edited
ConfigMap), Argo CD marks it *OutOfSync* and, with `selfHeal`, puts it back. The cluster cannot
quietly diverge from Git.

**Prune — on for staging, off for production.** With `prune`, deleting a file from Git deletes
the object from the cluster. Convenient for staging; for production a mistaken deletion could
take the database with it, so production only adds and updates, and removals are done by hand.

**Projects as guard rails.** `AppProject`s say which repositories an Application may use and
which namespaces it may deploy to. The `yathra` project can only deploy from this repository
into `yathra-*` namespaces and create no cluster-wide objects except its namespace.

**One revision for the whole tree.** Every child Application's first source is this repository.
The root Application applies a kustomize patch that sets that source's revision, so
`REVISION=my-branch deploy/argocd/install.sh local` points a whole cluster at a branch for
testing — and `main` is the default for real clusters.

**Charts from their publishers, values from Git.** The platform Applications use Argo CD's
*multiple sources*: the cert-manager chart from Jetstack's repository at a pinned version, the
values file from this repository (`$repo/deploy/platform/values/…`). Upgrading cert-manager is a
one-line pull request.

**Namespaces created by Argo CD, already locked down.** `CreateNamespace=true` with
`managedNamespaceMetadata` adds the "restricted" Pod Security labels, so a new environment is
born with the security profile enforced.

**Server-side apply.** CloudNativePG's CRDs are too big for the annotation client-side apply
stores on every object, so the Applications use `ServerSideApply=true`.

**Secrets in Git, per cluster.** `new-app-secret.sh <namespace> <file> --values` seals an
environment's keys with *that cluster's* Sealed Secrets key and writes them as a values file.
The chart turns it into a `SealedSecret`; the controller decrypts it into the Secret. The file
is useless anywhere else — another cluster, another namespace, another name.

**The deploy key and `[skip ci]`.** The *Deploy to staging* job pushes one commit straight to
`main`. The branch ruleset requires pull requests, so the ruleset lets this one deploy key
through, and nothing else. The commit message carries `[skip ci]`; without it, the tag commit
would trigger a build, which would publish an image, which would commit a tag… forever.

**Promotion by pull request.** Production moves when a person merges a PR that changes one
line, so every production release is reviewed and recorded: who, when, from which tag to which.

**Rollbacks.** Revert the commit that changed the tag (or run `promote.sh sha-<older>`), merge,
and Argo CD rolls back. The database is not rolled back — another reason migrations must stay
backward compatible ([03-kubernetes.md](03-kubernetes.md#how-a-release-rolls-out)).

**The Argo CD UI is not on the internet.** `make argocd-ui` (or the `kubectl port-forward` that
`install.sh` prints) tunnels to it through the Kubernetes API, which only your address can reach.

## What testing on the local cluster found

Tested end to end on a fresh k3d cluster, with the whole tree tracking the D4 branch on GitHub:

| Test | Result |
|------|--------|
| Empty cluster → `make up-gitops` → everything *Synced/Healthy* | ~10 minutes; waves applied in order: platform → issuers → app |
| Change the cluster by hand (`kubectl scale` the web app to 3) | Argo CD put it back to 1 in **6 s** (self-heal) |
| Commit a change to Git (2 web replicas) | Rolled out **23 s** after the push |
| `git revert` that commit | Rolled back **11 s** after the push |
| `promote.sh` against a scratch remote | Branch `promote/<tag>` with a one-line change to production's tag; a no-op when production already runs the tag |

One design fix came out of it: kustomize refuses to load single files from outside its own
directory, so the shared projects and platform Applications became a `base` kustomization that
each cluster includes. The *Deploy to staging* job can only run for real on `main` with the
deploy key in place; its tag rewrite was tested on the values file.

## Going live — what you do once

All of these need your accounts, so they are yours to do. Each is a few minutes.

1. **Domains.** Pick the two host names (for example DuckDNS: `yathra.duckdns.org` and
   `yathra-staging.duckdns.org`, both pointed at the node's address:
   `terraform -chdir=infra/terraform/cluster output -raw node_public_ip`)
   and put them in `host:` in `deploy/environments/{staging,production}/values.yaml`.
2. **Public images.** GitHub → your profile → *Packages* → `yathra-backend` → *Package settings*
   → *Change visibility* → Public. Same for `yathra-frontend`.
3. **The deploy key** (lets CI commit staging's image tag):

   ```bash
   ssh-keygen -t ed25519 -N "" -C "yathra-ci-deploy" -f yathra-deploy-key
   ```

   *Settings → Deploy keys → Add deploy key*: paste `yathra-deploy-key.pub`, tick **Allow write
   access**. *Settings → Secrets and variables → Actions → New repository secret*: name
   `DEPLOY_KEY`, value = the contents of `yathra-deploy-key`. Then delete both files. In the
   `main` ruleset, add **Deploy keys** to the bypass list.
4. **Bootstrap the server** (after D2's `make configure`):

   ```bash
   KUBECONFIG=~/.kube/yathra.yaml deploy/argocd/install.sh oracle
   ```

5. **Seal each environment's keys** once Argo CD has installed Sealed Secrets, and commit them
   through a pull request:

   ```bash
   KUBECONFIG=~/.kube/yathra.yaml deploy/scripts/new-app-secret.sh yathra-staging deploy/environments/staging/secrets.yaml --values
   ```

   ```bash
   KUBECONFIG=~/.kube/yathra.yaml deploy/scripts/new-app-secret.sh yathra-production deploy/environments/production/secrets.yaml --values
   ```

6. **First production release:** once staging works, `deploy/scripts/promote.sh` and merge the
   pull request it links to. When both sites have their (staging) certificates, change
   `clusterIssuer` to `letsencrypt-prod` in both values files.

## For your CV

- Implemented GitOps with Argo CD (app-of-apps, sync waves, AppProjects, multi-source
  Applications): the cluster is reconciled from Git, CI holds no cluster credentials, staging
  deploys on every merge and production is promoted by pull request.
- Bootstrapped an empty Kubernetes cluster to a running platform (cert-manager, CloudNativePG,
  Sealed Secrets, the application) with one command, and tested the whole tree from a branch
  before merging.

## Questions you should be able to answer

- What makes a deployment "GitOps" rather than "CI runs kubectl"? Why is pull-based safer?
- What do `prune` and `selfHeal` do? Why is prune off for production?
- How do sync waves work in an app of apps, and what had to be configured for them to work?
- How does a secret get into Git safely here? Could the staging file be used in production?
- How does a commit from CI avoid triggering CI again?
- How do you roll production back? What about the database?
