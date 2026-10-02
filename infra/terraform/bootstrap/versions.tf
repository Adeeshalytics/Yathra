terraform {
  required_version = ">= 1.12.0"

  required_providers {
    oci = {
      source  = "oracle/oci"
      version = "~> 9.8"
    }
    time = {
      source  = "hashicorp/time"
      version = "~> 0.13"
    }
  }

  # Local state on purpose: this stack creates the bucket every other stack keeps its state
  # in, so it cannot keep its own state there before it exists. It holds OCIDs only, no secrets.
}

provider "oci" {
  region              = var.region
  config_file_profile = var.oci_config_profile
}
