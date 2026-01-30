#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const wasmDir = path.resolve(rootDir, "apps/web/src/wasm/sim_core");
const wasmJs = pathToFileURL(path.join(wasmDir, "sim_core.js")).href;
const wasmBytes = fs.readFileSync(path.join(wasmDir, "sim_core_bg.wasm"));
const mod = await import(wasmJs);
mod.initSync({ module: wasmBytes });

function makeLCG(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state;
  };
}

const params = {
  gridSize: 16,
  metaLayers: 2,
  opCouplingOn: 1,
  sCouplingMode: 1,
  opBudgetK: 16,
  opStencil: 1,
  p3On: 0,
  p6On: 0,
  pWrite: 0,
  pNWrite: 0,
  pAWrite: 0,
  pSWrite: 1,
};

const sim = new mod.Sim(200, 1);
sim.set_params(params);
sim.step(200_000);

const rCount = sim.op_r_count();
const budget = sim.op_budget_k();
const interfaces = sim.op_interfaces();
const opK = sim.op_k_tokens();
const g = params.gridSize;
const cells = g * g;

assert.ok(rCount > 0, "op_r_count should be > 0");
assert.equal(opK.length, interfaces * cells * rCount);

let min = Number.POSITIVE_INFINITY;
let max = Number.NEGATIVE_INFINITY;
for (let i = 0; i < opK.length; i += 1) {
  const v = opK[i];
  if (v < min) min = v;
  if (v > max) max = v;
}
assert.ok(min >= 0);
assert.ok(max <= budget);

const rng = makeLCG(0x1234abcd);
const samples = 200;
for (let i = 0; i < samples; i += 1) {
  const iface = rng() % interfaces;
  const q = rng() % cells;
  const start = (iface * cells + q) * rCount;
  let sum = 0;
  for (let r = 0; r < rCount; r += 1) {
    sum += opK[start + r];
  }
  assert.equal(sum, budget, "budget sum mismatch");
}

console.log(
  `OK opK invariants: interfaces=${interfaces} cells=${cells} rCount=${rCount} budget=${budget} min=${min} max=${max}`,
);
