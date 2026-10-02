# Infrastructure workflow. Run from infra/ inside WSL; see docs/devops/02-iac.md.
#
#   make bootstrap    once: compartment, state bucket, quotas, budget
#   make init         once per checkout: connect the cluster stack to its remote state
#   make plan / apply network + node        (apply-retry: wait out "Out of host capacity")
#   make configure    harden the node and install k3s (Ansible)
#   make nodes        kubectl get nodes

SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := help

BOOTSTRAP := terraform -chdir=terraform/bootstrap
CLUSTER := terraform -chdir=terraform/cluster
KUBECONFIG_FILE := $(HOME)/.kube/yathra.yaml
RETRY_MINUTES ?= 10

# Ansible ignores an ansible.cfg in a world-writable directory (all of /mnt/c under WSL)
# unless it is named explicitly.
export ANSIBLE_CONFIG := $(CURDIR)/ansible/ansible.cfg

.PHONY: help my-ip bootstrap init plan apply apply-retry inventory collections configure ssh nodes destroy lint

help: ## List the targets
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-12s %s\n", $$1, $$2}'

my-ip: ## Print this machine's public address, ready for admin_cidrs
	@echo "$$(curl -fsS https://checkip.amazonaws.com)/32"

bootstrap: ## Create the compartment, state bucket, quotas and budget (once)
	$(BOOTSTRAP) init -input=false
	$(BOOTSTRAP) apply
	$(BOOTSTRAP) output -raw cluster_backend_config > terraform/cluster/backend.hcl
	@echo "Wrote terraform/cluster/backend.hcl — next: make init"

init: ## Connect the cluster stack to its remote state
	$(CLUSTER) init -input=false -backend-config=backend.hcl

plan: ## Show what apply would change
	$(CLUSTER) plan

apply: ## Create or update the network and the node
	$(CLUSTER) apply

# Oracle's free Arm capacity comes and goes. This re-plans and applies every RETRY_MINUTES
# until the node is created, and stops at once on any other error. Review `make plan` first:
# each attempt applies without asking.
apply-retry: ## Retry apply while OCI reports "Out of host capacity"
	@until $(CLUSTER) apply -auto-approve -input=false 2>&1 | tee .apply.log; do \
	  grep -q "Out of host capacity" .apply.log || { echo "Apply failed for another reason; not retrying."; exit 1; }; \
	  echo "$$(date '+%F %T') Out of host capacity; next attempt in $(RETRY_MINUTES) min (Ctrl+C stops)"; \
	  sleep $$(( $(RETRY_MINUTES) * 60 )); \
	done

inventory: ## Write ansible/inventory.yml from the Terraform outputs
	$(CLUSTER) output -raw ansible_inventory > ansible/inventory.yml

collections: ## Install the Ansible collections the roles use
	ansible-galaxy collection install -r ansible/requirements.yml

configure: inventory collections ## Harden the node and install k3s
	cd ansible && ansible-playbook site.yml

ssh: ## Open a shell on the node
	@$$($(CLUSTER) output -raw ssh_command)

nodes: ## kubectl get nodes against the new cluster
	KUBECONFIG=$(KUBECONFIG_FILE) kubectl get nodes -o wide

destroy: ## Delete the node and network (the bootstrap stack stays)
	$(CLUSTER) destroy

lint: ## The same checks CI runs
	terraform fmt -check -recursive -diff terraform
	for stack in bootstrap cluster; do \
	  terraform -chdir=terraform/$$stack init -backend=false -input=false -lockfile=readonly >/dev/null; \
	  terraform -chdir=terraform/$$stack validate; \
	done
	cd ansible && ansible-playbook --syntax-check site.yml && ansible-lint --profile production
