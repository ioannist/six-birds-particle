# Deliverable A — Null‑Regime Stationary Measure

This document specifies an explicit **stationary measure** \(\pi\) for the null regime (P₃=OFF, P₆=OFF) and a constructive method to ensure **detailed balance**.

The goal is to ensure:
- no baked-in arrow-of-time,
- no implicit “evolve” bias,
- any directionality must come from enabled non-equilibrium primitives.

---

## A1) State space

Let \(Z=(X,W)\).

### Fast substrate \(X\)
- \(N\) particles on a 2D torus \(\mathbb T^2=[0,1)^2\)
- positions \(x_i\in\mathbb T^2\), \(i=1,\dots,N\)

### Slow variables \(W\) (bounded / discrete)

- P₁ bonds: \(w_{ij}\in\{0,1,\dots,L_w\}\) for all \(i<j\)
- P₂ apparatus: \(a_i\in\{0,1,\dots,L_a\}\)
- P₄ counters: \(n_k\in\{-L_n,\dots,L_n\}\) for carriers \(k\in\mathcal K\)
- P₅ field: \(S_q\in\{0,1,\dots,L_S\}\) for grid cells \(q\in\{1,\dots,G^2\}\)

---

## A2) Null‑regime energy function \(E(Z)\)

We define a Gibbs stationary distribution:
\[
\pi(Z)\propto \exp(-\beta E(Z)).
\]

A simple, local, compute-friendly energy is:

### (i) Repulsive substrate energy (prevents collapse)
Let \(r_{ij}=\|x_i-x_j\|_{\mathbb T^2}\). Define:
\[
U_{\mathrm{rep}}(X)=\sum_{i<j}\frac{\kappa_{\mathrm{rep}}}{2}\,\Big(\max\{0,r_0-r_{ij}\}\Big)^2.
\]

### (ii) Bond–geometry coupling (so bonds “mean” something spatially)
Let \(r_\star\) be a preferred bond length. Define:
\[
U_{\mathrm{bond}}(X,W_1)=\sum_{i<j}\frac{\kappa_{\mathrm{bond}}}{2}\,w_{ij}\,(r_{ij}-r_\star)^2.
\]

### (iii) Quadratic penalties on slow variables (boundedness + trivial equilibrium)
\[
E_{P1}(W_1)=\sum_{i<j}\frac{\lambda_w}{2}\,w_{ij}^2,
\qquad
E_{P2}(W_2)=\sum_{i}\frac{\lambda_a}{2}\,a_i^2,
\]
\[
E_{P4}(W_4)=\sum_{k\in\mathcal K}\frac{\lambda_n}{2}\,n_k^2,
\qquad
E_{P5}(W_5)=\sum_{q}\frac{\lambda_S}{2}\,S_q^2.
\]

### Total null energy
\[
\boxed{
E(Z)=U_{\mathrm{rep}}(X)+U_{\mathrm{bond}}(X,W_1)+E_{P1}(W_1)+E_{P2}(W_2)+E_{P4}(W_4)+E_{P5}(W_5).
}
\tag{A-E}
\]

---

## A3) Detailed-balance construction (Metropolis updates)

To guarantee the stationary measure exactly (up to discretization), implement all null-regime updates via **symmetric proposal + Metropolis acceptance**.

### Generic acceptance rule
Given a proposed move \(Z\to Z'\) with symmetric proposal \(Q(Z\to Z')=Q(Z'\to Z)\), accept with:
\[
\boxed{
A(Z\to Z')=\min\{1, \exp(-\beta(E(Z')-E(Z)))\}.
}
\tag{A-M}
\]

This ensures detailed balance:
\[
\pi(Z)P(Z\to Z')=\pi(Z')P(Z'\to Z).
\]

---

## A4) What “null regime” means operationally

- P₃ OFF: no time-dependent protocol ordering or driven flow field.
- P₆ OFF: no work/affinity terms, no chemical potential gradients.
- Any subset of {P₁,P₂,P₄,P₅} may be ON, but their transitions must still use (A-M).

This guarantees:
- **all cycle affinities are zero** (Kolmogorov criterion),
- there are no stationary probability currents,
- any later observed arrow-of-time audit must come from P₆ drive or an explicit external protocol schedule; P₃ loop observables alone do not certify directionality in an autonomous lifted model.

---
