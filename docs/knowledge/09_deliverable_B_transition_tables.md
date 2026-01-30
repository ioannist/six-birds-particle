# Deliverable B — Primitive Transition Tables

This document specifies the **local transitions** each primitive contributes, and how toggles modify the transition rules.

Design constraints:
- In null regime (P₃=OFF, P₆=OFF), all enabled primitives must preserve detailed balance w.r.t. the same \(\pi(Z)\propto e^{-\beta E(Z)}\) from Deliverable A.
- P₆ is the only primitive that directly introduces nonconservative affinities; P₃ introduces protocol holonomy and only yields apparent irreversibility when the protocol is external or the phase is hidden.

---

## B0) Common components

### Base acceptance (null regime)
For a move \(Z\to Z'\):
\[
A_{\text{null}}(Z\to Z')=\min\{1,e^{-\beta\Delta E}\},\qquad \Delta E=E(Z')-E(Z).
\]

### Nonequilibrium acceptance (when P₆ is ON)
Add an antisymmetric work term \(W(Z\to Z')=-W(Z'\to Z)\):
\[
A_{P6}(Z\to Z')=\min\{1,e^{-\beta\Delta E+\beta W(Z\to Z')}\}.
\]
If \(W\equiv 0\), this reduces to the null acceptance.

### Protocol-cycle (when P₃ is ON)
P₃ can:
- modify proposal distributions (e.g., add a flow field), and/or
- enforce a specific noncommuting order of sub-kernels (see Deliverable C).

---

## B1) Base substrate update (always available)

### State
- positions \(x_i\in\mathbb T^2\).

### Proposal (P₃ OFF)
Pick \(i\) and propose:
\[
x_i' = x_i + \delta \quad (\mathrm{mod}\ 1),
\]
with \(\delta\) drawn from a symmetric distribution (e.g., uniform in a small disk).

### Acceptance
Use \(A_{\text{null}}\).

### Proposal (P₃ ON)
Pick \(i\) and propose:
\[
x_i' = x_i + u(x_i,\phi)\Delta t + \delta,
\]
where \(u(\cdot,\phi)\) is a bounded, time-periodic flow field with zero mean over a cycle.

Acceptance may still use \(A_{\text{null}}\) against the same \(E\); P₃ induces holonomy via time-dependent ordering. If the phase is hidden or the protocol is external, the observed process can look irreversible, but P₃ alone does not certify a sustained arrow-of-time audit in an autonomous lifted model.

---

## B2) P₁ — Operator-write (bond levels)

### State
- \(w_{ij}\in\{0,\dots,L_w\}\) for all \(i<j\).

### Energy terms affected
- \(\frac{\lambda_w}{2}w_{ij}^2\)
- \(\frac{\kappa_{\mathrm{bond}}}{2}w_{ij}(r_{ij}-r_\star)^2\)

### Proposal
Pick \(i<j\) and propose:
\[
w_{ij}' = w_{ij}\pm 1
\]
with equal probability, respecting bounds.

### Acceptance
- P₃ OFF, P₆ OFF: \(A_{\text{null}}\).
- P₆ ON: \(A_{P6}\) with a work term such as:
  \[
  W_{P1}=
  \begin{cases}
  +\eta_w\,\mu(x_{ij}) & \text{if } w_{ij}'=w_{ij}+1\\
  -\eta_w\,\mu(x_{ij}) & \text{if } w_{ij}'=w_{ij}-1
  \end{cases}
  \]
  where \(x_{ij}=(x_i+x_j)/2\).
- P₃ ON: may modulate attempt rate or ordering; it is a holonomy diagnostic and does not by itself certify directionality in an autonomous lifted model.

---

## B3) P₂ — Feasible-set-write (apparatus levels)

### State
- \(a_i\in\{0,\dots,L_a\}\).

### Energy term affected
- \(\frac{\lambda_a}{2}a_i^2\).

### Proposal
Pick \(i\) and propose:
\[
a_i' = a_i\pm 1.
\]

### Acceptance
- Null: \(A_{\text{null}}\).
- With P₆ ON:
  \[
  W_{P2}=
  \begin{cases}
  +\eta_a\,\mu(x_i) & a_i'=a_i+1\\
  -\eta_a\,\mu(x_i) & a_i'=a_i-1
  \end{cases}
  \]
  and accept with \(A_{P6}\).
- P₃ ON: optional phase-modulated attempt rate; protocol ordering can create geometric/holonomy effects without certifying directionality unless paired with an audit.

**Note:** P₂ does not schedule budgets globally; \(a_i\) is a local reversible degree of freedom.

---

## B4) P₄ — Quantized/topological counters

### State
- \(n_k\in\{-L_n,\dots,L_n\}\) for carriers \(k\in\mathcal K\).

### Energy term affected
- \(\frac{\lambda_n}{2}n_k^2\).

### Proposal
Pick \(k\) and propose:
\[
n_k' = n_k \pm 1.
\]

### Acceptance
- Null: \(A_{\text{null}}\).
- P₆ ON: add work:
  \[
  W_{P4}=
  \begin{cases}
  +\eta_n\,\mu(x_k) & n_k'=n_k+1\\
  -\eta_n\,\mu(x_k) & n_k'=n_k-1
  \end{cases}
  \]
  and accept with \(A_{P6}\).
- P₃ ON: optional phase-modulated attempt rate.

---

## B5) P₅ — Protective field on grid (build/erode)

### State
- \(S_q\in\{0,\dots,L_S\}\) for cells \(q\in\{1,\dots,G^2\}\).

### Energy term affected
- \(\frac{\lambda_S}{2}S_q^2\).

### Proposal
Pick \(q\) and propose:
\[
S_q' = S_q\pm 1.
\]

### Acceptance
- Null: \(A_{\text{null}}\).
- P₆ ON: add work:
  \[
  W_{P5}=
  \begin{cases}
  +\eta_S\,\mu(x_q) & S_q'=S_q+1\\
  -\eta_S\,\mu(x_q) & S_q'=S_q-1
  \end{cases}
  \]
  accept with \(A_{P6}\).
- P₃ ON: phase-modulated attempt rate or indirect effects via motion patterns.

**Note:** “Safe sets” are observables \(K_t=\{q:S_q\ge\tau_S\}\), not monotone by fiat.

---

## B6) P₆ — Resource transduction (two implementation options)

### Option 1: affinity-only P₆ (minimal)
- No extra state variable.
- Turning P₆ on provides a scalar field \(\mu(x)\) and enables nonzero work terms \(W(\cdot)\) in other primitives’ acceptance ratios.
- Turning P₆ off sets \(W\equiv 0\).

### Option 2: explicit stored resource \(r_i\) (still manageable)
Add:
- \(r_i\in\{0,\dots,L_r\}\) per particle.

One can implement local exchange moves \(r_i\to r_i\pm 1\) with Metropolis accept under an energy including \(-\mu(x_i)r_i\), or couple resource consumption directly to “up” writes (joint moves).

This option enables explicit “banking” displays, but is not required for the base playground.

---

## B7) Summary: which primitives can break reversibility?

- In null regime, all enabled transitions satisfy detailed balance.
- P₆ breaks reversibility by adding nonconservative work terms with nonzero cycle circulation.
- P₃ introduces protocol holonomy; it can yield **apparent** irreversibility only when the protocol is external or the phase is hidden. With phase included (A_AUT), P₃ alone does not certify a sustained arrow-of-time audit.

---
