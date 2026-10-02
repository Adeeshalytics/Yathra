#!/usr/bin/env bash
# Bootstrap GitOps on a cluster: install Argo CD, then hand it the root Application. From then
# on Argo CD installs and keeps in sync everything listed in deploy/argocd/clusters/<cluster>
# — the platform components first, then the Yathra environments — straight from GitHub.
#
#   deploy/argocd/install.sh local|oracle            track main
#   REVISION=my-branch deploy/argocd/install.sh local  track another branch (to test changes)
#
# Re-running is safe: it upgrades Argo CD and re-applies the root Application.
set -euo pipefail

CLUSTER=${1:?usage: install.sh local|oracle}
REVISION=${REVISION:-main}
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=https://github.com/Adeeshalytics/Yathra.git
ARGOCD_CHART_VERSION=10.9.6 # Argo CD v3.5.3

[[ -d "$HERE/clusters/$CLUSTER" ]] || { echo "No such cluster: $CLUSTER"; exit 1; }

echo "== Argo CD (chart $ARGOCD_CHART_VERSION)"
helm upgrade --install argocd argo-cd \
  --repo https://argoproj.github.io/argo-helm --version "$ARGOCD_CHART_VERSION" \
  --namespace argocd --create-namespace \
  --values "$HERE/values/argo-cd.yaml" --wait

echo "== Root application: deploy/argocd/clusters/$CLUSTER at $REVISION"
# The kustomize patch sets the same Git revision on every child Application (their first
# source is always this repository), so one value decides what the whole cluster runs.
kubectl apply -f - <<EOF
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: root
  namespace: argocd
spec:
  project: default
  source:
    repoURL: $REPO
    targetRevision: $REVISION
    path: deploy/argocd/clusters/$CLUSTER
    kustomize:
      patches:
        - target:
            group: argoproj.io
            kind: Application
          patch: |-
            - op: replace
              path: /spec/sources/0/targetRevision
              value: $REVISION
  destination:
    server: https://kubernetes.default.svc
    namespace: argocd
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
EOF

cat <<EOF

Argo CD is syncing the cluster from Git. Watch it:
  kubectl -n argocd get applications
The web UI (user "admin"):
  kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath='{.data.password}' | base64 -d; echo
  kubectl -n argocd port-forward svc/argocd-server 8443:80     # then http://localhost:8443
EOF
