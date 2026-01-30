#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

have() { command -v "$1" >/dev/null 2>&1; }

echo "[ratchet-playground] Bootstrapping dev dependencies (WSL/Ubuntu)."

if ! have curl; then
  echo "Missing dependency: curl"
  echo "Install it with: sudo apt-get update && sudo apt-get install -y curl"
  exit 1
fi

if ! have rustup; then
  echo "Installing rustup..."
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
fi

if [[ -f "$HOME/.cargo/env" ]]; then
  # shellcheck disable=SC1091
  source "$HOME/.cargo/env"
fi

echo "Ensuring wasm32 target..."
rustup target add wasm32-unknown-unknown

if ! have wasm-pack; then
  echo "Installing wasm-pack..."
  cargo install wasm-pack
fi

if ! have wasm-bindgen; then
  echo "Installing wasm-bindgen-cli..."
  cargo install wasm-bindgen-cli
fi

if ! have nvm; then
  echo "Installing nvm..."
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
fi

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [[ -s "$NVM_DIR/nvm.sh" ]]; then
  # shellcheck disable=SC1091
  source "$NVM_DIR/nvm.sh"
else
  echo "nvm installed but not found at $NVM_DIR/nvm.sh"
  echo "Open a new shell and re-run: bash scripts/bootstrap.sh"
  exit 1
fi

echo "Installing Node.js LTS..."
nvm install --lts

echo
echo "Done."
echo "Next: run 'make dev' from the repo root."
