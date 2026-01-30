# Central Mathematical Device: Reversible Channels + Non‑Equilibrium Sources

This note captures the core device used to make the playground:
- mathematically clean,
- toggleable,
- and free of baked-in directionality.

## 1) Fast–slow state

Model the world as:
\[
Z_t=(X_t,W_t).
\]
- \(X_t\): fast substrate (particles).
- \(W_t\): slow variables (bonds, capacities, counters, fields, resources).

## 2) Generator decomposition (conceptual)

In continuous time, write the generator:
\[
\mathcal L = \mathcal L_0 + \sum_{i=1}^6 \mathbf 1_{P_i\ \text{on}}\,\mathcal L_i.
\]
In discrete time, this corresponds to:
- a base kernel, plus
- additional kernels/transitions contributed by enabled primitives.

## 3) Reversible null regime via Gibbs measure

Choose an energy \(E(Z)\) and define:
\[
\pi(Z)\propto e^{-\beta E(Z)}.
\]
Implement each enabled reversible channel (P₁, P₂, P₄, P₅ in null mode) via symmetric proposals plus Metropolis acceptance:
\[
A(Z\to Z')=\min\{1, e^{-\beta(E(Z')-E(Z))}\}.
\]
This guarantees detailed balance w.r.t. \(\pi\).

## 4) How P₆ breaks reversibility without imposing goals

When P₆ is enabled, allow certain transitions to include an antisymmetric “work” term:
\[
W(Z\to Z') = -W(Z'\to Z).
\]
Use the nonequilibrium Metropolis acceptance:
\[
A(Z\to Z')=\min\{1, e^{-\beta\Delta E+\beta W(Z\to Z')}\}.
\]
This breaks detailed balance when \(W\) has nonzero circulation on cycles.

Interpretation:
- \(W\) is not “fitness”; it is a nonconservative affinity (chemical potential, resource gradient).
- It supplies an audit-able arrow-of-time that other primitives may rectify into patterns.

## 5) How P₃ produces holonomy (geometric/protocol effect)

Let \(K_A, K_B, K_C\) be kernels, each individually reversible w.r.t. the same \(\pi\).
Define the protocol cycle kernel:
\[
K_{\rm cyc}=K_C K_B K_A.
\]
Even though each step is reversible, the product is generally **nonreversible as an observed stroboscopic kernel** if the kernels do not commute:
\[
[K_A,K_B]\ne 0 \quad\Rightarrow\quad K_{\rm cyc}\ \text{nonreversible}.
\]

Interpretation:
- P₃ creates geometric currents via order-of-operations.
- This is a holonomy diagnostic. If the protocol is external or the phase is hidden, the observed process can look irreversible (protocol-trap).
- In an autonomous lifted model with phase included and reversible phase dynamics, P₃ alone does **not** certify a sustained arrow-of-time audit.

## 6) Why this device matches the “no bias to evolve” constraint

- In null mode (P₃=OFF, P₆=OFF), every enabled transition satisfies detailed balance ⇒ no net currents.
- Any observed arrow-of-time audit must come from P₆ drive or an explicit external schedule; P₃ loop observables are holonomy diagnostics and must be paired with an audit (e.g., affinity or path-asymmetry) in an autonomous model.

---
