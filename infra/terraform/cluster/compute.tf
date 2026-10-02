# The single k3s node: an Ampere A1 (Arm) VM sized to the Always Free allowance.

# Newest Canonical Ubuntu image for A1 (not the "Minimal" variant).
data "oci_core_images" "ubuntu" {
  compartment_id           = var.tenancy_ocid
  operating_system         = "Canonical Ubuntu"
  operating_system_version = var.ubuntu_version
  shape                    = "VM.Standard.A1.Flex"
  sort_by                  = "TIMECREATED"
  sort_order               = "DESC"
  state                    = "AVAILABLE"

  filter {
    name   = "display_name"
    values = ["^Canonical-Ubuntu-${replace(var.ubuntu_version, ".", "\\.")}-aarch64-"]
    regex  = true
  }
}

resource "oci_core_instance" "node" {
  compartment_id      = local.compartment_ocid
  availability_domain = data.oci_identity_availability_domains.this.availability_domains[0].name
  display_name        = local.node_name
  shape               = "VM.Standard.A1.Flex"

  shape_config {
    ocpus         = var.node_ocpus
    memory_in_gbs = var.node_memory_gb
  }

  source_details {
    source_type             = "image"
    source_id               = data.oci_core_images.ubuntu.images[0].id
    boot_volume_size_in_gbs = var.boot_volume_gb
    boot_volume_vpus_per_gb = 10 # "Balanced" performance, the Always Free tier
  }

  create_vnic_details {
    subnet_id        = oci_core_subnet.public.id
    assign_public_ip = true
    hostname_label   = local.node_name
    nsg_ids          = [oci_core_network_security_group.node.id]
  }

  metadata = {
    ssh_authorized_keys = trimspace(file(pathexpand(var.ssh_public_key_path)))
  }

  # Only the token-protected metadata endpoint (IMDSv2): a request forged through a
  # server-side request forgery bug cannot read the instance's credentials or metadata.
  instance_options {
    are_legacy_imds_endpoints_disabled = true
  }

  preserve_boot_volume = false

  lifecycle {
    # Oracle publishes new images every few weeks. Without this, each one would make Terraform
    # want to rebuild the server; patches arrive through unattended-upgrades instead.
    ignore_changes = [source_details[0].source_id]
  }
}
