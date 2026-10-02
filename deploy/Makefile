# The Kubernetes side, run from deploy/. See docs/devops/03-kubernetes.md.
#
# A complete local environment on k3d (k3s in Docker), the same software as the real cluster:
#   make up        cluster + platform + images + secret + app, with Helm (~10 minutes)
#   make up-gitops the same, but Argo CD deploys everything from GitHub (D4)
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

.PHONY: object-store restore-drill load-test help up up-gitops grafana argocd-ui cluster platform images namespace secret deploy seed status open down template

help: ## List the targets
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-10s %s\n", $$1, $$2}'

up: cluster platform images namespace secret deploy ## Everything, from nothing to a running site
	@echo "Open http://yathra.localhost — then 'make seed' for demo data."

REVISION ?= main
up-gitops: cluster images ## The same, but Argo CD installs everything from GitHub (REVISION=branch)
	REVISION=$(REVISION) bash argocd/install.sh local
	@echo "Waiting for Argo CD to create the $(NAMESPACE) namespace…"
	@until kubectl get namespace $(NAMESPACE) >/dev/null 2>&1; do sleep 5; done
	$(MAKE) secret
	@echo "Argo CD: 'make argocd-ui'. The site: http://yathra.localhost once 'make status' is all Running."

grafana: ## Open a tunnel to Grafana on http://localhost:3000 (dashboards "Yathra — <namespace>")
	kubectl -n monitoring port-forward svc/grafana 3000:80

argocd-ui: ## Print the Argo CD admin password and open a tunnel to the UI on :8443
	@echo "user admin, password: $$(kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath='{.data.password}' | base64 -d)"
	kubectl -n argocd port-forward svc/argocd-server 8443:80

cluster: ## Create the k3d cluster (skipped if it exists)
	k3d cluster list $(CLUSTER) >/dev/null 2>&1 || k3d cluster create --config local/k3d.yaml

platform: ## Monitoring, cert-manager, CloudNativePG, Sealed Secrets
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
	@until kubectl -n kube-system get deploy sealed-secrets-controller >/dev/null 2>&1; do sleep 5; done
	@kubectl -n kube-system rollout status deploy/sealed-secrets-controller --timeout=5m >/dev/null
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

object-store: ## A local S3-compatible store (RustFS) for database backups, with its credentials
	kubectl apply -f local/object-store.yaml
	kubectl -n object-store rollout status deploy/rustfs --timeout=5m
	kubectl -n $(NAMESPACE) create secret generic yathra-backup-credentials \
	  --from-literal=ACCESS_KEY_ID=local-backups --from-literal=ACCESS_SECRET_KEY=local-backups-not-a-secret \
	  --dry-run=client -o yaml | kubectl apply -f -

restore-drill: ## Back up the database, restore it into a new cluster, compare every table
	bash scripts/restore-drill.sh $(NAMESPACE)

VUS ?= 20
HOLD ?= 2m
load-test: ## k6 load test of the browsing journey (VUS=20 HOLD=2m; BASE_URL for another site)
	docker run --rm -i --add-host yathra.localhost:host-gateway \
	  -e VUS=$(VUS) -e HOLD=$(HOLD) -e BASE_URL=$(or $(BASE_URL),http://yathra.localhost) \
	  grafana/k6:2.3.0 run - < tests/load/browse.js

down: ## Delete the local cluster and everything in it
	k3d cluster delete $(CLUSTER)
