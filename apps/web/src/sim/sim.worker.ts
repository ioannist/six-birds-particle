import type { SimMessage, SimRequest, SimSnapshot } from "./workerMessages";
import { SNAPSHOT_VERSION } from "./workerMessages";

let wasmMod: any | null = null;
let sim: any | null = null;
let running = false;
let bondThreshold = 2;
let bondsEverySteps = 1;
let cachedBonds: Uint32Array | null = null;
let lastBondsSteps = -1;
let pendingParams: any | null = null;
let lastParams: any | null = null;
let totalSteps = 0;
let lastOpkPayloadSteps = -20000;
let cachedOpkTokens: Uint8Array | null = null;
let cachedOpkOffsets: Int8Array | null = null;

const OPK_PAYLOAD_EVERY_STEPS = 20000;

function post(message: SimMessage) {
  postMessage(message);
}

function debug(message: string) {
  post({ type: "debug", message });
}

debug("Worker bootstrap (WASM).");

function buildSnapshot(
  simRef: any,
  bondLimit: number,
  steps: number,
  forceOpkRefresh = false
): SimSnapshot {
  const opkEnabled = lastParams ? lastParams.opCouplingOn >= 0.5 : false;
  const opkInterfaces = Number(simRef.op_interfaces?.() ?? 0);
  const opkRCount = Number(simRef.op_r_count?.() ?? 0);
  const opkBudgetK = Number(simRef.op_budget_k?.() ?? 0);
  const opkStencilId = Number(simRef.op_stencil_id?.() ?? 0);
  const shouldRefreshOpk =
    forceOpkRefresh ||
    (opkEnabled &&
      opkInterfaces > 0 &&
      opkRCount > 0 &&
      totalSteps - lastOpkPayloadSteps >= OPK_PAYLOAD_EVERY_STEPS);
  let opkTokens: Uint8Array | undefined;
  let opkOffsets: Int8Array | undefined;
  let opkComputedAt: number | undefined;
  if (shouldRefreshOpk) {
    cachedOpkOffsets = simRef.op_offsets();
    cachedOpkTokens = simRef.op_k_tokens();
    lastOpkPayloadSteps = totalSteps;
    opkOffsets = cachedOpkOffsets;
    opkTokens = cachedOpkTokens;
    opkComputedAt = totalSteps;
  } else if (cachedOpkTokens) {
    opkComputedAt = lastOpkPayloadSteps;
  }

  let bonds = new Uint32Array();
  if (bondsEverySteps > 0) {
    if (totalSteps === 0 || lastBondsSteps < 0 || totalSteps - lastBondsSteps >= bondsEverySteps) {
      cachedBonds = simRef.bonds(bondLimit);
      lastBondsSteps = totalSteps;
      bonds = cachedBonds;
    }
  } else {
    cachedBonds = null;
  }

  return {
    snapshotVersion: SNAPSHOT_VERSION,
    n: simRef.n(),
    positions: simRef.positions(),
    bonds,
    counters: simRef.counters(),
    apparatus: simRef.apparatus(),
    field: simRef.field(),
    metaLayers: simRef.meta_layers(),
    metaField: simRef.meta_field(),
    baseSField: simRef.base_s_field(),
    metaNField: simRef.meta_n_field(),
    metaAField: simRef.meta_a_field(),
    metaWEdges: simRef.meta_w_edges(),
    energy: simRef.energy_breakdown(),
    diagnostics: simRef.diagnostics(),
    steps,
    extras: {
      ep: {
        exactTotal: simRef.ep_exact_total(),
        naiveTotal: simRef.ep_naive_total(),
        exactByMove: simRef.ep_exact_by_move(),
      },
      clock: {
        state: simRef.clock_state(),
        q: Number(simRef.clock_q()),
        fwd: Number(simRef.clock_fwd()),
        bwd: Number(simRef.clock_bwd()),
      },
      opk: {
        enabled: opkEnabled,
        budgetK: opkBudgetK,
        interfaces: opkInterfaces,
        rCount: opkRCount,
        stencilId: opkStencilId,
        offsets: opkOffsets,
        tokens: opkTokens,
        computedAtSteps: opkComputedAt,
      },
    },
  };
}

async function ensureSim() {
  if (wasmMod) return wasmMod;
  debug("Loading WASM JS module…");
  const mod = await import("../wasm/sim_core/sim_core.js");
  debug("Initializing WASM module…");
  await mod.default();
  debug("WASM ready.");
  wasmMod = mod;
  return wasmMod;
}

async function tick(mod: any) {
  if (!running || !sim) return;
  const steps = 500;
  totalSteps += steps;
  sim.step(steps);
  const snapshot = buildSnapshot(sim, bondThreshold, steps);
  post({ type: "snapshot", snapshot });
  setTimeout(() => void tick(mod), 16);
}

self.onmessage = async (ev: MessageEvent<SimRequest>) => {
  try {
    const req = ev.data;
    debug(`received: ${req.type}`);

    const mod = await ensureSim();

    if (req.type === "init") {
      debug("Constructing Sim…");
      totalSteps = 0;
      cachedBonds = null;
      lastBondsSteps = -Math.max(1, bondsEverySteps);
      lastOpkPayloadSteps = -OPK_PAYLOAD_EVERY_STEPS;
      cachedOpkTokens = null;
      cachedOpkOffsets = null;
      sim = new mod.Sim(req.n, req.seed);
      if (pendingParams) {
        debug("Applying pending params…");
        sim.set_params(pendingParams);
        lastParams = pendingParams;
        pendingParams = null;
      }
      debug("Sim constructed; posting ready + initial snapshot.");
      post({ type: "ready" });
      const snapshot = buildSnapshot(sim, bondThreshold, 0);
      post({ type: "snapshot", snapshot });
      return;
    }

    if (req.type === "config") {
      const prevBondThreshold = bondThreshold;
      bondThreshold = Math.max(0, Math.min(255, Math.floor(req.bondThreshold)));
      const prevBondsEverySteps = bondsEverySteps;
      if (typeof req.bondsEverySteps === "number") {
        bondsEverySteps = Math.max(0, Math.floor(req.bondsEverySteps));
      }
      const bondsCadenceChanged = prevBondsEverySteps !== bondsEverySteps;
      if (bondsCadenceChanged || bondThreshold !== prevBondThreshold) {
        lastBondsSteps = -Math.max(1, bondsEverySteps || 1);
      }
      if (bondsEverySteps <= 0) {
        cachedBonds = null;
      }
      const prevParams = lastParams;
      lastParams = req.params;
      const opkParamsChanged =
        !prevParams ||
        prevParams.opCouplingOn !== req.params.opCouplingOn ||
        prevParams.metaLayers !== req.params.metaLayers ||
        prevParams.gridSize !== req.params.gridSize ||
        prevParams.opStencil !== req.params.opStencil ||
        prevParams.opBudgetK !== req.params.opBudgetK ||
        prevParams.opKTargetWeight !== req.params.opKTargetWeight ||
        prevParams.sCouplingMode !== req.params.sCouplingMode ||
        prevParams.opDriveOnK !== req.params.opDriveOnK;
      const shouldForceOpk =
        opkParamsChanged && req.params.opCouplingOn >= 0.5 && req.params.metaLayers >= 1;
      if (req.params.opCouplingOn < 0.5) {
        cachedOpkTokens = null;
        cachedOpkOffsets = null;
      }
      if (!sim) {
        pendingParams = req.params;
        debug("Stored config params (will apply on init).");
        return;
      }
      sim.set_params(req.params);
      debug(`Updated bondThreshold=${bondThreshold}`);
      const snapshot = buildSnapshot(sim, bondThreshold, 0, shouldForceOpk);
      post({ type: "snapshot", snapshot });
      return;
    }

    if (!sim) throw new Error("Simulation not initialized; send {type:'init'} first.");

    if (req.type === "step") {
      totalSteps += req.steps;
      sim.step(req.steps);
      const snapshot = buildSnapshot(sim, bondThreshold, req.steps);
      post({ type: "snapshot", snapshot });
      return;
    }

    if (req.type === "perturb") {
      sim.apply_perturbation(req.params);
      const snapshot = buildSnapshot(sim, bondThreshold, 0);
      post({ type: "snapshot", snapshot });
      return;
    }

    if (req.type === "resume") {
      if (!running) {
        running = true;
        void tick(mod);
      }
      return;
    }

    if (req.type === "pause") {
      running = false;
      return;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    post({ type: "error", message });
  }
};
