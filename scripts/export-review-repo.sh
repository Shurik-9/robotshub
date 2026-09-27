#!/usr/bin/env bash
# Produce a new, clean working tree for a separate GitHub repository.
# Never pushes or rewrites the original Replit Git history.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ "$#" -ne 1 ]; then
  echo "Usage: bash scripts/export-review-repo.sh /path/to/empty/destination" >&2
  exit 2
fi
destination="$(realpath -m "$1")"
if [ "$destination" = "$root" ] || [ "$destination" = "/" ]; then
  echo "Choose a new destination, not the source repository." >&2
  exit 2
fi
if [ -e "$destination" ] && [ -n "$(ls -A "$destination")" ]; then
  echo "Destination must be empty: $destination" >&2
  exit 2
fi
mkdir -p "$destination"

(
  cd "$root"
  tar -cf - \
    --exclude='.replit-artifact' --exclude='node_modules' --exclude='dist' \
    --exclude='*.tsbuildinfo' \
    --exclude='docs/prtners' \
    --exclude='*.tsbuildinfo' --exclude='*.zip' --exclude='*.7z' \
    --exclude='post-merge.sh' \
    .npmrc .gitignore .dockerignore .env.example \
    package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.json \
    Dockerfile compose.yaml README.md SECURITY.md \
    deploy docs .github artifacts lib scripts
) | tar -xf - -C "$destination"

echo "Clean review tree created at: $destination"
echo "No Git history, Replit configuration, uploaded archives or full-text research sources were copied."
echo "Check docs/DATA_AND_RIGHTS.md and obtain rights approval before publishing."