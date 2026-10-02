variable "tenancy_ocid" {
  description = "OCID of the tenancy (Oracle console → Profile → Tenancy). Same value as in ~/.oci/config."
  type        = string

  validation {
    condition     = startswith(var.tenancy_ocid, "ocid1.tenancy.")
    error_message = "tenancy_ocid must be a tenancy OCID (ocid1.tenancy.…)."
  }
}

variable "region" {
  description = "Home region. Always Free resources exist only there."
  type        = string
  default     = "ap-hyderabad-1"
}

variable "oci_config_profile" {
  description = "Profile in ~/.oci/config holding the API key Terraform signs requests with."
  type        = string
  default     = "DEFAULT"
}

variable "project" {
  description = "Name used for the compartment and as a prefix for resources."
  type        = string
  default     = "yathra"
}

variable "budget_amount" {
  description = "Monthly budget in the tenancy's currency. Everything here should cost nothing; the budget exists to raise the alarm if something does."
  type        = number
  default     = 1
}

variable "budget_alert_email" {
  description = "Where budget alerts go."
  type        = string

  validation {
    condition     = can(regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", var.budget_alert_email))
    error_message = "budget_alert_email must be an e-mail address."
  }
}
