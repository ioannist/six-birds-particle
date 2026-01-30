#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const outDir = path.resolve(rootDir, ".tmp", "clock_code");

const wasmDir = path.resolve(rootDir, "apps/web/src/wasm/sim_core");
const wasmJs = pathToFileURL(path.join(wasmDir, "sim_core.js")).href;
const wasmBytes = fs.readFileSync(path.join(wasmDir, "sim_core_bg.wasm"));
const mod = await import(wasmJs);
mod.initSync({ module: wasmBytes });

const seeds = [1, 2, 3, 4, 5];
const steps = 1_000_000;
const reportEvery = 5_000;
const perturbStep = 200_000;
const deadline = 25_000;

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function mean(values) {
  return values.reduce((acc, v) => acc + v, 0) / values.length;
}

function percentile(values, p) {
  const nums = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (nums.length === 0) return null;
  const idx = Math.min(nums.length - 1, Math.floor(p * (nums.length - 1)));
  return nums[idx];
}

function meanAbsDiff(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) {
    sum += Math.abs(a[i] - b[i]);
  }
  return a.length === 0 ? 0 : sum / a.length;
}

function meanAbsDiffQuadrant(a, b, g, quadrant) {
  let sum = 0;
  let count = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = i % g;
    const y = Math.floor(i / g);
    const qx = x < g / 2 ? 0 : 1;
    const qy = y < g / 2 ? 0 : 1;
    const q = qy * 2 + qx;
    if (q !== quadrant) continue;
    sum += Math.abs(a[i] - b[i]);
    count += 1;
  }
  return count === 0 ? 0 : sum / count;
}

function quadrantIndex(idx, g) {
  const x = idx % g;
  const y = Math.floor(idx / g);
  const qx = x < g / 2 ? 0 : 1;
  const qy = y < g / 2 ? 0 : 1;
  return qy * 2 + qx;
}

function logicalBitsFromField(field, g, lS, mask) {
  const sums = [0, 0, 0, 0];
  const counts = [0, 0, 0, 0];
  for (let i = 0; i < field.length; i += 1) {
    if (mask && !mask[i]) continue;
    const q = quadrantIndex(i, g);
    sums[q] += field[i];
    counts[q] += 1;
  }
  const threshold = lS / 2;
  return sums.map((sum, i) => {
    const meanVal = counts[i] > 0 ? sum / counts[i] : 0;
    return meanVal >= threshold ? 1 : 0;
  });
}

function errorRate(bitsA, bitsB) {
  let mismatches = 0;
  for (let i = 0; i < bitsA.length; i += 1) {
    if (bitsA[i] !== bitsB[i]) mismatches += 1;
  }
  return mismatches / bitsA.length;
}

function makeMask(seed, size, frac) {
  let x = seed >>> 0;
  if (x === 0) x = 1;
  const mask = new Array(size);
  for (let i = 0; i < size; i += 1) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    const r = (x >>> 8) / (1 << 24);
    mask[i] = r < frac;
  }
  return mask;
}

function errF05(baseBits, metaField, g, lS, seed) {
  const trials = 20;
  let acc = 0;
  for (let t = 0; t < trials; t += 1) {
    const mask = makeMask(seed + t * 101, metaField.length, 0.5);
    const bits = logicalBitsFromField(metaField, g, lS, mask);
    acc += errorRate(bits, baseBits);
  }
  return acc / trials;
}

const baseParams = {
  beta: 2.0,
  stepSize: 0.01,
  p3On: 0,
  p6On: 1,
  p6SFactor: 0.0,
  pWrite: 0,
  pNWrite: 0.01,
  pAWrite: 0,
  pSWrite: 0.99,
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
  lS: 20,
  gridSize: 16,
  rPropose: 0.12,
  metaLayers: 2,
  eta: 0.0,
  etaDrive: 1.0,
  codeNoiseRate: 0.02,
  codeNoiseBatch: 2,
  codeNoiseLayer: 0,
  clockK: 8,
  clockFrac: 1.0,
  repairClockGated: 1,
  repairGateMode: 1,
  repairGateSpan: 1,
};

function runPreset(id, overrides) {
  const params = { ...baseParams, ...overrides };
  const runs = [];
  for (const seed of seeds) {
    const sim = new mod.Sim(50, seed);
    sim.set_params(params);
    let baselineTarget = null;
    let recoverySteps = null;
    let perturbApplied = false;

    for (let step = reportEvery; step <= steps; step += reportEvery) {
      sim.step(reportEvery);
      const baseS = sim.base_s_field();
      const metaS = sim.meta_field();
      const cells = baseS.length;
      const meta0 = metaS.subarray(0, cells);
      const sdiffBase = meanAbsDiffQuadrant(baseS, meta0, params.gridSize, 2);
      if (!perturbApplied) {
        if (step >= perturbStep) {
          baselineTarget = 4.0;
          sim.apply_perturbation({
            target: "metaS",
            layer: 0,
            frac: 1.0,
            mode: "randomize",
            seed: seed * 1000 + 13,
            region: "quadrant",
            quadrant: 2,
          });
          perturbApplied = true;
        }
      } else if (recoverySteps === null && baselineTarget !== null) {
        if (sdiffBase <= baselineTarget * 1.1) {
          recoverySteps = step - perturbStep;
        }
      }
    }

    const baseS = sim.base_s_field();
    const metaS = sim.meta_field();
    const cells = baseS.length;
    const meta0 = metaS.subarray(0, cells);
    const lS = params.lS ?? 1;
    const baseBits = logicalBitsFromField(baseS, params.gridSize, lS);
    const err = errF05(baseBits, meta0, params.gridSize, lS, seed + 9000);
    const sdiffBase = meanAbsDiffQuadrant(baseS, meta0, params.gridSize, 2);
    const missDeadline = recoverySteps === null || recoverySteps > deadline;

    runs.push({
      id,
      seed,
      errF05: err,
      sdiffBase,
      recoverySteps: recoverySteps ?? Infinity,
      missDeadline,
    });
  }
  return runs;
}

ensureDir(outDir);

const presets = [
  { id: "drift", overrides: { clockOn: 1, clockUsesP6: 1 } },
  { id: "random", overrides: { clockOn: 1, clockUsesP6: 0 } },
  { id: "static", overrides: { clockOn: 0, clockUsesP6: 1 } },
];

const rawLines = [];
const summaries = [];

for (const preset of presets) {
  const runs = runPreset(preset.id, preset.overrides);
  for (const row of runs) rawLines.push(JSON.stringify(row));
  const err = runs.map((r) => r.errF05);
  const sdiff = runs.map((r) => r.sdiffBase);
  const recovery = runs.map((r) => r.recoverySteps);
  const missDeadline = runs.filter((r) => r.missDeadline).length;
  summaries.push({
    id: preset.id,
    errMean: mean(err),
    sdiffMean: mean(sdiff),
    recoveryMean: mean(recovery.filter((v) => Number.isFinite(v))),
    recoveryP95: percentile(recovery, 0.95),
    missDeadlineCount: missDeadline,
  });
}

const summaryPath = path.join(outDir, "clock_deadline_traversal_summary.csv");
const rawPath = path.join(outDir, "clock_deadline_traversal_raw.jsonl");
fs.writeFileSync(rawPath, rawLines.join("\n"));

const header = [
  "preset",
  "errF05Mean",
  "sdiffMean",
  "recoveryMean",
  "recoveryP95",
  "missDeadlineCount",
];
const csvLines = [
  header.join(","),
  ...summaries.map((s) =>
    [
      s.id,
      s.errMean,
      s.sdiffMean,
      Number.isFinite(s.recoveryMean) ? s.recoveryMean : "",
      s.recoveryP95 ?? "",
      s.missDeadlineCount,
    ].join(","),
  ),
];
fs.writeFileSync(summaryPath, csvLines.join("\n"));

const drift = summaries.find((s) => s.id === "drift");
const random = summaries.find((s) => s.id === "random");
const staticCtrl = summaries.find((s) => s.id === "static");

assert.ok(drift.missDeadlineCount <= random.missDeadlineCount);
assert.ok(random.missDeadlineCount <= staticCtrl.missDeadlineCount);

console.log("Clock deadline traversal summary:");
for (const row of summaries) {
  console.log(
    `${row.id} | err(f=0.5) ${row.errMean.toFixed(3)} | sdiff ${row.sdiffMean.toFixed(3)} | recovery mean ${row.recoveryMean.toFixed(1)} | miss deadline ${row.missDeadlineCount}/${seeds.length}`,
  );
}
