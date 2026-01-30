# A‑Life Principles for the Ratchet Playground

This document formalizes the “no baked-in directionality” design constraint.

## 1) The core requirement

The sandbox must not contain hidden “helpers” that push the system toward complexity.

Therefore:

> **Null regime requirement:**  
> With **P₃=OFF** and **P₆=OFF**, the dynamics must be **reversible** (detailed balance) with respect to an explicit stationary measure \(\pi\).  
> Any persistent arrow-of-time audit must arise only when the user enables a nonconservative drive (P₆) or imposes an external protocol schedule; P₃ alone is a holonomy diagnostic in an autonomous lifted model.

This is stronger than “it looks random.” It is a mathematical guarantee.

## 2) Reversibility, detailed balance, and cycle affinity

For a Markov chain with transition probabilities \(P(z\to z')\), reversibility w.r.t. \(\pi\) means:
\[
\pi(z)\,P(z\to z')=\pi(z')\,P(z'\to z).
\]

Equivalent: all cycle affinities vanish. For any directed cycle \(\gamma\),
\[
\mathcal A(\gamma)=\sum_{e\in\gamma}\log\frac{P(e)}{P(e^{\rm rev})}=0.
\]

If any cycle affinity is nonzero, time-reversal symmetry is broken and persistent probability currents can exist.

## 3) How to enforce the null regime

The cleanest construction is a Gibbs stationary measure
\[
\pi(z)\propto \exp(-\beta E(z))
\]
and Metropolis-Hastings updates with symmetric proposals:
\[
A(z\to z') = \min\{1,\exp(-\beta(E(z')-E(z)))\}.
\]
This yields detailed balance by construction.

## 4) What it means to “toggle primitives” in this framework

- A primitive **adds transitions** (edges) to the state transition graph, or **changes the operator** by protocol ordering.
- In the null regime, the added transitions must remain reversible w.r.t. the same \(\pi\).

Only P₆ directly introduces nonconservative affinities. P₃ introduces protocol holonomy:

- **P₃ (protocol-cycle):** time-dependent ordering / noncommuting kernels; can yield **stroboscopic** asymmetry if the protocol is external or the phase is hidden. In an autonomous lifted model with phase included and reversible phase dynamics, P₃ alone does not certify a sustained arrow-of-time audit.
- **P₆ (resource transduction):** nonconservative “work/affinity” terms that certify directionality via audit.

This is not an arbitrary choice; it preserves the experiment’s interpretability:
- if you observe an arrow-of-time audit, you can attribute it to P₆ drive (or to an explicitly external schedule), not to P₃ loop observables alone.

## 5) What “pattern ratchet” means without monotone writes

Because the sandbox avoids hard-coded irreversibility, “one-way” patterns must be understood as **metastable lock-in**:

- patterns persist for long times,
- reversal times can grow quickly with barriers or drive,
- but reversals are not forbidden by fiat.

Diagnostics therefore focus on:
- reversal rates,
- persistence times,
- and cycle affinities / entropy production.

---
