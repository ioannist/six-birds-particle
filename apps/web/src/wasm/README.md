# Generated WASM bindings

This folder is intentionally mostly empty in git.

Build the Rust/WASM package into:

`apps/web/src/wasm/sim_core`

via:

```bash
cd crates/sim-core
wasm-pack build --target web --out-dir ../../apps/web/src/wasm/sim_core --out-name sim_core
```

