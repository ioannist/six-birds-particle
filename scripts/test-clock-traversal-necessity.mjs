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
const reportEvery = 100_000;
const perturbStep = 500_000;

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
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

function runPreset(id, paramsPath) {
  const params = readJson(path.resolve(rootDir, paramsPath));
  const runs = [];
  for (const seed of seeds) {
    const sim = new mod.Sim(50, seed);
    sim.set_params(params);
    let preSamples = [];
    let baselineMean = null;
    let baselineTarget = null;
    let recoverySteps = null;
    let perturbApplied = false;

    for (let step = reportEvery; step <= steps; step += reportEvery) {
      sim.step(reportEvery);
      const baseS = sim.base_s_field();
      const metaS = sim.meta_field();
      const cells = baseS.length;
      const meta0 = metaS.subarray(0, cells);
      const sdiffBase = meanAbsDiff(baseS, meta0);
      if (!perturbApplied) {
        if (step <= perturbStep) preSamples.push(sdiffBase);
        if (step >= perturbStep) {
          baselineMean = mean(preSamples.slice(-3));
          baselineTarget = Math.max(baselineMean, 0.5);
          sim.apply_perturbation({
            target: "metaS",
            layer: 0,
            frac: 0.3,
            mode: "randomize",
            seed: seed * 1000 + 9,
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
    const err = errF05(baseBits, meta0, params.gridSize, lS, seed + 4000);
    const sdiffBase = meanAbsDiff(baseS, meta0);

    runs.push({
      id,
      seed,
      errF05: err,
      sdiffBase,
      recoverySteps: recoverySteps ?? Infinity,
    });
  }
  return runs;
}

ensureDir(outDir);

const presets = [
  { id: "A_ungated", file: "scripts/params/clock_code/code_p6_drive.json" },
  { id: "B_gated_clock", file: "scripts/params/clock_code/code_p6_clock_gated.json" },
  { id: "C_gated_static", file: "scripts/params/clock_code/code_p6_clock_gated_static.json" },
  { id: "D_gated_random", file: "scripts/params/clock_code/code_p6_clock_gated_random.json" },
];

const rawLines = [];
const summaries = [];

for (const preset of presets) {
  const runs = runPreset(preset.id, preset.file);
  for (const row of runs) rawLines.push(JSON.stringify(row));
  const err = runs.map((r) => r.errF05);
  const sdiff = runs.map((r) => r.sdiffBase);
  const recovery = runs.map((r) => r.recoverySteps);
  summaries.push({
    id: preset.id,
    errMean: mean(err),
    sdiffMean: mean(sdiff),
    recoveryMean: mean(recovery.filter((v) => Number.isFinite(v))),
    recoveryP95: percentile(recovery, 0.95),
    recoveryFinite: recovery.filter((v) => Number.isFinite(v)).length,
    errPass: err.filter((v) => v <= 0.1).length,
    errFail: err.filter((v) => v >= 0.25).length,
    recovery,
    err,
  });
}

const summaryPath = path.join(outDir, "clock_traversal_necessity_summary.csv");
const rawPath = path.join(outDir, "clock_traversal_necessity_raw.jsonl");
fs.writeFileSync(rawPath, rawLines.join("\n"));

const header = [
  "preset",
  "errF05Mean",
  "sdiffMean",
  "recoveryMean",
  "recoveryP95",
  "recoveryFinite",
  "errPassCount",
  "errFailCount",
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
      s.recoveryFinite,
      s.errPass,
      s.errFail,
    ].join(","),
  ),
];
fs.writeFileSync(summaryPath, csvLines.join("\n"));

const gated = summaries.find((s) => s.id === "B_gated_clock");
const staticCtrl = summaries.find((s) => s.id === "C_gated_static");

assert.ok(gated.errPass >= 4);
assert.ok(gated.recoveryFinite >= 4);

const gatedRecoveryMean = gated.recoveryMean;
const staticFailByErr = staticCtrl.errFail >= 4;
const staticFailByRecovery = staticCtrl.recovery.filter((v) => !Number.isFinite(v) || v > 3 * gatedRecoveryMean).length >= 4;
assert.ok(staticFailByErr || staticFailByRecovery);

console.log("Clock traversal necessity summary:");
for (const row of summaries) {
  console.log(
    `${row.id} | err(f=0.5) ${row.errMean.toFixed(3)} | sdiff ${row.sdiffMean.toFixed(3)} | recovery mean ${row.recoveryMean.toFixed(1)} | err<=0.1 count ${row.errPass}`,
  );
}
