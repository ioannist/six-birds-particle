/* tslint:disable */
/* eslint-disable */

export class Sim {
  free(): void;
  [Symbol.dispose](): void;
  ep_q_stats(): object;
  meta_field(): Uint8Array;
  op_offsets(): Int8Array;
  op_r_count(): number;
  set_params(params: any): void;
  clock_state(): number;
  diagnostics(): object;
  meta_layers(): number;
  op_budget_k(): number;
  op_k_tokens(): Uint8Array;
  base_s_field(): Uint8Array;
  meta_a_field(): Uint16Array;
  meta_n_field(): Int16Array;
  meta_w_edges(): Uint8Array;
  accept_log_ep(): Float64Array;
  op_interfaces(): number;
  op_stencil_id(): number;
  accept_log_len(): number;
  accept_log_u32(): Uint32Array;
  ep_exact_total(): number;
  ep_move_labels(): Array<any>;
  ep_naive_total(): number;
  meta_edge_count(): number;
  accept_log_clear(): void;
  energy_breakdown(): object;
  ep_exact_by_move(): Float64Array;
  ep_naive_by_move(): Float64Array;
  apply_perturbation(params: any): void;
  n(): number;
  accept_log_overflowed(): boolean;
  constructor(n: number, seed: number);
  step(steps: number): void;
  bonds(threshold: number): Uint32Array;
  field(): Uint8Array;
  clock_q(): bigint;
  counters(): Int16Array;
  ep_total(): number;
  apparatus(): Uint16Array;
  clock_bwd(): bigint;
  clock_fwd(): bigint;
  positions(): Float32Array;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly __wbg_sim_free: (a: number, b: number) => void;
  readonly sim_accept_log_clear: (a: number) => void;
  readonly sim_accept_log_ep: (a: number) => any;
  readonly sim_accept_log_len: (a: number) => number;
  readonly sim_accept_log_overflowed: (a: number) => number;
  readonly sim_accept_log_u32: (a: number) => any;
  readonly sim_apparatus: (a: number) => any;
  readonly sim_apply_perturbation: (a: number, b: any) => void;
  readonly sim_base_s_field: (a: number) => any;
  readonly sim_bonds: (a: number, b: number) => any;
  readonly sim_clock_bwd: (a: number) => bigint;
  readonly sim_clock_fwd: (a: number) => bigint;
  readonly sim_clock_q: (a: number) => bigint;
  readonly sim_clock_state: (a: number) => number;
  readonly sim_counters: (a: number) => any;
  readonly sim_diagnostics: (a: number) => any;
  readonly sim_energy_breakdown: (a: number) => any;
  readonly sim_ep_exact_by_move: (a: number) => any;
  readonly sim_ep_exact_total: (a: number) => number;
  readonly sim_ep_move_labels: (a: number) => any;
  readonly sim_ep_naive_by_move: (a: number) => any;
  readonly sim_ep_naive_total: (a: number) => number;
  readonly sim_ep_q_stats: (a: number) => any;
  readonly sim_meta_a_field: (a: number) => any;
  readonly sim_meta_edge_count: (a: number) => number;
  readonly sim_meta_field: (a: number) => any;
  readonly sim_meta_layers: (a: number) => number;
  readonly sim_meta_n_field: (a: number) => any;
  readonly sim_meta_w_edges: (a: number) => any;
  readonly sim_n: (a: number) => number;
  readonly sim_new: (a: number, b: number) => number;
  readonly sim_op_budget_k: (a: number) => number;
  readonly sim_op_k_tokens: (a: number) => any;
  readonly sim_op_offsets: (a: number) => any;
  readonly sim_op_r_count: (a: number) => number;
  readonly sim_op_stencil_id: (a: number) => number;
  readonly sim_positions: (a: number) => any;
  readonly sim_set_params: (a: number, b: any) => void;
  readonly sim_step: (a: number, b: number) => void;
  readonly sim_op_interfaces: (a: number) => number;
  readonly sim_field: (a: number) => any;
  readonly sim_ep_total: (a: number) => number;
  readonly __wbindgen_malloc: (a: number, b: number) => number;
  readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
  readonly __wbindgen_exn_store: (a: number) => void;
  readonly __externref_table_alloc: () => number;
  readonly __wbindgen_externrefs: WebAssembly.Table;
  readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
* Instantiates the given `module`, which can either be bytes or
* a precompiled `WebAssembly.Module`.
*
* @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
*
* @returns {InitOutput}
*/
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
* If `module_or_path` is {RequestInfo} or {URL}, makes a request and
* for everything else, calls `WebAssembly.instantiate` directly.
*
* @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
*
* @returns {Promise<InitOutput>}
*/
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
