# One VCN with one public subnet. The node gets a public IP; what can reach it is decided by a
# network security group (NSG) attached to its network card, not by the subnet.

resource "oci_core_vcn" "this" {
  compartment_id = local.compartment_ocid
  display_name   = "${var.project}-vcn"
  cidr_blocks    = [var.vcn_cidr]
  dns_label      = var.project
}

resource "oci_core_internet_gateway" "this" {
  compartment_id = local.compartment_ocid
  vcn_id         = oci_core_vcn.this.id
  display_name   = "${var.project}-igw"
  enabled        = true
}

resource "oci_core_route_table" "public" {
  compartment_id = local.compartment_ocid
  vcn_id         = oci_core_vcn.this.id
  display_name   = "${var.project}-public"

  route_rules {
    destination       = "0.0.0.0/0"
    destination_type  = "CIDR_BLOCK"
    network_entity_id = oci_core_internet_gateway.this.id
  }
}

# Every new VCN gets a default security list that allows SSH from anywhere. Taking it over and
# leaving only egress means the NSG below is the single place inbound access is defined.
resource "oci_core_default_security_list" "this" {
  manage_default_resource_id = oci_core_vcn.this.default_security_list_id
  display_name               = "${var.project}-default (egress only, see NSG)"

  egress_security_rules {
    destination = "0.0.0.0/0"
    protocol    = "all"
  }
}

resource "oci_core_subnet" "public" {
  compartment_id             = local.compartment_ocid
  vcn_id                     = oci_core_vcn.this.id
  display_name               = "${var.project}-public"
  cidr_block                 = cidrsubnet(var.vcn_cidr, 8, 1) # 10.10.1.0/24
  dns_label                  = "public"
  route_table_id             = oci_core_route_table.public.id
  security_list_ids          = [oci_core_default_security_list.this.id]
  prohibit_public_ip_on_vnic = false
}

# ---- Network security group: the node's perimeter firewall ------------------------------------

resource "oci_core_network_security_group" "node" {
  compartment_id = local.compartment_ocid
  vcn_id         = oci_core_vcn.this.id
  display_name   = "${var.project}-node"
}

resource "oci_core_network_security_group_security_rule" "egress_all" {
  network_security_group_id = oci_core_network_security_group.node.id
  description               = "All outbound traffic (package updates, image pulls, …)"
  direction                 = "EGRESS"
  protocol                  = "all"
  destination               = "0.0.0.0/0"
  destination_type          = "CIDR_BLOCK"
}

resource "oci_core_network_security_group_security_rule" "public_tcp" {
  for_each = local.public_tcp_ports

  network_security_group_id = oci_core_network_security_group.node.id
  description               = "${upper(each.key)} from anywhere"
  direction                 = "INGRESS"
  protocol                  = "6" # TCP
  source                    = "0.0.0.0/0"
  source_type               = "CIDR_BLOCK"

  tcp_options {
    destination_port_range {
      min = each.value
      max = each.value
    }
  }
}

resource "oci_core_network_security_group_security_rule" "admin_tcp" {
  for_each = local.admin_rules

  network_security_group_id = oci_core_network_security_group.node.id
  description               = "${each.value.name} from admin ${each.value.cidr}"
  direction                 = "INGRESS"
  protocol                  = "6" # TCP
  source                    = each.value.cidr
  source_type               = "CIDR_BLOCK"

  tcp_options {
    destination_port_range {
      min = each.value.port
      max = each.value.port
    }
  }
}

# "Fragmentation needed" messages. Without them, path-MTU discovery fails and large responses
# silently stall — the default security list allows these for the same reason.
resource "oci_core_network_security_group_security_rule" "icmp_path_mtu" {
  network_security_group_id = oci_core_network_security_group.node.id
  description               = "ICMP fragmentation-needed (path MTU discovery)"
  direction                 = "INGRESS"
  protocol                  = "1" # ICMP
  source                    = "0.0.0.0/0"
  source_type               = "CIDR_BLOCK"

  icmp_options {
    type = 3
    code = 4
  }
}
