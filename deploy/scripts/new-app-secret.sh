#!/usr/bin/env bash
# Create the application Secret for one environment, encrypted for one cluster.
#
#   deploy/scripts/new-app-secret.sh <namespace> <output-file> [--values]
#
# Generates fresh random keys and encrypts them with the cluster's Sealed Secrets public key.
# Only the controller inside that cluster can decrypt the result, so it is safe to commit. The
# plain values exist only in this process's memory.
#
#   default    a SealedSecret manifest, for `kubectl apply` (a local cluster)
#   --values   a Helm values file for the chart (deploy/environments/<name>/secrets.yaml), which
#              Argo CD deploys from Git
#
# Optional extra keys are read from the environment if set: EMAIL_URL, PAYHERE_MERCHANT_ID,
# PAYHERE_MERCHANT_SECRET.
set -euo pipefail

NAMESPACE=${1:?usage: new-app-secret.sh <namespace> <output-file> [--values]}
OUTPUT=${2:?usage: new-app-secret.sh <namespace> <output-file> [--values]}
FORMAT=${3:-}
NAME=${SECRET_NAME:-yathra-app}

random_key() { openssl rand -base64 48 | tr -d '\n/+=' | cut -c1-50; }

args=(
  --from-literal=DJANGO_SECRET_KEY="$(random_key)"
  --from-literal=MOCK_PAYMENT_SECRET="$(random_key)"
)
for key in EMAIL_URL PAYHERE_MERCHANT_ID PAYHERE_MERCHANT_SECRET; do
  [[ -n "${!key:-}" ]] && args+=(--from-literal="$key=${!key}")
done

sealed=$(
  kubectl create secret generic "$NAME" --namespace "$NAMESPACE" "${args[@]}" \
    --dry-run=client --output yaml |
    kubeseal --format yaml --controller-namespace kube-system \
      --controller-name sealed-secrets-controller
)

if [[ "$FORMAT" == --values ]]; then
  {
    echo "# The app's keys for the $NAMESPACE namespace, sealed by deploy/scripts/new-app-secret.sh."
    echo "# Safe to commit: only that cluster's Sealed Secrets controller can decrypt them."
    echo "django:"
    echo "  sealedSecret:"
    # The encryptedData block of the SealedSecret, already indented four spaces.
    awk '/^  encryptedData:/ { inside = 1; next } inside && /^    / { print; next } inside { exit }' <<<"$sealed"
  } >"$OUTPUT"
  echo "Wrote $OUTPUT. Commit it; Argo CD creates the SealedSecret from it."
else
  printf '%s\n' "$sealed" >"$OUTPUT"
  echo "Wrote $OUTPUT (SealedSecret $NAMESPACE/$NAME). kubectl apply -f $OUTPUT"
fi
