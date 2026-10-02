terraform {
  required_version = ">= 1.12.0"

  required_providers {
    oci = {
      source  = "oracle/oci"
      version = "~> 9.8"
    }
  }

  # State lives in the bucket the bootstrap stack created, with locking, so two applies can
  # never run at once. The values are account-specific and come from backend.hcl:
  #   terraform init -backend-config=backend.hcl      (make init writes it)
  backend "oci" {}
}

provider "oci" {
  region              = var.region
  config_file_profile = var.oci_config_profile
}
