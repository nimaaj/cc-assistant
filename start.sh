#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
RECIPE="default"
PACKAGE_MANAGER="${CC_ASSISTANT_PACKAGE_MANAGER:-}"
FORCE_INSTALL=false
FORCE_BUILD=false
SKIP_INSTALL=false
SKIP_BUILD=false

usage() {
  cat <<'EOF'
Start cc-assistant's daemon, MCP-enabled controller, and web dashboard.

Usage: ./start.sh [options]

Options:
  --recipe NAME              Start a committed runtime recipe (default: default)
  --package-manager NAME     Use pnpm or npm for setup/build steps
  --install                  Reinstall dependencies before starting
  --build                    Rebuild all workspaces and the Claude plugin
  --skip-install             Fail instead of installing when node_modules is missing
  --skip-build               Fail instead of building when artifacts are missing
  -h, --help                 Show this help

Environment:
  CC_ASSISTANT_PACKAGE_MANAGER=pnpm|npm

The script installs or builds only when required unless --install or --build is supplied.
It starts a detached tmux recipe and prints its dashboard and attachment details.
EOF
}

fail() {
  printf 'cc-assistant startup: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "required command '$1' was not found in PATH"
}

while (($# > 0)); do
  case "$1" in
    --recipe)
      (($# >= 2)) || fail "--recipe requires a name"
      RECIPE="$2"
      shift 2
      ;;
    --package-manager)
      (($# >= 2)) || fail "--package-manager requires pnpm or npm"
      PACKAGE_MANAGER="$2"
      shift 2
      ;;
    --install)
      FORCE_INSTALL=true
      shift
      ;;
    --build)
      FORCE_BUILD=true
      shift
      ;;
    --skip-install)
      SKIP_INSTALL=true
      shift
      ;;
    --skip-build)
      SKIP_BUILD=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "unknown option '$1' (run ./start.sh --help)"
      ;;
  esac
done

[[ "$RECIPE" =~ ^[a-z0-9][a-z0-9-]*$ ]] || fail "recipe names may contain only lowercase letters, numbers, and hyphens"
[[ "$PACKAGE_MANAGER" == "" || "$PACKAGE_MANAGER" == "pnpm" || "$PACKAGE_MANAGER" == "npm" ]] \
  || fail "package manager must be pnpm or npm"
[[ "$FORCE_INSTALL" == false || "$SKIP_INSTALL" == false ]] || fail "--install and --skip-install cannot be combined"
[[ "$FORCE_BUILD" == false || "$SKIP_BUILD" == false ]] || fail "--build and --skip-build cannot be combined"

cd -- "$ROOT_DIR"

require_command node
require_command tmux
require_command claude

NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
if ((NODE_MAJOR < 24 || NODE_MAJOR >= 27)); then
  fail "Node.js 24, 25, or 26 is required; found $(node --version)"
fi

if [[ -z "$PACKAGE_MANAGER" ]]; then
  if command -v pnpm >/dev/null 2>&1; then
    PACKAGE_MANAGER="pnpm"
  else
    PACKAGE_MANAGER="npm"
  fi
fi
require_command "$PACKAGE_MANAGER"

run_install() {
  if [[ "$PACKAGE_MANAGER" == "pnpm" ]]; then
    pnpm install --frozen-lockfile
  else
    npm ci
  fi
}

run_build() {
  if [[ "$PACKAGE_MANAGER" == "pnpm" ]]; then
    pnpm build
    pnpm plugin:build
  else
    npm run build
    npm run plugin:build
  fi
}

if [[ "$FORCE_INSTALL" == true || ! -d node_modules ]]; then
  [[ "$SKIP_INSTALL" == false ]] || fail "node_modules is missing and dependency installation was disabled"
  printf 'Installing dependencies with %s...\n' "$PACKAGE_MANAGER"
  run_install
fi

BUILD_MISSING=false
for artifact in apps/daemon/dist/index.js apps/web/dist/index.html claude-plugin/server/index.mjs; do
  if [[ ! -f "$artifact" ]]; then
    BUILD_MISSING=true
    break
  fi
done

if [[ "$FORCE_BUILD" == true || "$BUILD_MISSING" == true ]]; then
  [[ "$SKIP_BUILD" == false ]] || fail "build artifacts are missing and building was disabled"
  printf 'Building cc-assistant with %s...\n' "$PACKAGE_MANAGER"
  run_build
fi

printf 'Starting runtime recipe %s...\n' "$RECIPE"
node scripts/runtime-recipe.mjs start "$RECIPE"
