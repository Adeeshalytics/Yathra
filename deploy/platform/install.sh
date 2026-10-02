#!/usr/bin/env bash
# Cluster-wide components every Yathra environment relies on. Run once per cluster, and again to
# upgrade (every step is `helm upgrade --install` or `kubectl apply`, so re-running is safe).
#
#   deploy/platform/install.sh local     a k3d cluster on this machine (plain HTTP)
#   deploy/platform/install.sh oracle    the k3s node from infra/ (HTTPS, Let's Encrypt)
#
# From D4 on, Argo CD manages these same charts and versions from Git.
set -euo pipefail

PROFILE=${1:?usage: install.sh local|oracle}
HERE=$(cd "$(dirname "$0")" && pwd)

CERT_MANAGER_VERSION=v1.21.2  # https://cert-manager.io/docs/releases/
CNPG_CHART_VERSION=0.29.1     # CloudNativePG operator 1.30.1
SEALED_SECRETS_VERSION=2.20.0 # controller 0.40.0 — keep kubeseal at the same controller version

step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }

step "cert-manager $CERT_MANAGER_VERSION (TLS certificates)"
helm upgrade --install cert-manager cert-manager \
  --repo https://charts.jetstack.io --version "$CERT_MANAGER_VERSION" \
  --namespace cert-manager --create-namespace \
  --values "$HERE/values/cert-manager.yaml" --wait

step "CloudNativePG operator (PostgreSQL)"
helm upgrade --install cnpg cloudnative-pg \
  --repo https://cloudnative-pg.github.io/charts --version "$CNPG_CHART_VERSION" \
  --namespace cnpg-system --create-namespace \
  --values "$HERE/values/cloudnative-pg.yaml" --wait

step "Sealed Secrets controller (encrypted secrets in Git)"
# The name kubeseal looks for by default, in the namespace it looks in by default.
helm upgrade --install sealed-secrets sealed-secrets \
  --repo https://bitnami.github.io/sealed-secrets --version "$SEALED_SECRETS_VERSION" \
  --namespace kube-system \
  --values "$HERE/values/sealed-secrets.yaml" --wait

step "Let's Encrypt issuers"
kubectl apply -f "$HERE/cluster-issuers.yaml"

if [[ "$PROFILE" == oracle ]]; then
  step "Traefik: real client addresses, HTTP → HTTPS"
  kubectl apply -f "$HERE/traefik-config.yaml"
fi

step "Done"
kubectl get pods --namespace cert-manager
kubectl get pods --namespace cnpg-system
