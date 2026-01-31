# Six Birds: Particle Substrate

This repository contains the **particle-based substrate** for the paper:

> **To Wake a Stone with Six Birds: A Life is A Theory**
>
> Archived at: https://zenodo.org/records/18420406

This paper is the life-focused instantiation of the emergence calculus introduced in *Six Birds: Foundations of Emergence Calculus*. It demonstrates how the canonical theory-package view (microstate, lens/observables, definability, completion/packaging rule, and audit) can be instantiated in working substrates, and what life-like phenomena are observed in those instantiations.

## What this repository provides

The particle-based substrate implements:

- A **finite microstate** with discrete slow variables and field-like packaging
- **Coarse audit proxies** for tracking system behavior
- **Maintenance/repair behaviors** under perturbations and deadlines
- Interactive exploration of **ratchet primitives P₁–P₆** under a strict null regime (P₃=OFF, P₆=OFF ⇒ reversible / detailed balance)
- Diagnostics for irreversibility (cycle affinities) and structure

See also: [six-birds-neural](https://github.com/anthropics/six-birds-neural) for the neural/meta-layer substrate.

## Repository structure

- `docs/README.md` — Theory and specification
- `apps/web` — Interactive browser UI
- `crates/sim-core` — Rust/WASM simulation core

## Scope and limitations

The paper is explicit about what it does and does not establish:

- Protocol holonomy (P3) is reported as route-dependence diagnostics; arrow-of-time claims require a clean audit/drive channel (P6) separated from a calibrated null
- Reported audit quantities are proxies, not full path-space KL audits
- Idempotence defects of the completion/packaging operator are not measured
- "Novelty/extension" is lens-relative and not claimed as unbounded open-ended evolution

## Prerequisites (WSL Ubuntu 22.04)

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
