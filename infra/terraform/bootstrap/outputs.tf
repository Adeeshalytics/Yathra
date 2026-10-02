output "compartment_ocid" {
  description = "Compartment holding every project resource."
  value       = oci_identity_compartment.project.id
}

output "namespace" {
  description = "Object Storage namespace of the tenancy."
  value       = data.oci_objectstorage_namespace.this.namespace
}

output "state_bucket" {
  description = "Bucket that stores Terraform state for the other stacks."
  value       = oci_objectstorage_bucket.tfstate.name
}

# `make bootstrap` writes this to terraform/cluster/backend.hcl.
output "cluster_backend_config" {
  description = "Partial backend configuration for the cluster stack."
  value       = <<-EOT
    bucket              = "${oci_objectstorage_bucket.tfstate.name}"
    namespace           = "${data.oci_objectstorage_namespace.this.namespace}"
    region              = "${var.region}"
    key                 = "cluster/terraform.tfstate"
    auth                = "APIKey"
    config_file_profile = "${var.oci_config_profile}"
  EOT
}
