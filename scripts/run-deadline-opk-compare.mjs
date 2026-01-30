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

function pickPreset() {
  const preferred = path.resolve(rootDir, "scripts/params/clock_code/deadline_fidelity_found.json");
  const fallback = path.resolve(rootDir, "scripts/params/clock_code/code_deadline_gated_clock.json");
  if (fs.existsSync(preferred)) return preferred;
  return fallback;
}

function summarizeRuns(id, runs, meta) {
  const missFrac = runs.map((r) => r.missFrac);
  const uptimeTail = runs.map((r) => r.uptimeTail);
  const errTail = runs.map((r) => r.errTailMean);
  const sdiffTail = runs.map((r) => r.sdiffTailMean);
  const recP95 = runs.map((r) => r.recoveryP95 ?? 0);
  const epTotal = runs.map((r) => r.epTotalRate);
  const epClock = runs.map((r) => r.epClockRate);
  const epRepair = runs.map((r) => r.epRepairRate);
  const epOpK = runs.map((r) => r.epOpKRate ?? 0);

  return {
    id,
    ...meta,
    missFracMean: mean(missFrac),
    missFracStd: std(missFrac),
    uptimeTailMean: mean(uptimeTail),
    uptimeTailStd: std(uptimeTail),
    errTailMean: mean(errTail),
    errTailStd: std(errTail),
    sdiffTailMean: mean(sdiffTail),
    sdiffTailStd: std(sdiffTail),
    recoveryP95Mean: mean(recP95),
    recoveryP95Std: std(recP95),
    epTotalRateMean: mean(epTotal),
    epClockRateMean: mean(epClock),
    epRepairRateMean: mean(epRepair),
    epOpKRateMean: mean(epOpK),
  };
}

function pickBestOp(rows) {
  return rows.reduce((best, row) => {
    if (!best) return row;
    if (row.missFracMean < best.missFracMean - 1e-6) return row;
    if (Math.abs(row.missFracMean - best.missFracMean) <= 1e-6) {
      if (row.uptimeTailMean > best.uptimeTailMean + 1e-6) return row;
      if (Math.abs(row.uptimeTailMean - best.uptimeTailMean) <= 1e-6) {
        if (row.epTotalRateMean < best.epTotalRateMean - 1e-6) return row;
      }
    }
    return best;
  }, null);
}

ensureDir(outDir);
await loadWasm();

const presetPath = pickPreset();
const presetRaw = readJson(presetPath);
const baseParams = presetRaw.params ?? presetRaw;
const baseDeadline = presetRaw.deadline ?? 25_000;
const seeds = Array.from({ length: 10 }, (_, i) => i + 1);

const rawRows = [];
const summaryRows = [];

const legacyParams = { ...baseParams, opCouplingOn: 0, sCouplingMode: 0 };
const legacyRuns = await runDeadlineEvents({
  presetPath,
  presetParams: legacyParams,
  variant: "drift",
  seeds,
  steps: 2_000_000,
  reportEvery: 5_000,
  eventEvery: 50_000,
  deadline: baseDeadline,
  regionType: "quadrant",
  regionIndex: 2,
  gateSpan: null,
  corruptFrac: 0.2,
  errGood: 0.1,
  sdiffGood: 1.0,
  tailWindow: 200_000,
});
for (const r of legacyRuns.runs) rawRows.push(JSON.stringify({ variant: "legacy", ...r }));
summaryRows.push(
  summarizeRuns("legacy", legacyRuns.runs, { opStencil: "", opBudgetK: "" }),
);

const opConfigs = [];
for (const opStencil of [0, 1]) {
  for (const opBudgetK of [8, 16, 32]) {
    opConfigs.push({ opStencil, opBudgetK });
  }
}

const opSummaries = [];
for (const cfg of opConfigs) {
  const params = {
    ...baseParams,
    opCouplingOn: 1,
    sCouplingMode: 1,
    opDriveOnK: 1,
    opStencil: cfg.opStencil,
    opBudgetK: cfg.opBudgetK,
  };
  const runs = await runDeadlineEvents({
    presetPath,
    presetParams: params,
    variant: "drift",
    seeds,
    steps: 2_000_000,
    reportEvery: 5_000,
    eventEvery: 50_000,
    deadline: baseDeadline,
    regionType: "quadrant",
    regionIndex: 2,
    gateSpan: null,
    corruptFrac: 0.2,
    errGood: 0.1,
    sdiffGood: 1.0,
    tailWindow: 200_000,
  });
  for (const r of runs.runs) {
    rawRows.push(JSON.stringify({ variant: "op", opStencil: cfg.opStencil, opBudgetK: cfg.opBudgetK, ...r }));
  }
  const summary = summarizeRuns(
    `op_s${cfg.opStencil}_b${cfg.opBudgetK}`,
    runs.runs,
    cfg,
  );
  opSummaries.push(summary);
  summaryRows.push(summary);
}

const bestOp = pickBestOp(opSummaries);
const legacy = summaryRows.find((r) => r.id === "legacy");
const bestConfig = {
  ...baseParams,
  opCouplingOn: 1,
  sCouplingMode: 1,
  opDriveOnK: 1,
  opStencil: bestOp.opStencil,
  opBudgetK: bestOp.opBudgetK,
  note: "best op config from run-deadline-opk-compare",
};
const bestPath = path.resolve(rootDir, "scripts/params/op_coupling/deadline_opk_best.json");
fs.mkdirSync(path.dirname(bestPath), { recursive: true });
fs.writeFileSync(bestPath, `${JSON.stringify(bestConfig, null, 2)}\n`);

const summaryPath = path.join(outDir, "deadline_opk_summary.csv");
const header = [
  "id",
  "opStencil",
  "opBudgetK",
  "missFracMean",
  "missFracStd",
  "uptimeTailMean",
  "uptimeTailStd",
  "errTailMean",
  "errTailStd",
  "sdiffTailMean",
  "sdiffTailStd",
  "recoveryP95Mean",
  "recoveryP95Std",
  "epTotalRateMean",
  "epClockRateMean",
  "epRepairRateMean",
  "epOpKRateMean",
];
const lines = [
  header.join(","),
  ...summaryRows.map((row) =>
    [
      row.id,
      row.opStencil,
      row.opBudgetK,
      row.missFracMean,
      row.missFracStd,
      row.uptimeTailMean,
      row.uptimeTailStd,
      row.errTailMean,
      row.errTailStd,
      row.sdiffTailMean,
      row.sdiffTailStd,
      row.recoveryP95Mean,
      row.recoveryP95Std,
      row.epTotalRateMean,
      row.epClockRateMean,
      row.epRepairRateMean,
      row.epOpKRateMean,
    ].join(","),
  ),
].join("\n");
fs.writeFileSync(summaryPath, `${lines}\n`);

const rawPath = path.join(outDir, "deadline_opk_raw.jsonl");
fs.writeFileSync(rawPath, rawRows.join("\n"));

console.log(`BEST_OP_CONFIG: stencil=${bestOp.opStencil} budget=${bestOp.opBudgetK} miss=${bestOp.missFracMean.toFixed(3)} uptimeTail=${bestOp.uptimeTailMean.toFixed(3)} epRate=${bestOp.epTotalRateMean.toFixed(4)}`);
const improved =
  bestOp.missFracMean < legacy.missFracMean - 1e-3 ||
  (bestOp.missFracMean <= legacy.missFracMean + 1e-3 &&
    bestOp.uptimeTailMean > legacy.uptimeTailMean + 0.02);
if (!improved) {
  console.log("NO_IMPROVEMENT_OVER_LEGACY");
}
console.log(`deadline opk compare summary written to ${summaryPath}`);
