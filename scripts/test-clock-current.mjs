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

const seeds = [1, 2, 3, 4, 5];
const steps = 2_000_000;
const clockFrac = 0.01;

function runCase(label, params) {
  const rows = [];
  for (const seed of seeds) {
    const sim = new mod.Sim(50, seed);
    sim.set_params(params);
    sim.step(steps);
    const clockQ = Number(sim.clock_q());
    const clockFwd = Number(sim.clock_fwd());
    const clockBwd = Number(sim.clock_bwd());
    const clockSteps = clockFwd + clockBwd;
    const drift = steps > 0 ? clockQ / steps : 0;
    const epTotal = sim.ep_exact_total();
    const epRate = steps > 0 ? epTotal / steps : 0;
    rows.push({ seed, clockQ, clockSteps, drift, epRate });
  }
  console.log(`\n${label}`);
  for (const row of rows) {
    console.log(
      `seed ${row.seed} | Q ${row.clockQ} | steps ${row.clockSteps} | drift ${row.drift.toExponential(3)} | epRate ${row.epRate.toExponential(3)}`,
    );
  }
  return rows;
}

const baseParams = {
  beta: 1.0,
  stepSize: 0.01,
  p3On: 0,
  p6On: 0,
  pWrite: 0,
  pNWrite: 1,
  pAWrite: 0,
  pSWrite: 0,
  muHigh: 1.0,
  muLow: 1.0,
  kappaRep: 1.0,
  r0: 0.25,
  kappaBond: 0.0,
  rStar: 0.22,
  lambdaW: 0.0,
  lW: 4,
  lambdaN: 0.0,
  lN: 6,
  lambdaA: 0.0,
  lA: 6,
  lambdaS: 0.0,
  lS: 6,
  gridSize: 12,
  rPropose: 0.12,
  metaLayers: 0,
  eta: 0.0,
  etaDrive: 0.0,
  clockOn: 1,
  clockK: 8,
  clockFrac,
  clockUsesP6: 1,
  repairClockGated: 0,
};

const nullRows = runCase("Case A (null)", { ...baseParams, p6On: 0 });
for (const row of nullRows) {
  assert.ok(Math.abs(row.clockQ) <= 5 * Math.sqrt(row.clockSteps));
  assert.ok(Math.abs(row.drift) <= 1e-4);
  assert.ok(Math.abs(row.epRate) <= 5e-4);
}

const driveRows = runCase("Case B (P6 drive)", { ...baseParams, p6On: 1 });
const signs = driveRows
  .map((row) => Math.sign(row.clockQ))
  .filter((v) => v !== 0);
if (signs.length > 0) {
  const expected = signs[0];
  for (const s of signs) {
    assert.strictEqual(s, expected);
  }
}
for (const row of driveRows) {
  assert.ok(row.drift >= 1e-3);
  assert.ok(row.epRate > 1e-4);
}

console.log("\nClock current tests passed.");
