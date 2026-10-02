# Where PostgreSQL's backups go (docs/devops/06-reliability.md): a private bucket, written
# through Object Storage's S3-compatible API by CloudNativePG's Barman Cloud plugin. Each
# environment uses its own prefix (s3://yathra-backups/staging, …/production). Barman deletes
# backups older than the chart's retention; the Always Free tier covers 10 GB of standard storage.

resource "oci_objectstorage_bucket" "backups" {
  compartment_id = local.compartment_ocid
  namespace      = data.oci_objectstorage_namespace.this.namespace
  name           = "${var.project}-backups"
  access_type    = "NoPublicAccess"
  storage_tier   = "Standard"
}

data "oci_objectstorage_namespace" "this" {
  compartment_id = var.tenancy_ocid
}

# An S3-style key pair for the backups. OCI calls these "customer secret keys"; each user may
# have two. The secret half is shown once — by Terraform, into its (private, versioned) state.
resource "oci_identity_customer_secret_key" "backups" {
  user_id      = var.user_ocid
  display_name = "${var.project}-backups (Terraform)"
}

output "backup_endpoint" {
  description = "backup.endpointURL for deploy/environments/<env>/values.yaml."
  value       = "https://${data.oci_objectstorage_namespace.this.namespace}.compat.objectstorage.${var.region}.oraclecloud.com"
}

output "backup_access_key_id" {
  description = "ACCESS_KEY_ID for the backup credentials."
  value       = oci_identity_customer_secret_key.backups.id
}

output "backup_secret_access_key" {
  description = "ACCESS_SECRET_KEY for the backup credentials. Seal it; never commit it."
  value       = oci_identity_customer_secret_key.backups.key
  sensitive   = true
}
