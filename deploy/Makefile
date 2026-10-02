# The Kubernetes side, run from deploy/. See docs/devops/03-kubernetes.md.
#
# A complete local environment on k3d (k3s in Docker), the same software as the real cluster:
#   make up        cluster + platform + images + secret + app       (~10 minutes the first time)
#   make seed      demo data (operators, routes, trips) and accounts
#   make down      delete the local cluster
#
# Needs docker, k3d, kubectl, helm, kubeseal, openssl.

SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := help

CLUSTER := yathra
NAMESPACE ?= yathra-local
RELEASE := yathra
REGISTRY := ghcr.io/adeeshalytics
TAG := local
SEED_PASSWORD ?=

.PHONY: help up cluster platform images namespace secret deploy seed status open down template

help: ## List the targets
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-10s %s\n", $$1, $$2}'

up: cluster platform images namespace secret deploy ## Everything, from nothing to a running site
	@echo "Open http://yathra.localhost — then 'make seed' for demo data."

cluster: ## Create the k3d cluster (skipped if it exists)
	k3d cluster list $(CLUSTER) >/dev/null 2>&1 || k3d cluster create --config local/k3d.yaml

platform: ## cert-manager, CloudNativePG, Sealed Secrets
	bash platform/install.sh local

images: ## Build both production images and load them into the cluster
	docker build --target production -t $(REGISTRY)/yathra-backend:$(TAG) ../backend
	docker build --target production -t $(REGISTRY)/yathra-frontend:$(TAG) ../frontend
	k3d image import --cluster $(CLUSTER) $(REGISTRY)/yathra-backend:$(TAG) $(REGISTRY)/yathra-frontend:$(TAG)

namespace: ## The environment's namespace, enforcing the "restricted" Pod Security Standard
	kubectl create namespace $(NAMESPACE) --dry-run=client -o yaml | kubectl apply -f -
	kubectl label namespace $(NAMESPACE) --overwrite \
	  pod-security.kubernetes.io/enforce=restricted pod-security.kubernetes.io/warn=restricted

secret: ## Generate the app's keys as a SealedSecret and apply it (once per namespace)
	@if kubectl -n $(NAMESPACE) get secret yathra-app >/dev/null 2>&1; then \
	  echo "Secret yathra-app already exists in $(NAMESPACE)"; \
	else \
	  bash scripts/new-app-secret.sh $(NAMESPACE) /tmp/yathra-app.sealed.yaml && \
	  kubectl apply -f /tmp/yathra-app.sealed.yaml && rm /tmp/yathra-app.sealed.yaml && \
	  until kubectl -n $(NAMESPACE) get secret yathra-app >/dev/null 2>&1; do sleep 1; done; \
	fi

deploy: ## Install or upgrade the app
	helm upgrade --install $(RELEASE) charts/yathra --namespace $(NAMESPACE) \
	  --values environments/local/values.yaml --set image.tag=$(TAG) --wait --timeout 10m

seed: ## Demo data and accounts; their password is SEED_PASSWORD, or a new random one
	@password='$(SEED_PASSWORD)'; [[ -n "$$password" ]] || password="Demo-$$(openssl rand -hex 6)"; \
	kubectl -n $(NAMESPACE) exec deploy/$(RELEASE)-api -c api -- \
	  python manage.py seed_dev_data --force --password "$$password"; \
	echo "Seeded. Demo accounts' password: $$password"
	kubectl -n $(NAMESPACE) exec deploy/$(RELEASE)-api -c api -- python manage.py refresh_route_paths

status: ## Pods, jobs, database and ingress at a glance
	kubectl -n $(NAMESPACE) get pods,jobs,cronjobs,ingress
	kubectl -n $(NAMESPACE) get cluster.postgresql.cnpg.io

template: ## Render the chart with the local values (no cluster needed)
	helm template $(RELEASE) charts/yathra --namespace $(NAMESPACE) \
	  --values environments/local/values.yaml --set image.tag=$(TAG)

down: ## Delete the local cluster and everything in it
	k3d cluster delete $(CLUSTER)
