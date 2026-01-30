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

function meanAbsDiff(a, b) {
  let sum = 0;
  const len = a.length;
  for (let i = 0; i < len; i += 1) {
    sum += Math.abs(a[i] - b[i]);
  }
  return sum / len;
}

function runSim(params, steps) {
  const sim = new mod.Sim(50, 1);
  sim.set_params(params);
  sim.step(steps);
  return sim;
}

function logCase(label, detail) {
  console.log(`${label}: ${detail}`);
}

const gridSize = 12;
const metaLayers = 2;
const cells = gridSize * gridSize;
const steps = 50000;

// Case A: S coupling reduces base/meta mismatch.
{
  const baseParams = {
    beta: 10.0,
    gridSize,
    metaLayers,
    lS: 10,
    pSWrite: 1,
    pWrite: 0,
    pNWrite: 0,
    pAWrite: 0,
    p3On: 0,
    p6On: 0,
    lambdaS: 0,
  };

  const sim0 = runSim({ ...baseParams, eta: 0.0 }, steps);
  const sim1 = runSim({ ...baseParams, eta: 1.0 }, steps);

  const base0 = sim0.base_s_field();
  const meta0 = sim0.meta_field();
  const base1 = sim1.base_s_field();
  const meta1 = sim1.meta_field();

  const meta0L0 = meta0.subarray(0, cells);
  const meta0L1 = meta0.subarray(cells, 2 * cells);
  const meta1L0 = meta1.subarray(0, cells);
  const meta1L1 = meta1.subarray(cells, 2 * cells);

  const diffBase0 = meanAbsDiff(base0, meta0L0);
  const diffBase1 = meanAbsDiff(base1, meta1L0);
  const diffMeta0 = meanAbsDiff(meta0L0, meta0L1);
  const diffMeta1 = meanAbsDiff(meta1L0, meta1L1);

  logCase(
    "Case A diff base/meta",
    `eta0=${diffBase0.toFixed(4)} eta1=${diffBase1.toFixed(4)}`,
  );
  logCase(
    "Case A diff meta/meta",
    `eta0=${diffMeta0.toFixed(4)} eta1=${diffMeta1.toFixed(4)}`,
  );

  assert.ok(diffBase1 <= 0.85 * diffBase0);
  assert.ok(diffMeta1 <= 0.85 * diffMeta0);
}

// Case B: W coupling reduces meta edge mismatch.
{
  const baseParams = {
    beta: 10.0,
    gridSize,
    metaLayers,
    lW: 10,
    pWrite: 1,
    pSWrite: 0,
    pNWrite: 0,
    pAWrite: 0,
    p3On: 0,
    p6On: 0,
    lambdaW: 0,
    kappaBond: 0,
  };

  const sim0 = runSim({ ...baseParams, eta: 0.0 }, steps);
  const sim1 = runSim({ ...baseParams, eta: 1.0 }, steps);

  const edges = 2 * gridSize * gridSize;
  const w0 = sim0.meta_w_edges();
  const w1 = sim1.meta_w_edges();

  const w0L0 = w0.subarray(0, edges);
  const w0L1 = w0.subarray(edges, 2 * edges);
  const w1L0 = w1.subarray(0, edges);
  const w1L1 = w1.subarray(edges, 2 * edges);

  const diff0 = meanAbsDiff(w0L0, w0L1);
  const diff1 = meanAbsDiff(w1L0, w1L1);

  logCase("Case B diff metaW", `eta0=${diff0.toFixed(4)} eta1=${diff1.toFixed(4)}`);

  assert.ok(diff1 <= 0.85 * diff0);
}
