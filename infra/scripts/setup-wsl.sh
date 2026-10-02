#!/usr/bin/env bash
# One-time workstation setup for the infrastructure tools, inside WSL Ubuntu.
#
#   bash infra/scripts/setup-wsl.sh
#
# Installs Terraform, kubectl and Ansible for your user (checksums verified), creates the SSH key
# you will log in to the node with, and creates the API signing key Terraform uses for Oracle
# Cloud. Safe to run again: anything already in place is left alone.
set -euo pipefail

TERRAFORM_VERSION=1.16.4
KUBECTL_VERSION=v1.36.5 # same minor version as k3s (infra/ansible/group_vars/all.yml)
HELM_VERSION=v4.3.0
KUBESEAL_VERSION=0.40.0 # same as the Sealed Secrets controller (deploy/platform/install.sh)
ANSIBLE_CORE_VERSION=2.21.4
ANSIBLE_LINT_VERSION=26.9.0
REGION=ap-hyderabad-1

BIN="$HOME/.local/bin"
mkdir -p "$BIN"
step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }

step "System packages (asks for your WSL password once)"
sudo apt-get update -qq
sudo apt-get install -y -qq unzip jq pipx python3-venv openssl
pipx ensurepath >/dev/null

step "Terraform $TERRAFORM_VERSION"
if [[ "$("$BIN/terraform" version 2>/dev/null | head -1)" != "Terraform v$TERRAFORM_VERSION" ]]; then
  tmp=$(mktemp -d)
  base="https://releases.hashicorp.com/terraform/$TERRAFORM_VERSION"
  zip="terraform_${TERRAFORM_VERSION}_linux_amd64.zip"
  curl -fsSLo "$tmp/$zip" "$base/$zip"
  curl -fsSLo "$tmp/SHA256SUMS" "$base/terraform_${TERRAFORM_VERSION}_SHA256SUMS"
  (cd "$tmp" && grep " $zip\$" SHA256SUMS | sha256sum --check --quiet)
  unzip -oq "$tmp/$zip" terraform -d "$BIN"
  rm -rf "$tmp"
fi
"$BIN/terraform" version | head -1

step "kubectl $KUBECTL_VERSION"
if ! "$BIN/kubectl" version --client 2>/dev/null | grep -q "$KUBECTL_VERSION"; then
  tmp=$(mktemp -d)
  curl -fsSLo "$tmp/kubectl" "https://dl.k8s.io/release/$KUBECTL_VERSION/bin/linux/amd64/kubectl"
  echo "$(curl -fsSL "https://dl.k8s.io/release/$KUBECTL_VERSION/bin/linux/amd64/kubectl.sha256")  $tmp/kubectl" | sha256sum --check --quiet
  install -m 0755 "$tmp/kubectl" "$BIN/kubectl"
  rm -rf "$tmp"
fi
"$BIN/kubectl" version --client | head -1

step "Helm $HELM_VERSION"
if ! "$BIN/helm" version --short 2>/dev/null | grep -q "^$HELM_VERSION"; then
  tmp=$(mktemp -d)
  tgz="helm-$HELM_VERSION-linux-amd64.tar.gz"
  curl -fsSLo "$tmp/$tgz" "https://get.helm.sh/$tgz"
  echo "$(curl -fsSL "https://get.helm.sh/$tgz.sha256sum" | awk '{print $1}')  $tmp/$tgz" | sha256sum --check --quiet
  tar -xzf "$tmp/$tgz" -C "$tmp" linux-amd64/helm
  install -m 0755 "$tmp/linux-amd64/helm" "$BIN/helm"
  rm -rf "$tmp"
fi
"$BIN/helm" version --short

step "kubeseal $KUBESEAL_VERSION"
if ! "$BIN/kubeseal" --version 2>/dev/null | grep -q "$KUBESEAL_VERSION"; then
  tmp=$(mktemp -d)
  base="https://github.com/bitnami-labs/sealed-secrets/releases/download/v$KUBESEAL_VERSION"
  tgz="kubeseal-$KUBESEAL_VERSION-linux-amd64.tar.gz"
  curl -fsSLo "$tmp/$tgz" "$base/$tgz"
  (cd "$tmp" && curl -fsSL "$base/sealed-secrets_${KUBESEAL_VERSION}_checksums.txt" | grep " $tgz\$" | sha256sum --check --quiet)
  tar -xzf "$tmp/$tgz" -C "$tmp" kubeseal
  install -m 0755 "$tmp/kubeseal" "$BIN/kubeseal"
  rm -rf "$tmp"
fi
"$BIN/kubeseal" --version

step "Ansible $ANSIBLE_CORE_VERSION and ansible-lint $ANSIBLE_LINT_VERSION"
pipx install --force "ansible-core==$ANSIBLE_CORE_VERSION" >/dev/null
pipx install --force "ansible-lint==$ANSIBLE_LINT_VERSION" >/dev/null
"$BIN/ansible" --version | head -1

step "SSH key for the node (~/.ssh/yathra_oci)"
mkdir -p "$HOME/.ssh" && chmod 700 "$HOME/.ssh"
if [[ ! -f "$HOME/.ssh/yathra_oci" ]]; then
  ssh-keygen -t ed25519 -f "$HOME/.ssh/yathra_oci" -N "" -C "yathra-oci-$(whoami)"
fi
echo "public key: ~/.ssh/yathra_oci.pub"

step "Oracle Cloud API signing key (~/.oci)"
mkdir -p "$HOME/.oci" && chmod 700 "$HOME/.oci"
if [[ ! -f "$HOME/.oci/oci_api_key.pem" ]]; then
  (umask 077 && openssl genrsa -out "$HOME/.oci/oci_api_key.pem" 2048 2>/dev/null)
  openssl rsa -pubout -in "$HOME/.oci/oci_api_key.pem" -out "$HOME/.oci/oci_api_key_public.pem" 2>/dev/null
fi
fingerprint=$(openssl rsa -pubout -outform DER -in "$HOME/.oci/oci_api_key.pem" 2>/dev/null | openssl md5 -c | awk '{print $2}')

if [[ ! -f "$HOME/.oci/config" ]]; then
  cat <<EOF

Upload the PUBLIC key below in the Oracle console:
  Profile (top right) → My profile → API keys → Add API key → "Paste a public key" → Add

$(cat "$HOME/.oci/oci_api_key_public.pem")

The private key never leaves this machine (~/.oci/oci_api_key.pem).
After adding it, the console shows a "Configuration file preview" with the OCIDs asked below.
EOF
  read -rp "user OCID    (ocid1.user…):    " user_ocid
  read -rp "tenancy OCID (ocid1.tenancy…): " tenancy_ocid
  [[ "$user_ocid" == ocid1.user.* && "$tenancy_ocid" == ocid1.tenancy.* ]] || { echo "Those do not look like OCIDs; run the script again."; exit 1; }
  (umask 077 && cat > "$HOME/.oci/config" <<EOF
[DEFAULT]
user=$user_ocid
fingerprint=$fingerprint
tenancy=$tenancy_ocid
region=$REGION
key_file=$HOME/.oci/oci_api_key.pem
EOF
  )
  echo "Wrote ~/.oci/config. The console's fingerprint should read: $fingerprint"
else
  echo "~/.oci/config already exists (key fingerprint: $fingerprint)"
fi

step "Done"
echo "Open a new terminal (or run: source ~/.profile) so ~/.local/bin is on your PATH."
echo "Next: cd to the repo's infra/ directory and follow docs/devops/02-iac.md from 'First run'."
