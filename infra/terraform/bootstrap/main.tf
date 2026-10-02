# One-time foundation, applied before anything that costs (or could cost) money:
#
#   1. a compartment that holds every project resource,
#   2. the bucket that stores Terraform state for the other stacks,
#   3. guardrails that make the Pay As You Go account behave like a free one.

resource "oci_identity_compartment" "project" {
  compartment_id = var.tenancy_ocid
  name           = var.project
  description    = "Yathra bus booking platform. Managed by Terraform (infra/terraform)."
  enable_delete  = true # let `terraform destroy` remove it
}

# A new compartment takes a little while to be visible to every OCI service.
resource "time_sleep" "compartment_propagation" {
  depends_on      = [oci_identity_compartment.project]
  create_duration = "60s"
}

data "oci_objectstorage_namespace" "this" {
  compartment_id = var.tenancy_ocid
}

resource "oci_objectstorage_bucket" "tfstate" {
  depends_on = [time_sleep.compartment_propagation]

  compartment_id = oci_identity_compartment.project.id
  namespace      = data.oci_objectstorage_namespace.this.namespace
  name           = "${var.project}-tfstate"
  access_type    = "NoPublicAccess"
  storage_tier   = "Standard"
  # Every state write keeps the previous version, so a bad apply or an accidental delete can be
  # rolled back.
  versioning = "Enabled"
}

# ---- Guardrails ------------------------------------------------------------------------------
#
# Quotas are hard limits: OCI refuses to create anything that would exceed them, whatever the
# account could otherwise pay for. Everything is zeroed, then exactly the Always Free allowance
# is allowed back:
#
#   Ampere A1 (Arm)  1,500 OCPU-hours + 9,000 GB-hours a month = 2 OCPUs and 12 GB all month
#   AMD E2.1.Micro   two instances
#   Block volumes    200 GB of boot + block volumes, 5 backups
#
# Hyderabad has a single availability domain, and single-AD regions check the *regional* A1
# quota names — so both the per-AD and the regional names are set.

resource "oci_limits_quota" "free_tier" {
  compartment_id = var.tenancy_ocid
  name           = "FreeTierGuardrails"
  description    = "Limit the tenancy to the Always Free allowance. Managed by Terraform (infra/terraform/bootstrap)."

  # Order matters: within one quota policy, later statements override earlier ones.
  statements = [
    "zero compute-core quotas in tenancy",
    "zero compute-memory quotas in tenancy",
    "set compute-core quota standard-a1-core-count to 2 in tenancy",
    "set compute-core quota standard-a1-core-regional-count to 2 in tenancy",
    "set compute-memory quota standard-a1-memory-count to 12 in tenancy",
    "set compute-memory quota standard-a1-memory-regional-count to 12 in tenancy",
    "set compute-core quota standard-e2-micro-core-count to 2 in tenancy",
    "set block-storage quota total-storage-gb to 200 in tenancy",
    "set block-storage quota backup-count to 5 in tenancy",
  ]
}

# Quotas stop compute and disks from growing past the free allowance; the budget is the
# smoke alarm for everything else (a paid shape in another service, data egress, …).
resource "oci_budget_budget" "monthly" {
  compartment_id = var.tenancy_ocid
  display_name   = "${var.project}-monthly"
  description    = "Should stay at zero. Managed by Terraform (infra/terraform/bootstrap)."
  amount         = var.budget_amount
  reset_period   = "MONTHLY"
  target_type    = "COMPARTMENT"
  targets        = [var.tenancy_ocid] # the root compartment: the whole tenancy
}

resource "oci_budget_alert_rule" "any_spend" {
  budget_id      = oci_budget_budget.monthly.id
  display_name   = "any-actual-spend"
  description    = "Fires as soon as anything is actually billed."
  type           = "ACTUAL"
  threshold_type = "ABSOLUTE"
  threshold      = 0.01
  recipients     = var.budget_alert_email
  message        = "Oracle Cloud has billed something in the ${var.project} tenancy. Check Billing & Cost Management → Cost Analysis now."
}

resource "oci_budget_alert_rule" "forecast" {
  budget_id      = oci_budget_budget.monthly.id
  display_name   = "forecast-over-budget"
  description    = "Fires when the month is forecast to exceed the budget."
  type           = "FORECAST"
  threshold_type = "PERCENTAGE"
  threshold      = 100
  recipients     = var.budget_alert_email
  message        = "Oracle Cloud forecasts spend above the ${var.project} budget this month."
}
