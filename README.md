# Ratchet Playground

Interactive browser sandbox for exploring **ratchet primitives P₁–P₆** under a strict **null regime** (P₃=OFF, P₆=OFF ⇒ reversible / detailed balance), plus diagnostics for irreversibility (cycle affinities) and structure.

- Theory/spec: `docs/README.md`
- UI app: `apps/web`
- Simulation core: `crates/sim-core`

## Prereqs (WSL Ubuntu 22.04)

You’ll need Node.js + npm and Rust + wasm tooling.

### One-shot bootstrap (recommended)

```bash
bash scripts/bootstrap.sh
```

### Install Rust toolchain

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
rustup target add wasm32-unknown-unknown
cargo install wasm-pack
```

### Install Node.js (one option: nvm)

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source "$HOME/.nvm/nvm.sh"
nvm install --lts
```

## Getting started

From the repo root:

```bash
# Recommended: use the Makefile targets (handles temp-dir quirks for wasm-pack)
make dev
```

This will:
- compile the Rust/WASM package into `apps/web/src/wasm/sim_core`
- install `apps/web` npm dependencies
- start the Vite dev server (it may use port 5174+ if 5173 is busy)

### Manual compile/run (no Makefile)

```bash
# 1) Build the WASM package into the web app source tree
mkdir -p .tmp
TMPDIR="$PWD/.tmp" CARGO_TARGET_DIR="$PWD/.tmp/cargo-target" \
  cd crates/sim-core && wasm-pack build --target web --out-dir ../../apps/web/src/wasm/sim_core --out-name sim_core

# 2) Install web deps and run dev server
cd apps/web
npm install
npm run dev
```

### Production build

```bash
make wasm
cd apps/web
npm run build
npm run preview
```
