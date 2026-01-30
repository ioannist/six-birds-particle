# Browser Implementation Notes (Math-to-Code Translation)

These notes are implementation-oriented but keep the discussion mathematical: how to translate the reversible-channel design into a manageable browser simulation.

## 1) Discretize slow variables aggressively

To keep the state space finite and updates cheap:
- \(w_{ij}\in\{0,\dots,L_w\}\) with small \(L_w\) (e.g., 6–12)
- \(a_i\in\{0,\dots,L_a\}\) small
- \(n_k\in\{-L_n,\dots,L_n\}\) small
- \(S_q\in\{0,\dots,L_S\}\) small
- optional \(r_i\in\{0,\dots,L_r\}\) small

Discrete ±1 proposals match Deliverables A/B and simplify cycle-affinity estimation.

## 2) Keep the interaction graph sparse

Although \(w_{ij}\) can be defined for all pairs, for performance:
- maintain a neighbor list \(\mathcal N_i\) using spatial hashing (grid buckets),
- only allow bond proposals for pairs within a radius (or propose uniformly among neighbor pairs).

If you do this, ensure proposal symmetry:
- proposal probability for \((i,j)\) must equal that for \((i,j)\) in reverse (same edge).

## 3) Update scheduling as a mixture (null) vs protocol (P₃)

### Null regime
Use a mixture of kernels per step:
- with probabilities \(p_X,p_{P1},p_{P2},p_{P4},p_{P5}\) (constants),
pick one move type and apply a Metropolis step.

This yields a time-homogeneous reversible chain.

### With P₃ on
Switch from “mixture” to “protocol” scheduling:
- apply kernels in a fixed cyclic order (e.g., X → P1 → P4 → P2 → P5 → …),
or modulate proposal distributions by phase \(\phi(t)\).

Noncommutativity can appear even if each kernel is individually reversible.

## 4) Energies and local ΔE

Choose \(E(Z)\) so that ΔE for a local move depends only on local terms:
- moving one particle affects only nearby repulsion terms and bonds involving that particle,
- changing one \(w_{ij}\) affects only that edge’s terms,
- changing one \(S_q\) affects only that cell’s term, etc.

This keeps each accept/reject O(local degree).

## 5) Implementing P₆ without heavy resource accounting

The minimal P₆ (affinity-only) is easiest:
- define a scalar field \(\mu(x)\) (two patches is enough),
- define work terms \(W\) for “up” vs “down” moves of memory variables,
- use acceptance with \(-\beta\Delta E+\beta W\).

This is enough to create nonzero cycle affinities via M6 motifs.

## 6) Diagnostics are counting problems

All irreversibility diagnostics can be computed from:
- forward/back counts \(N^+,N^-\),
- context-binned counts \(N_H^{+},N_L^{+},...\),
- periodic sampling for protocol loops.

This is cheap and robust in-browser.

## 7) Avoid hidden directionality

Common pitfalls:
- using one-way clamps (e.g., “if stable, only strengthen”)
- using schedules (“if things look good, increase capacity”)
- using base dynamics that already align/order by design

Stick to:
- reversible updates in null regime,
- P₃/P₆ as the only non-equilibrium sources,
- diagnostics that report what happened, not what should happen.

---
