# Ratchet Playground — Implementation Notes (Agent Guidance)

## Tech stack (record of choices)

- UI language/framework: TypeScript + React (Vite)
- Simulation core: Rust compiled to WebAssembly (wasm-bindgen)
- Concurrency model: WebWorker owns the simulation loop; UI receives snapshots/diagnostics
- Rendering: Canvas2D initially (optionally OffscreenCanvas in the worker); WebGL2 is a later optimization
- Diagnostics/plots: lightweight charting (uPlot or custom canvas plots)

## Design constraints from `/docs`

- Null regime (P3=OFF, P6=OFF) must satisfy detailed balance w.r.t. an explicit stationary measure.
- P3 and P6 are the only primitives allowed to break reversibility.
- Diagnostics must be descriptive (no implicit optimization/progress).

## Repo layout

- `apps/web`: Vite React UI + worker bridge
- `crates/sim-core`: Rust/WASM simulation core (no UI code)
- `docs`: local theory/spec reference (source of truth)

## Coding conventions

- Prefer small, composable modules and explicit types.
- Keep simulation state inside WASM/worker; avoid copying large arrays per frame.
- Make “null regime correctness” easy to test/inspect (energy breakdown + affinity ~ 0).

