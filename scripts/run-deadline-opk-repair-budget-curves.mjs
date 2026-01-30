#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {
  loadWasm,
  mean,
  readJson,
  runDeadlineEvents,
} from "./deadline-event-utils.mjs";

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const outDir = path.resolve(rootDir, ".tmp", "op_coupling");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function pickPreset() {
  const preferred = path.resolve(rootDir, "scripts/params/clock_code/deadline_fidelity_found.json");
  const fallback = path.resolve(rootDir, "scripts/params/clock_code/code_deadline_gated_clock.json");
  if (fs.existsSync(preferred)) return preferred;
  return fallback;
}

ensureDir(outDir);
await loadWasm();

const presetPath = pickPreset();
const presetRaw = readJson(presetPath);
const baseParams = presetRaw.params ?? presetRaw;
const baseDeadline = presetRaw.deadline ?? 25_000;

const paramsPath = path.join(outDir, "deadline_rate_matched_v4_best_params.json");
if (!fs.existsSync(paramsPath)) {
  throw new Error("Missing deadline_rate_matched_v4_best_params.json; run throughput-matched v4 first.");
}
const bestParams = readJson(paramsPath);

const seeds = Array.from({ length: 10 }, (_, i) => i + 1);
const steps = 500_000;
const reportEvery = 5_000;
const eventEvery = 50_000;
const regionType = "quadrant";
const regionIndex = 2;
const errGood = 0.1;
const sdiffGood = 1.0;
const tailWindow = 200_000;

const budgets = [5, 10, 15, 20, 30, 40, 60, 80];

const modes = [
  { id: "A_legacy", params: { ...baseParams, opCouplingOn: 0, sCouplingMode: 0, opDriveOnK: 0 } },
  { id: "B_dilution_only", params: { ...baseParams, opCouplingOn: 1, sCouplingMode: 0, opDriveOnK: 0 } },
  { id: "C_op_noKdrive", params: { ...baseParams, opCouplingOn: 1, sCouplingMode: 1, opDriveOnK: 0 } },
  { id: "D_op_withKdrive", params: { ...baseParams, opCouplingOn: 1, sCouplingMode: 1, opDriveOnK: 1 } },
];

const rawRows = [];
const pointsRows = [];
const summaryRows = [];
const repairsByMode = new Map();
const eventsByMode = new Map();

for (const mode of modes) {
  const modeParams = bestParams[mode.id] ?? {};
  const params = {
    ...mode.params,
    opKTargetWeight: modeParams.opKTargetWeightMean ?? 1.0,
    pSWrite: modeParams.pSWriteMean ?? baseParams.pSWrite ?? 0.1,
    opStencil: modeParams.opStencil ?? mode.params.opStencil,
    opBudgetK: modeParams.opBudgetK ?? mode.params.opBudgetK,
    opDriveOnK: modeParams.opDriveOnK ?? mode.params.opDriveOnK,
  };

  const result = await runDeadlineEvents({
    presetPath,
    presetParams: params,
    variant: "drift",
    seeds,
    steps,
    reportEvery,
    eventEvery,
    deadline: baseDeadline,
    regionType,
    regionIndex,
    gateSpan: null,
    corruptFrac: 0.2,
    errGood,
    sdiffGood,
    tailWindow,
    includeEvents: true,
  });

  const repairs = [];
  for (const run of result.runs) {
    rawRows.push(JSON.stringify({ mode: mode.id, seed: run.seed, ...run }));
    if (!run.eventOutcomes) continue;
    for (const evt of run.eventOutcomes) {
      const val = evt.repairsUsed;
      repairs.push(val);
    }
  }
  repairsByMode.set(mode.id, repairs);
  eventsByMode.set(mode.id, result.runs.reduce((acc, r) => acc + (r.events ?? 0), 0));

  const successRepairs = repairs.filter((v) => Number.isFinite(v));
  const meanSuccess = successRepairs.length ? mean(successRepairs) : null;
  const sortedSuccess = successRepairs.slice().sort((a, b) => a - b);
  const medianSuccess = sortedSuccess.length
    ? sortedSuccess[Math.floor(sortedSuccess.length / 2)]
    : null;

  summaryRows.push({
    mode: mode.id,
    meanRepairsSuccess: meanSuccess,
    medianRepairsSuccess: medianSuccess,
    totalEvents: repairs.length,
  });
}

function bootstrapCI(values, budget, reps) {
  const n = values.length;
  if (n === 0) return { lo: null, hi: null };
  const draws = [];
  const rng = new (class {
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
  })(budget * 997 + n);
  for (let i = 0; i < reps; i += 1) {
    let succ = 0;
    for (let j = 0; j < n; j += 1) {
      if (values[rng.int(n)] <= budget) succ += 1;
    }
    draws.push(succ / n);
  }
  draws.sort((a, b) => a - b);
  const lo = draws[Math.floor(0.025 * reps)];
  const hi = draws[Math.floor(0.975 * reps)];
  return { lo, hi };
}

const pointsPath = path.join(outDir, "repair_budget_curves_points.csv");
const pointsLines = [
  "mode,budget,pSucc,pSuccCiLow,pSuccCiHigh,events",
];
for (const mode of modes) {
  const repairs = repairsByMode.get(mode.id) ?? [];
  const total = repairs.length;
  for (const budget of budgets) {
    const succ = repairs.filter((v) => v <= budget).length;
    const psucc = total > 0 ? succ / total : 0;
    const ci = bootstrapCI(repairs, budget, 2000);
    pointsLines.push(
      [
        mode.id,
        budget,
        psucc,
        ci.lo ?? "",
        ci.hi ?? "",
        total,
      ].join(","),
    );
    pointsRows.push({
      mode: mode.id,
      budget,
      pSucc: psucc,
      pSuccCiLow: ci.lo,
      pSuccCiHigh: ci.hi,
      events: total,
    });
  }
}
fs.writeFileSync(pointsPath, `${pointsLines.join("\n")}\n`);

const summaryPath = path.join(outDir, "repair_budget_curves_summary.csv");
const summaryLines = [
  "mode,meanRepairsSuccess,medianRepairsSuccess,totalEvents",
  ...summaryRows.map((row) =>
    [row.mode, row.meanRepairsSuccess ?? "", row.medianRepairsSuccess ?? "", row.totalEvents].join(","),
  ),
].join("\n");
fs.writeFileSync(summaryPath, `${summaryLines}\n`);

fs.writeFileSync(path.join(outDir, "repair_budget_curves_raw.jsonl"), rawRows.join("\n"));

const modeToBudgets = new Map();
for (const row of pointsRows) {
  const key = row.mode;
  if (!modeToBudgets.has(key)) modeToBudgets.set(key, new Map());
  modeToBudgets.get(key).set(row.budget, row.pSucc);
}

const checkDominance = (a, b) => {
  for (const budget of budgets) {
    const pa = modeToBudgets.get(a)?.get(budget);
    const pb = modeToBudgets.get(b)?.get(budget);
    if (pa == null || pb == null) continue;
    if (pa < pb) return { ok: false, budget };
  }
  return { ok: true, budget: null };
};

const domCB = checkDominance("C_op_noKdrive", "B_dilution_only");
const domCA = checkDominance("C_op_noKdrive", "A_legacy");
console.log(
  `DOMINANCE_CHECK C>=B: ${domCB.ok}${domCB.ok ? "" : ` firstFailBudget=${domCB.budget}`}`,
);
console.log(
  `DOMINANCE_CHECK C>=A: ${domCA.ok}${domCA.ok ? "" : ` firstFailBudget=${domCA.budget}`}`,
);
