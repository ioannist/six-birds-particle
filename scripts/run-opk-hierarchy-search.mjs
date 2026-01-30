#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { computeOpkMetrics, computeSpearman, finiteCheck } from "./opk-metrics.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const outDir = path.resolve(rootDir, ".tmp", "op_coupling");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

const wasmDir = path.resolve(rootDir, "apps/web/src/wasm/sim_core");
const wasmJs = pathToFileURL(path.join(wasmDir, "sim_core.js")).href;
const wasmBytes = fs.readFileSync(path.join(wasmDir, "sim_core_bg.wasm"));
const mod = await import(wasmJs);
mod.initSync({ module: wasmBytes });

function mean(values) {
  return values.reduce((acc, v) => acc + v, 0) / values.length;
}

function std(values, meanVal) {
  const variance = values.reduce((acc, v) => acc + (v - meanVal) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

const metaLayersList = [2, 3, 4];
const stencilList = [0, 1];
const budgetList = [8, 16, 32];
const seeds = [1, 2, 3];
const steps = 1_000_000;

const regimes = [
  {
    id: "null",
    params: {
      p3On: 0,
      p6On: 0,
      eta: 0.6,
      etaDrive: 0,
      opDriveOnK: 0,
      muHigh: 1.0,
      muLow: -1.0,
    },
  },
  {
    id: "drive",
    params: {
      p3On: 0,
      p6On: 1,
      eta: 0.0,
      etaDrive: 0.6,
      opDriveOnK: 1,
      muHigh: 1.0,
      muLow: 1.0,
    },
  },
];

ensureDir(outDir);
const rawPath = path.join(outDir, "opk_hierarchy_raw.jsonl");
const summaryPath = path.join(outDir, "opk_hierarchy_summary.csv");
const bestPath = path.join(outDir, "opk_hierarchy_best.json");

const rawRows = [];
const summaryRows = [];
const bestByRegime = {
  null: { R2: null, H: null, coh: null },
  drive: { R2: null, H: null, coh: null },
};

for (const regime of regimes) {
  const rhoR2All = [];
  const rhoHAll = [];
  const rhoCohAll = [];
  const deltaR2All = [];
  const deltaHAll = [];
  const deltaCohAll = [];

  for (const metaLayers of metaLayersList) {
    for (const opStencil of stencilList) {
      for (const opBudgetK of budgetList) {
        const rhoR2Seeds = [];
        const rhoHSeeds = [];
        const rhoCohSeeds = [];
        const deltaR2Seeds = [];
        const deltaHSeeds = [];
        const deltaCohSeeds = [];

        for (const seed of seeds) {
          const params = {
            beta: 5.0,
            gridSize: 16,
            metaLayers,
            lS: 10,
            lambdaS: 0,
            pWrite: 0,
            pNWrite: 0,
            pAWrite: 0,
            pSWrite: 1,
            opCouplingOn: 1,
            sCouplingMode: 1,
            opStencil,
            opBudgetK,
            initRandom: 1,
            ...regime.params,
          };

          const sim = new mod.Sim(200, seed);
          sim.set_params(params);
          sim.step(steps);

          const baseS = sim.base_s_field();
          const metaS = sim.meta_field();
          const opK = sim.op_k_tokens();
          const opOffsets = sim.op_offsets();
          const rCount = sim.op_r_count();
          const budget = sim.op_budget_k();

          const metrics = computeOpkMetrics({
            gridSize: params.gridSize,
            metaLayers,
            rCount,
            opBudgetK: budget,
            opOffsets,
            opKTokens: opK,
            baseS,
            metaS,
            lS: params.lS,
          });

          if (!finiteCheck(metrics)) {
            throw new Error(`Non-finite metrics for ${regime.id} seed ${seed}`);
          }

          const ifaceIndex = metrics.r2Arr.map((_, idx) => idx);
          const rhoEligible = metaLayers >= 3;
          const rhoR2 = rhoEligible ? computeSpearman(ifaceIndex, metrics.r2Arr) : NaN;
          const rhoH = rhoEligible ? computeSpearman(ifaceIndex, metrics.hArr) : NaN;
          const rhoCoh = rhoEligible ? computeSpearman(ifaceIndex, metrics.cohArr) : NaN;
          const deltaR2 = metrics.r2Arr[metrics.r2Arr.length - 1] - metrics.r2Arr[0];
          const deltaH = metrics.hArr[metrics.hArr.length - 1] - metrics.hArr[0];
          const deltaCoh = metrics.cohArr[metrics.cohArr.length - 1] - metrics.cohArr[0];

          rhoR2Seeds.push(rhoR2);
          rhoHSeeds.push(rhoH);
          rhoCohSeeds.push(rhoCoh);
          deltaR2Seeds.push(deltaR2);
          deltaHSeeds.push(deltaH);
          deltaCohSeeds.push(deltaCoh);

          rawRows.push({
            regime: regime.id,
            metaLayers,
            opStencil,
            opBudgetK,
            seed,
            rhoR2,
            rhoH,
            rhoCoh,
            deltaR2,
            deltaH,
            deltaCoh,
            metrics,
          });
        }

        const validRhoR2 = rhoR2Seeds.filter((v) => Number.isFinite(v));
        const validRhoH = rhoHSeeds.filter((v) => Number.isFinite(v));
        const validRhoCoh = rhoCohSeeds.filter((v) => Number.isFinite(v));
        const rhoR2Mean = validRhoR2.length ? mean(validRhoR2) : NaN;
        const rhoHMean = validRhoH.length ? mean(validRhoH) : NaN;
        const rhoCohMean = validRhoCoh.length ? mean(validRhoCoh) : NaN;
        const deltaR2Mean = mean(deltaR2Seeds);
        const deltaHMean = mean(deltaHSeeds);
        const deltaCohMean = mean(deltaCohSeeds);
        const deltaR2Std = std(deltaR2Seeds, deltaR2Mean);
        const deltaHStd = std(deltaHSeeds, deltaHMean);
        const deltaCohStd = std(deltaCohSeeds, deltaCohMean);

        const signalThreshold = 0.02;
        const signalCheck = (arr) => {
          const pos = arr.filter((v) => v >= signalThreshold).length;
          const neg = arr.filter((v) => v <= -signalThreshold).length;
          const total = arr.length;
          const dominant = Math.max(pos, neg);
          return dominant >= Math.ceil((2 * total) / 3);
        };
        const signalR2 = signalCheck(deltaR2Seeds);
        const signalH = signalCheck(deltaHSeeds);
        const signalCoh = signalCheck(deltaCohSeeds);

        if (Number.isFinite(rhoR2Mean)) rhoR2All.push(rhoR2Mean);
        if (Number.isFinite(rhoHMean)) rhoHAll.push(rhoHMean);
        if (Number.isFinite(rhoCohMean)) rhoCohAll.push(rhoCohMean);
        deltaR2All.push(deltaR2Mean);
        deltaHAll.push(deltaHMean);
        deltaCohAll.push(deltaCohMean);

        const row = {
          regime: regime.id,
          metaLayers,
          opStencil,
          opBudgetK,
          seeds: seeds.length,
          rhoR2Mean,
          rhoHMean,
          rhoCohMean,
          deltaR2Mean,
          deltaHMean,
          deltaCohMean,
          deltaR2Std,
          deltaHStd,
          deltaCohStd,
          signalR2,
          signalH,
          signalCoh,
        };
        summaryRows.push(row);

        const updateBest = (metric, value) => {
          const current = bestByRegime[regime.id][metric];
          if (!Number.isFinite(value)) {
            return;
          }
          if (!current || Math.abs(value) > Math.abs(current.value)) {
            bestByRegime[regime.id][metric] = { value, row };
          }
        };
        updateBest("R2", rhoR2Mean);
        updateBest("H", rhoHMean);
        updateBest("coh", rhoCohMean);
      }
    }
  }

  const rhoR2MeanAll = rhoR2All.length ? mean(rhoR2All) : NaN;
  const rhoHMeanAll = rhoHAll.length ? mean(rhoHAll) : NaN;
  const rhoCohMeanAll = rhoCohAll.length ? mean(rhoCohAll) : NaN;
  summaryRows.push({
    regime: regime.id,
    metaLayers: "",
    opStencil: "",
    opBudgetK: "",
    seeds: "",
    rhoR2Mean: rhoR2MeanAll,
    rhoHMean: rhoHMeanAll,
    rhoCohMean: rhoCohMeanAll,
    deltaR2Mean: std(rhoR2All, rhoR2MeanAll),
    deltaHMean: std(rhoHAll, rhoHMeanAll),
    deltaCohMean: std(rhoCohAll, rhoCohMeanAll),
    deltaR2Std: std(deltaR2All, mean(deltaR2All)),
    deltaHStd: std(deltaHAll, mean(deltaHAll)),
    deltaCohStd: std(deltaCohAll, mean(deltaCohAll)),
    signalR2: "",
    signalH: "",
    signalCoh: "",
    note: "SUMMARY_MEAN_STD_RHO",
  });
}

for (const regime of ["null", "drive"]) {
  const bestR2 = bestByRegime[regime].R2;
  const bestH = bestByRegime[regime].H;
  const bestCoh = bestByRegime[regime].coh;
  if (bestR2) {
    summaryRows.push({
      regime,
      metaLayers: bestR2.row.metaLayers,
      opStencil: bestR2.row.opStencil,
      opBudgetK: bestR2.row.opBudgetK,
      seeds: bestR2.row.seeds,
      rhoR2Mean: bestR2.row.rhoR2Mean,
      rhoHMean: bestR2.row.rhoHMean,
      rhoCohMean: bestR2.row.rhoCohMean,
      deltaR2Mean: bestR2.row.deltaR2Mean,
      deltaHMean: bestR2.row.deltaHMean,
      deltaCohMean: bestR2.row.deltaCohMean,
      note: "BEST_R2",
    });
  }
  if (bestH) {
    summaryRows.push({
      regime,
      metaLayers: bestH.row.metaLayers,
      opStencil: bestH.row.opStencil,
      opBudgetK: bestH.row.opBudgetK,
      seeds: bestH.row.seeds,
      rhoR2Mean: bestH.row.rhoR2Mean,
      rhoHMean: bestH.row.rhoHMean,
      rhoCohMean: bestH.row.rhoCohMean,
      deltaR2Mean: bestH.row.deltaR2Mean,
      deltaHMean: bestH.row.deltaHMean,
      deltaCohMean: bestH.row.deltaCohMean,
      note: "BEST_H",
    });
  }
  if (bestCoh) {
    summaryRows.push({
      regime,
      metaLayers: bestCoh.row.metaLayers,
      opStencil: bestCoh.row.opStencil,
      opBudgetK: bestCoh.row.opBudgetK,
      seeds: bestCoh.row.seeds,
      rhoR2Mean: bestCoh.row.rhoR2Mean,
      rhoHMean: bestCoh.row.rhoHMean,
      rhoCohMean: bestCoh.row.rhoCohMean,
      deltaR2Mean: bestCoh.row.deltaR2Mean,
      deltaHMean: bestCoh.row.deltaHMean,
      deltaCohMean: bestCoh.row.deltaCohMean,
      note: "BEST_COH",
    });
  }
}

const header = [
  "regime",
  "metaLayers",
  "opStencil",
  "opBudgetK",
  "seeds",
  "rhoR2Mean",
  "rhoHMean",
  "rhoCohMean",
  "deltaR2Mean",
  "deltaHMean",
  "deltaCohMean",
  "deltaR2Std",
  "deltaHStd",
  "deltaCohStd",
  "signalR2",
  "signalH",
  "signalCoh",
  "note",
];
const lines = [
  header.join(","),
  ...summaryRows.map((row) =>
    [
      row.regime,
      row.metaLayers,
      row.opStencil,
      row.opBudgetK,
      row.seeds,
      row.rhoR2Mean,
      row.rhoHMean,
      row.rhoCohMean,
      row.deltaR2Mean,
      row.deltaHMean,
      row.deltaCohMean,
      row.deltaR2Std ?? "",
      row.deltaHStd ?? "",
      row.deltaCohStd ?? "",
      row.signalR2 ?? "",
      row.signalH ?? "",
      row.signalCoh ?? "",
      row.note ?? "",
    ].join(","),
  ),
  ["NOTE", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "metaLayers=2 excluded from rho ranking"].join(
    ",",
  ),
  [
    "NOTE",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    summaryRows.some((row) => row.signalR2 || row.signalH || row.signalCoh)
      ? "HIERARCHY_SIGNAL_FOUND"
      : "NO_HIERARCHY_SIGNAL_FOUND",
  ].join(","),
].join("\n");

fs.writeFileSync(rawPath, rawRows.map((r) => JSON.stringify(r)).join("\n"));
fs.writeFileSync(summaryPath, `${lines}\n`);
fs.writeFileSync(bestPath, JSON.stringify(bestByRegime, null, 2));

const bestR2Null = bestByRegime.null.R2?.row;
const bestHNull = bestByRegime.null.H?.row;
const bestCohNull = bestByRegime.null.coh?.row;
const bestR2Drive = bestByRegime.drive.R2?.row;
const bestHDrive = bestByRegime.drive.H?.row;
const bestCohDrive = bestByRegime.drive.coh?.row;

if (bestR2Null) {
  console.log(
    `BEST_R2 null: metaLayers=${bestR2Null.metaLayers} stencil=${bestR2Null.opStencil} budget=${bestR2Null.opBudgetK} rho=${bestR2Null.rhoR2Mean.toFixed(3)}`,
  );
}
if (bestR2Drive) {
  console.log(
    `BEST_R2 drive: metaLayers=${bestR2Drive.metaLayers} stencil=${bestR2Drive.opStencil} budget=${bestR2Drive.opBudgetK} rho=${bestR2Drive.rhoR2Mean.toFixed(3)}`,
  );
}
if (bestHNull) {
  console.log(
    `BEST_H null: metaLayers=${bestHNull.metaLayers} stencil=${bestHNull.opStencil} budget=${bestHNull.opBudgetK} rho=${bestHNull.rhoHMean.toFixed(3)}`,
  );
}
if (bestHDrive) {
  console.log(
    `BEST_H drive: metaLayers=${bestHDrive.metaLayers} stencil=${bestHDrive.opStencil} budget=${bestHDrive.opBudgetK} rho=${bestHDrive.rhoHMean.toFixed(3)}`,
  );
}
if (bestCohNull) {
  console.log(
    `BEST_COH null: metaLayers=${bestCohNull.metaLayers} stencil=${bestCohNull.opStencil} budget=${bestCohNull.opBudgetK} rho=${bestCohNull.rhoCohMean.toFixed(3)}`,
  );
}
if (bestCohDrive) {
  console.log(
    `BEST_COH drive: metaLayers=${bestCohDrive.metaLayers} stencil=${bestCohDrive.opStencil} budget=${bestCohDrive.opBudgetK} rho=${bestCohDrive.rhoCohMean.toFixed(3)}`,
  );
}

console.log("metaLayers=2 excluded from rho ranking");
const signalFound = summaryRows.some((row) => row.signalR2 || row.signalH || row.signalCoh);
if (!signalFound) {
  console.log("NO_HIERARCHY_SIGNAL_FOUND");
}
console.log(
  `opk hierarchy search complete: ${summaryRows.filter((r) => r.note !== "SUMMARY_MEAN_STD_RHO").length} configs`,
);
