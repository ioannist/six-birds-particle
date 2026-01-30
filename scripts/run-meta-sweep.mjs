#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const logsDir = path.resolve(rootDir, ".tmp", "experiments_meta");

const seeds = [1, 2, 3];
const runs = [
  {
    id: "meta2_null_decoupled",
    steps: 3_000_000,
    reportEvery: 1_000_000,
    params: "scripts/params/meta/meta2_null_decoupled.json",
  },
  {
    id: "meta2_null_coupled",
    steps: 3_000_000,
    reportEvery: 1_000_000,
    params: "scripts/params/meta/meta2_null_coupled.json",
  },
  {
    id: "meta2_p6_drive_coupled",
    steps: 2_000_000,
    reportEvery: 1_000_000,
    params: "scripts/params/meta/meta2_p6_drive_coupled.json",
  },
  {
    id: "meta2_p3_pump_coupled",
    steps: 1_000_000,
    reportEvery: 200_000,
    loopEvery: 50_000,
    params: "scripts/params/meta/meta2_p3_pump_coupled.json",
  },
  {
    id: "meta2_p3p6_combo_coupled",
    steps: 2_000_000,
    reportEvery: 500_000,
    loopEvery: 50_000,
    params: "scripts/params/meta/meta2_p3p6_combo_coupled.json",
  },
];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function meanStd(values) {
  const nums = values.filter((v) => Number.isFinite(v));
  if (nums.length === 0) return { mean: null, std: null };
  const mean = nums.reduce((acc, v) => acc + v, 0) / nums.length;
  const variance = nums.reduce((acc, v) => acc + (v - mean) ** 2, 0) / nums.length;
  return { mean, std: Math.sqrt(variance) };
}

function fmt(value, digits = 4) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "n/a";
  return value.toFixed(digits);
}

function graphStats(n, bonds) {
  const parent = Array.from({ length: n }, (_, i) => i);
  const size = Array.from({ length: n }, () => 1);
  const find = (x) => {
    let p = parent[x];
    while (p !== parent[p]) p = parent[p];
    while (x !== p) {
      const next = parent[x];
      parent[x] = p;
      x = next;
    }
    return p;
  };
  const unite = (a, b) => {
    let ra = find(a);
    let rb = find(b);
    if (ra === rb) return;
    if (size[ra] < size[rb]) {
      [ra, rb] = [rb, ra];
    }
    parent[rb] = ra;
    size[ra] += size[rb];
  };
  for (let i = 0; i < bonds.length; i += 2) {
    unite(bonds[i], bonds[i + 1]);
  }
  let components = 0;
  let largest = 0;
  for (let i = 0; i < n; i += 1) {
    if (parent[i] === i) {
      components += 1;
      largest = Math.max(largest, size[i]);
    }
  }
  return { edges: bonds.length / 2, components, largest, n };
}

function formatSummary(totalSteps, energy, diag, graph) {
  const lines = [];
  lines.push(
    `E=${energy.total.toFixed(3)} (Urep ${energy.uRep.toFixed(3)}, Ubond ${energy.uBond.toFixed(3)}, Ew ${energy.eW.toFixed(3)}, En ${energy.eN.toFixed(3)}, Ea ${energy.eA.toFixed(3)}, Es ${energy.eS.toFixed(3)})`,
  );
  lines.push(`Steps: ${totalSteps}`);
  lines.push(
    `P1 steps ${diag.window} | N+ ${diag.wPlus} N- ${diag.wMinus} | Jw ${diag.jW.toFixed(4)} Aw ${diag.aW.toFixed(4)} Σmem ${diag.sigmaMem.toFixed(4)}`,
  );
  lines.push(
    `P2 steps ${diag.window} | N+ ${diag.aPlus} N- ${diag.aMinus} | Ja ${diag.jA.toFixed(4)} Aa ${diag.aA.toFixed(4)}`,
  );
  lines.push(
    `P4 steps ${diag.window} | N+ ${diag.nPlus} N- ${diag.nMinus} | Jn ${diag.jN.toFixed(4)} An ${diag.aN.toFixed(4)}`,
  );
  lines.push(
    `P5 steps ${diag.window} | N+ ${diag.sPlus} N- ${diag.sMinus} | Js ${diag.jS.toFixed(4)} As ${diag.aS.toFixed(4)}`,
  );
  lines.push(`P3 cycle ${diag.p3CycleLen} | disp ${diag.p3DispMag.toFixed(4)} | loop ${diag.p3LoopArea.toFixed(4)}`);
  lines.push(
    `P6 M6 | W ${diag.aM6W.toFixed(4)} N ${diag.aM6N.toFixed(4)} A ${diag.aM6A.toFixed(4)} S ${diag.aM6S.toFixed(4)}`,
  );
  lines.push(
    `Graph edges ${graph.edges} | components ${graph.components} | largest ${graph.largest}/${graph.n}`,
  );
  return lines;
}

function meanAbsDiff(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += Math.abs(a[i] - b[i]);
  }
  return a.length === 0 ? 0 : sum / a.length;
}

function nonzeroFraction(arr) {
  if (arr.length === 0) return 0;
  let nz = 0;
  for (const v of arr) {
    if (v !== 0) nz += 1;
  }
  return nz / arr.length;
}

function crossLayerMetrics(sim) {
  const baseS = sim.base_s_field();
  const metaS = sim.meta_field();
  const metaW = sim.meta_w_edges();
  const metaA = sim.meta_a_field();
  const metaN = sim.meta_n_field();
  const cells = baseS.length;
  const edgeCount = cells * 2;
  const metaLayers = cells > 0 ? Math.floor(metaS.length / cells) : 0;
  const s0 = metaS.subarray(0, cells);
  const s1 = metaS.subarray(cells, 2 * cells);
  const w0 = metaW.subarray(0, edgeCount);
  const w1 = metaW.subarray(edgeCount, 2 * edgeCount);
  const sdiffBase = meanAbsDiff(baseS, s0);
  const sdiffMeta = meanAbsDiff(s0, s1);
  const wdiffMeta = meanAbsDiff(w0, w1);
  return {
    metaLayers,
    sdiffBase,
    sdiffMeta,
    wdiffMeta,
    nzMetaS: nonzeroFraction(metaS),
    nzMetaW: nonzeroFraction(metaW),
    nzMetaA: nonzeroFraction(metaA),
    nzMetaN: nonzeroFraction(metaN),
  };
}

function readParams(relPath) {
  const file = path.resolve(rootDir, relPath);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function checkEtaEffect(mod) {
  const base = {
    gridSize: 12,
    metaLayers: 2,
    p3On: 0,
    p6On: 0,
  };
  const steps = 1_000_000;

  // S-only coupling sanity.
  const sParams = {
    ...base,
    pSWrite: 1,
    pWrite: 0,
    pNWrite: 0,
    pAWrite: 0,
    lambdaS: 0,
    lS: 2,
  };
  const s0 = new mod.Sim(50, 1);
  s0.set_params({ ...sParams, eta: 0.0 });
  s0.step(steps);
  const s1 = new mod.Sim(50, 1);
  s1.set_params({ ...sParams, eta: 1.0 });
  s1.step(steps);
  const sDiff0 = crossLayerMetrics(s0);
  const sDiff1 = crossLayerMetrics(s1);
  const okS0 = sDiff1.sdiffBase <= 0.85 * sDiff0.sdiffBase;
  const okS1 = sDiff1.sdiffMeta <= 0.85 * sDiff0.sdiffMeta;

  // W-only coupling sanity (meta edges).
  const wParams = {
    ...base,
    pSWrite: 0,
    pWrite: 1,
    pNWrite: 0,
    pAWrite: 0,
    lambdaW: 0,
    kappaBond: 0,
    lW: 2,
  };
  const w0 = new mod.Sim(50, 1);
  w0.set_params({ ...wParams, eta: 0.0 });
  w0.step(steps);
  const w1 = new mod.Sim(50, 1);
  w1.set_params({ ...wParams, eta: 1.0 });
  w1.step(steps);
  const wDiff0 = crossLayerMetrics(w0);
  const wDiff1 = crossLayerMetrics(w1);
  const okW = wDiff1.wdiffMeta <= 0.85 * wDiff0.wdiffMeta;

  console.log(
    `Eta sanity S: base/meta0 ${sDiff0.sdiffBase.toFixed(4)} -> ${sDiff1.sdiffBase.toFixed(4)}, ` +
      `meta0/meta1 ${sDiff0.sdiffMeta.toFixed(4)} -> ${sDiff1.sdiffMeta.toFixed(4)}`,
  );
  console.log(
    `Eta sanity W: meta0/meta1 ${wDiff0.wdiffMeta.toFixed(4)} -> ${wDiff1.wdiffMeta.toFixed(4)}`,
  );
  if (!okS0 || !okS1 || !okW) {
    throw new Error("Eta sanity check failed (diff reduction < 15%).");
  }
}

ensureDir(logsDir);

const wasmDir = path.resolve(rootDir, "apps/web/src/wasm/sim_core");
const wasmJs = pathToFileURL(path.join(wasmDir, "sim_core.js")).href;
const wasmBytes = fs.readFileSync(path.join(wasmDir, "sim_core_bg.wasm"));
const mod = await import(wasmJs);
mod.initSync({ module: wasmBytes });

checkEtaEffect(mod);

const summaries = [];
for (const run of runs) {
  const seedResults = [];
  for (const seed of seeds) {
    const params = readParams(run.params);
    const sim = new mod.Sim(200, seed);
    sim.set_params(params);
    const logPath = path.join(logsDir, `${run.id}-seed${seed}.log`);
    const logLines = [];
    let totalSteps = 0;
    const loopSamples = [];
    const dispSamples = [];
    const reportEvery = Math.max(1, Math.floor(run.reportEvery));
    const loopEvery = Math.max(1, Math.floor(run.loopEvery ?? run.reportEvery));
    const chunk = Math.min(reportEvery, loopEvery);
    while (totalSteps < run.steps) {
      const stepNow = Math.min(chunk, run.steps - totalSteps);
      sim.step(stepNow);
      totalSteps += stepNow;
      if (totalSteps % loopEvery === 0 || totalSteps === run.steps) {
        const diag = sim.diagnostics();
        loopSamples.push(Math.abs(diag.p3LoopArea));
        dispSamples.push(Math.abs(diag.p3DispMag));
      }
      if (totalSteps % reportEvery === 0 || totalSteps === run.steps) {
        const energy = sim.energy_breakdown();
        const diag = sim.diagnostics();
        const bonds = sim.bonds(3);
        const graph = graphStats(200, bonds);
        for (const line of formatSummary(totalSteps, energy, diag, graph)) {
          logLines.push(line);
        }
        logLines.push("");
      }
    }
    const cross = crossLayerMetrics(sim);
    logLines.push(
      `Meta S diff base/meta0 ${cross.sdiffBase.toFixed(4)} | meta0/meta1 ${cross.sdiffMeta.toFixed(4)} | ` +
        `W diff meta0/meta1 ${cross.wdiffMeta.toFixed(4)}`,
    );
    logLines.push(
      `Meta nz S ${cross.nzMetaS.toFixed(4)} | W ${cross.nzMetaW.toFixed(4)} | A ${cross.nzMetaA.toFixed(4)} | N ${cross.nzMetaN.toFixed(4)}`,
    );
    fs.writeFileSync(logPath, logLines.join("\n"));

    const loopAbsMean =
      loopSamples.length === 0 ? null : loopSamples.reduce((a, v) => a + v, 0) / loopSamples.length;
    const loopNonzero =
      loopSamples.length === 0
        ? null
        : loopSamples.filter((v) => v > 1e-6).length / loopSamples.length;

    const diag = sim.diagnostics();
    const bonds = sim.bonds(3);
    const graph = graphStats(200, bonds);
    seedResults.push({
      seed,
      metrics: {
        sigmaMem: diag.sigmaMem,
        aw: diag.aW,
        aa: diag.aA,
        an: diag.aN,
        as: diag.aS,
        m6w: diag.aM6W,
        m6n: diag.aM6N,
        m6a: diag.aM6A,
        m6s: diag.aM6S,
        edges: graph.edges,
        largest: graph.largest,
        sdiffBase: cross.sdiffBase,
        sdiffMeta: cross.sdiffMeta,
        wdiffMeta: cross.wdiffMeta,
        nzMetaS: cross.nzMetaS,
        nzMetaW: cross.nzMetaW,
        nzMetaA: cross.nzMetaA,
        nzMetaN: cross.nzMetaN,
      },
      loopAbsMean,
      loopNonzero,
    });
  }

  const metricsKeys = [
    "sigmaMem",
    "aw",
    "aa",
    "an",
    "as",
    "m6w",
    "m6n",
    "m6a",
    "m6s",
    "sdiffBase",
    "sdiffMeta",
    "wdiffMeta",
    "nzMetaS",
    "nzMetaW",
    "nzMetaA",
    "nzMetaN",
    "edges",
    "largest",
  ];
  const summary = { id: run.id };
  for (const key of metricsKeys) {
    const values = seedResults.map((s) => s.metrics[key]).filter((v) => Number.isFinite(v));
    summary[key] = meanStd(values);
  }
  summary.loopAbs = meanStd(seedResults.map((s) => s.loopAbsMean));
  summary.loopNonzero = meanStd(seedResults.map((s) => s.loopNonzero));
  summary.seeds = seedResults;
  summaries.push(summary);
}

console.log("Summary table (mean ± std):");
console.log(
  [
    "preset",
    "SigmaMem",
    "Aw",
    "Aa",
    "An",
    "As",
    "M6W",
    "M6N",
    "M6A",
    "M6S",
    "loop|mean|",
    "loop>0 frac",
    "Sdiff base/meta0",
    "Sdiff meta0/meta1",
    "Wdiff meta0/meta1",
    "nz metaS",
    "nz metaW",
    "nz metaA",
    "nz metaN",
    "edges",
    "largest",
  ].join("\t"),
);
for (const s of summaries) {
  console.log(
    [
      s.id,
      `${fmt(s.sigmaMem.mean)}±${fmt(s.sigmaMem.std)}`,
      `${fmt(s.aw.mean)}±${fmt(s.aw.std)}`,
      `${fmt(s.aa.mean)}±${fmt(s.aa.std)}`,
      `${fmt(s.an.mean)}±${fmt(s.an.std)}`,
      `${fmt(s.as.mean)}±${fmt(s.as.std)}`,
      `${fmt(s.m6w.mean)}±${fmt(s.m6w.std)}`,
      `${fmt(s.m6n.mean)}±${fmt(s.m6n.std)}`,
      `${fmt(s.m6a.mean)}±${fmt(s.m6a.std)}`,
      `${fmt(s.m6s.mean)}±${fmt(s.m6s.std)}`,
      `${fmt(s.loopAbs.mean)}±${fmt(s.loopAbs.std)}`,
      `${fmt(s.loopNonzero.mean)}±${fmt(s.loopNonzero.std)}`,
      `${fmt(s.sdiffBase.mean)}±${fmt(s.sdiffBase.std)}`,
      `${fmt(s.sdiffMeta.mean)}±${fmt(s.sdiffMeta.std)}`,
      `${fmt(s.wdiffMeta.mean)}±${fmt(s.wdiffMeta.std)}`,
      `${fmt(s.nzMetaS.mean)}±${fmt(s.nzMetaS.std)}`,
      `${fmt(s.nzMetaW.mean)}±${fmt(s.nzMetaW.std)}`,
      `${fmt(s.nzMetaA.mean)}±${fmt(s.nzMetaA.std)}`,
      `${fmt(s.nzMetaN.mean)}±${fmt(s.nzMetaN.std)}`,
      `${fmt(s.edges.mean, 0)}±${fmt(s.edges.std, 0)}`,
      `${fmt(s.largest.mean, 0)}±${fmt(s.largest.std, 0)}`,
    ].join("\t"),
  );
}
