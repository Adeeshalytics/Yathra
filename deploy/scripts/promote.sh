#!/usr/bin/env bash
# Promote what staging runs to production — as a pull request, so a person approves every
# production change and Git records who did it and when.
#
#   deploy/scripts/promote.sh            the tag in deploy/environments/staging/values.yaml
#   deploy/scripts/promote.sh sha-1a2b3c4  a specific tag (for example, to roll back)
#
# Creates the branch promote/<tag> from origin/main, commits the new tag to
# deploy/environments/production/values.yaml, pushes it, and prints the link to open the PR.
# Merging the PR is the deployment: Argo CD rolls production out to that tag.
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
STAGING="deploy/environments/staging/values.yaml"
PRODUCTION="deploy/environments/production/values.yaml"

git -C "$ROOT" fetch --quiet origin main
tag_in() { git -C "$ROOT" show "origin/main:$1" | sed -n 's/^  tag: *\([^ #]*\).*/\1/p' | head -1; }

TAG=${1:-$(tag_in "$STAGING")}
CURRENT=$(tag_in "$PRODUCTION")
[[ "$TAG" =~ ^sha-[0-9a-f]{7,40}$ ]] || { echo "Not an image tag: '$TAG'"; exit 1; }
[[ "$TAG" != "$CURRENT" ]] || { echo "Production already runs $TAG."; exit 0; }

BRANCH="promote/$TAG"
WORKTREE=$(mktemp -d)
trap 'git -C "$ROOT" worktree remove --force "$WORKTREE" >/dev/null 2>&1 || true' EXIT

# A separate worktree, so whatever is checked out (and uncommitted) here is left alone.
git -C "$ROOT" worktree add --quiet -b "$BRANCH" "$WORKTREE" origin/main
sed -i "s/^  tag: *$CURRENT/  tag: $TAG/" "$WORKTREE/$PRODUCTION"
git -C "$WORKTREE" commit --quiet -am "deploy(production): $CURRENT → $TAG"
git -C "$WORKTREE" push --quiet -u origin "$BRANCH"

REMOTE=$(git -C "$ROOT" remote get-url origin | sed -E 's#(git@github.com:|https://github.com/)##; s#\.git$##')
echo "Production: $CURRENT → $TAG"
echo "Open the pull request: https://github.com/$REMOTE/compare/main...$BRANCH?expand=1"
