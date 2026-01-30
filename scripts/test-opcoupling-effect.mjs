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

const OP_STENCIL_CROSS = [
  [0, 0],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
const OP_STENCIL_FULL = [
  [0, 0],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
];

function offsetIndex(q, dx, dy, g) {
  const x = q % g;
  const y = Math.floor(q / g);
  const nx = (x + dx + g) % g;
  const ny = (y + dy + g) % g;
  return ny * g + nx;
}

function opMismatchMean({
  baseS,
  metaS,
  opK,
  gridSize,
  metaLayers,
  rCount,
  budget,
  stencil,
  lS,
}) {
  const cells = gridSize * gridSize;
  const denom = Math.max(1, lS);
  let sum = 0;
  let count = 0;
  for (let iface = 0; iface < metaLayers; iface += 1) {
    for (let q = 0; q < cells; q += 1) {
      let pred = 0;
      const start = (iface * cells + q) * rCount;
      for (let r = 0; r < rCount; r += 1) {
        const [dx, dy] = stencil[r];
        const qOff = offsetIndex(q, dx, dy, gridSize);
        const lower = iface === 0
          ? baseS[qOff]
          : metaS[(iface - 1) * cells + qOff];
        pred += (opK[start + r] / budget) * (lower / denom);
      }
      const upper = metaS[iface * cells + q] / denom;
      sum += Math.abs(upper - pred);
      count += 1;
    }
  }
  return count > 0 ? sum / count : 0;
}

function runCase(eta) {
  const params = {
    beta: 12.0,
    gridSize: 16,
    metaLayers: 2,
    lS: 10,
    lambdaS: 0,
    pSWrite: 1,
    pWrite: 0,
    pNWrite: 0,
    pAWrite: 0,
    p3On: 0,
    p6On: 0,
    eta,
    etaDrive: 0,
    opCouplingOn: 1,
    sCouplingMode: 1,
    opBudgetK: 16,
    opStencil: 1,
  };
  const sim = new mod.Sim(200, 1);
  sim.set_params(params);
  sim.step(3_000_000);
  const baseS = sim.base_s_field();
  const metaS = sim.meta_field();
  const opK = sim.op_k_tokens();
  const rCount = sim.op_r_count();
  const budget = sim.op_budget_k();
  const stencil = params.opStencil === 1 ? OP_STENCIL_FULL : OP_STENCIL_CROSS;
  const mismatch = opMismatchMean({
    baseS,
    metaS,
    opK,
    gridSize: params.gridSize,
    metaLayers: params.metaLayers,
    rCount,
    budget,
    stencil,
    lS: params.lS,
  });
  return mismatch;
}

const diff0 = runCase(0.0);
const diff1 = runCase(0.6);
const ratio = diff1 / diff0;

console.log(
  `Sdiff_op eta0=${diff0.toFixed(6)} eta0.6=${diff1.toFixed(6)} ratio=${ratio.toFixed(4)}`,
);

assert.ok(diff1 <= 0.85 * diff0);
