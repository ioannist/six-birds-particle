#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const outDir = path.resolve(rootDir, ".tmp", "op_coupling");

const wasmDir = path.resolve(rootDir, "apps/web/src/wasm/sim_core");
const wasmJs = pathToFileURL(path.join(wasmDir, "sim_core.js")).href;
const wasmBytes = fs.readFileSync(path.join(wasmDir, "sim_core_bg.wasm"));
const mod = await import(wasmJs);
mod.initSync({ module: wasmBytes });

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

ensureDir(outDir);

const weights = [0.0, 0.25, 0.5, 1.0, 2.0];
const seeds = [1, 2, 3];
const steps = 3_000_000;
const reportEvery = 1_000_000;

const rows = [];
const summary = [];

for (const weight of weights) {
  const rates = [];
  for (const seed of seeds) {
    const sim = new mod.Sim(200, seed);
    sim.set_params({
      gridSize: 16,
      metaLayers: 2,
      opCouplingOn: 1,
      sCouplingMode: 1,
      opKTargetWeight: weight,
      p3On: 0,
      p6On: 0,
      eta: 0.6,
      etaDrive: 0,
      pWrite: 0,
      pNWrite: 0,
      pAWrite: 0,
      pSWrite: 1,
      initRandom: 1,
    });
    let lastEp = sim.ep_exact_total();
    let lastWindow = 0;
    for (let t = reportEvery; t <= steps; t += reportEvery) {
      sim.step(reportEvery);
      const ep = sim.ep_exact_total();
      lastWindow = ep - lastEp;
      lastEp = ep;
    }
    const rate = lastWindow / reportEvery;
    rates.push(rate);
    rows.push({
      weight,
      seed,
      epExactRateWindowLast: rate,
      pass: Math.abs(rate) <= 2e-4,
    });
    assert.ok(Math.abs(rate) <= 2e-4);
  }
  const mean = rates.reduce((acc, v) => acc + v, 0) / rates.length;
  const variance = rates.reduce((acc, v) => acc + (v - mean) ** 2, 0) / rates.length;
  const std = Math.sqrt(variance);
  summary.push({ weight, mean, std });
}

const summaryPath = path.join(outDir, "opk_null_ep_weights_summary.csv");
const lines = [
  "weight,seed,epExactRateWindowLast,pass",
  ...rows.map((row) =>
    [row.weight, row.seed, row.epExactRateWindowLast, row.pass].join(","),
  ),
  "weight,seed,mean,std",
  ...summary.map((row) => [row.weight, "mean", row.mean, row.std].join(",")),
];
fs.writeFileSync(summaryPath, `${lines.join("\n")}\n`);

console.log("opK null EP weights summary:");
for (const row of summary) {
  console.log(`weight ${row.weight} mean ${row.mean.toExponential(3)} std ${row.std.toExponential(2)}`);
}
