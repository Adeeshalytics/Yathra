output "node_public_ip" {
  description = "Public address of the k3s node."
  value       = oci_core_instance.node.public_ip
}

output "ssh_command" {
  description = "Log in to the node."
  value       = "ssh -i ${trimsuffix(var.ssh_public_key_path, ".pub")} ubuntu@${oci_core_instance.node.public_ip}"
}

output "image" {
  description = "The image the node was built from."
  value       = data.oci_core_images.ubuntu.images[0].display_name
}

# `make inventory` writes this to ansible/inventory.yml.
output "ansible_inventory" {
  description = "Ansible inventory for infra/ansible."
  value = yamlencode({
    all = {
      children = {
        k3s_servers = {
          hosts = {
            (local.node_name) = {
              ansible_host = oci_core_instance.node.public_ip
              public_ip    = oci_core_instance.node.public_ip
              private_ip   = oci_core_instance.node.private_ip
            }
          }
        }
      }
    }
  })
}
