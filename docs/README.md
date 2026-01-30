# Ratchet Playground — Local Reference Docs

This folder is intended to live inside the **ratchet-playground** app repository as a self-contained reference for:
- the core *ratchet primitives* **P₁–P₆**,
- the **A‑Life constraint** (no baked-in directionality),
- the **central mathematical device** (fast–slow state, reversible null regime, non‑equilibrium sources),
- Deliverables **A–D** (stationary measure, transition tables, cycle-affinity wiring, on-screen diagnostics),
- and a compact but rigorous write-up of **Weakness × Economy** (the canonical Constraint×Constraint scaffold).

## Guiding principle for the playground

The playground is designed so that:
- **No global objective** is optimized.
- **No replication/heredity** is assumed at the base layer.
- **No “always-increasing write” rules** are allowed by default.
- Any arrow-of-time / “force” that appears must arise from:
  - **non-equilibrium driving** implemented *only through primitives that truly break reversibility* (typically **P₃** and/or **P₆**), and/or
  - emergent interaction effects among enabled primitives.

The null regime (P₃=OFF, P₆=OFF) is required to be **reversible** (detailed balance), and the documents show how to implement that rigorously.

---
