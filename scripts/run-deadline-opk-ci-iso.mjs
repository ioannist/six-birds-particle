#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {
  loadWasm,
  mean,
  std,
  readJson,
  runDeadlineEvents,
} from "./deadline-event-utils.mjs";

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const outDir = path.resolve(rootDir, ".tmp", "op_coupling");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

class LcgRng {
  constructor(seed) {
    this.state = seed >>> 0;
  }
  next() {
    this.state = (1664525 * this.state + 1013904223) >>> 0;
    return this.state / 0xffffffff;
  }
  int(max) {
    return Math.floor(this.next() * max);
  }
}

function bootstrapMean(values, reps, rng) {
  const n = values.length;
  const draws = [];
  for (let i = 0; i < reps; i += 1) {
    let acc = 0;
    for (let j = 0; j < n; j += 1) {
      acc += values[rng.int(n)];
    }
    draws.push(acc / n);
  }
  draws.sort((a, b) => a - b);
  const lo = draws[Math.floor(0.025 * reps)];
  const hi = draws[Math.floor(0.975 * reps)];
  return { lo, hi };
}

function bootstrapDiff(a, b, reps, rng) {
  const n = a.length;
  const m = b.length;
  const draws = [];
  for (let i = 0; i < reps; i += 1) {
    let accA = 0;
    let accB = 0;
    for (let j = 0; j < n; j += 1) accA += a[rng.int(n)];
    for (let j = 0; j < m; j += 1) accB += b[rng.int(m)];
    draws.push(accA / n - accB / m);
  }
  draws.sort((x, y) => x - y);
  const lo = draws[Math.floor(0.025 * reps)];
  const hi = draws[Math.floor(0.975 * reps)];
  return { lo, hi };
}

ensureDir(outDir);
await loadWasm();

const presetPath = path.resolve(rootDir, "scripts/params/clock_code/deadline_fidelity_found.json");
const fallback = path.resolve(rootDir, "scripts/params/clock_code/code_deadline_gated_clock.json");
const chosenPreset = fs.existsSync(presetPath) ? presetPath : fallback;
const baseParams = readJson(chosenPreset).params ?? readJson(chosenPreset);
const deadline = readJson(chosenPreset).deadline ?? 25_000;

const seeds = Array.from({ length: 50 }, (_, i) => i + 1);
const steps = 500_000;
const reportEvery = 5_000;
const eventEvery = 50_000;
const regionType = "quadrant";
const regionIndex = 2;
const errGood = 0.1;
const sdiffGood = 1.0;
const tailWindow = 200_000;
const reps = 2000;

const modes = [
  {
    id: "A_legacy",
    params: { ...baseParams, opCouplingOn: 0, sCouplingMode: 0, opDriveOnK: 0, pSWrite: 0.65, etaDrive: 0.4 },
  },
  {
    id: "B_dilution_only",
    params: { ...baseParams, opCouplingOn: 1, sCouplingMode: 0, opDriveOnK: 0, pSWrite: 0.2, etaDrive: 0.4 },
  },
  {
    id: "C_op_noKdrive",
    params: { ...baseParams, opCouplingOn: 1, sCouplingMode: 1, opDriveOnK: 0, pSWrite: 0.2, etaDrive: 0.4, opStencil: 1, opBudgetK: 32 },
  },
  {
    id: "D_op_withKdrive",
    params: { ...baseParams, opCouplingOn: 1, sCouplingMode: 1, opDriveOnK: 1, pSWrite: 0.2, etaDrive: 0.8, opStencil: 1, opBudgetK: 16 },
  },
];

const rawRows = [];
const epByMode = new Map();
const missByMode = new Map();
const summaryRows = [];

for (const mode of modes) {
  const result = await runDeadlineEvents({
    presetPath: chosenPreset,
    presetParams: mode.params,
    variant: "drift",
    seeds,
    steps,
    reportEvery,
    eventEvery,
    deadline,
    regionType,
    regionIndex,
    gateSpan: null,
    corruptFrac: 0.2,
    errGood,
    sdiffGood,
    tailWindow,
  });
  for (const run of result.runs) {
    rawRows.push(JSON.stringify({ mode: mode.id, ...run }));
  }
  const ep = result.runs.map((r) => r.epTotalRate);
  const miss = result.runs.map((r) => r.missFrac);
  epByMode.set(mode.id, ep);
  missByMode.set(mode.id, miss);
  const uptime = result.runs.map((r) => r.uptimeTail);
  const err = result.runs.map((r) => r.errTailMean);
  const rng = new LcgRng(123456);
  const epCi = bootstrapMean(ep, reps, rng);
  const missCi = bootstrapMean(miss, reps, rng);
  summaryRows.push({
    mode: mode.id,
    meanEp: mean(ep),
    stdEp: std(ep),
    epCiLow: epCi.lo,
    epCiHigh: epCi.hi,
    meanMiss: mean(miss),
    stdMiss: std(miss),
    missCiLow: missCi.lo,
    missCiHigh: missCi.hi,
    meanUptime: mean(uptime),
    meanErr: mean(err),
  });
}

const modeMap = Object.fromEntries(summaryRows.map((row) => [row.mode, row]));
const rng = new LcgRng(98765);
const epDiffCB = bootstrapDiff(
  epByMode.get("C_op_noKdrive") ?? [],
  epByMode.get("B_dilution_only") ?? [],
  reps,
  rng,
);
const missDiffCB = bootstrapDiff(
  missByMode.get("C_op_noKdrive") ?? [],
  missByMode.get("B_dilution_only") ?? [],
  reps,
  rng,
);

const summaryPath = path.join(outDir, "deadline_iso_ci_summary.csv");
const header = [
  "mode",
  "meanEp",
  "epCiLow",
  "epCiHigh",
  "meanMiss",
  "missCiLow",
  "missCiHigh",
  "meanUptime",
  "meanErr",
  "note",
];
const lines = [
  header.join(","),
  ...summaryRows.map((row) =>
    [
      row.mode,
      row.meanEp,
      row.epCiLow,
      row.epCiHigh,
      row.meanMiss,
      row.missCiLow,
      row.missCiHigh,
      row.meanUptime,
      row.meanErr,
      "",
    ].join(","),
  ),
  [
    "DELTA_EP_C_MINUS_B",
    modeMap.C_op_noKdrive.meanEp - modeMap.B_dilution_only.meanEp,
    epDiffCB.lo,
    epDiffCB.hi,
    "",
    "",
    "",
    "",
    "",
    "",
  ].join(","),
  [
    "DELTA_MISS_C_MINUS_B",
    modeMap.C_op_noKdrive.meanMiss - modeMap.B_dilution_only.meanMiss,
    missDiffCB.lo,
    missDiffCB.hi,
    "",
    "",
    "",
    "",
    "",
    "",
  ].join(","),
].join("\n");

fs.writeFileSync(summaryPath, `${lines}\n`);
fs.writeFileSync(path.join(outDir, "deadline_iso_ci_raw.jsonl"), rawRows.join("\n"));

const excludesZero = epDiffCB.lo > 0 || epDiffCB.hi < 0;
console.log(
  `DELTA_EP_C_MINUS_B_CI: ${epDiffCB.lo.toFixed(6)} ${epDiffCB.hi.toFixed(6)} excludesZero=${excludesZero}`,
);
