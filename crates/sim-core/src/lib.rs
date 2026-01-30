use js_sys::{
    Array, Float32Array, Float64Array, Int16Array, Int8Array, Object, Reflect, Uint16Array,
    Uint32Array, Uint8Array,
};
use wasm_bindgen::prelude::*;

const DEFAULT_GRID_SIZE: usize = 16;
const MAX_META_LAYERS: u16 = 16;
const MOVE_KIND_COUNT: usize = 11;
const MOVE_KIND_LABELS: [&str; MOVE_KIND_COUNT] = [
    "X",
    "P1Base",
    "P1Meta",
    "P2Base",
    "P2Meta",
    "P4Base",
    "P4Meta",
    "P5Base",
    "P5Meta",
    "OpK",
    "Clock",
];

const MOVE_X: usize = 0;
const MOVE_P1_BASE: usize = 1;
const MOVE_P1_META: usize = 2;
const MOVE_P2_BASE: usize = 3;
const MOVE_P2_META: usize = 4;
const MOVE_P4_BASE: usize = 5;
const MOVE_P4_META: usize = 6;
const MOVE_P5_BASE: usize = 7;
const MOVE_P5_META: usize = 8;
const MOVE_OPK: usize = 9;
const MOVE_CLOCK: usize = 10;

const OP_STENCIL_CROSS: [(i32, i32); 5] = [(0, 0), (1, 0), (-1, 0), (0, 1), (0, -1)];
const OP_STENCIL_FULL: [(i32, i32); 9] = [
    (0, 0),
    (1, 0),
    (-1, 0),
    (0, 1),
    (0, -1),
    (1, 1),
    (-1, 1),
    (1, -1),
    (-1, -1),
];

#[wasm_bindgen]
pub struct Sim {
    n: usize,
    positions: Vec<f32>, // [x0,y0,x1,y1,...] in [0,1)
    w: Vec<u8>, // upper-triangular edge weights (P1), length n*(n-1)/2
    n_counter: Vec<i16>,
    a_counter: Vec<u16>,
    s_field: Vec<u8>,
    meta_field: Vec<u8>,
    meta_n_field: Vec<i16>,
    meta_a_field: Vec<u16>,
    meta_w_edges: Vec<u8>,
    op_k: Vec<u8>,
    rng: u32,
    params: Params,
    diag: DiagTotals,
    phase: u8,
    p3_cycle_len: u8,
    p3_start_positions: Vec<f32>,
    p3_obs1: Vec<f32>,
    p3_obs2: Vec<f32>,
    p3_disp_x: f32,
    p3_disp_y: f32,
    p3_disp_mag: f32,
    p3_loop_area: f32,
    sum_w: i32,
    sum_s: i32,
    ep_naive_total: f64,
    ep_exact_total: f64,
    ep_q_stats: [EpQStats; MOVE_KIND_COUNT],
    ep_naive_by_move: [f64; MOVE_KIND_COUNT],
    ep_exact_by_move: [f64; MOVE_KIND_COUNT],
    accept_log_u32: Vec<u32>,
    accept_log_ep: Vec<f64>,
    accept_log_overflowed: bool,
    step_count: u32,
    clock_state: u8,
    clock_q: i64,
    clock_fwd: u64,
    clock_bwd: u64,
}

#[derive(Clone, Copy)]
struct Params {
    beta: f32,
    step_size: f32,
    p_write: f32, // probability of proposing a P1 write step (vs X move)
    p_n_write: f32, // probability of proposing a P4 counter write step
    p_a_write: f32, // probability of proposing a P2 apparatus write step
    p_s_write: f32, // probability of proposing a P5 field write step
    p3_on: bool,    // protocol-cycle scheduling (P3)
    p6_on: bool,    // resource transduction (P6)
    p6_s_factor: f32,
    mu_high: f32,
    mu_low: f32,
    // Deliverable A energy params (minimal subset for X + P1)
    kappa_rep: f32,
    r0: f32,
    kappa_bond: f32,
    r_star: f32,
    lambda_w: f32,
    l_w: u8,
    lambda_n: f32,
    l_n: i16,
    lambda_a: f32,
    l_a: u16,
    lambda_s: f32,
    l_s: u8,
    grid_size: u16,
    r_propose: f32, // neighbor radius for P1 proposals
    meta_layers: u16,
    eta: f32,
    eta_drive: f32,
    op_coupling_on: bool,
    op_stencil: u8,
    op_budget_k: u8,
    op_k_target_weight: f32,
    s_coupling_mode: u8,
    op_drive_on_k: bool,
    accept_log_on: bool,
    accept_log_mask: u32,
    accept_log_cap: u32,
    ep_debug: bool,
    init_random: bool,
    code_noise_rate: f32,
    code_noise_batch: u16,
    code_noise_layer: u16,
    clock_on: bool,
    clock_k: u8,
    clock_frac: f32,
    clock_uses_p6: bool,
    repair_clock_gated: bool,
    repair_gate_mode: u8,
    repair_gate_span: u8,
}

#[wasm_bindgen]
impl Sim {
    fn accept_log_push(
        &mut self,
        t: u32,
        q: u32,
        move_id: u8,
        aux_a: u8,
        aux_b: u8,
        aux_c: u8,
        ep_delta: f64,
    ) {
        if !self.params.accept_log_on {
            return;
        }
        if self.accept_log_overflowed {
            return;
        }
        let mask = 1u32 << (move_id as u32);
        if (self.params.accept_log_mask & mask) == 0 {
            return;
        }
        if (self.accept_log_ep.len() as u32) >= self.params.accept_log_cap {
            self.accept_log_overflowed = true;
            return;
        }
        self.accept_log_u32.push(t);
        self.accept_log_u32.push(q);
        let meta = (move_id as u32)
            | ((aux_a as u32) << 8)
            | ((aux_b as u32) << 16)
            | ((aux_c as u32) << 24);
        self.accept_log_u32.push(meta);
        self.accept_log_ep.push(ep_delta);
    }

    #[wasm_bindgen(constructor)]
    pub fn new(n: usize, seed: u32) -> Sim {
        let m = n.saturating_mul(n.saturating_sub(1)) / 2;
        let mut sim = Sim {
            n,
            positions: vec![0.0; 2 * n],
            w: vec![0u8; m],
            n_counter: vec![0i16; n],
            a_counter: vec![0u16; n],
            s_field: vec![0u8; DEFAULT_GRID_SIZE * DEFAULT_GRID_SIZE],
            meta_field: Vec::new(),
            meta_n_field: Vec::new(),
            meta_a_field: Vec::new(),
            meta_w_edges: Vec::new(),
            op_k: Vec::new(),
            rng: if seed == 0 { 1 } else { seed },
            params: Params {
                beta: 1.0,
                step_size: 0.01,
                p_write: 0.2,
                p_n_write: 0.05,
                p_a_write: 0.05,
                p_s_write: 0.05,
                p3_on: false,
                p6_on: false,
                p6_s_factor: 1.0,
                mu_high: 1.0,
                mu_low: -1.0,
                kappa_rep: 50.0,
                r0: 0.03,
                kappa_bond: 3.0,
                r_star: 0.18,
                lambda_w: 0.12,
                l_w: 5,
                lambda_n: 0.5,
                l_n: 6,
                lambda_a: 0.5,
                l_a: 6,
                lambda_s: 0.5,
                l_s: 6,
                grid_size: DEFAULT_GRID_SIZE as u16,
                r_propose: 0.22,
                meta_layers: 0,
                eta: 0.0,
                eta_drive: 0.0,
                op_coupling_on: false,
                op_stencil: 0,
                op_budget_k: 16,
                op_k_target_weight: 1.0,
                s_coupling_mode: 0,
                op_drive_on_k: true,
                accept_log_on: false,
                accept_log_mask: 0,
                accept_log_cap: 100000,
                ep_debug: false,
                init_random: false,
                code_noise_rate: 0.0,
                code_noise_batch: 1,
                code_noise_layer: 0,
                clock_on: false,
                clock_k: 8,
                clock_frac: 0.2,
                clock_uses_p6: true,
                repair_clock_gated: false,
                repair_gate_mode: 0,
                repair_gate_span: 1,
            },
            diag: DiagTotals::default(),
            phase: 0,
            p3_cycle_len: 0,
            p3_start_positions: Vec::new(),
            p3_obs1: Vec::new(),
            p3_obs2: Vec::new(),
            p3_disp_x: 0.0,
            p3_disp_y: 0.0,
            p3_disp_mag: 0.0,
            p3_loop_area: 0.0,
            sum_w: 0,
            sum_s: 0,
            ep_naive_total: 0.0,
            ep_exact_total: 0.0,
            ep_q_stats: [EpQStats::default(); MOVE_KIND_COUNT],
            ep_naive_by_move: [0.0; MOVE_KIND_COUNT],
            ep_exact_by_move: [0.0; MOVE_KIND_COUNT],
            accept_log_u32: Vec::new(),
            accept_log_ep: Vec::new(),
            accept_log_overflowed: false,
            step_count: 0,
            clock_state: 0,
            clock_q: 0,
            clock_fwd: 0,
            clock_bwd: 0,
        };
        for i in 0..n {
            let x = sim.rand01();
            let y = sim.rand01();
            sim.positions[2 * i] = x;
            sim.positions[2 * i + 1] = y;
        }
        sim
    }

    pub fn n(&self) -> usize {
        self.n
    }

    pub fn step(&mut self, steps: u32) {
        // Null-regime mixture of reversible kernels (Deliverables A/B):
        // - X: symmetric position proposals + Metropolis against E(Z)
        // - P1: symmetric +/-1 write proposals + Metropolis against E(Z)
        for _ in 0..steps {
            self.step_count = self.step_count.wrapping_add(1);
            let mut step_diag = StepDiag::default();
            if self.params.p3_on {
                self.protocol_step(&mut step_diag);
            } else {
                let r = self.rand01();
                if r < self.params.p_write {
                    let delta = if self.params.meta_layers == 0 {
                        self.p1_write_step()
                    } else {
                        let target = self.pick_write_target();
                        if target == 0 {
                            self.p1_write_step()
                        } else {
                            self.p1_write_step_meta((target - 1) as usize)
                        }
                    };
                    if delta > 0 {
                        step_diag.w_plus = 1;
                    } else if delta < 0 {
                        step_diag.w_minus = 1;
                    }
                } else if r < self.params.p_write + self.params.p_n_write {
                    let delta = if self.params.meta_layers == 0 {
                        self.p4_write_step()
                    } else {
                        let target = self.pick_write_target();
                        if target == 0 {
                            self.p4_write_step()
                        } else {
                            self.p4_write_step_meta((target - 1) as usize)
                        }
                    };
                    if delta > 0 {
                        step_diag.n_plus = 1;
                    } else if delta < 0 {
                        step_diag.n_minus = 1;
                    }
                } else if r < self.params.p_write + self.params.p_n_write + self.params.p_a_write {
                    let delta = if self.params.meta_layers == 0 {
                        self.p2_write_step()
                    } else {
                        let target = self.pick_write_target();
                        if target == 0 {
                            self.p2_write_step()
                        } else {
                            self.p2_write_step_meta((target - 1) as usize)
                        }
                    };
                    if delta > 0 {
                        step_diag.a_plus = 1;
                    } else if delta < 0 {
                        step_diag.a_minus = 1;
                    }
                } else if r
                    < self.params.p_write
                        + self.params.p_n_write
                        + self.params.p_a_write
                        + self.params.p_s_write
                {
                    let delta = if self.params.meta_layers == 0 {
                        self.p5_write_step()
                    } else if self.params.op_coupling_on {
                        let target = self.pick_p5_target_op();
                        let layers = self.params.meta_layers as usize;
                        if target == 0 {
                            self.p5_write_step()
                        } else if target <= layers {
                            self.p5_write_step_meta((target - 1) as usize)
                        } else {
                            self.p5_write_step_opk(target - (layers + 1))
                        }
                    } else {
                        let target = self.pick_write_target();
                        if target == 0 {
                            self.p5_write_step()
                        } else {
                            self.p5_write_step_meta((target - 1) as usize)
                        }
                    };
                    if delta > 0 {
                        step_diag.s_plus = 1;
                    } else if delta < 0 {
                        step_diag.s_minus = 1;
                    }
                } else {
                    self.x_move_step();
                }
            }
            self.diag.push(step_diag);
            self.maybe_code_noise();
        }
    }

    pub fn positions(&self) -> Float32Array {
        Float32Array::from(self.positions.as_slice())
    }

    pub fn counters(&self) -> Int16Array {
        Int16Array::from(self.n_counter.as_slice())
    }

    pub fn apparatus(&self) -> Uint16Array {
        Uint16Array::from(self.a_counter.as_slice())
    }

    #[wasm_bindgen]
    pub fn bonds(&self, threshold: u8) -> Uint32Array {
        let mut out: Vec<u32> = Vec::new();
        out.reserve(self.w.len()); // upper bound; pairs will be 2*edges
        for i in 0..self.n {
            for j in (i + 1)..self.n {
                let idx = edge_index(self.n, i, j);
                if self.w[idx] >= threshold {
                    out.push(i as u32);
                    out.push(j as u32);
                }
            }
        }
        Uint32Array::from(out.as_slice())
    }

    pub fn field(&self) -> Uint8Array {
        Uint8Array::from(self.s_field.as_slice())
    }

    pub fn base_s_field(&self) -> Uint8Array {
        Uint8Array::from(self.s_field.as_slice())
    }

    pub fn meta_layers(&self) -> u16 {
        self.params.meta_layers
    }

    pub fn meta_field(&self) -> Uint8Array {
        if self.params.meta_layers == 0 {
            Uint8Array::new_with_length(0)
        } else {
            Uint8Array::from(self.meta_field.as_slice())
        }
    }

    pub fn meta_n_field(&self) -> Int16Array {
        if self.params.meta_layers == 0 {
            Int16Array::new_with_length(0)
        } else {
            Int16Array::from(self.meta_n_field.as_slice())
        }
    }

    pub fn meta_a_field(&self) -> Uint16Array {
        if self.params.meta_layers == 0 {
            Uint16Array::new_with_length(0)
        } else {
            Uint16Array::from(self.meta_a_field.as_slice())
        }
    }

    pub fn meta_w_edges(&self) -> Uint8Array {
        if self.params.meta_layers == 0 {
            Uint8Array::new_with_length(0)
        } else {
            Uint8Array::from(self.meta_w_edges.as_slice())
        }
    }

    pub fn meta_edge_count(&self) -> u32 {
        meta_edge_count(self.params.grid_size as usize) as u32
    }

    pub fn op_r_count(&self) -> u32 {
        self.op_r_count_internal() as u32
    }

    pub fn op_offsets(&self) -> Int8Array {
        let offsets = self.op_offsets_internal();
        let mut out: Vec<i8> = Vec::with_capacity(offsets.len() * 2);
        for (dx, dy) in offsets {
            out.push(*dx as i8);
            out.push(*dy as i8);
        }
        Int8Array::from(out.as_slice())
    }

    pub fn op_k_tokens(&self) -> Uint8Array {
        if !self.params.op_coupling_on || self.params.meta_layers == 0 {
            Uint8Array::new_with_length(0)
        } else {
            Uint8Array::from(self.op_k.as_slice())
        }
    }

    pub fn op_budget_k(&self) -> u32 {
        self.params.op_budget_k as u32
    }

    pub fn op_interfaces(&self) -> u32 {
        self.params.meta_layers as u32
    }

    pub fn op_stencil_id(&self) -> u32 {
        self.params.op_stencil as u32
    }

    pub fn ep_total(&self) -> f64 {
        self.ep_naive_total
    }

    pub fn ep_naive_total(&self) -> f64 {
        self.ep_naive_total
    }

    pub fn ep_exact_total(&self) -> f64 {
        self.ep_exact_total
    }

    pub fn ep_naive_by_move(&self) -> Float64Array {
        Float64Array::from(self.ep_naive_by_move.as_slice())
    }

    pub fn ep_exact_by_move(&self) -> Float64Array {
        Float64Array::from(self.ep_exact_by_move.as_slice())
    }

    pub fn ep_move_labels(&self) -> Array {
        let labels = Array::new();
        for label in MOVE_KIND_LABELS {
            labels.push(&JsValue::from_str(label));
        }
        labels
    }

    pub fn accept_log_len(&self) -> u32 {
        self.accept_log_ep.len() as u32
    }

    pub fn accept_log_u32(&self) -> Uint32Array {
        Uint32Array::from(self.accept_log_u32.as_slice())
    }

    pub fn accept_log_ep(&self) -> Float64Array {
        Float64Array::from(self.accept_log_ep.as_slice())
    }

    pub fn accept_log_overflowed(&self) -> bool {
        self.accept_log_overflowed
    }

    pub fn accept_log_clear(&mut self) {
        self.accept_log_u32.clear();
        self.accept_log_ep.clear();
        self.accept_log_overflowed = false;
    }

    pub fn clock_state(&self) -> u32 {
        self.clock_state as u32
    }

    pub fn clock_q(&self) -> i64 {
        self.clock_q
    }

    pub fn clock_fwd(&self) -> u64 {
        self.clock_fwd
    }

    pub fn clock_bwd(&self) -> u64 {
        self.clock_bwd
    }

    pub fn ep_q_stats(&self) -> Object {
        let labels = Array::new();
        let mut means: Vec<f64> = Vec::with_capacity(MOVE_KIND_COUNT);
        let mut max_abs: Vec<f64> = Vec::with_capacity(MOVE_KIND_COUNT);
        let mut counts: Vec<u32> = Vec::with_capacity(MOVE_KIND_COUNT);
        for (idx, label) in MOVE_KIND_LABELS.iter().enumerate() {
            labels.push(&JsValue::from_str(label));
            let stats = self.ep_q_stats[idx];
            let mean = if stats.count > 0 {
                stats.sum / (stats.count as f64)
            } else {
                0.0
            };
            means.push(mean);
            max_abs.push(stats.max_abs);
            counts.push(stats.count.min(u64::from(u32::MAX)) as u32);
        }
        let o = Object::new();
        let _ = Reflect::set(&o, &JsValue::from_str("labels"), &labels);
        let _ = Reflect::set(&o, &JsValue::from_str("mean"), &Float64Array::from(means.as_slice()));
        let _ = Reflect::set(
            &o,
            &JsValue::from_str("maxAbs"),
            &Float64Array::from(max_abs.as_slice()),
        );
        let _ = Reflect::set(&o, &JsValue::from_str("count"), &Uint32Array::from(counts.as_slice()));
        o
    }

    #[wasm_bindgen]
    pub fn apply_perturbation(&mut self, params: JsValue) {
        if !params.is_object() {
            return;
        }
        let target = match get_string(&params, "target") {
            Some(v) => v,
            None => return,
        };
        let mode = get_string(&params, "mode").unwrap_or_else(|| "randomize".to_string());
        let region = get_string(&params, "region").unwrap_or_else(|| "all".to_string());
        let frac = get_f32(&params, "frac").unwrap_or(0.0).clamp(0.0, 1.0);
        if frac <= 0.0 {
            return;
        }
        let target_quadrant = if region == "quadrant" {
            Some(get_u8(&params, "quadrant").unwrap_or(0).min(3))
        } else {
            None
        };
        let target_stripe = if region == "stripe" {
            let bins = get_u8(&params, "bins").unwrap_or(self.params.clock_k).max(1);
            let span = get_u8(&params, "span").unwrap_or(1).max(1);
            let bin = get_u8(&params, "bin").unwrap_or(0);
            Some((bins, span, bin))
        } else {
            None
        };
        let seed = get_u32(&params, "seed").unwrap_or_else(|| self.rand_u32());
        let mut rng = seed;
        let mut next_u32 = || {
            // xorshift32
            let mut x = rng;
            x ^= x << 13;
            x ^= x >> 17;
            x ^= x << 5;
            rng = x;
            x
        };

        let g = self.params.grid_size as usize;
        let cells = g * g;
        let l_s = self.params.l_s;
        let mut touched_base = false;

        if target == "baseS" {
            for (idx, s) in self.s_field.iter_mut().enumerate() {
                if let Some(q) = target_quadrant {
                    let x = idx % g;
                    let y = idx / g;
                    let qx = if x < g / 2 { 0 } else { 1 };
                    let qy = if y < g / 2 { 0 } else { 1 };
                    let quad = (qy * 2 + qx) as u8;
                    if quad != q {
                        continue;
                    }
                }
                if let Some((bins, span, bin)) = target_stripe {
                    let x = idx % g;
                    let stripe = ((x as f32 / g as f32) * (bins as f32)).floor() as u8;
                    let span = span.min(bins);
                    let mut ok = false;
                    for i in 0..span {
                        if stripe == (bin + i) % bins {
                            ok = true;
                            break;
                        }
                    }
                    if !ok {
                        continue;
                    }
                }
                let u = next_u32() >> 8;
                let r = (u as f32) / ((1u32 << 24) as f32);
                if r < frac {
                    *s = match mode.as_str() {
                        "zero" => 0,
                        _ => (next_u32() % (l_s as u32 + 1)) as u8,
                    };
                    touched_base = true;
                }
            }
        } else if target == "metaS" {
            let layer = get_u16(&params, "layer").unwrap_or(0) as usize;
            if layer >= self.params.meta_layers as usize {
                return;
            }
            let base = layer * cells;
            let end = base + cells;
            for (offset, s) in self.meta_field[base..end].iter_mut().enumerate() {
                if let Some(q) = target_quadrant {
                    let x = offset % g;
                    let y = offset / g;
                    let qx = if x < g / 2 { 0 } else { 1 };
                    let qy = if y < g / 2 { 0 } else { 1 };
                    let quad = (qy * 2 + qx) as u8;
                    if quad != q {
                        continue;
                    }
                }
                if let Some((bins, span, bin)) = target_stripe {
                    let x = offset % g;
                    let stripe = ((x as f32 / g as f32) * (bins as f32)).floor() as u8;
                    let span = span.min(bins);
                    let mut ok = false;
                    for i in 0..span {
                        if stripe == (bin + i) % bins {
                            ok = true;
                            break;
                        }
                    }
                    if !ok {
                        continue;
                    }
                }
                let u = next_u32() >> 8;
                let r = (u as f32) / ((1u32 << 24) as f32);
                if r < frac {
                    *s = match mode.as_str() {
                        "zero" => 0,
                        _ => (next_u32() % (l_s as u32 + 1)) as u8,
                    };
                }
            }
        }

        if touched_base {
            self.recompute_sum_s();
        }
    }

    #[wasm_bindgen]
    pub fn energy_breakdown(&self) -> Object {
        let (u_rep, u_bond, e_w, e_n, e_a, e_s, total) = self.energy_breakdown_inner();
        let o = Object::new();
        let _ = Reflect::set(&o, &JsValue::from_str("uRep"), &JsValue::from_f64(u_rep as f64));
        let _ = Reflect::set(&o, &JsValue::from_str("uBond"), &JsValue::from_f64(u_bond as f64));
        let _ = Reflect::set(&o, &JsValue::from_str("eW"), &JsValue::from_f64(e_w as f64));
        let _ = Reflect::set(&o, &JsValue::from_str("eN"), &JsValue::from_f64(e_n as f64));
        let _ = Reflect::set(&o, &JsValue::from_str("eA"), &JsValue::from_f64(e_a as f64));
        let _ = Reflect::set(&o, &JsValue::from_str("eS"), &JsValue::from_f64(e_s as f64));
        let _ = Reflect::set(&o, &JsValue::from_str("total"), &JsValue::from_f64(total as f64));
        o
    }

    #[wasm_bindgen]
    pub fn diagnostics(&self) -> Object {
        let (w_plus, w_minus, n_plus, n_minus, a_plus, a_minus, s_plus, s_minus, window) =
            self.diag.counts();
        let (
            w_plus_h,
            w_minus_h,
            w_plus_l,
            w_minus_l,
            n_plus_h,
            n_minus_h,
            n_plus_l,
            n_minus_l,
            a_plus_h,
            a_minus_h,
            a_plus_l,
            a_minus_l,
            s_plus_h,
            s_minus_h,
            s_plus_l,
            s_minus_l,
        ) = self.diag.counts_hl();
        let o = Object::new();
        let _ = Reflect::set(&o, &JsValue::from_str("wPlus"), &JsValue::from_f64(w_plus as f64));
        let _ = Reflect::set(&o, &JsValue::from_str("wMinus"), &JsValue::from_f64(w_minus as f64));
        let _ = Reflect::set(&o, &JsValue::from_str("nPlus"), &JsValue::from_f64(n_plus as f64));
        let _ = Reflect::set(&o, &JsValue::from_str("nMinus"), &JsValue::from_f64(n_minus as f64));
        let _ = Reflect::set(&o, &JsValue::from_str("aPlus"), &JsValue::from_f64(a_plus as f64));
        let _ = Reflect::set(&o, &JsValue::from_str("aMinus"), &JsValue::from_f64(a_minus as f64));
        let _ = Reflect::set(&o, &JsValue::from_str("sPlus"), &JsValue::from_f64(s_plus as f64));
        let _ = Reflect::set(
            &o,
            &JsValue::from_str("sMinus"),
            &JsValue::from_f64(s_minus as f64),
        );
        let _ = Reflect::set(&o, &JsValue::from_str("wPlusH"), &JsValue::from_f64(w_plus_h as f64));
        let _ = Reflect::set(&o, &JsValue::from_str("wMinusH"), &JsValue::from_f64(w_minus_h as f64));
        let _ = Reflect::set(&o, &JsValue::from_str("wPlusL"), &JsValue::from_f64(w_plus_l as f64));
        let _ = Reflect::set(&o, &JsValue::from_str("wMinusL"), &JsValue::from_f64(w_minus_l as f64));
        let _ = Reflect::set(&o, &JsValue::from_str("nPlusH"), &JsValue::from_f64(n_plus_h as f64));
        let _ = Reflect::set(&o, &JsValue::from_str("nMinusH"), &JsValue::from_f64(n_minus_h as f64));
        let _ = Reflect::set(&o, &JsValue::from_str("nPlusL"), &JsValue::from_f64(n_plus_l as f64));
        let _ = Reflect::set(&o, &JsValue::from_str("nMinusL"), &JsValue::from_f64(n_minus_l as f64));
        let _ = Reflect::set(&o, &JsValue::from_str("aPlusH"), &JsValue::from_f64(a_plus_h as f64));
        let _ = Reflect::set(&o, &JsValue::from_str("aMinusH"), &JsValue::from_f64(a_minus_h as f64));
        let _ = Reflect::set(&o, &JsValue::from_str("aPlusL"), &JsValue::from_f64(a_plus_l as f64));
        let _ = Reflect::set(&o, &JsValue::from_str("aMinusL"), &JsValue::from_f64(a_minus_l as f64));
        let _ = Reflect::set(&o, &JsValue::from_str("sPlusH"), &JsValue::from_f64(s_plus_h as f64));
        let _ = Reflect::set(&o, &JsValue::from_str("sMinusH"), &JsValue::from_f64(s_minus_h as f64));
        let _ = Reflect::set(&o, &JsValue::from_str("sPlusL"), &JsValue::from_f64(s_plus_l as f64));
        let _ = Reflect::set(&o, &JsValue::from_str("sMinusL"), &JsValue::from_f64(s_minus_l as f64));
        let _ = Reflect::set(&o, &JsValue::from_str("window"), &JsValue::from_f64(window as f64));
        let (j_w, a_w, sigma_w) = diag_flux_affinity(w_plus, w_minus, window);
        let (j_n, a_n, sigma_n) = diag_flux_affinity(n_plus, n_minus, window);
        let (j_a, a_a, sigma_a) = diag_flux_affinity(a_plus, a_minus, window);
        let (j_s, a_s, sigma_s) = diag_flux_affinity(s_plus, s_minus, window);
        let a_m6_w = diag_m6_affinity(w_plus_h, w_minus_h, w_plus_l, w_minus_l);
        let a_m6_n = diag_m6_affinity(n_plus_h, n_minus_h, n_plus_l, n_minus_l);
        let a_m6_a = diag_m6_affinity(a_plus_h, a_minus_h, a_plus_l, a_minus_l);
        let a_m6_s = diag_m6_affinity(s_plus_h, s_minus_h, s_plus_l, s_minus_l);
        let _ = Reflect::set(&o, &JsValue::from_str("aM6W"), &JsValue::from_f64(a_m6_w as f64));
        let _ = Reflect::set(&o, &JsValue::from_str("aM6N"), &JsValue::from_f64(a_m6_n as f64));
        let _ = Reflect::set(&o, &JsValue::from_str("aM6A"), &JsValue::from_f64(a_m6_a as f64));
        let _ = Reflect::set(&o, &JsValue::from_str("aM6S"), &JsValue::from_f64(a_m6_s as f64));
        let _ = Reflect::set(&o, &JsValue::from_str("jW"), &JsValue::from_f64(j_w as f64));
        let _ = Reflect::set(&o, &JsValue::from_str("aW"), &JsValue::from_f64(a_w as f64));
        let _ = Reflect::set(&o, &JsValue::from_str("jN"), &JsValue::from_f64(j_n as f64));
        let _ = Reflect::set(&o, &JsValue::from_str("aN"), &JsValue::from_f64(a_n as f64));
        let _ = Reflect::set(&o, &JsValue::from_str("jA"), &JsValue::from_f64(j_a as f64));
        let _ = Reflect::set(&o, &JsValue::from_str("aA"), &JsValue::from_f64(a_a as f64));
        let _ = Reflect::set(&o, &JsValue::from_str("jS"), &JsValue::from_f64(j_s as f64));
        let _ = Reflect::set(&o, &JsValue::from_str("aS"), &JsValue::from_f64(a_s as f64));
        let _ = Reflect::set(
            &o,
            &JsValue::from_str("sigmaMem"),
            &JsValue::from_f64((sigma_w + sigma_n + sigma_a + sigma_s) as f64),
        );
        let _ = Reflect::set(&o, &JsValue::from_str("p3CycleLen"), &JsValue::from_f64(self.p3_cycle_len as f64));
        let _ = Reflect::set(&o, &JsValue::from_str("p3DispX"), &JsValue::from_f64(self.p3_disp_x as f64));
        let _ = Reflect::set(&o, &JsValue::from_str("p3DispY"), &JsValue::from_f64(self.p3_disp_y as f64));
        let _ = Reflect::set(&o, &JsValue::from_str("p3DispMag"), &JsValue::from_f64(self.p3_disp_mag as f64));
        let _ = Reflect::set(&o, &JsValue::from_str("p3LoopArea"), &JsValue::from_f64(self.p3_loop_area as f64));
        let hist = self.w_histogram();
        let _ = Reflect::set(&o, &JsValue::from_str("wHist"), &hist);
        let s_hist = self.s_histogram();
        let _ = Reflect::set(&o, &JsValue::from_str("sHist"), &s_hist);
        o
    }

    #[wasm_bindgen]
    pub fn set_params(&mut self, params: JsValue) {
        // Accept a plain JS object with numeric fields; ignore missing fields.
        if !params.is_object() {
            return;
        }

        let prev_p3 = self.params.p3_on;
        let prev_grid_size = self.params.grid_size;
        let prev_meta_layers = self.params.meta_layers;
        let prev_op_on = self.params.op_coupling_on;
        let prev_op_stencil = self.params.op_stencil;
        let prev_op_budget = self.params.op_budget_k;
        if let Some(v) = get_f32(&params, "beta") {
            if v.is_finite() && v > 0.0 {
                self.params.beta = v;
            }
        }
        if let Some(v) = get_f32(&params, "stepSize") {
            if v.is_finite() && v > 0.0 {
                self.params.step_size = v.min(0.25);
            }
        }
        if let Some(v) = get_f32(&params, "pWrite") {
            if v.is_finite() {
                self.params.p_write = v.clamp(0.0, 1.0);
            }
        }
        if let Some(v) = get_f32(&params, "pNWrite") {
            if v.is_finite() {
                self.params.p_n_write = v.clamp(0.0, 1.0);
            }
        }
        if let Some(v) = get_f32(&params, "pAWrite") {
            if v.is_finite() {
                self.params.p_a_write = v.clamp(0.0, 1.0);
            }
        }
        if let Some(v) = get_f32(&params, "pSWrite") {
            if v.is_finite() {
                self.params.p_s_write = v.clamp(0.0, 1.0);
            }
        }
        if let Some(v) = get_f32(&params, "p3On") {
            if v.is_finite() {
                self.params.p3_on = v >= 0.5;
            }
        }
        if let Some(v) = get_f32(&params, "p6On") {
            if v.is_finite() {
                self.params.p6_on = v >= 0.5;
            }
        }
        if let Some(v) = get_f32(&params, "p6SFactor") {
            if v.is_finite() {
                self.params.p6_s_factor = v.clamp(0.0, 1.0);
            }
        }
        if let Some(v) = get_f32(&params, "muHigh") {
            if v.is_finite() {
                self.params.mu_high = v;
            }
        }
        if let Some(v) = get_f32(&params, "muLow") {
            if v.is_finite() {
                self.params.mu_low = v;
            }
        }
        if self.params.p3_on != prev_p3 {
            self.phase = 0;
            self.p3_cycle_len = 0;
            self.p3_start_positions.clear();
            self.p3_obs1.clear();
            self.p3_obs2.clear();
            self.p3_disp_x = 0.0;
            self.p3_disp_y = 0.0;
            self.p3_disp_mag = 0.0;
            self.p3_loop_area = 0.0;
        }
        let sum = self.params.p_write + self.params.p_n_write + self.params.p_a_write + self.params.p_s_write;
        if sum > 1.0 {
            self.params.p_write /= sum;
            self.params.p_n_write /= sum;
            self.params.p_a_write /= sum;
            self.params.p_s_write /= sum;
        }
        if let Some(v) = get_f32(&params, "kappaRep") {
            if v.is_finite() && v >= 0.0 {
                self.params.kappa_rep = v;
            }
        }
        if let Some(v) = get_f32(&params, "r0") {
            if v.is_finite() && v >= 0.0 && v <= 0.5 {
                self.params.r0 = v;
            }
        }
        if let Some(v) = get_f32(&params, "kappaBond") {
            if v.is_finite() && v >= 0.0 {
                self.params.kappa_bond = v;
            }
        }
        if let Some(v) = get_f32(&params, "rStar") {
            if v.is_finite() && v >= 0.0 && v <= 0.5 {
                self.params.r_star = v;
            }
        }
        if let Some(v) = get_f32(&params, "lambdaW") {
            if v.is_finite() && v >= 0.0 {
                self.params.lambda_w = v;
            }
        }
        if let Some(v) = get_f32(&params, "lambdaN") {
            if v.is_finite() && v >= 0.0 {
                self.params.lambda_n = v;
            }
        }
        if let Some(v) = get_f32(&params, "lambdaA") {
            if v.is_finite() && v >= 0.0 {
                self.params.lambda_a = v;
            }
        }
        if let Some(v) = get_f32(&params, "lambdaS") {
            if v.is_finite() && v >= 0.0 {
                self.params.lambda_s = v;
            }
        }
        if let Some(v) = get_u8(&params, "lW") {
            let new_lw = v.max(1);
            self.params.l_w = new_lw;
            for w in &mut self.w {
                if *w > new_lw {
                    *w = new_lw;
                }
            }
            for w in &mut self.meta_w_edges {
                if *w > new_lw {
                    *w = new_lw;
                }
            }
            self.recompute_sum_w();
        }
        if let Some(v) = get_i16(&params, "lN") {
            let new_ln = v.max(1);
            self.params.l_n = new_ln;
            for n in &mut self.n_counter {
                if *n > new_ln {
                    *n = new_ln;
                } else if *n < -new_ln {
                    *n = -new_ln;
                }
            }
            for n in &mut self.meta_n_field {
                if *n > new_ln {
                    *n = new_ln;
                } else if *n < -new_ln {
                    *n = -new_ln;
                }
            }
        }
        if let Some(v) = get_u16(&params, "lA") {
            let new_la = v.max(1);
            self.params.l_a = new_la;
            for a in &mut self.a_counter {
                if *a > new_la {
                    *a = new_la;
                }
            }
            for a in &mut self.meta_a_field {
                if *a > new_la {
                    *a = new_la;
                }
            }
        }
        if let Some(v) = get_u8(&params, "lS") {
            let new_ls = v.max(1);
            self.params.l_s = new_ls;
            for s in &mut self.s_field {
                if *s > new_ls {
                    *s = new_ls;
                }
            }
            for s in &mut self.meta_field {
                if *s > new_ls {
                    *s = new_ls;
                }
            }
            self.recompute_sum_s();
        }
        if let Some(v) = get_u16(&params, "gridSize") {
            let new_g = v.max(2).min(256);
            if new_g != self.params.grid_size {
                self.params.grid_size = new_g;
                self.s_field = vec![0u8; (new_g as usize) * (new_g as usize)];
                self.recompute_sum_s();
            }
        }
        if let Some(v) = get_u16(&params, "metaLayers") {
            let new_layers = v.min(MAX_META_LAYERS);
            self.params.meta_layers = new_layers;
        }
        if let Some(v) = get_f32(&params, "eta") {
            if v.is_finite() {
                self.params.eta = v.clamp(0.0, 1.0);
            }
        }
        if let Some(v) = get_f32(&params, "etaDrive") {
            if v.is_finite() {
                self.params.eta_drive = v.clamp(0.0, 1.0);
            }
        }
        if let Some(v) = get_f32(&params, "opCouplingOn") {
            if v.is_finite() {
                self.params.op_coupling_on = v >= 0.5;
            }
        }
        if let Some(v) = get_u8(&params, "opStencil") {
            self.params.op_stencil = v.min(1);
        }
        if let Some(v) = get_u8(&params, "opBudgetK") {
            self.params.op_budget_k = v.max(1);
        }
        if let Some(v) = get_f32(&params, "opKTargetWeight") {
            if v.is_finite() {
                self.params.op_k_target_weight = v.clamp(0.0, 10.0);
            }
        }
        if let Some(v) = get_u8(&params, "sCouplingMode") {
            self.params.s_coupling_mode = v.min(1);
        }
        if let Some(v) = get_f32(&params, "opDriveOnK") {
            if v.is_finite() {
                self.params.op_drive_on_k = v >= 0.5;
            }
        }
        if let Some(v) = get_f32(&params, "acceptLogOn") {
            if v.is_finite() {
                self.params.accept_log_on = v >= 0.5;
            }
        }
        if let Some(v) = get_u32(&params, "acceptLogMask") {
            self.params.accept_log_mask = v;
        }
        if let Some(v) = get_u32(&params, "acceptLogCap") {
            self.params.accept_log_cap = v.clamp(1000, 2_000_000);
        }
        if let Some(v) = get_f32(&params, "epDebug") {
            if v.is_finite() {
                self.params.ep_debug = v >= 0.5;
            }
        }
        if let Some(v) = get_f32(&params, "initRandom") {
            if v.is_finite() {
                let on = v >= 0.5;
                self.params.init_random = on;
                if on {
                    self.randomize_state();
                    self.ep_naive_total = 0.0;
                    self.ep_exact_total = 0.0;
                    self.ep_naive_by_move = [0.0; MOVE_KIND_COUNT];
                    self.ep_exact_by_move = [0.0; MOVE_KIND_COUNT];
                }
            }
        }
        if let Some(v) = get_f32(&params, "codeNoiseRate") {
            if v.is_finite() {
                self.params.code_noise_rate = v.clamp(0.0, 1.0);
            }
        }
        if let Some(v) = get_u16(&params, "codeNoiseBatch") {
            let batch = v.max(1);
            self.params.code_noise_batch = batch;
        }
        if let Some(v) = get_u16(&params, "codeNoiseLayer") {
            self.params.code_noise_layer = v;
        }
        if let Some(v) = get_f32(&params, "clockOn") {
            if v.is_finite() {
                self.params.clock_on = v >= 0.5;
            }
        }
        if let Some(v) = get_u8(&params, "clockK") {
            let new_k = v.max(3);
            self.params.clock_k = new_k;
            if self.clock_state >= new_k {
                self.clock_state = 0;
            }
        }
        if let Some(v) = get_f32(&params, "clockFrac") {
            if v.is_finite() {
                self.params.clock_frac = v.clamp(0.0, 1.0);
            }
        }
        if let Some(v) = get_f32(&params, "clockUsesP6") {
            if v.is_finite() {
                self.params.clock_uses_p6 = v >= 0.5;
            }
        }
        if let Some(v) = get_f32(&params, "repairClockGated") {
            if v.is_finite() {
                self.params.repair_clock_gated = v >= 0.5;
            }
        }
        if let Some(v) = get_u8(&params, "repairGateMode") {
            self.params.repair_gate_mode = v.min(1);
        }
        if let Some(v) = get_u8(&params, "repairGateSpan") {
            self.params.repair_gate_span = v.max(1);
        }
        if self.params.s_coupling_mode > 0 && !self.params.op_coupling_on {
            self.params.s_coupling_mode = 0;
        }
        if self.params.grid_size != prev_grid_size || self.params.meta_layers != prev_meta_layers {
            self.resize_meta_arrays();
        }
        if !self.params.op_coupling_on || self.params.meta_layers == 0 {
            self.op_k.clear();
        } else if self.params.grid_size != prev_grid_size
            || self.params.meta_layers != prev_meta_layers
            || prev_op_on != self.params.op_coupling_on
            || prev_op_stencil != self.params.op_stencil
            || prev_op_budget != self.params.op_budget_k
        {
            self.init_op_k();
        }
        if let Some(v) = get_f32(&params, "rPropose") {
            if v.is_finite() && v >= 0.0 && v <= 0.5 {
                self.params.r_propose = v;
            }
        }
    }
}

impl Sim {
    fn recompute_sum_w(&mut self) {
        self.sum_w = self.w.iter().map(|w| *w as i32).sum();
    }

    fn recompute_sum_s(&mut self) {
        self.sum_s = self.s_field.iter().map(|s| *s as i32).sum();
    }

    fn resize_meta_arrays(&mut self) {
        let layers = self.params.meta_layers as usize;
        if layers == 0 {
            self.meta_field.clear();
            self.meta_n_field.clear();
            self.meta_a_field.clear();
            self.meta_w_edges.clear();
            return;
        }
        let g = self.params.grid_size as usize;
        let cells = layers * g * g;
        self.meta_field = vec![0u8; cells];
        self.meta_n_field = vec![0i16; cells];
        self.meta_a_field = vec![0u16; cells];
        self.meta_w_edges = vec![0u8; layers * meta_edge_count(g)];
    }

    fn op_offsets_internal(&self) -> &'static [(i32, i32)] {
        if self.params.op_stencil == 1 {
            &OP_STENCIL_FULL
        } else {
            &OP_STENCIL_CROSS
        }
    }

    fn op_r_count_internal(&self) -> usize {
        self.op_offsets_internal().len()
    }

    fn op_k_index(&self, interface: usize, q: usize, r_idx: usize) -> usize {
        let g = self.params.grid_size as usize;
        let cells = g * g;
        let r_count = self.op_r_count_internal();
        ((interface * cells + q) * r_count) + r_idx
    }

    fn mismatch_bin(upper: u8, lower: u8) -> u8 {
        let diff = (upper as i16) - (lower as i16);
        if diff < 0 {
            0
        } else if diff == 0 {
            1
        } else {
            2
        }
    }

    fn op_k_dir(&self, interface: usize, q: usize) -> u8 {
        if self.op_k.is_empty() {
            return 0;
        }
        if interface >= self.params.meta_layers as usize {
            return 0;
        }
        let r_count = self.op_r_count_internal();
        if r_count == 0 || r_count > u8::MAX as usize {
            // Stencil sizes should be small; clamp to 0 if out of range.
            return 0;
        }
        let mut best_idx = 0usize;
        let mut best_val = 0u8;
        for r_idx in 0..r_count {
            let idx = self.op_k_index(interface, q, r_idx);
            let val = self.op_k[idx];
            if val > best_val {
                best_val = val;
                best_idx = r_idx;
            }
        }
        best_idx as u8
    }

    fn offset_index(q: usize, dx: i32, dy: i32, g: usize) -> usize {
        let x = (q % g) as i32;
        let y = (q / g) as i32;
        let nx = (x + dx).rem_euclid(g as i32) as usize;
        let ny = (y + dy).rem_euclid(g as i32) as usize;
        ny * g + nx
    }

    fn op_lower_norm(&self, interface: usize, q: usize) -> f32 {
        let denom = self.params.l_s.max(1) as f32;
        let val = if interface == 0 {
            self.s_field[q]
        } else {
            let g = self.params.grid_size as usize;
            let cells = g * g;
            self.meta_field[(interface - 1) * cells + q]
        };
        (val as f32) / denom
    }

    fn op_upper_norm(&self, interface: usize, q: usize) -> f32 {
        let denom = self.params.l_s.max(1) as f32;
        let g = self.params.grid_size as usize;
        let cells = g * g;
        let val = self.meta_field[interface * cells + q];
        (val as f32) / denom
    }

    fn op_pred_norm(&self, interface: usize, q: usize) -> f32 {
        let g = self.params.grid_size as usize;
        let cells = g * g;
        if self.op_k.is_empty() || interface >= self.params.meta_layers as usize || q >= cells {
            return 0.0;
        }
        let budget = self.params.op_budget_k as f32;
        if budget <= 0.0 {
            return 0.0;
        }
        let mut acc = 0.0;
        for (r_idx, (dx, dy)) in self.op_offsets_internal().iter().enumerate() {
            let q_off = Self::offset_index(q, *dx, *dy, g);
            let k_idx = self.op_k_index(interface, q, r_idx);
            let weight = (self.op_k[k_idx] as f32) / budget;
            acc += weight * self.op_lower_norm(interface, q_off);
        }
        acc
    }

    fn delta_raw_s_op(&self, level: usize, idx: usize, s0: u8, s1: u8) -> f32 {
        if !self.params.op_coupling_on || self.params.s_coupling_mode == 0 {
            return 0.0;
        }
        let layers = self.params.meta_layers as usize;
        if layers == 0 {
            return 0.0;
        }
        let g = self.params.grid_size as usize;
        if g == 0 {
            return 0.0;
        }
        let denom = self.params.l_s.max(1) as f32;
        let s0n = (s0 as f32) / denom;
        let s1n = (s1 as f32) / denom;
        let mut delta = 0.0;
        if level > 0 {
            let interface = level - 1;
            if interface < layers {
                let pred = self.op_pred_norm(interface, idx);
                delta += 0.5 * ((s1n - pred).powi(2) - (s0n - pred).powi(2));
            }
        }
        if level < layers {
            let interface = level;
            for (r_idx, (dx, dy)) in self.op_offsets_internal().iter().enumerate() {
                let q_prime = Self::offset_index(idx, -*dx, -*dy, g);
                let pred_old = self.op_pred_norm(interface, q_prime);
                let upper = self.op_upper_norm(interface, q_prime);
                let k_idx = self.op_k_index(interface, q_prime, r_idx);
                let weight = (self.op_k[k_idx] as f32) / (self.params.op_budget_k as f32);
                let pred_new = pred_old + weight * (s1n - s0n);
                delta += 0.5 * ((upper - pred_new).powi(2) - (upper - pred_old).powi(2));
            }
        }
        delta
    }

    fn delta_raw_k_op(&self, interface: usize, q: usize, r_from: usize, r_to: usize) -> f32 {
        if !self.params.op_coupling_on || self.params.s_coupling_mode == 0 {
            return 0.0;
        }
        let layers = self.params.meta_layers as usize;
        if layers == 0 || interface >= layers {
            return 0.0;
        }
        let g = self.params.grid_size as usize;
        if g == 0 {
            return 0.0;
        }
        let budget = self.params.op_budget_k as f32;
        if budget <= 0.0 {
            return 0.0;
        }
        let pred_old = self.op_pred_norm(interface, q);
        let upper = self.op_upper_norm(interface, q);
        let offsets = self.op_offsets_internal();
        let (dx_from, dy_from) = offsets[r_from];
        let (dx_to, dy_to) = offsets[r_to];
        let lower_from = self.op_lower_norm(interface, Self::offset_index(q, dx_from, dy_from, g));
        let lower_to = self.op_lower_norm(interface, Self::offset_index(q, dx_to, dy_to, g));
        let pred_new = pred_old + (lower_to - lower_from) / budget;
        0.5 * ((upper - pred_new).powi(2) - (upper - pred_old).powi(2))
    }

    fn init_op_k(&mut self) {
        if !self.params.op_coupling_on || self.params.meta_layers == 0 {
            self.op_k.clear();
            return;
        }
        let layers = self.params.meta_layers as usize;
        let g = self.params.grid_size as usize;
        let cells = g * g;
        let r_count = self.op_r_count_internal();
        let budget = self.params.op_budget_k;
        if r_count == 0 || budget == 0 {
            self.op_k.clear();
            return;
        }
        let base = budget / (r_count as u8);
        let rem = (budget % (r_count as u8)) as usize;
        self.op_k = vec![0u8; layers * cells * r_count];
        for interface in 0..layers {
            for q in 0..cells {
                let start = (interface * cells + q) * r_count;
                for r in 0..r_count {
                    let mut val = base;
                    if r < rem {
                        val = val.saturating_add(1);
                    }
                    self.op_k[start + r] = val;
                }
            }
        }
    }

    fn randomize_state(&mut self) {
        let mut rng = self.rng;
        let mut next_u32 = || {
            let mut x = rng;
            x ^= x << 13;
            x ^= x >> 17;
            x ^= x << 5;
            rng = x;
            x
        };
        let mut rand01 = || {
            let u = next_u32() >> 8;
            (u as f64) / ((1u32 << 24) as f64)
        };

        let beta = self.params.beta as f64;
        let l_w = self.params.l_w as usize;
        let l_s = self.params.l_s as usize;
        let l_a = self.params.l_a as usize;
        let l_n = self.params.l_n.max(1) as i32;

        let weights_s: Vec<f64> = (0..=l_s)
            .map(|v| (-0.5 * beta * (self.params.lambda_s as f64) * (v as f64).powi(2)).exp())
            .collect();
        let weights_a: Vec<f64> = (0..=l_a)
            .map(|v| (-0.5 * beta * (self.params.lambda_a as f64) * (v as f64).powi(2)).exp())
            .collect();
        let weights_n: Vec<f64> = (-l_n..=l_n)
            .map(|v| (-0.5 * beta * (self.params.lambda_n as f64) * (v as f64).powi(2)).exp())
            .collect();
        let weights_w_base: Vec<f64> = (0..=l_w)
            .map(|v| (-0.5 * beta * (self.params.lambda_w as f64) * (v as f64).powi(2)).exp())
            .collect();

        let sample_index = |weights: &[f64], r: f64| -> usize {
            let total: f64 = weights.iter().sum();
            if total <= 0.0 {
                return 0;
            }
            let mut acc = 0.0;
            let target = r * total;
            for (idx, w) in weights.iter().enumerate() {
                acc += *w;
                if acc >= target {
                    return idx;
                }
            }
            weights.len().saturating_sub(1)
        };

        if self.n > 1 {
            let mut idx = 0usize;
            for i in 0..self.n {
                for j in (i + 1)..self.n {
                    let r = torus_dist(
                        self.positions[2 * i],
                        self.positions[2 * i + 1],
                        self.positions[2 * j],
                        self.positions[2 * j + 1],
                    );
                    let bond_shape =
                        0.5 * (self.params.kappa_bond as f64) * (r - self.params.r_star).powi(2) as f64;
                    let weights = if bond_shape > 0.0 {
                        let mut local = Vec::with_capacity(l_w + 1);
                        for v in 0..=l_w {
                            let vf = v as f64;
                            let e = 0.5 * beta * (self.params.lambda_w as f64) * vf * vf
                                + beta * bond_shape * vf;
                            local.push((-e).exp());
                        }
                        local
                    } else {
                        weights_w_base.clone()
                    };
                    self.w[idx] = sample_index(&weights, rand01()) as u8;
                    idx += 1;
                }
            }
        }
        for n in &mut self.n_counter {
            let idx = sample_index(&weights_n, rand01());
            *n = (idx as i16) - (l_n as i16);
        }
        for a in &mut self.a_counter {
            *a = sample_index(&weights_a, rand01()) as u16;
        }
        for s in &mut self.s_field {
            *s = sample_index(&weights_s, rand01()) as u8;
        }
        if self.params.meta_layers > 0 {
            for s in &mut self.meta_field {
                *s = sample_index(&weights_s, rand01()) as u8;
            }
            for n in &mut self.meta_n_field {
                let idx = sample_index(&weights_n, rand01());
                *n = (idx as i16) - (l_n as i16);
            }
            for a in &mut self.meta_a_field {
                *a = sample_index(&weights_a, rand01()) as u16;
            }
            for w in &mut self.meta_w_edges {
                *w = sample_index(&weights_w_base, rand01()) as u8;
            }
        }
        if self.params.op_coupling_on && self.params.meta_layers > 0 {
            self.init_op_k();
        } else {
            self.op_k.clear();
        }
        self.rng = rng;
        self.recompute_sum_w();
        self.recompute_sum_s();
    }

    fn pick_write_target(&mut self) -> usize {
        let total = (self.params.meta_layers as u32) + 1;
        (self.rand_u32() % total) as usize
    }

    fn pick_p5_target_op(&mut self) -> usize {
        let layers = self.params.meta_layers as u32;
        let weight = self.params.op_k_target_weight;
        if (weight - 1.0).abs() < 1e-6 {
            let total = 1 + (2 * layers);
            (self.rand_u32() % total) as usize
        } else {
            let layers_usize = layers as usize;
            if layers_usize == 0 {
                return 0;
            }
            let s_weight = (layers_usize + 1) as f32;
            let op_weight = (layers_usize as f32) * weight.max(0.0);
            let total = s_weight + op_weight;
            if total <= 0.0 {
                return 0;
            }
            let r = self.rand01() * total;
            if r < s_weight {
                (self.rand_u32() % (layers + 1)) as usize
            } else {
                let idx = (self.rand_u32() % layers) as usize;
                (layers_usize + 1) + idx
            }
        }
    }

    fn rand_u32(&mut self) -> u32 {
        // xorshift32
        let mut x = self.rng;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        self.rng = x;
        x
    }

    fn rand01(&mut self) -> f32 {
        // Map to [0,1) using 24 high bits for stable float conversion.
        let u = self.rand_u32() >> 8;
        (u as f32) / ((1u32 << 24) as f32)
    }

    fn clock_step(&mut self) -> bool {
        let k = self.params.clock_k.max(3);
        let up = self.rand01() < 0.5;
        let c0 = self.clock_state;
        let c1 = if up {
            if c0 + 1 >= k {
                0
            } else {
                c0 + 1
            }
        } else if c0 == 0 {
            k - 1
        } else {
            c0 - 1
        };
        let work = if self.params.p6_on && self.params.clock_uses_p6 {
            let mu = self.params.mu_high;
            if up { mu } else { -mu }
        } else {
            0.0
        };
        if self.accept_move(0.0, work, 0.0, MOVE_CLOCK) {
            self.clock_state = c1;
            if up {
                self.clock_q += 1;
                self.clock_fwd = self.clock_fwd.saturating_add(1);
            } else {
                self.clock_q -= 1;
                self.clock_bwd = self.clock_bwd.saturating_add(1);
            }
            return true;
        }
        false
    }

    fn clock_gate_allows(&self, x: f32, y: f32) -> bool {
        if !self.params.repair_clock_gated {
            return true;
        }
        let active = if self.params.clock_on {
            self.clock_state
        } else {
            0
        };
        match self.params.repair_gate_mode {
            1 => {
                let bins = self.params.clock_k.max(1) as usize;
                let idx = ((x * (bins as f32)).floor() as usize).min(bins - 1);
                let active_bin = (active as usize) % bins;
                let span = self.params.repair_gate_span.max(1) as usize;
                let span = span.min(bins);
                for i in 0..span {
                    if (active_bin + i) % bins == idx {
                        return true;
                    }
                }
                false
            }
            _ => {
                let qx = if x < 0.5 { 0 } else { 1 };
                let qy = if y < 0.5 { 0 } else { 1 };
                let quadrant = (qy * 2 + qx) as u8;
                quadrant == (active % 4)
            }
        }
    }

    fn x_move_step(&mut self) {
        if self.n <= 1 {
            return;
        }
        let i = (self.rand_u32() as usize) % self.n;
        let x0 = self.positions[2 * i];
        let y0 = self.positions[2 * i + 1];

        // Symmetric proposal on the torus (small box step).
        let dx = (self.rand01() - 0.5) * 2.0 * self.params.step_size;
        let dy = (self.rand01() - 0.5) * 2.0 * self.params.step_size;
        let x1 = wrap01(x0 + dx);
        let y1 = wrap01(y0 + dy);

        let d_e = self.delta_e_move_particle(i, x0, y0, x1, y1);
        if self.accept_move(d_e, 0.0, 0.0, MOVE_X) {
            self.positions[2 * i] = x1;
            self.positions[2 * i + 1] = y1;
        }
    }

    fn p1_write_step(&mut self) -> i8 {
        let m = self.w.len();
        if m == 0 {
            return 0;
        }

        // Choose a neighbor pair uniformly among those within r_propose.
        let mut chosen: Option<(usize, usize)> = None;
        let mut count = 0u32;
        for i in 0..self.n {
            for j in (i + 1)..self.n {
                let r = torus_dist(
                    self.positions[2 * i],
                    self.positions[2 * i + 1],
                    self.positions[2 * j],
                    self.positions[2 * j + 1],
                );
                if r <= self.params.r_propose {
                    count += 1;
                    if self.rand01() < 1.0 / (count as f32) {
                        chosen = Some((i, j));
                    }
                }
            }
        }

        let (i, j) = match chosen {
            Some(pair) => pair,
            None => return 0,
        };
        let idx = edge_index(self.n, i, j);
        let w0 = self.w[idx];

        let up = self.rand01() < 0.5;
        let w1 = if up {
            if w0 >= self.params.l_w {
                return 0;
            }
            w0 + 1
        } else {
            if w0 == 0 {
                return 0;
            }
            w0 - 1
        };

        let r = torus_dist(
            self.positions[2 * i],
            self.positions[2 * i + 1],
            self.positions[2 * j],
            self.positions[2 * j + 1],
        );
        let d_e = self.delta_e_write(w0, w1, r);
        let (work, high_ctx) = if self.params.p6_on {
            let (mx, my) = torus_midpoint(
                self.positions[2 * i],
                self.positions[2 * i + 1],
                self.positions[2 * j],
                self.positions[2 * j + 1],
            );
            let mu = self.mu_at(mx, my);
            (if up { mu } else { -mu }, mx < 0.5)
        } else {
            (0.0, false)
        };
        if self.accept_move(d_e, work, 0.0, MOVE_P1_BASE) {
            self.w[idx] = w1;
            self.sum_w += if up { 1 } else { -1 };
            if self.params.p6_on {
                if high_ctx {
                    if up {
                        self.diag.w_plus_h = self.diag.w_plus_h.saturating_add(1);
                    } else {
                        self.diag.w_minus_h = self.diag.w_minus_h.saturating_add(1);
                    }
                } else if up {
                    self.diag.w_plus_l = self.diag.w_plus_l.saturating_add(1);
                } else {
                    self.diag.w_minus_l = self.diag.w_minus_l.saturating_add(1);
                }
            }
            return if up { 1 } else { -1 };
        }
        0
    }

    fn p4_write_step(&mut self) -> i8 {
        if self.params.clock_on && self.params.clock_frac > 0.0 {
            if self.rand01() < self.params.clock_frac {
                self.clock_step();
                return 0;
            }
        }
        if self.n == 0 {
            return 0;
        }
        let k = (self.rand_u32() as usize) % self.n;
        let n0 = self.n_counter[k];
        let up = self.rand01() < 0.5;
        let n1 = if up {
            if n0 >= self.params.l_n {
                return 0;
            }
            n0 + 1
        } else {
            if n0 <= -self.params.l_n {
                return 0;
            }
            n0 - 1
        };
        let d_e = self.delta_e_counter(n0, n1);
        let (work, high_ctx) = if self.params.p6_on {
            let x = self.positions[2 * k];
            let y = self.positions[2 * k + 1];
            let mu = self.mu_at(x, y);
            (if up { mu } else { -mu }, x < 0.5)
        } else {
            (0.0, false)
        };
        if self.accept_move(d_e, work, 0.0, MOVE_P4_BASE) {
            self.n_counter[k] = n1;
            if self.params.p6_on {
                if high_ctx {
                    if up {
                        self.diag.n_plus_h = self.diag.n_plus_h.saturating_add(1);
                    } else {
                        self.diag.n_minus_h = self.diag.n_minus_h.saturating_add(1);
                    }
                } else if up {
                    self.diag.n_plus_l = self.diag.n_plus_l.saturating_add(1);
                } else {
                    self.diag.n_minus_l = self.diag.n_minus_l.saturating_add(1);
                }
            }
            return if up { 1 } else { -1 };
        }
        0
    }

    fn p2_write_step(&mut self) -> i8 {
        if self.n == 0 {
            return 0;
        }
        let k = (self.rand_u32() as usize) % self.n;
        let a0 = self.a_counter[k];
        let up = self.rand01() < 0.5;
        let a1 = if up {
            if a0 >= self.params.l_a {
                return 0;
            }
            a0 + 1
        } else {
            if a0 == 0 {
                return 0;
            }
            a0 - 1
        };
        let d_e = self.delta_e_apparatus(a0, a1);
        let (work, high_ctx) = if self.params.p6_on {
            let x = self.positions[2 * k];
            let y = self.positions[2 * k + 1];
            let mu = self.mu_at(x, y);
            (if up { mu } else { -mu }, x < 0.5)
        } else {
            (0.0, false)
        };
        if self.accept_move(d_e, work, 0.0, MOVE_P2_BASE) {
            self.a_counter[k] = a1;
            if self.params.p6_on {
                if high_ctx {
                    if up {
                        self.diag.a_plus_h = self.diag.a_plus_h.saturating_add(1);
                    } else {
                        self.diag.a_minus_h = self.diag.a_minus_h.saturating_add(1);
                    }
                } else if up {
                    self.diag.a_plus_l = self.diag.a_plus_l.saturating_add(1);
                } else {
                    self.diag.a_minus_l = self.diag.a_minus_l.saturating_add(1);
                }
            }
            return if up { 1 } else { -1 };
        }
        0
    }

    fn p5_write_step(&mut self) -> i8 {
        let g = self.params.grid_size as usize;
        if g == 0 {
            return 0;
        }
        let idx = (self.rand_u32() as usize) % (g * g);
        let s0 = self.s_field[idx];
        let mismatch_bin = if self.params.meta_layers > 0 {
            let lower = self.meta_field[idx];
            Self::mismatch_bin(s0, lower)
        } else {
            1
        };
        let k_dir = self.op_k_dir(0, idx);
        let g_f = self.params.grid_size as f32;
        let x = ((idx % g as usize) as f32 + 0.5) / g_f;
        let y = ((idx / g as usize) as f32 + 0.5) / g_f;
        let up = self.rand01() < 0.5;
        let s1 = if up {
            if s0 >= self.params.l_s {
                return 0;
            }
            s0 + 1
        } else {
            if s0 == 0 {
                return 0;
            }
            s0 - 1
        };
        let mut d_e = self.delta_e_field(s0, s1);
        if self.params.s_coupling_mode == 0 {
            d_e += self.delta_e_s_couple_level(0, idx, s0, s1);
        } else {
            d_e += self.params.eta * self.delta_raw_s_op(0, idx, s0, s1);
        }
        let (work, high_ctx) = if self.params.p6_on {
            let mu = self.mu_at(x, y);
            let scaled = mu * self.params.p6_s_factor;
            (if up { scaled } else { -scaled }, x < 0.5)
        } else {
            (0.0, false)
        };
        let align_work = self.drive_align_work(0, idx, s0, s1, x, y);
        let ep_before = self.ep_exact_total;
        if self.accept_move(d_e, work + align_work, 0.0, MOVE_P5_BASE) {
            self.s_field[idx] = s1;
            self.sum_s += if up { 1 } else { -1 };
            let ep_delta = self.ep_exact_total - ep_before;
            self.accept_log_push(
                self.step_count,
                idx as u32,
                MOVE_P5_BASE as u8,
                255,
                mismatch_bin,
                k_dir,
                ep_delta,
            );
            if self.params.p6_on {
                if high_ctx {
                    if up {
                        self.diag.s_plus_h = self.diag.s_plus_h.saturating_add(1);
                    } else {
                        self.diag.s_minus_h = self.diag.s_minus_h.saturating_add(1);
                    }
                } else if up {
                    self.diag.s_plus_l = self.diag.s_plus_l.saturating_add(1);
                } else {
                    self.diag.s_minus_l = self.diag.s_minus_l.saturating_add(1);
                }
            }
            return if up { 1 } else { -1 };
        }
        0
    }

    fn p5_write_step_meta(&mut self, layer: usize) -> i8 {
        let g = self.params.grid_size as usize;
        if g == 0 || layer >= self.params.meta_layers as usize {
            return 0;
        }
        let cells = g * g;
        let base = layer * cells;
        let idx_local = (self.rand_u32() as usize) % cells;
        let idx = base + idx_local;
        let s0 = self.meta_field[idx];
        let lower = if layer == 0 {
            self.s_field[idx_local]
        } else {
            self.meta_field[(layer - 1) * cells + idx_local]
        };
        let mismatch_bin = Self::mismatch_bin(s0, lower);
        let k_dir = self.op_k_dir(layer, idx_local);
        let (x, y) = grid_cell_center(idx_local, g);
        // When gated, only allow P5 updates in the active quadrant.
        if self.params.repair_clock_gated && !self.clock_gate_allows(x, y) {
            return 0;
        }
        let up = self.rand01() < 0.5;
        let s1 = if up {
            if s0 >= self.params.l_s {
                return 0;
            }
            s0 + 1
        } else {
            if s0 == 0 {
                return 0;
            }
            s0 - 1
        };
        let mut d_e = self.delta_e_field(s0, s1);
        if self.params.s_coupling_mode == 0 {
            d_e += self.delta_e_s_couple_level(layer + 1, idx_local, s0, s1);
        } else {
            d_e += self.params.eta * self.delta_raw_s_op(layer + 1, idx_local, s0, s1);
        }
        let (work, high_ctx) = if self.params.p6_on {
            let mu = self.mu_at(x, y);
            let scaled = mu * self.params.p6_s_factor;
            (if up { scaled } else { -scaled }, x < 0.5)
        } else {
            (0.0, false)
        };
        let align_work = self.drive_align_work(layer + 1, idx_local, s0, s1, x, y);
        let ep_before = self.ep_exact_total;
        if self.accept_move(d_e, work + align_work, 0.0, MOVE_P5_META) {
            self.meta_field[idx] = s1;
            let ep_delta = self.ep_exact_total - ep_before;
            self.accept_log_push(
                self.step_count,
                idx_local as u32,
                MOVE_P5_META as u8,
                layer as u8,
                mismatch_bin,
                k_dir,
                ep_delta,
            );
            if self.params.p6_on {
                if high_ctx {
                    if up {
                        self.diag.s_plus_h = self.diag.s_plus_h.saturating_add(1);
                    } else {
                        self.diag.s_minus_h = self.diag.s_minus_h.saturating_add(1);
                    }
                } else if up {
                    self.diag.s_plus_l = self.diag.s_plus_l.saturating_add(1);
                } else {
                    self.diag.s_minus_l = self.diag.s_minus_l.saturating_add(1);
                }
            }
            return if up { 1 } else { -1 };
        }
        0
    }

    fn p5_write_step_opk(&mut self, interface: usize) -> i8 {
        if !self.params.op_coupling_on {
            return 0;
        }
        let layers = self.params.meta_layers as usize;
        if layers == 0 || interface >= layers {
            return 0;
        }
        let g = self.params.grid_size as usize;
        if g == 0 {
            return 0;
        }
        let r_count = self.op_r_count_internal();
        if r_count < 2 || self.op_k.is_empty() {
            return 0;
        }
        let cells = g * g;
        let q = (self.rand_u32() as usize) % cells;
        let r_from = (self.rand_u32() as usize) % r_count;
        let mut r_to = (self.rand_u32() as usize) % (r_count - 1);
        if r_to >= r_from {
            r_to += 1;
        }
        let idx_from = self.op_k_index(interface, q, r_from);
        if self.op_k[idx_from] == 0 {
            return 0;
        }
        let idx_to = self.op_k_index(interface, q, r_to);
        let delta_raw = self.delta_raw_k_op(interface, q, r_from, r_to);
        let mut d_e = 0.0;
        if self.params.s_coupling_mode == 1 {
            d_e = self.params.eta * delta_raw;
        }
        let mut work = 0.0;
        if self.params.p6_on && self.params.op_drive_on_k && self.params.s_coupling_mode == 1 {
            let (x, y) = grid_cell_center(q, g);
            let mu_scale = self.mu_at(x, y).abs();
            let scale = self.params.l_s.max(1) as f32;
            work = -self.params.eta_drive * delta_raw * scale * scale * mu_scale;
        }
        let ep_before = self.ep_exact_total;
        if self.accept_move(d_e, work, 0.0, MOVE_OPK) {
            self.op_k[idx_from] = self.op_k[idx_from].saturating_sub(1);
            self.op_k[idx_to] = self.op_k[idx_to].saturating_add(1);
            let ep_delta = self.ep_exact_total - ep_before;
            self.accept_log_push(
                self.step_count,
                q as u32,
                MOVE_OPK as u8,
                0,
                r_from as u8,
                r_to as u8,
                ep_delta,
            );
        }
        0
    }

    fn p4_write_step_meta(&mut self, layer: usize) -> i8 {
        let g = self.params.grid_size as usize;
        if self.params.clock_on && self.params.clock_frac > 0.0 {
            if self.rand01() < self.params.clock_frac {
                self.clock_step();
                return 0;
            }
        }
        if g == 0 || layer >= self.params.meta_layers as usize {
            return 0;
        }
        let cells = g * g;
        let base = layer * cells;
        let idx_local = (self.rand_u32() as usize) % cells;
        let idx = base + idx_local;
        let n0 = self.meta_n_field[idx];
        let up = self.rand01() < 0.5;
        let n1 = if up {
            if n0 >= self.params.l_n {
                return 0;
            }
            n0 + 1
        } else {
            if n0 <= -self.params.l_n {
                return 0;
            }
            n0 - 1
        };
        let mut d_e = self.delta_e_counter(n0, n1);
        d_e += self.delta_e_meta_n_couple(layer, idx_local, n0, n1);
        let (work, high_ctx) = if self.params.p6_on {
            let (x, y) = grid_cell_center(idx_local, g);
            let mu = self.mu_at(x, y);
            (if up { mu } else { -mu }, x < 0.5)
        } else {
            (0.0, false)
        };
        if self.accept_move(d_e, work, 0.0, MOVE_P4_META) {
            self.meta_n_field[idx] = n1;
            if self.params.p6_on {
                if high_ctx {
                    if up {
                        self.diag.n_plus_h = self.diag.n_plus_h.saturating_add(1);
                    } else {
                        self.diag.n_minus_h = self.diag.n_minus_h.saturating_add(1);
                    }
                } else if up {
                    self.diag.n_plus_l = self.diag.n_plus_l.saturating_add(1);
                } else {
                    self.diag.n_minus_l = self.diag.n_minus_l.saturating_add(1);
                }
            }
            return if up { 1 } else { -1 };
        }
        0
    }

    fn p2_write_step_meta(&mut self, layer: usize) -> i8 {
        let g = self.params.grid_size as usize;
        if g == 0 || layer >= self.params.meta_layers as usize {
            return 0;
        }
        let cells = g * g;
        let base = layer * cells;
        let idx_local = (self.rand_u32() as usize) % cells;
        let idx = base + idx_local;
        let a0 = self.meta_a_field[idx];
        let up = self.rand01() < 0.5;
        let a1 = if up {
            if a0 >= self.params.l_a {
                return 0;
            }
            a0 + 1
        } else {
            if a0 == 0 {
                return 0;
            }
            a0 - 1
        };
        let mut d_e = self.delta_e_apparatus(a0, a1);
        d_e += self.delta_e_meta_a_couple(layer, idx_local, a0, a1);
        let (work, high_ctx) = if self.params.p6_on {
            let (x, y) = grid_cell_center(idx_local, g);
            let mu = self.mu_at(x, y);
            (if up { mu } else { -mu }, x < 0.5)
        } else {
            (0.0, false)
        };
        if self.accept_move(d_e, work, 0.0, MOVE_P2_META) {
            self.meta_a_field[idx] = a1;
            if self.params.p6_on {
                if high_ctx {
                    if up {
                        self.diag.a_plus_h = self.diag.a_plus_h.saturating_add(1);
                    } else {
                        self.diag.a_minus_h = self.diag.a_minus_h.saturating_add(1);
                    }
                } else if up {
                    self.diag.a_plus_l = self.diag.a_plus_l.saturating_add(1);
                } else {
                    self.diag.a_minus_l = self.diag.a_minus_l.saturating_add(1);
                }
            }
            return if up { 1 } else { -1 };
        }
        0
    }

    fn p1_write_step_meta(&mut self, layer: usize) -> i8 {
        let g = self.params.grid_size as usize;
        if g == 0 || layer >= self.params.meta_layers as usize {
            return 0;
        }
        let edges_per_layer = meta_edge_count(g);
        if edges_per_layer == 0 {
            return 0;
        }
        let base = layer * edges_per_layer;
        let edge = (self.rand_u32() as usize) % edges_per_layer;
        let idx = base + edge;
        let w0 = self.meta_w_edges[idx];
        let up = self.rand01() < 0.5;
        let w1 = if up {
            if w0 >= self.params.l_w {
                return 0;
            }
            w0 + 1
        } else {
            if w0 == 0 {
                return 0;
            }
            w0 - 1
        };
        let w0f = w0 as f32;
        let w1f = w1 as f32;
        let mut d_e = 0.5 * self.params.lambda_w * (w1f * w1f - w0f * w0f);
        d_e += self.delta_e_meta_w_couple(layer, edge, w0, w1);
        let (work, high_ctx) = if self.params.p6_on {
            let (mx, my) = meta_edge_midpoint(edge, g);
            let mu = self.mu_at(mx, my);
            (if up { mu } else { -mu }, mx < 0.5)
        } else {
            (0.0, false)
        };
        if self.accept_move(d_e, work, 0.0, MOVE_P1_META) {
            self.meta_w_edges[idx] = w1;
            if self.params.p6_on {
                if high_ctx {
                    if up {
                        self.diag.w_plus_h = self.diag.w_plus_h.saturating_add(1);
                    } else {
                        self.diag.w_minus_h = self.diag.w_minus_h.saturating_add(1);
                    }
                } else if up {
                    self.diag.w_plus_l = self.diag.w_plus_l.saturating_add(1);
                } else {
                    self.diag.w_minus_l = self.diag.w_minus_l.saturating_add(1);
                }
            }
            return if up { 1 } else { -1 };
        }
        0
    }

    fn protocol_step(&mut self, step_diag: &mut StepDiag) {
        let mut kernels = [0u8; 5];
        let mut len = 0usize;
        kernels[len] = 0; // X
        len += 1;
        if self.params.p_write > 0.0 {
            kernels[len] = 1;
            len += 1;
        }
        if self.params.p_a_write > 0.0 {
            kernels[len] = 2;
            len += 1;
        }
        if self.params.p_n_write > 0.0 {
            kernels[len] = 3;
            len += 1;
        }
        if self.params.p_s_write > 0.0 {
            kernels[len] = 4;
            len += 1;
        }
        if len == 0 {
            return;
        }
        if self.p3_cycle_len != len as u8 {
            self.p3_cycle_len = len as u8;
            self.phase = 0;
            self.p3_obs1 = vec![0.0; len];
            self.p3_obs2 = vec![0.0; len];
            self.p3_start_positions = self.positions.clone();
        }
        if self.phase == 0 && self.p3_start_positions.len() != self.positions.len() {
            self.p3_start_positions = self.positions.clone();
        }
        let idx = (self.phase as usize) % len;
        match kernels[idx] {
            0 => self.x_move_step(),
            1 => {
                let delta = if self.params.meta_layers == 0 {
                    self.p1_write_step()
                } else {
                    let target = self.pick_write_target();
                    if target == 0 {
                        self.p1_write_step()
                    } else {
                        self.p1_write_step_meta((target - 1) as usize)
                    }
                };
                if delta > 0 {
                    step_diag.w_plus = 1;
                } else if delta < 0 {
                    step_diag.w_minus = 1;
                }
            }
            2 => {
                let delta = if self.params.meta_layers == 0 {
                    self.p2_write_step()
                } else {
                    let target = self.pick_write_target();
                    if target == 0 {
                        self.p2_write_step()
                    } else {
                        self.p2_write_step_meta((target - 1) as usize)
                    }
                };
                if delta > 0 {
                    step_diag.a_plus = 1;
                } else if delta < 0 {
                    step_diag.a_minus = 1;
                }
            }
            3 => {
                let delta = if self.params.meta_layers == 0 {
                    self.p4_write_step()
                } else {
                    let target = self.pick_write_target();
                    if target == 0 {
                        self.p4_write_step()
                    } else {
                        self.p4_write_step_meta((target - 1) as usize)
                    }
                };
                if delta > 0 {
                    step_diag.n_plus = 1;
                } else if delta < 0 {
                    step_diag.n_minus = 1;
                }
            }
            4 => {
                let delta = if self.params.meta_layers == 0 {
                    self.p5_write_step()
                } else if self.params.op_coupling_on {
                    let target = self.pick_p5_target_op();
                    let layers = self.params.meta_layers as usize;
                    if target == 0 {
                        self.p5_write_step()
                    } else if target <= layers {
                        self.p5_write_step_meta((target - 1) as usize)
                    } else {
                        self.p5_write_step_opk(target - (layers + 1))
                    }
                } else {
                    let target = self.pick_write_target();
                    if target == 0 {
                        self.p5_write_step()
                    } else {
                        self.p5_write_step_meta((target - 1) as usize)
                    }
                };
                if delta > 0 {
                    step_diag.s_plus = 1;
                } else if delta < 0 {
                    step_diag.s_minus = 1;
                }
            }
            _ => {}
        }
        if idx < self.p3_obs1.len() {
            self.p3_obs1[idx] = self.sum_w as f32;
            self.p3_obs2[idx] = self.sum_s as f32;
        }
        self.phase = self.phase.wrapping_add(1);
        if self.phase as usize >= len {
            self.phase = 0;
            self.update_p3_cycle_diagnostics();
            self.p3_start_positions = self.positions.clone();
        }
    }

    fn update_p3_cycle_diagnostics(&mut self) {
        if self.p3_start_positions.len() != self.positions.len() || self.n == 0 {
            return;
        }
        let mut dx = 0.0f32;
        let mut dy = 0.0f32;
        for i in 0..self.n {
            let x0 = self.p3_start_positions[2 * i];
            let y0 = self.p3_start_positions[2 * i + 1];
            let x1 = self.positions[2 * i];
            let y1 = self.positions[2 * i + 1];
            let (ddx, ddy) = torus_delta(x0, y0, x1, y1);
            dx += ddx;
            dy += ddy;
        }
        let n_inv = 1.0 / (self.n as f32);
        self.p3_disp_x = dx * n_inv;
        self.p3_disp_y = dy * n_inv;
        self.p3_disp_mag = (self.p3_disp_x * self.p3_disp_x + self.p3_disp_y * self.p3_disp_y).sqrt();

        let len = self.p3_obs1.len();
        if len >= 2 {
            let mut area = 0.0f32;
            for i in 0..len {
                let j = (i + 1) % len;
                area += self.p3_obs1[i] * self.p3_obs2[j] - self.p3_obs1[j] * self.p3_obs2[i];
            }
            self.p3_loop_area = 0.5 * area;
        }
    }

    fn accept_move(&mut self, delta_e: f32, work: f32, log_q_ratio: f32, move_kind: usize) -> bool {
        let effective = delta_e - work;
        let log_a_ratio = -self.params.beta * effective;
        let accepted = if effective <= 0.0 {
            true
        } else {
            let a = log_a_ratio.exp();
            self.rand01() < a.min(1.0)
        };
        if accepted {
            self.ep_naive_total += log_a_ratio as f64;
            self.ep_exact_total += (log_a_ratio + log_q_ratio) as f64;
            if move_kind < MOVE_KIND_COUNT {
                self.ep_naive_by_move[move_kind] += log_a_ratio as f64;
                self.ep_exact_by_move[move_kind] += (log_a_ratio + log_q_ratio) as f64;
            }
            if self.params.ep_debug {
                self.ep_q_stats[move_kind].record(log_q_ratio);
            }
        }
        accepted
    }

    fn maybe_code_noise(&mut self) {
        if self.params.code_noise_rate <= 0.0 {
            return;
        }
        let layers = self.params.meta_layers as usize;
        if layers == 0 {
            return;
        }
        if self.rand01() >= self.params.code_noise_rate {
            return;
        }
        let g = self.params.grid_size as usize;
        if g == 0 {
            return;
        }
        let cells = g * g;
        let layer = self.params.code_noise_layer as usize;
        if layer >= layers {
            return;
        }
        let base = layer * cells;
        let max_val = self.params.l_s as u32 + 1;
        let batch = self.params.code_noise_batch.max(1) as usize;
        for _ in 0..batch {
            let idx = base + ((self.rand_u32() as usize) % cells);
            let val = if max_val == 0 {
                0
            } else {
                (self.rand_u32() % max_val) as u8
            };
            self.meta_field[idx] = val;
        }
    }

    fn delta_e_write(&self, w0: u8, w1: u8, r: f32) -> f32 {
        let w0f = w0 as f32;
        let w1f = w1 as f32;
        let e_w0 = 0.5 * self.params.lambda_w * w0f * w0f;
        let e_w1 = 0.5 * self.params.lambda_w * w1f * w1f;
        let bond_shape = 0.5 * self.params.kappa_bond * (r - self.params.r_star).powi(2);
        (e_w1 - e_w0) + bond_shape * (w1f - w0f)
    }

    fn delta_e_counter(&self, n0: i16, n1: i16) -> f32 {
        let n0f = n0 as f32;
        let n1f = n1 as f32;
        let e0 = 0.5 * self.params.lambda_n * n0f * n0f;
        let e1 = 0.5 * self.params.lambda_n * n1f * n1f;
        e1 - e0
    }

    fn delta_e_apparatus(&self, a0: u16, a1: u16) -> f32 {
        let a0f = a0 as f32;
        let a1f = a1 as f32;
        let e0 = 0.5 * self.params.lambda_a * a0f * a0f;
        let e1 = 0.5 * self.params.lambda_a * a1f * a1f;
        e1 - e0
    }

    fn delta_e_field(&self, s0: u8, s1: u8) -> f32 {
        let s0f = s0 as f32;
        let s1f = s1 as f32;
        let e0 = 0.5 * self.params.lambda_s * s0f * s0f;
        let e1 = 0.5 * self.params.lambda_s * s1f * s1f;
        e1 - e0
    }

    fn delta_e_s_couple_level(&self, level: usize, idx: usize, s0: u8, s1: u8) -> f32 {
        let layers = self.params.meta_layers as usize;
        if self.params.eta == 0.0 || layers == 0 {
            return 0.0;
        }
        let denom = self.params.l_s.max(1) as f32;
        let s0n = (s0 as f32) / denom;
        let s1n = (s1 as f32) / denom;
        let g = self.params.grid_size as usize;
        let cells = g * g;
        let mut delta = 0.0;
        if level > 0 {
            let neighbor = if level == 1 {
                self.s_field[idx]
            } else {
                self.meta_field[(level - 2) * cells + idx]
            };
            let nn = (neighbor as f32) / denom;
            delta += 0.5 * self.params.eta * ((s1n - nn).powi(2) - (s0n - nn).powi(2));
        }
        if level < layers {
            let neighbor = self.meta_field[level * cells + idx];
            let nn = (neighbor as f32) / denom;
            delta += 0.5 * self.params.eta * ((s1n - nn).powi(2) - (s0n - nn).powi(2));
        }
        delta
    }

    fn delta_s_mismatch_level(&self, level: usize, idx: usize, s0: u8, s1: u8) -> f32 {
        let layers = self.params.meta_layers as usize;
        if layers == 0 {
            return 0.0;
        }
        let denom = self.params.l_s.max(1) as f32;
        let s0n = (s0 as f32) / denom;
        let s1n = (s1 as f32) / denom;
        let g = self.params.grid_size as usize;
        let cells = g * g;
        let mut delta = 0.0;
        if level > 0 {
            let neighbor = if level == 1 {
                self.s_field[idx]
            } else {
                self.meta_field[(level - 2) * cells + idx]
            };
            let nn = (neighbor as f32) / denom;
            delta += 0.5 * ((s1n - nn).powi(2) - (s0n - nn).powi(2));
        }
        if level < layers {
            let neighbor = self.meta_field[level * cells + idx];
            let nn = (neighbor as f32) / denom;
            delta += 0.5 * ((s1n - nn).powi(2) - (s0n - nn).powi(2));
        }
        delta
    }

    fn drive_align_work(&self, level: usize, idx: usize, s0: u8, s1: u8, x: f32, y: f32) -> f32 {
        if !self.params.p6_on || self.params.eta_drive == 0.0 {
            return 0.0;
        }
        if self.params.repair_clock_gated && level == 0 {
            return 0.0;
        }
        let gated = self.params.repair_clock_gated && level > 0;
        if gated && !self.clock_gate_allows(x, y) {
            return 0.0;
        }
        let delta = if self.params.s_coupling_mode == 1 {
            self.delta_raw_s_op(level, idx, s0, s1)
        } else {
            self.delta_s_mismatch_level(level, idx, s0, s1)
        };
        let scale = self.params.l_s.max(1) as f32;
        // Boost work under quadrant gating to offset reduced coverage.
        let gate_scale = if gated { 16.0 } else { 1.0 };
        let mu_scale = self.mu_at(x, y).abs();
        -self.params.eta_drive * delta * scale * scale * gate_scale * mu_scale
    }

    fn delta_e_meta_a_couple(&self, layer: usize, idx: usize, a0: u16, a1: u16) -> f32 {
        let layers = self.params.meta_layers as usize;
        if self.params.eta == 0.0 || layers < 2 {
            return 0.0;
        }
        let denom = self.params.l_a.max(1) as f32;
        let a0n = (a0 as f32) / denom;
        let a1n = (a1 as f32) / denom;
        let g = self.params.grid_size as usize;
        let cells = g * g;
        let mut delta = 0.0;
        if layer > 0 {
            let neighbor = self.meta_a_field[(layer - 1) * cells + idx];
            let nn = (neighbor as f32) / denom;
            delta += 0.5 * self.params.eta * ((a1n - nn).powi(2) - (a0n - nn).powi(2));
        }
        if layer + 1 < layers {
            let neighbor = self.meta_a_field[(layer + 1) * cells + idx];
            let nn = (neighbor as f32) / denom;
            delta += 0.5 * self.params.eta * ((a1n - nn).powi(2) - (a0n - nn).powi(2));
        }
        delta
    }

    fn delta_e_meta_n_couple(&self, layer: usize, idx: usize, n0: i16, n1: i16) -> f32 {
        let layers = self.params.meta_layers as usize;
        if self.params.eta == 0.0 || layers < 2 {
            return 0.0;
        }
        let denom = self.params.l_n.max(1) as f32;
        let n0n = (n0 as f32) / denom;
        let n1n = (n1 as f32) / denom;
        let g = self.params.grid_size as usize;
        let cells = g * g;
        let mut delta = 0.0;
        if layer > 0 {
            let neighbor = self.meta_n_field[(layer - 1) * cells + idx];
            let nn = (neighbor as f32) / denom;
            delta += 0.5 * self.params.eta * ((n1n - nn).powi(2) - (n0n - nn).powi(2));
        }
        if layer + 1 < layers {
            let neighbor = self.meta_n_field[(layer + 1) * cells + idx];
            let nn = (neighbor as f32) / denom;
            delta += 0.5 * self.params.eta * ((n1n - nn).powi(2) - (n0n - nn).powi(2));
        }
        delta
    }

    fn delta_e_meta_w_couple(&self, layer: usize, edge: usize, w0: u8, w1: u8) -> f32 {
        let layers = self.params.meta_layers as usize;
        if self.params.eta == 0.0 || layers < 2 {
            return 0.0;
        }
        let denom = self.params.l_w.max(1) as f32;
        let w0n = (w0 as f32) / denom;
        let w1n = (w1 as f32) / denom;
        let g = self.params.grid_size as usize;
        let edges = meta_edge_count(g);
        let mut delta = 0.0;
        if layer > 0 {
            let neighbor = self.meta_w_edges[(layer - 1) * edges + edge];
            let nn = (neighbor as f32) / denom;
            delta += 0.5 * self.params.eta * ((w1n - nn).powi(2) - (w0n - nn).powi(2));
        }
        if layer + 1 < layers {
            let neighbor = self.meta_w_edges[(layer + 1) * edges + edge];
            let nn = (neighbor as f32) / denom;
            delta += 0.5 * self.params.eta * ((w1n - nn).powi(2) - (w0n - nn).powi(2));
        }
        delta
    }

    fn mu_at(&self, x: f32, _y: f32) -> f32 {
        if x < 0.5 {
            self.params.mu_high
        } else {
            self.params.mu_low
        }
    }

    fn delta_e_move_particle(&self, i: usize, x0: f32, y0: f32, x1: f32, y1: f32) -> f32 {
        let mut d_rep = 0.0f32;
        let mut d_bond = 0.0f32;
        for j in 0..self.n {
            if j == i {
                continue;
            }
            let xj = self.positions[2 * j];
            let yj = self.positions[2 * j + 1];
            let r0 = torus_dist(x0, y0, xj, yj);
            let r1 = torus_dist(x1, y1, xj, yj);
            d_rep += repulsion_energy(self.params.kappa_rep, self.params.r0, r1)
                - repulsion_energy(self.params.kappa_rep, self.params.r0, r0);

            let (a, b) = if i < j { (i, j) } else { (j, i) };
            let w = self.w[edge_index(self.n, a, b)];
            if w > 0 {
                let wf = w as f32;
                let bond0 = 0.5 * self.params.kappa_bond * wf * (r0 - self.params.r_star).powi(2);
                let bond1 = 0.5 * self.params.kappa_bond * wf * (r1 - self.params.r_star).powi(2);
                d_bond += bond1 - bond0;
            }
        }
        d_rep + d_bond
    }

    fn energy_breakdown_inner(&self) -> (f32, f32, f32, f32, f32, f32, f32) {
        let mut u_rep = 0.0f32;
        let mut u_bond = 0.0f32;
        let mut e_w = 0.0f32;
        let mut e_n = 0.0f32;
        let mut e_a = 0.0f32;
        let mut e_s = 0.0f32;

        for i in 0..self.n {
            for j in (i + 1)..self.n {
                let r = torus_dist(
                    self.positions[2 * i],
                    self.positions[2 * i + 1],
                    self.positions[2 * j],
                    self.positions[2 * j + 1],
                );
                u_rep += repulsion_energy(self.params.kappa_rep, self.params.r0, r);
                let w = self.w[edge_index(self.n, i, j)] as f32;
                if w > 0.0 {
                    u_bond += 0.5 * self.params.kappa_bond * w * (r - self.params.r_star).powi(2);
                }
            }
        }

        for &w in &self.w {
            let wf = w as f32;
            e_w += 0.5 * self.params.lambda_w * wf * wf;
        }

        for &n in &self.n_counter {
            let nf = n as f32;
            e_n += 0.5 * self.params.lambda_n * nf * nf;
        }

        for &a in &self.a_counter {
            let af = a as f32;
            e_a += 0.5 * self.params.lambda_a * af * af;
        }

        for &s in &self.s_field {
            let sf = s as f32;
            e_s += 0.5 * self.params.lambda_s * sf * sf;
        }

        for &w in &self.meta_w_edges {
            let wf = w as f32;
            e_w += 0.5 * self.params.lambda_w * wf * wf;
        }

        for &n in &self.meta_n_field {
            let nf = n as f32;
            e_n += 0.5 * self.params.lambda_n * nf * nf;
        }

        for &a in &self.meta_a_field {
            let af = a as f32;
            e_a += 0.5 * self.params.lambda_a * af * af;
        }

        for &s in &self.meta_field {
            let sf = s as f32;
            e_s += 0.5 * self.params.lambda_s * sf * sf;
        }

        let total = u_rep + u_bond + e_w + e_n + e_a + e_s;
        (u_rep, u_bond, e_w, e_n, e_a, e_s, total)
    }

    fn w_histogram(&self) -> Uint32Array {
        let bins = (self.params.l_w as usize) + 1;
        let mut hist = vec![0u32; bins];
        for &w in &self.w {
            let idx = (w as usize).min(bins - 1);
            hist[idx] += 1;
        }
        Uint32Array::from(hist.as_slice())
    }

    fn s_histogram(&self) -> Uint32Array {
        let bins = (self.params.l_s as usize) + 1;
        let mut hist = vec![0u32; bins];
        for &s in &self.s_field {
            let idx = (s as usize).min(bins - 1);
            hist[idx] += 1;
        }
        Uint32Array::from(hist.as_slice())
    }
}

#[derive(Clone, Copy, Default)]
struct EpQStats {
    count: u64,
    sum: f64,
    max_abs: f64,
}

impl EpQStats {
    fn record(&mut self, value: f32) {
        let v = value as f64;
        self.count = self.count.saturating_add(1);
        self.sum += v;
        let abs = v.abs();
        if abs > self.max_abs {
            self.max_abs = abs;
        }
    }
}

#[derive(Clone, Copy, Default)]
struct StepDiag {
    w_plus: u32,
    w_minus: u32,
    n_plus: u32,
    n_minus: u32,
    a_plus: u32,
    a_minus: u32,
    s_plus: u32,
    s_minus: u32,
    w_plus_h: u32,
    w_minus_h: u32,
    w_plus_l: u32,
    w_minus_l: u32,
    n_plus_h: u32,
    n_minus_h: u32,
    n_plus_l: u32,
    n_minus_l: u32,
    a_plus_h: u32,
    a_minus_h: u32,
    a_plus_l: u32,
    a_minus_l: u32,
    s_plus_h: u32,
    s_minus_h: u32,
    s_plus_l: u32,
    s_minus_l: u32,
}

#[derive(Clone, Copy, Default)]
struct DiagTotals {
    steps: u32,
    w_plus: u32,
    w_minus: u32,
    n_plus: u32,
    n_minus: u32,
    a_plus: u32,
    a_minus: u32,
    s_plus: u32,
    s_minus: u32,
    w_plus_h: u32,
    w_minus_h: u32,
    w_plus_l: u32,
    w_minus_l: u32,
    n_plus_h: u32,
    n_minus_h: u32,
    n_plus_l: u32,
    n_minus_l: u32,
    a_plus_h: u32,
    a_minus_h: u32,
    a_plus_l: u32,
    a_minus_l: u32,
    s_plus_h: u32,
    s_minus_h: u32,
    s_plus_l: u32,
    s_minus_l: u32,
}

impl DiagTotals {
    fn push(&mut self, step: StepDiag) {
        self.steps = self.steps.saturating_add(1);
        self.w_plus = self.w_plus.saturating_add(step.w_plus);
        self.w_minus = self.w_minus.saturating_add(step.w_minus);
        self.n_plus = self.n_plus.saturating_add(step.n_plus);
        self.n_minus = self.n_minus.saturating_add(step.n_minus);
        self.a_plus = self.a_plus.saturating_add(step.a_plus);
        self.a_minus = self.a_minus.saturating_add(step.a_minus);
        self.s_plus = self.s_plus.saturating_add(step.s_plus);
        self.s_minus = self.s_minus.saturating_add(step.s_minus);
        self.w_plus_h = self.w_plus_h.saturating_add(step.w_plus_h);
        self.w_minus_h = self.w_minus_h.saturating_add(step.w_minus_h);
        self.w_plus_l = self.w_plus_l.saturating_add(step.w_plus_l);
        self.w_minus_l = self.w_minus_l.saturating_add(step.w_minus_l);
        self.n_plus_h = self.n_plus_h.saturating_add(step.n_plus_h);
        self.n_minus_h = self.n_minus_h.saturating_add(step.n_minus_h);
        self.n_plus_l = self.n_plus_l.saturating_add(step.n_plus_l);
        self.n_minus_l = self.n_minus_l.saturating_add(step.n_minus_l);
        self.a_plus_h = self.a_plus_h.saturating_add(step.a_plus_h);
        self.a_minus_h = self.a_minus_h.saturating_add(step.a_minus_h);
        self.a_plus_l = self.a_plus_l.saturating_add(step.a_plus_l);
        self.a_minus_l = self.a_minus_l.saturating_add(step.a_minus_l);
        self.s_plus_h = self.s_plus_h.saturating_add(step.s_plus_h);
        self.s_minus_h = self.s_minus_h.saturating_add(step.s_minus_h);
        self.s_plus_l = self.s_plus_l.saturating_add(step.s_plus_l);
        self.s_minus_l = self.s_minus_l.saturating_add(step.s_minus_l);
    }

    fn counts(&self) -> (u32, u32, u32, u32, u32, u32, u32, u32, u32) {
        (
            self.w_plus,
            self.w_minus,
            self.n_plus,
            self.n_minus,
            self.a_plus,
            self.a_minus,
            self.s_plus,
            self.s_minus,
            self.steps,
        )
    }

    fn counts_hl(&self) -> (u32, u32, u32, u32, u32, u32, u32, u32, u32, u32, u32, u32, u32, u32, u32, u32) {
        (
            self.w_plus_h,
            self.w_minus_h,
            self.w_plus_l,
            self.w_minus_l,
            self.n_plus_h,
            self.n_minus_h,
            self.n_plus_l,
            self.n_minus_l,
            self.a_plus_h,
            self.a_minus_h,
            self.a_plus_l,
            self.a_minus_l,
            self.s_plus_h,
            self.s_minus_h,
            self.s_plus_l,
            self.s_minus_l,
        )
    }
}

fn diag_flux_affinity(n_plus: u32, n_minus: u32, window: u32) -> (f32, f32, f32) {
    if window == 0 {
        return (0.0, 0.0, 0.0);
    }
    let j = (n_plus as f32 - n_minus as f32) / (window as f32);
    let a = ((n_plus + 1) as f32 / (n_minus + 1) as f32).ln();
    let sigma = j * a;
    (j, a, sigma)
}

fn diag_m6_affinity(nh_plus: u32, nh_minus: u32, nl_plus: u32, nl_minus: u32) -> f32 {
    let a = (nh_plus + 1) as f32;
    let b = (nl_minus + 1) as f32;
    let c = (nh_minus + 1) as f32;
    let d = (nl_plus + 1) as f32;
    (a * b / (c * d)).ln()
}

fn wrap01(mut x: f32) -> f32 {
    if x >= 1.0 {
        x -= 1.0;
    } else if x < 0.0 {
        x += 1.0;
    }
    x
}

fn get_f32(obj: &JsValue, key: &str) -> Option<f32> {
    let v = Reflect::get(obj, &JsValue::from_str(key)).ok()?;
    if v.is_undefined() || v.is_null() {
        return None;
    }
    v.as_f64().map(|n| n as f32)
}

fn get_string(obj: &JsValue, key: &str) -> Option<String> {
    let v = Reflect::get(obj, &JsValue::from_str(key)).ok()?;
    if v.is_undefined() || v.is_null() {
        return None;
    }
    v.as_string()
}

fn get_u8(obj: &JsValue, key: &str) -> Option<u8> {
    let v = Reflect::get(obj, &JsValue::from_str(key)).ok()?;
    if v.is_undefined() || v.is_null() {
        return None;
    }
    let n = v.as_f64()?;
    if !n.is_finite() {
        return None;
    }
    Some(n.round().clamp(0.0, 255.0) as u8)
}

fn get_i16(obj: &JsValue, key: &str) -> Option<i16> {
    let v = Reflect::get(obj, &JsValue::from_str(key)).ok()?;
    if v.is_undefined() || v.is_null() {
        return None;
    }
    let n = v.as_f64()?;
    if !n.is_finite() {
        return None;
    }
    Some(n.round().clamp(-32768.0, 32767.0) as i16)
}

fn get_u16(obj: &JsValue, key: &str) -> Option<u16> {
    let v = Reflect::get(obj, &JsValue::from_str(key)).ok()?;
    if v.is_undefined() || v.is_null() {
        return None;
    }
    let n = v.as_f64()?;
    if !n.is_finite() {
        return None;
    }
    Some(n.round().clamp(0.0, 65535.0) as u16)
}

fn get_u32(obj: &JsValue, key: &str) -> Option<u32> {
    let v = Reflect::get(obj, &JsValue::from_str(key)).ok()?;
    if v.is_undefined() || v.is_null() {
        return None;
    }
    let n = v.as_f64()?;
    if !n.is_finite() {
        return None;
    }
    Some(n.round().clamp(0.0, 4294967295.0) as u32)
}

fn edge_index(n: usize, i: usize, j: usize) -> usize {
    debug_assert!(i < j);
    // Row-major upper-triangle (excluding diagonal):
    // row i has entries (i,i+1)...(i,n-1), length n-i-1.
    let before = i * (2 * n - i - 1) / 2;
    before + (j - i - 1)
}

fn torus_dist(x0: f32, y0: f32, x1: f32, y1: f32) -> f32 {
    let mut dx = x0 - x1;
    let mut dy = y0 - y1;
    if dx > 0.5 {
        dx -= 1.0;
    } else if dx < -0.5 {
        dx += 1.0;
    }
    if dy > 0.5 {
        dy -= 1.0;
    } else if dy < -0.5 {
        dy += 1.0;
    }
    (dx * dx + dy * dy).sqrt()
}

fn torus_delta(x0: f32, y0: f32, x1: f32, y1: f32) -> (f32, f32) {
    let mut dx = x1 - x0;
    let mut dy = y1 - y0;
    if dx > 0.5 {
        dx -= 1.0;
    } else if dx < -0.5 {
        dx += 1.0;
    }
    if dy > 0.5 {
        dy -= 1.0;
    } else if dy < -0.5 {
        dy += 1.0;
    }
    (dx, dy)
}

fn torus_midpoint(x0: f32, y0: f32, x1: f32, y1: f32) -> (f32, f32) {
    let (dx, dy) = torus_delta(x0, y0, x1, y1);
    (wrap01(x0 + 0.5 * dx), wrap01(y0 + 0.5 * dy))
}

fn meta_edge_count(grid: usize) -> usize {
    grid.saturating_mul(grid).saturating_mul(2)
}

fn grid_cell_center(idx: usize, grid: usize) -> (f32, f32) {
    let g = grid as f32;
    let x = (idx % grid) as f32;
    let y = (idx / grid) as f32;
    ((x + 0.5) / g, (y + 0.5) / g)
}

// Edge indexing: 0..g*g are horizontal (cell -> right neighbor), g*g..2*g*g vertical (cell -> down).
fn meta_edge_midpoint(edge: usize, grid: usize) -> (f32, f32) {
    let cells = grid * grid;
    if edge < cells {
        let x = edge % grid;
        let y = edge / grid;
        let x2 = (x + 1) % grid;
        let idx1 = y * grid + x2;
        let (x0, y0) = grid_cell_center(edge, grid);
        let (x1, y1) = grid_cell_center(idx1, grid);
        torus_midpoint(x0, y0, x1, y1)
    } else {
        let local = edge - cells;
        let x = local % grid;
        let y = local / grid;
        let y2 = (y + 1) % grid;
        let idx1 = y2 * grid + x;
        let (x0, y0) = grid_cell_center(local, grid);
        let (x1, y1) = grid_cell_center(idx1, grid);
        torus_midpoint(x0, y0, x1, y1)
    }
}

fn repulsion_energy(kappa_rep: f32, r0: f32, r: f32) -> f32 {
    let d = (r0 - r).max(0.0);
    0.5 * kappa_rep * d * d
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Lcg {
        state: u32,
    }

    impl Lcg {
        fn new(seed: u32) -> Self {
            Self { state: seed }
        }

        fn next_u32(&mut self) -> u32 {
            self.state = self.state.wrapping_mul(1664525).wrapping_add(1013904223);
            self.state
        }

        fn next_usize(&mut self, max: usize) -> usize {
            if max == 0 {
                0
            } else {
                (self.next_u32() as usize) % max
            }
        }

        fn next_u8_range(&mut self, max_inclusive: u8) -> u8 {
            if max_inclusive == 0 {
                0
            } else {
                (self.next_u32() % (max_inclusive as u32 + 1)) as u8
            }
        }

        fn next_u16_range(&mut self, max_inclusive: u16) -> u16 {
            if max_inclusive == 0 {
                0
            } else {
                (self.next_u32() % (max_inclusive as u32 + 1)) as u16
            }
        }

        fn next_i16_range(&mut self, min_inclusive: i16, max_inclusive: i16) -> i16 {
            if min_inclusive >= max_inclusive {
                return min_inclusive;
            }
            let span = (max_inclusive as i32 - min_inclusive as i32 + 1) as u32;
            min_inclusive + (self.next_u32() % span) as i16
        }
    }

    fn coupling_energy_s(
        params: &Params,
        grid: usize,
        meta_layers: usize,
        base_s: &[u8],
        meta_s: &[u8],
    ) -> f64 {
        if params.eta == 0.0 || meta_layers == 0 {
            return 0.0;
        }
        let denom = params.l_s.max(1) as f64;
        let eta = params.eta as f64;
        let cells = grid * grid;
        let mut energy = 0.0;
        for level in 1..=meta_layers {
            let lower = if level == 1 {
                &base_s[..cells]
            } else {
                &meta_s[(level - 2) * cells..(level - 1) * cells]
            };
            let upper = &meta_s[(level - 1) * cells..level * cells];
            for i in 0..cells {
                let a = (lower[i] as f64) / denom;
                let b = (upper[i] as f64) / denom;
                let diff = b - a;
                energy += 0.5 * eta * diff * diff;
            }
        }
        energy
    }

    fn coupling_energy_meta_a(
        params: &Params,
        grid: usize,
        meta_layers: usize,
        meta_a: &[u16],
    ) -> f64 {
        if params.eta == 0.0 || meta_layers < 2 {
            return 0.0;
        }
        let denom = params.l_a.max(1) as f64;
        let eta = params.eta as f64;
        let cells = grid * grid;
        let mut energy = 0.0;
        for layer in 1..meta_layers {
            let lower = &meta_a[(layer - 1) * cells..layer * cells];
            let upper = &meta_a[layer * cells..(layer + 1) * cells];
            for i in 0..cells {
                let a = (lower[i] as f64) / denom;
                let b = (upper[i] as f64) / denom;
                let diff = b - a;
                energy += 0.5 * eta * diff * diff;
            }
        }
        energy
    }

    fn coupling_energy_meta_n(
        params: &Params,
        grid: usize,
        meta_layers: usize,
        meta_n: &[i16],
    ) -> f64 {
        if params.eta == 0.0 || meta_layers < 2 {
            return 0.0;
        }
        let denom = params.l_n.max(1) as f64;
        let eta = params.eta as f64;
        let cells = grid * grid;
        let mut energy = 0.0;
        for layer in 1..meta_layers {
            let lower = &meta_n[(layer - 1) * cells..layer * cells];
            let upper = &meta_n[layer * cells..(layer + 1) * cells];
            for i in 0..cells {
                let a = (lower[i] as f64) / denom;
                let b = (upper[i] as f64) / denom;
                let diff = b - a;
                energy += 0.5 * eta * diff * diff;
            }
        }
        energy
    }

    fn coupling_energy_meta_w(
        params: &Params,
        grid: usize,
        meta_layers: usize,
        meta_w: &[u8],
    ) -> f64 {
        if params.eta == 0.0 || meta_layers < 2 {
            return 0.0;
        }
        let denom = params.l_w.max(1) as f64;
        let eta = params.eta as f64;
        let edges = meta_edge_count(grid);
        let mut energy = 0.0;
        for layer in 1..meta_layers {
            let lower = &meta_w[(layer - 1) * edges..layer * edges];
            let upper = &meta_w[layer * edges..(layer + 1) * edges];
            for i in 0..edges {
                let a = (lower[i] as f64) / denom;
                let b = (upper[i] as f64) / denom;
                let diff = b - a;
                energy += 0.5 * eta * diff * diff;
            }
        }
        energy
    }

    fn fill_random_fields(sim: &mut Sim, rng: &mut Lcg) {
        let l_s = sim.params.l_s;
        let l_w = sim.params.l_w;
        let l_a = sim.params.l_a;
        let l_n = sim.params.l_n;
        for s in &mut sim.s_field {
            *s = rng.next_u8_range(l_s);
        }
        for s in &mut sim.meta_field {
            *s = rng.next_u8_range(l_s);
        }
        for w in &mut sim.meta_w_edges {
            *w = rng.next_u8_range(l_w);
        }
        for a in &mut sim.meta_a_field {
            *a = rng.next_u16_range(l_a);
        }
        for n in &mut sim.meta_n_field {
            *n = rng.next_i16_range(-l_n, l_n);
        }
    }

    fn propose_u8(rng: &mut Lcg, max: u8, current: u8) -> u8 {
        if max == 0 {
            return 0;
        }
        if current == 0 {
            1
        } else if current >= max {
            current - 1
        } else if rng.next_u32() % 2 == 0 {
            current + 1
        } else {
            current - 1
        }
    }

    fn propose_u16(rng: &mut Lcg, max: u16, current: u16) -> u16 {
        if max == 0 {
            return 0;
        }
        if current == 0 {
            1
        } else if current >= max {
            current - 1
        } else if rng.next_u32() % 2 == 0 {
            current + 1
        } else {
            current - 1
        }
    }

    fn propose_i16(rng: &mut Lcg, max: i16, current: i16) -> i16 {
        if max <= 0 {
            return 0;
        }
        if current <= -max {
            current + 1
        } else if current >= max {
            current - 1
        } else if rng.next_u32() % 2 == 0 {
            current + 1
        } else {
            current - 1
        }
    }

    #[test]
    fn test_delta_e_s_couple_matches_energy_diff() {
        let mut sim = Sim::new(1, 1);
        let g = 5usize;
        let layers = 3usize;
        sim.params.grid_size = g as u16;
        sim.params.meta_layers = layers as u16;
        sim.params.l_s = 7;
        sim.params.eta = 0.7;
        sim.resize_meta_arrays();

        let mut rng = Lcg::new(1234);
        fill_random_fields(&mut sim, &mut rng);

        let cells = g * g;
        let level = rng.next_usize(layers + 1);
        let idx = rng.next_usize(cells);
        let s0 = if level == 0 {
            sim.s_field[idx]
        } else {
            sim.meta_field[(level - 1) * cells + idx]
        };
        let s1 = propose_u8(&mut rng, sim.params.l_s, s0);
        let delta = sim.delta_e_s_couple_level(level, idx, s0, s1);

        let base_before = sim.s_field.clone();
        let meta_before = sim.meta_field.clone();
        let mut base_after = base_before.clone();
        let mut meta_after = meta_before.clone();
        if level == 0 {
            base_after[idx] = s1;
        } else {
            meta_after[(level - 1) * cells + idx] = s1;
        }

        let e_before = coupling_energy_s(&sim.params, g, layers, &base_before, &meta_before);
        let e_after = coupling_energy_s(&sim.params, g, layers, &base_after, &meta_after);
        let diff = (e_after - e_before - delta as f64).abs();
        assert!(diff < 1e-5);
    }

    #[test]
    fn test_delta_e_meta_a_couple_matches_energy_diff() {
        let mut sim = Sim::new(1, 1);
        let g = 5usize;
        let layers = 3usize;
        sim.params.grid_size = g as u16;
        sim.params.meta_layers = layers as u16;
        sim.params.l_a = 9;
        sim.params.eta = 0.7;
        sim.resize_meta_arrays();

        let mut rng = Lcg::new(5678);
        fill_random_fields(&mut sim, &mut rng);

        let cells = g * g;
        let layer = rng.next_usize(layers);
        let idx = rng.next_usize(cells);
        let a0 = sim.meta_a_field[layer * cells + idx];
        let a1 = propose_u16(&mut rng, sim.params.l_a, a0);
        let delta = sim.delta_e_meta_a_couple(layer, idx, a0, a1);

        let meta_before = sim.meta_a_field.clone();
        let mut meta_after = meta_before.clone();
        meta_after[layer * cells + idx] = a1;

        let e_before = coupling_energy_meta_a(&sim.params, g, layers, &meta_before);
        let e_after = coupling_energy_meta_a(&sim.params, g, layers, &meta_after);
        let diff = (e_after - e_before - delta as f64).abs();
        assert!(diff < 1e-5);
    }

    #[test]
    fn test_delta_e_meta_n_couple_matches_energy_diff() {
        let mut sim = Sim::new(1, 1);
        let g = 5usize;
        let layers = 3usize;
        sim.params.grid_size = g as u16;
        sim.params.meta_layers = layers as u16;
        sim.params.l_n = 7;
        sim.params.eta = 0.7;
        sim.resize_meta_arrays();

        let mut rng = Lcg::new(9012);
        fill_random_fields(&mut sim, &mut rng);

        let cells = g * g;
        let layer = rng.next_usize(layers);
        let idx = rng.next_usize(cells);
        let n0 = sim.meta_n_field[layer * cells + idx];
        let n1 = propose_i16(&mut rng, sim.params.l_n, n0);
        let delta = sim.delta_e_meta_n_couple(layer, idx, n0, n1);

        let meta_before = sim.meta_n_field.clone();
        let mut meta_after = meta_before.clone();
        meta_after[layer * cells + idx] = n1;

        let e_before = coupling_energy_meta_n(&sim.params, g, layers, &meta_before);
        let e_after = coupling_energy_meta_n(&sim.params, g, layers, &meta_after);
        let diff = (e_after - e_before - delta as f64).abs();
        assert!(diff < 1e-5);
    }

    #[test]
    fn test_delta_e_meta_w_couple_matches_energy_diff() {
        let mut sim = Sim::new(1, 1);
        let g = 5usize;
        let layers = 3usize;
        sim.params.grid_size = g as u16;
        sim.params.meta_layers = layers as u16;
        sim.params.l_w = 8;
        sim.params.eta = 0.7;
        sim.resize_meta_arrays();

        let mut rng = Lcg::new(3456);
        fill_random_fields(&mut sim, &mut rng);

        let edges = meta_edge_count(g);
        let layer = rng.next_usize(layers);
        let edge = rng.next_usize(edges);
        let w0 = sim.meta_w_edges[layer * edges + edge];
        let w1 = propose_u8(&mut rng, sim.params.l_w, w0);
        let delta = sim.delta_e_meta_w_couple(layer, edge, w0, w1);

        let meta_before = sim.meta_w_edges.clone();
        let mut meta_after = meta_before.clone();
        meta_after[layer * edges + edge] = w1;

        let e_before = coupling_energy_meta_w(&sim.params, g, layers, &meta_before);
        let e_after = coupling_energy_meta_w(&sim.params, g, layers, &meta_after);
        let diff = (e_after - e_before - delta as f64).abs();
        assert!(diff < 1e-5);
    }
}
