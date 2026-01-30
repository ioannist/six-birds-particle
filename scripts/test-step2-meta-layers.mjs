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

function countNonZero(arr) {
  let count = 0;
  for (const v of arr) {
    if (v !== 0) count += 1;
  }
  return count;
}

function minMaxI16(arr) {
  let min = 0;
  let max = 0;
  let init = false;
  for (const v of arr) {
    if (!init) {
      min = v;
      max = v;
      init = true;
      continue;
    }
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min, max };
}

function maxU16(arr) {
  let max = 0;
  for (const v of arr) {
    if (v > max) max = v;
  }
  return max;
}

function maxU8(arr) {
  let max = 0;
  for (const v of arr) {
    if (v > max) max = v;
  }
  return max;
}

function newSim() {
  return new mod.Sim(50, 1);
}

function logCase(label, detail) {
  console.log(`${label}: ${detail}`);
}

const gridSize = 16;
const metaLayers = 2;
const edgeCount = 2 * gridSize * gridSize;

// Case 0: sizing invariants
{
  const sim = newSim();
  sim.set_params({ gridSize, metaLayers });
  const metaField = sim.meta_field();
  const metaN = sim.meta_n_field();
  const metaA = sim.meta_a_field();
  const metaW = sim.meta_w_edges();
  assert.equal(metaField.length, metaLayers * gridSize * gridSize);
  assert.equal(metaN.length, metaLayers * gridSize * gridSize);
  assert.equal(metaA.length, metaLayers * gridSize * gridSize);
  assert.equal(metaW.length, metaLayers * edgeCount);
  logCase(
    "Case 0 sizes",
    `metaField=${metaField.length} metaN=${metaN.length} metaA=${metaA.length} metaW=${metaW.length}`,
  );
}

// Case 1: P5 updates meta_field
{
  const sim = newSim();
  sim.set_params({
    gridSize,
    metaLayers,
    pSWrite: 1,
    pWrite: 0,
    pNWrite: 0,
    pAWrite: 0,
    p3On: 0,
    p6On: 0,
    lambdaS: 0,
    lS: 6,
  });
  sim.step(2000);
  const metaField = sim.meta_field();
  const nonZero = countNonZero(metaField);
  const max = maxU8(metaField);
  assert.ok(nonZero > 0);
  logCase("Case 1 metaField", `nonZero=${nonZero} max=${max}`);
}

{
  const sim = newSim();
  sim.set_params({
    gridSize,
    metaLayers,
    pSWrite: 0,
    pWrite: 0,
    pNWrite: 0,
    pAWrite: 0,
    p3On: 0,
    p6On: 0,
    lambdaS: 0,
    lS: 6,
  });
  sim.step(1000);
  const metaField = sim.meta_field();
  const nonZero = countNonZero(metaField);
  assert.equal(nonZero, 0);
  logCase("Case 1b metaField", `nonZero=${nonZero}`);
}

// Case 2: P4 updates meta_n_field
{
  const sim = newSim();
  const lN = 6;
  sim.set_params({
    gridSize,
    metaLayers,
    pSWrite: 0,
    pWrite: 0,
    pNWrite: 1,
    pAWrite: 0,
    p3On: 0,
    p6On: 0,
    lambdaN: 0,
    lN,
  });
  sim.step(2000);
  const metaN = sim.meta_n_field();
  const nonZero = countNonZero(metaN);
  const { min, max } = minMaxI16(metaN);
  assert.ok(nonZero > 0);
  assert.ok(min >= -lN);
  assert.ok(max <= lN);
  logCase("Case 2 metaN", `nonZero=${nonZero} min=${min} max=${max}`);
}

// Case 3: P2 updates meta_a_field
{
  const sim = newSim();
  const lA = 6;
  sim.set_params({
    gridSize,
    metaLayers,
    pSWrite: 0,
    pWrite: 0,
    pNWrite: 0,
    pAWrite: 1,
    p3On: 0,
    p6On: 0,
    lambdaA: 0,
    lA,
  });
  sim.step(2000);
  const metaA = sim.meta_a_field();
  const nonZero = countNonZero(metaA);
  const max = maxU16(metaA);
  assert.ok(nonZero > 0);
  assert.ok(max <= lA);
  logCase("Case 3 metaA", `nonZero=${nonZero} max=${max}`);
}

// Case 4: P1 updates meta_w_edges
{
  const sim = newSim();
  const lW = 6;
  sim.set_params({
    gridSize,
    metaLayers,
    pSWrite: 0,
    pWrite: 1,
    pNWrite: 0,
    pAWrite: 0,
    p3On: 0,
    p6On: 0,
    lambdaW: 0,
    kappaBond: 0,
    lW,
  });
  sim.step(2000);
  const metaW = sim.meta_w_edges();
  const nonZero = countNonZero(metaW);
  const max = maxU8(metaW);
  assert.ok(nonZero > 0);
  assert.ok(max <= lW);
  logCase("Case 4 metaW", `nonZero=${nonZero} max=${max}`);
}
