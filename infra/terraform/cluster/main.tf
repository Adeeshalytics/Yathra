locals {
  compartment_ocid = data.oci_identity_compartments.project.compartments[0].id
  node_name        = "${var.project}-node-1"

  # Everything that should reach the node from the internet. SSH and the Kubernetes API are
  # admin-only; the web ports are public.
  public_tcp_ports = {
    http  = 80
    https = 443
  }
  admin_tcp_ports = {
    ssh     = 22
    kubeapi = 6443
  }
  admin_rules = {
    for pair in setproduct(keys(local.admin_tcp_ports), var.admin_cidrs) :
    "${pair[0]}-${pair[1]}" => { port = local.admin_tcp_ports[pair[0]], cidr = pair[1], name = pair[0] }
  }
}

# Created by the bootstrap stack; found by name so the stacks share no state.
data "oci_identity_compartments" "project" {
  compartment_id = var.tenancy_ocid
  name           = var.project
  state          = "ACTIVE"
}

data "oci_identity_availability_domains" "this" {
  compartment_id = var.tenancy_ocid
}
