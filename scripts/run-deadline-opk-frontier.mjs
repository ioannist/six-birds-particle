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

function readBestConfigs() {
  const summaryPath = path.resolve(outDir, "deadline_decomp_summary.csv");
  const defaults = {
    bestC: { opStencil: 1, opBudgetK: 32 },
    bestD: { opStencil: 1, opBudgetK: 16 },
  };
  if (!fs.existsSync(summaryPath)) return defaults;
  const lines = fs.readFileSync(summaryPath, "utf8").trim().split("\n");
  const header = lines.shift()?.split(",") ?? [];
  const idx = Object.fromEntries(header.map((k, i) => [k, i]));
  for (const line of lines) {
    const cols = line.split(",");
    const note = cols[idx.note] ?? "";
    if (note === "BEST_C") {
      defaults.bestC = {
        opStencil: Number(cols[idx.opStencil]),
        opBudgetK: Number(cols[idx.opBudgetK]),
      };
    }
    if (note === "BEST_D") {
      defaults.bestD = {
        opStencil: Number(cols[idx.opStencil]),
        opBudgetK: Number(cols[idx.opBudgetK]),
      };
    }
  }
  return defaults;
}

function summarizeRuns(id, runs, meta) {
  const missFrac = runs.map((r) => r.missFrac);
  const uptimeTail = runs.map((r) => r.uptimeTail);
  const errTail = runs.map((r) => r.errTailMean);
  const epTotal = runs.map((r) => r.epTotalRate);
  const epRepair = runs.map((r) => r.epRepairRate);
  const repairRate = runs.map((r) => r.repairRate ?? 0);
  const p5MetaSuccess = runs.map((r) => r.p5MetaToRecoverSuccessMean ?? 0);

  return {
    id,
    ...meta,
    missFracMean: mean(missFrac),
    missFracStd: std(missFrac),
    uptimeTailMean: mean(uptimeTail),
    uptimeTailStd: std(uptimeTail),
    errTailMean: mean(errTail),
    errTailStd: std(errTail),
    epTotalRateMean: mean(epTotal),
    epTotalRateStd: std(epTotal),
    epRepairRateMean: mean(epRepair),
    repairRateMean: mean(repairRate),
    p5MetaToRecoverSuccessMean: mean(p5MetaSuccess),
  };
}

function paretoFront(points) {
  return points.filter((a) => {
    for (const b of points) {
      if (b === a) continue;
      const noWorse = b.missFracMean <= a.missFracMean && b.epTotalRateMean <= a.epTotalRateMean;
      const strictlyBetter = b.missFracMean < a.missFracMean || b.epTotalRateMean < a.epTotalRateMean;
      if (noWorse && strictlyBetter) return false;
    }
    return true;
  });
}

ensureDir(outDir);
await loadWasm();

const presetPath = pickPreset();
const presetRaw = readJson(presetPath);
const baseParams = presetRaw.params ?? presetRaw;
const baseDeadline = presetRaw.deadline ?? 25_000;
const best = readBestConfigs();

const seeds = [1, 2, 3, 4, 5];
const steps = 500_000;
const reportEvery = 5_000;
const eventEvery = 50_000;
const regionType = "quadrant";
const regionIndex = 2;
const errGood = 0.1;
const sdiffGood = 1.0;
const tailWindow = 200_000;

const pSWriteGrid = [0.2, 0.35, 0.5, 0.65, 0.8, 0.95];
const etaDriveGrid = [0.4, 0.6, 0.8, 1.0];

const modes = [
  { id: "A_legacy", params: { ...baseParams, opCouplingOn: 0, sCouplingMode: 0, opDriveOnK: 0 } },
  { id: "B_dilution_only", params: { ...baseParams, opCouplingOn: 1, sCouplingMode: 0, opDriveOnK: 0 } },
  {
    id: "C_op_noKdrive",
    params: {
      ...baseParams,
      opCouplingOn: 1,
      sCouplingMode: 1,
      opDriveOnK: 0,
      opStencil: best.bestC.opStencil,
      opBudgetK: best.bestC.opBudgetK,
    },
  },
  {
    id: "D_op_withKdrive",
    params: {
      ...baseParams,
      opCouplingOn: 1,
      sCouplingMode: 1,
      opDriveOnK: 1,
      opStencil: best.bestD.opStencil,
      opBudgetK: best.bestD.opBudgetK,
    },
  },
];

const rawRows = [];
const summaryRows = [];

for (const mode of modes) {
  for (const pSWrite of pSWriteGrid) {
    for (const etaDrive of etaDriveGrid) {
      const params = { ...mode.params, pSWrite, etaDrive };
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
      });
      for (const run of result.runs) {
        rawRows.push(
          JSON.stringify({
            mode: mode.id,
            seed: run.seed,
            pSWrite,
            etaDrive,
            opStencil: params.opStencil ?? "",
            opBudgetK: params.opBudgetK ?? "",
            opDriveOnK: params.opDriveOnK ?? "",
            ...run,
          }),
        );
      }
      summaryRows.push(
        summarizeRuns(
          `${mode.id}_p${pSWrite}_e${etaDrive}`,
          result.runs,
          {
            mode: mode.id,
            pSWrite,
            etaDrive,
            opStencil: params.opStencil ?? "",
            opBudgetK: params.opBudgetK ?? "",
            opDriveOnK: params.opDriveOnK ?? "",
          },
        ),
      );
    }
  }
}

const summaryPath = path.join(outDir, "deadline_frontier_summary.csv");
const header = [
  "id",
  "mode",
  "pSWrite",
  "etaDrive",
  "opStencil",
  "opBudgetK",
  "opDriveOnK",
  "missFracMean",
  "missFracStd",
  "uptimeTailMean",
  "uptimeTailStd",
  "errTailMean",
  "errTailStd",
  "epTotalRateMean",
  "epTotalRateStd",
  "epRepairRateMean",
  "repairRateMean",
  "p5MetaToRecoverSuccessMean",
];
const lines = [
  header.join(","),
  ...summaryRows.map((row) =>
    [
      row.id,
      row.mode,
      row.pSWrite,
      row.etaDrive,
      row.opStencil ?? "",
      row.opBudgetK ?? "",
      row.opDriveOnK ?? "",
      row.missFracMean,
      row.missFracStd,
      row.uptimeTailMean,
      row.uptimeTailStd,
      row.errTailMean,
      row.errTailStd,
      row.epTotalRateMean,
      row.epTotalRateStd,
      row.epRepairRateMean,
      row.repairRateMean,
      row.p5MetaToRecoverSuccessMean,
    ].join(","),
  ),
].join("\n");
fs.writeFileSync(summaryPath, `${lines}\n`);
fs.writeFileSync(path.join(outDir, "deadline_frontier_raw.jsonl"), rawRows.join("\n"));

const frontierRows = [];
for (const mode of modes) {
  const subset = summaryRows.filter((row) => row.mode === mode.id);
  const front = paretoFront(subset);
  frontierRows.push(...front);
}
const frontHeader = [
  "mode",
  "pSWrite",
  "etaDrive",
  "opStencil",
  "opBudgetK",
  "opDriveOnK",
  "missFracMean",
  "epTotalRateMean",
  "uptimeTailMean",
  "errTailMean",
];
const frontLines = [
  frontHeader.join(","),
  ...frontierRows.map((row) =>
    [
      row.mode,
      row.pSWrite,
      row.etaDrive,
      row.opStencil ?? "",
      row.opBudgetK ?? "",
      row.opDriveOnK ?? "",
      row.missFracMean,
      row.epTotalRateMean,
      row.uptimeTailMean,
      row.errTailMean,
    ].join(","),
  ),
].join("\n");
fs.writeFileSync(path.join(outDir, "deadline_frontier_points.csv"), `${frontLines}\n`);

const isoThresholds = [0.05, 0.08, 0.1, 0.12];
const isoRows = [];
for (const mode of modes) {
  for (const tau of isoThresholds) {
    const candidates = summaryRows.filter((row) => row.mode === mode.id && row.missFracMean <= tau);
    if (candidates.length === 0) {
      isoRows.push({ mode: mode.id, tau, epTotalRate: null, pSWrite: null, etaDrive: null });
      continue;
    }
    const best = candidates.reduce(
      (acc, row) => (row.epTotalRateMean < acc.epTotalRateMean ? row : acc),
      candidates[0],
    );
    isoRows.push({
      mode: mode.id,
      tau,
      epTotalRate: best.epTotalRateMean,
      pSWrite: best.pSWrite,
      etaDrive: best.etaDrive,
    });
  }
}
const isoPath = path.join(outDir, "deadline_frontier_iso_miss.csv");
const isoLines = [
  "mode,tau,epTotalRate,pSWrite,etaDrive",
  ...isoRows.map((row) =>
    [
      row.mode,
      row.tau,
      row.epTotalRate ?? "",
      row.pSWrite ?? "",
      row.etaDrive ?? "",
    ].join(","),
  ),
].join("\n");
fs.writeFileSync(isoPath, `${isoLines}\n`);

console.log("ISO_MISS_TABLE");
for (const row of isoRows) {
  const ep = row.epTotalRate === null ? "NA" : row.epTotalRate.toFixed(6);
  console.log(`${row.mode} tau=${row.tau} ep=${ep} pSWrite=${row.pSWrite ?? "NA"} etaDrive=${row.etaDrive ?? "NA"}`);
}
