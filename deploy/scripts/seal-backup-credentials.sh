#!/usr/bin/env bash
# Seal the database-backup credentials for one environment, from the Terraform outputs.
#
#   deploy/scripts/seal-backup-credentials.sh <namespace> <output-file>
#   e.g. deploy/scripts/seal-backup-credentials.sh yathra-staging deploy/environments/staging/backup-credentials.yaml
#
# Reads the S3 key pair Terraform created (infra/terraform/cluster/backups.tf), encrypts it for
# this cluster's Sealed Secrets controller, and writes a Helm values file that is safe to
# commit. The secret key exists only in Terraform's state and in this process's memory.
set -euo pipefail

NAMESPACE=${1:?usage: seal-backup-credentials.sh <namespace> <output-file>}
OUTPUT=${2:?usage: seal-backup-credentials.sh <namespace> <output-file>}
ROOT=$(git rev-parse --show-toplevel)
TF="terraform -chdir=$ROOT/infra/terraform/cluster"

sealed=$(
  kubectl create secret generic yathra-backup-credentials --namespace "$NAMESPACE" \
    --from-literal=ACCESS_KEY_ID="$($TF output -raw backup_access_key_id)" \
    --from-literal=ACCESS_SECRET_KEY="$($TF output -raw backup_secret_access_key)" \
    --from-literal=REGION="$($TF output -raw backup_endpoint | sed -E 's#.*objectstorage\.([^.]+)\.oraclecloud\.com#\1#')" \
    --dry-run=client --output yaml |
    kubeseal --format yaml --controller-namespace kube-system \
      --controller-name sealed-secrets-controller
)

{
  echo "# Object Storage keys for $NAMESPACE's database backups, sealed by"
  echo "# deploy/scripts/seal-backup-credentials.sh. Only that cluster can decrypt them."
  echo "backup:"
  echo "  sealedCredentials:"
  awk '/^  encryptedData:/ { inside = 1; next } inside && /^    / { print; next } inside { exit }' <<<"$sealed"
} >"$OUTPUT"
echo "Wrote $OUTPUT. Also set backup.endpointURL to: $($TF output -raw backup_endpoint)"
