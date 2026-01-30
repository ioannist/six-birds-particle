# Deliverable C — Cycle‑Affinity “Wiring Diagram”

This document specifies how to determine, from the enabled primitives, whether **nonzero cycle affinity** (hence irreversibility / arrow-of-time) is possible, and which minimal loop motifs to monitor.

---

## C1) Cycle affinity and reversibility

For transitions with probabilities/rates \(P(z\to z')\), define edge affinity:
\[
a(z\to z') := \log\frac{P(z\to z')}{P(z'\to z)}.
\]

For a directed cycle \(\gamma: z_0\to z_1\to\cdots\to z_m=z_0\), define cycle affinity:
\[
\mathcal A(\gamma) := \sum_{\ell=0}^{m-1} a(z_\ell\to z_{\ell+1})
= \log\frac{\prod_{\ell}P(z_\ell\to z_{\ell+1})}{\prod_{\ell}P(z_{\ell+1}\to z_\ell)}.
\]

**Kolmogorov cycle criterion:**  
A Markov chain is reversible iff \(\mathcal A(\gamma)=0\) for every cycle \(\gamma\).

---

## C2) Null regime: all affinities vanish

With Metropolis-Hastings against \(\pi\propto e^{-\beta E}\),
\[
\frac{P(z\to z')}{P(z'\to z)}=e^{-\beta(E(z')-E(z))}.
\]
So for a cycle, energy telescopes:
\[
\sum_{\gamma} (E(z')-E(z))=0 \quad\Rightarrow\quad \mathcal A(\gamma)=0.
\]

Therefore, with P₃=OFF and P₆=OFF, irreversibility is impossible by construction.

---

## C3) How primitives create nonzero affinity

### C3.1 P₆: antisymmetric work on edges
When P₆ adds a work term \(W(z\to z')=-W(z'\to z)\),
\[
a(z\to z') = -\beta\Delta E + \beta W(z\to z').
\]
Then cycle affinity is:
\[
\mathcal A(\gamma)=\beta\sum_{e\in\gamma}W(e).
\]
So P₆ produces force only if the induced “work 1-form” has nonzero circulation on some loop.

### C3.2 P₃: noncommuting reversible kernels (geometric pumping)
Let \(K_A,K_B,\dots\) be reversible kernels. The protocol product
\[
K_{\rm cyc}=K_C K_B K_A
\]
is generically nonreversible as a **stroboscopic observed kernel** when the kernels do not commute. This can create apparent cycle asymmetry if the protocol is external or the phase is hidden. In an autonomous lifted model with phase included and reversible phase dynamics, P₃ alone does not certify a sustained arrow-of-time audit.

---

## C4) Minimal motifs

### Motif M0 (baseline)
Enabled subset of {P₁,P₂,P₄,P₅}, with P₃=OFF and P₆=OFF:
\[
\mathcal A(\gamma)=0\quad\forall\gamma.
\]

---

### Motif M6 (P₆ + any writable coordinate + two contexts)

Assume P₆ provides a context \(\mu\) with at least two bins: High (H) and Low (L).

Pick any reversible memory coordinate \(y\in\{w,a,n,S\}\) with \(\pm 1\) steps and P₆ work:
\[
W((\text{ctx},y)\to(\text{ctx},y+1)) = +\eta\,\mu(\text{ctx}),
\qquad
W((\text{ctx},y+1)\to(\text{ctx},y)) = -\eta\,\mu(\text{ctx}).
\]

Consider the 4-cycle:
\[
(H,y)\xrightarrow{y+}(H,y+1)\xrightarrow{\text{move}}(L,y+1)\xrightarrow{y-}(L,y)\xrightarrow{\text{move}}(H,y).
\]
Then
\[
\boxed{\mathcal A_{M6} = \beta\eta(\mu_H-\mu_L).}
\]

**Wiring rule:**  
P₆ alone is not enough; you need:
- a memory transition edge (P₁/P₂/P₄/P₅),
- movement between contexts with differing \(\mu\),
- and a loop that includes both.

---

### Motif M3 (pure protocol pump from P₃)

Even if each substep kernel is reversible, a cyclic protocol can yield nonreversible stroboscopic dynamics if kernels do not commute **and the phase is external/hidden**.

Minimal conceptual example:
- three coarse states \(\{A,B,C\}\),
- three reversible “mix A↔B”, “mix B↔C”, “mix C↔A” kernels,
- protocol applies them in order.

The product kernel is generically nonreversible at the observed level ⇒ some 3-cycle has \(\mathcal A\neq 0\) in the stroboscopic model (protocol-trap warning).

**Wiring rule:**  
P₃ can generate **apparent** irreversibility without P₆ in an externally scheduled or hidden-phase view, but you need:
- at least a 3-state coarse structure (or a 2D state graph),
- noncommuting sub-operations.

---

### Motif M3+W (protocol pump rectified into memory)

Let \(K_X\) update \(X\) and \(K_y\) update a memory coordinate \(y\) (P₁/P₂/P₄/P₅), each individually reversible w.r.t. \(\pi\), but coupled through \(E(X,y)\).

Under protocol ordering:
\[
K_{\rm cyc}=K_y K_X,
\]
noncommutativity yields nonreversibility in the observed stroboscopic model; in an autonomous lifted model with phase included, any sustained directionality still requires a P₆ audit.

This is the minimal way for P₃ to create persistent patterning in a writable variable without any monotone write rule.

---

## C5) Practical “wiring diagram” summary

- If **P₃=OFF and P₆=OFF**: no irreversibility possible (all \(\mathcal A=0\)).
- If **P₆=ON**: irreversibility possible iff there exist loops that traverse contexts where \(\mu\) differs (M6).
- If **P₃=ON**: holonomy/route-mismatch possible; **apparent** irreversibility can appear if the protocol is external or the phase is hidden (M3). In autonomous lifted models, sustained arrow-of-time audits require P₆ drive.
- The most robust patterning arises when:
  - P₃ and/or P₆ supply a non-equilibrium source,
  - and P₁/P₂/P₄/P₅ provide state variables that can carry the resulting flux as visible patterns.

---
