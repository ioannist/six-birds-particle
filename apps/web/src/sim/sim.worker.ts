import type { SimMessage, SimRequest, SimSnapshot } from "./workerMessages";
import { SNAPSHOT_VERSION } from "./workerMessages";

let wasmMod: any | null = null;
let sim: any | null = null;
let running = false;
let bondThreshold = 2;
let pendingParams: any | null = null;

function post(message: SimMessage) {
  postMessage(message);
}

function debug(message: string) {
  post({ type: "debug", message });
}

debug("Worker bootstrap (WASM).");

function buildSnapshot(simRef: any, bondLimit: number, steps: number): SimSnapshot {
  return {
    snapshotVersion: SNAPSHOT_VERSION,
    n: simRef.n(),
    positions: simRef.positions(),
    bonds: simRef.bonds(bondLimit),
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
      },
      clock: {
        state: simRef.clock_state(),
        q: Number(simRef.clock_q()),
        fwd: Number(simRef.clock_fwd()),
        bwd: Number(simRef.clock_bwd()),
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
      sim = new mod.Sim(req.n, req.seed);
      if (pendingParams) {
        debug("Applying pending params…");
        sim.set_params(pendingParams);
        pendingParams = null;
      }
      debug("Sim constructed; posting ready + initial snapshot.");
      post({ type: "ready" });
      const snapshot = buildSnapshot(sim, bondThreshold, 0);
      post({ type: "snapshot", snapshot });
      return;
    }

    if (req.type === "config") {
      bondThreshold = Math.max(0, Math.min(255, Math.floor(req.bondThreshold)));
      if (!sim) {
        pendingParams = req.params;
        debug("Stored config params (will apply on init).");
        return;
      }
      sim.set_params(req.params);
      debug(`Updated bondThreshold=${bondThreshold}`);
      const snapshot = buildSnapshot(sim, bondThreshold, 0);
      post({ type: "snapshot", snapshot });
      return;
    }

    if (!sim) throw new Error("Simulation not initialized; send {type:'init'} first.");

    if (req.type === "step") {
      sim.step(req.steps);
      const snapshot = buildSnapshot(sim, bondThreshold, req.steps);
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
