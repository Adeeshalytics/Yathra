#!/usr/bin/env bash
# Create the application Secret for one environment, encrypted for one cluster.
#
#   deploy/scripts/new-app-secret.sh <namespace> <output-file>
#
# Generates fresh random keys, encrypts them with the cluster's Sealed Secrets public key, and
# writes a SealedSecret manifest that is safe to commit: only the controller inside that
# cluster can decrypt it. The plain values exist only in this process's memory.
#
# Optional extra keys are read from the environment if set: EMAIL_URL, PAYHERE_MERCHANT_ID,
# PAYHERE_MERCHANT_SECRET.
set -euo pipefail

NAMESPACE=${1:?usage: new-app-secret.sh <namespace> <output-file>}
OUTPUT=${2:?usage: new-app-secret.sh <namespace> <output-file>}
NAME=${SECRET_NAME:-yathra-app}

random_key() { openssl rand -base64 48 | tr -d '\n/+=' | cut -c1-50; }

args=(
  --from-literal=DJANGO_SECRET_KEY="$(random_key)"
  --from-literal=MOCK_PAYMENT_SECRET="$(random_key)"
)
for key in EMAIL_URL PAYHERE_MERCHANT_ID PAYHERE_MERCHANT_SECRET; do
  [[ -n "${!key:-}" ]] && args+=(--from-literal="$key=${!key}")
done

kubectl create secret generic "$NAME" --namespace "$NAMESPACE" "${args[@]}" \
  --dry-run=client --output yaml |
  kubeseal --format yaml --controller-namespace kube-system \
    --controller-name sealed-secrets-controller >"$OUTPUT"

echo "Wrote $OUTPUT (SealedSecret $NAMESPACE/$NAME). Commit it, or: kubectl apply -f $OUTPUT"
