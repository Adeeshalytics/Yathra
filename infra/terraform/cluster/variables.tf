variable "tenancy_ocid" {
  description = "OCID of the tenancy. Same value as in ~/.oci/config."
  type        = string

  validation {
    condition     = startswith(var.tenancy_ocid, "ocid1.tenancy.")
    error_message = "tenancy_ocid must be a tenancy OCID (ocid1.tenancy.…)."
  }
}

variable "user_ocid" {
  description = "OCID of your Oracle user (the user= line in ~/.oci/config). Owns the backups' S3 key."
  type        = string

  validation {
    condition     = startswith(var.user_ocid, "ocid1.user.")
    error_message = "user_ocid must be a user OCID (ocid1.user.…)."
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
  description = "Must match the bootstrap stack: the compartment is looked up by this name."
  type        = string
  default     = "yathra"
}

variable "admin_cidrs" {
  description = "Addresses allowed to reach SSH (22) and the Kubernetes API (6443), e.g. [\"203.0.113.7/32\"]. `make my-ip` prints yours."
  type        = list(string)

  validation {
    condition     = length(var.admin_cidrs) > 0 && alltrue([for c in var.admin_cidrs : can(cidrhost(c, 0))])
    error_message = "admin_cidrs must be a non-empty list of CIDR blocks."
  }

  validation {
    condition     = !contains(var.admin_cidrs, "0.0.0.0/0")
    error_message = "Do not open SSH and the Kubernetes API to the whole internet."
  }
}

variable "ssh_public_key_path" {
  description = "Public half of the key Ansible and you log in with."
  type        = string
  default     = "~/.ssh/yathra_oci.pub"
}

variable "vcn_cidr" {
  description = "Address space of the network. Must not overlap k3s' 10.42.0.0/16 (pods) or 10.43.0.0/16 (services)."
  type        = string
  default     = "10.10.0.0/16"
}

variable "ubuntu_version" {
  description = "Canonical Ubuntu release for the node."
  type        = string
  default     = "24.04"
}

# The defaults are the whole Always Free A1 allowance. The validations repeat the tenancy quota
# (infra/terraform/bootstrap) so a mistake fails at `plan`, before OCI is even asked.
variable "node_ocpus" {
  description = "OCPUs for the A1 node. The Always Free allowance is 2."
  type        = number
  default     = 2

  validation {
    condition     = var.node_ocpus >= 1 && var.node_ocpus <= 2
    error_message = "node_ocpus must be 1 or 2 to stay inside the Always Free allowance."
  }
}

variable "node_memory_gb" {
  description = "Memory for the A1 node in GB. The Always Free allowance is 12."
  type        = number
  default     = 12

  validation {
    condition     = var.node_memory_gb >= 6 && var.node_memory_gb <= 12
    error_message = "node_memory_gb must be between 6 and 12 to stay inside the Always Free allowance."
  }
}

variable "boot_volume_gb" {
  description = "Boot volume size. Always Free covers 200 GB of boot and block volumes in total."
  type        = number
  default     = 100

  validation {
    condition     = var.boot_volume_gb >= 50 && var.boot_volume_gb <= 200
    error_message = "boot_volume_gb must be between 50 and 200."
  }
}
