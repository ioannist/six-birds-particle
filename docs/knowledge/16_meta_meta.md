Below is a “pure” operator/topology‑lifting design in the precise sense you’ve been insisting on:

* **No semantic feature detection** (no “defect extraction,” no engineered interpretation).
* **No extra directionality** (null remains genuinely null).
* **No extra “cost function on top”** meant to bias outcomes (no distance penalties, no regularizers added just to “make it behave”).
* **Economy/weakness implemented the same way you already did it**: by bounded carriers + saturation + budget competition, not by an external optimizer.

The only unavoidable “bias” is the same one your original experiment already had: a **finite, symmetric representational envelope** (finite grid/layers, finite bits/tokens, finite candidate relations). Everything else is moved into substrates acted on by P1–P6.

---

# 0) Design priorities as explicit axioms

Let the full state be (Z=(X,\Theta)), where:

* (X): all existing base + meta layer state (particles, fields, edge weights, counters, etc.).
* (\Theta): *operator/topology* degrees of freedom we’re lifting.

We impose these axioms:

### A0. No interpretation bias

No new state variable is allowed to be a **deterministic function** of other state used for dynamics (no “computed boundary map,” no clustering detector, no pattern recognizer).
All (\Theta) are **free carriers** updated by primitive moves.

### A1. No extra directionality

When (p3On=0) and (p6On=0), the full chain on (Z) must satisfy detailed balance (reversibility), and ( \text{epExact} \to 0 ) windowed.

### A2. Economy/weakness only by bounded carriers + budget exchange

We do **not** add “priors” like (\lambda \sum |r|^2 K_r) or “distance penalties” for long edges.
Instead, we implement scarcity by:

* bounded integer carriers,
* saturation,
* and **conserved budgets** (microcanonical economy), updated by symmetric exchange moves.

This is not “adding a cost”; it’s the same irreducible fact as “finite grid and finite bits.”

### A3. Symmetry maximal

The envelope and proposals must be invariant under a chosen symmetry group (G) (translations, rotations/reflections of the lattice, and any layer permutations you deem legitimate). Formally, in null:
[
P(gz\to gz') = P(z\to z') \quad \forall g\in G.
]

### A4. P1–P6 act on everything uniformly

Operator/topology carriers are just more substrate. They are updated by the same event scheduler and the same primitive toggles.

---

# 1) Minimal unavoidable envelope

You cannot avoid *some* envelope in a finite machine (same as your original experiment):

* finite lattice (\Lambda) (e.g., (g\times g)),
* finite number of layers (L),
* finite candidate relation sets (local stencils, candidate edges),
* bounded integer ranges.

**“Pure” here means:** the envelope is chosen *symmetry-first* and *capacity-first*, not outcome-first.

Two envelope options that stay no-bias:

### Envelope E1: purely local primitives

All “couplings” live on nearest-neighbor lattice edges.
Effective long-range influence emerges only via **paths** (many local edges), not direct long edges.

This is the cleanest “physics-like” choice: locality is fundamental, long-range is constructed.

### Envelope E2: local + sparse nonlocal candidates

Allow a bounded set (\mathcal R) of offsets up to some (R_{\max}), but **balanced** so there is no combinatorial bias:

* choose (\mathcal R) as a fixed set closed under (r\mapsto -r) and rotations,
* and (if possible) equal counts per radius bin.

This gives the system explicit choice of locality scale without “distance penalties.”

---

# 2) What gets lifted: operator and topology substrates

## 2.1 Cross-layer operator kernels (K) as a budgeted simplex field

For each interface (\ell-1 \to \ell) and each cell (q\in\Lambda), introduce a kernel:
[
K^{(\ell)}(q,\cdot) \in \mathbb{N}^{|\mathcal R|}, \quad 0\le K^{(\ell)}(q,r)\le B_K
]
with a **strict budget constraint**
[
\sum_{r\in\mathcal R} K^{(\ell)}(q,r) = B_K.
]

Define normalized coefficients:
[
k^{(\ell)}(q,r) := \frac{K^{(\ell)}(q,r)}{B_K}.
]
So each cell’s operator is a convex combination over offsets.

### Operator action (feature-agnostic)

For any lower-layer field (U^{(\ell-1)}) (could be (S), (A), etc.), define:
[
(\mathcal K^{(\ell)} U^{(\ell-1)})(q) = \sum_{r\in\mathcal R} k^{(\ell)}(q,r), U^{(\ell-1)}(q+r).
]

This is just “a local linear operator.” No semantics (no edges/boundaries) are privileged.

---

## 2.2 Within-layer topology (\omega) as budgeted edge mass

Pick a candidate edge set (\mathcal E) inside the envelope (nearest neighbor edges for E1; or a sparse candidate set for E2).

For each layer (\ell) and edge (e\in\mathcal E), define integer edge mass:
[
\omega^{(\ell)}*e \in {0,1,\dots,B*\omega}
]
with a conserved global (or per-node) budget:
[
\sum_{e\in\mathcal E} \omega^{(\ell)}*e = B*\Omega \quad \text{(global)}
]
or
[
\sum_{e\ni v} \omega^{(\ell)}*e = B*{\deg} \quad \forall v \quad \text{(per-node)}.
]

**Interpretation:** (\omega) is “how much coupling capacity is allocated to each relation.”

Again: no distance penalty. Scarcity comes from finite budget.

---

## 2.3 Optional: coupling-strength allocation (\alpha) as budget, not a real-valued knob

If you want “how strongly layers couple” to be selected too, do it the same way:

Let (\alpha^{(\ell)}(q)\in{0,\dots,B_\alpha}) with (\sum_q \alpha^{(\ell)}(q)=B_{\alpha,\ell}).
Then any inter-layer coupling term uses (\alpha^{(\ell)}(q)) as a multiplier. No new penalty on (\alpha) itself.

---

# 3) How (\Theta) influences the existing primitive mechanics

This is where we must be very careful to avoid sneaking in a “goal.”

The right rule is:

> (\Theta) may only enter **transition kernels** through the same kinds of reversible energy terms and/or P6 work terms you already use (η conservative coupling, etaDrive drive-only maintenance).
> No additional evaluation functional is introduced “because we want it.”

So we define coupling only in the following generic form:

## 3.1 Conservative cross-layer coupling (optional)

A generic quadratic mismatch energy:
[
E_{\text{couple}}(X,\Theta)
= \frac{\eta}{2}\sum_{\ell=1}^{L}\sum_{q\in\Lambda}
\left(
\mathrm{norm}(U^{(\ell)}(q)) -
\mathrm{norm}((\mathcal K^{(\ell)}U^{(\ell-1)})(q))
\right)^2.
]

* If you want **zero selection in null**, set (\eta=0).
* If you accept equilibrium “selection” (still reversible), you can keep (\eta>0).

This is not a “locality penalty.” It’s a physical interaction term between layers.

## 3.2 Drive-only coupling (ratchet-maintained scaffold)

Exactly like your `etaDrive` idea, but now with (K) and/or (\omega) shaping what “alignment” means.

For an accepted move (z\to z'), define a work contribution:
[
W_{\text{align}}(z\to z') = -\eta_{\text{drive}};\Delta E_{\text{mismatch}}(z\to z'),
]
where (E_{\text{mismatch}}) is the same mismatch functional used above (or a chosen channel’s mismatch).

Key property:
[
W_{\text{align}}(z'\to z) = -W_{\text{align}}(z\to z')
]
so it’s a legitimate P6-style antisymmetric work term.

With (p6On=0), (W_{\text{align}}=0) and nothing is “actively maintained.”

This is your proven “dynamic code maintenance costs EP” mechanism—now parameterized by operator/topology substrates rather than hard-coded pointwise alignment.

---

# 4) How P1–P6 update (\Theta) without a new mechanism

Everything in (\Theta) must be updated by **the same kind of local, reversible, bounded moves** you already use.

## 4.1 Budget exchange move as the universal “pure economy” update

### Kernel exchange

Pick ((\ell,q)) and two offsets (r_1\neq r_2). If (K^{(\ell)}(q,r_1)>0), propose:
[
K^{(\ell)}(q,r_1)\mapsto K^{(\ell)}(q,r_1)-1,\quad
K^{(\ell)}(q,r_2)\mapsto K^{(\ell)}(q,r_2)+1.
]
All other components unchanged.

This preserves (\sum_r K=B_K) exactly.

### Topology exchange

Pick ((\ell)) and two edges (e_1\neq e_2). If (\omega^{(\ell)}*{e_1}>0), propose:
[
\omega^{(\ell)}*{e_1}\mapsto \omega^{(\ell)}*{e_1}-1,\quad
\omega^{(\ell)}*{e_2}\mapsto \omega^{(\ell)}_{e_2}+1.
]

### Which primitive is this?

Implementation-wise you can map these exchanges onto your existing primitive families:

* Treat (K) and (\omega) as “edge-like” carriers → updated when **P1** is enabled.
* Or treat them as “field-like” carriers → updated when **P5** is enabled.

The key is not the label, but that:

* proposals are symmetric,
* budgets are conserved,
* acceptance uses the same Metropolis / NE-Metropolis structure.

## 4.2 Protocol and regime switching

* **P3** can order “update (K) then update (U)” vs “update (U) then update (K)” noncommutatively, producing holonomy / pumped operator-space currents; this is not a directionality audit without P6 drive or an explicit external schedule.
* **P4** can toggle discrete mode fields if you choose to have a small operator basis index; but the most no-bias version is to avoid discrete hand-picked bases and keep the full simplex (K).

## 4.3 Closure/viability (P5) without monotonic writes

Any “operator stability” must arise from reversible dynamics + (optional) drive bias, never from “once selected, don’t go back.”

Budget exchange moves are reversible; stability emerges only if the combined dynamics makes some regions of (\Theta)-space long-lived.

---

# 5) Null-regime guarantee on the extended system

Let (Z=(X,\Theta)) evolve with proposals (q(z\to z')) and acceptance (a(z\to z')).

### Null regime

Set (p3On=0), (p6On=0). Use Metropolis acceptance:
[
a(z\to z')=\min{1,\exp(-\beta\Delta E)}.
]

If:

1. every proposal move has a well-defined reverse,
2. proposal probabilities are symmetric: (q(z\to z')=q(z'\to z)),
3. (\Delta E) is computed from a single scalar energy (E(X,\Theta)),

then detailed balance holds with:
[
\pi(z)\propto e^{-\beta E(z)}
]
restricted to the budget-constrained manifold (kernel simplex, edge budgets, etc.).

So:

* **no currents in (\Theta)**,
* **no currents in (X)** beyond equilibrium fluctuations,
* **epExact window rate → 0**.

This is your “no extra directionality” promise, now extended to operator/topology selection.

---

# 6) Why budgets are the “pure” alternative to extra penalties

This is the critical point relative to your objection.

If you add (M) new binary couplings with no constraint, then in null the typical number of active couplings is (M/2) purely by combinatorics (not ratchets). That’s a trivial entropy artifact.

A conserved budget (B) avoids that without a penalty function:

* In any state with (\sum_e \omega_e=B), the number of nonzero edges is at most (B).
  So density cannot blow up just because there are many possibilities.

So budgets are not “engineering outcomes”; they are the minimal way to keep “latent space is huge” from collapsing into “everything is on.”

And importantly:

* budgets don’t privilege *which* couplings win,
* they only ensure scarcity exists—exactly what “economy” means.

---

# 7) What “selection of latent transformations” means in this design

Because null has no currents, “selection” can only mean:

* Under drive (P6 or an explicit external protocol), (\Theta) can develop **nonzero stationary currents** or biased drifts in some summary statistic (effective operator shape, effective coupling topology). In an autonomous lifted model, P3 holonomy alone does not certify a sustained arrow-of-time audit.
* Those currents are measurable and dissipation-priced (via epExact buckets on (\Theta)-moves).

Operationally, define any summary statistic (F(\Theta)) (e.g., entropy of kernels, sparsity of (\omega), spectral gap of the induced coupling graph). Then “latent transformation selection” corresponds to:
[
\lim_{t\to\infty}\frac{\mathbb E[F(\Theta_t)-F(\Theta_0)]}{t}\neq 0
]
or persistent cycling in (\Theta)-space.

And because (\Theta)-moves are part of the same Markov chain, any such directed drift must show up in epExact (your dissipation ledger).

---

# 8) Checklist for “no-bias compliance”

If you implement this, you can certify you didn’t sneak in semantics by running these invariance/ablation tests:

1. **Null EP test**: with P3=0,P6=0, epExactRateWindowLast ≈ 0 even with operator/topology carriers enabled.
2. **Symmetry test**: rotate/translate the initial condition and RNG seed mapping → distribution of outcomes unchanged (up to symmetry).
3. **Offset-label permutation test**: randomly permute the labels of offsets (r\in\mathcal R) everywhere (consistently) → null statistics unchanged.
4. **Budget ablation**: reduce budgets (B_K,B_\Omega) → phenomena degrade gracefully rather than explode combinatorially.
5. **Drive ablation**: turn P6 off → any directed drift in (\Theta) disappears.

---

# 9) Minimal formal spec you can drop into the repo docs

If you want this in one paragraph:

> We extend the simulator state from (X) to (Z=(X,\Theta)) where (\Theta) contains (i) cross-layer local linear operators (K^{(\ell)}(q,\cdot)) represented as integer token distributions with (\sum_r K=B_K), and (ii) within-layer topology masses (\omega^{(\ell)}*e) on a symmetric candidate edge set with (\sum_e\omega=B*\Omega). (\Theta) is updated only by symmetric, budget-conserving exchange moves (token transfers), scheduled under the same primitive toggles as (X). (\Theta) enters dynamics only through the same reversible energy terms and/or P6 antisymmetric work terms already used for coupling/maintenance (no additional priors or penalties). Therefore, in null (P3=0,P6=0) the joint chain satisfies detailed balance on the budget manifold and epExact→0, while under drive (P6 or explicit external protocol) any persistent drift/cycling in (\Theta) constitutes dissipation-priced selection of latent transformations.

---

If you want to go one notch “purer” still, pick **Envelope E1** (nearest-neighbor only) and let “effective nonlocality” emerge only via *paths* and via *stack depth*. Then you literally never introduce explicit long-range couplings at all—locality is fundamental, and what’s selected is conductivity/topology of local edges and operator composition across layers. That’s the closest analogue to “nature doesn’t have arbitrary long-range couplings; it builds them.”
