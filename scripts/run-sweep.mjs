#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const logsDir = path.resolve(rootDir, ".tmp", "experiments");

const seeds = [1, 2, 3];
const runs = [
  {
    id: "base_null_balanced",
    steps: 5_000_000,
    reportEvery: 1_000_000,
    params: "scripts/params/base_null_balanced.json",
  },
  {
    id: "base_p6_drive",
    steps: 3_000_000,
    reportEvery: 1_000_000,
    params: "scripts/params/base_p6_drive.json",
  },
  {
    id: "base_p3_pump_minimal",
    steps: 1_000_000,
    reportEvery: 200_000,
    params: "scripts/params/base_p3_pump_minimal.json",
  },
  {
    id: "base_p3p6_combo_minimal",
    steps: 2_000_000,
    reportEvery: 500_000,
    params: "scripts/params/base_p3p6_combo_minimal.json",
  },
];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function parseNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseLine(line, metrics, loopSamples) {
  if (line.startsWith("P1 steps")) {
    const jw = line.match(/Jw\s+([-\d.]+)/);
    const aw = line.match(/Aw\s+([-\d.]+)/);
    const mem = line.match(/mem\s+([-\d.]+)/);
    if (jw) metrics.jw = parseNumber(jw[1]);
    if (aw) metrics.aw = parseNumber(aw[1]);
    if (mem) metrics.sigmaMem = parseNumber(mem[1]);
  } else if (line.startsWith("P2 steps")) {
    const ja = line.match(/Ja\s+([-\d.]+)/);
    const aa = line.match(/Aa\s+([-\d.]+)/);
    if (ja) metrics.ja = parseNumber(ja[1]);
    if (aa) metrics.aa = parseNumber(aa[1]);
  } else if (line.startsWith("P4 steps")) {
    const jn = line.match(/Jn\s+([-\d.]+)/);
    const an = line.match(/An\s+([-\d.]+)/);
    if (jn) metrics.jn = parseNumber(jn[1]);
    if (an) metrics.an = parseNumber(an[1]);
  } else if (line.startsWith("P5 steps")) {
    const js = line.match(/Js\s+([-\d.]+)/);
    const as = line.match(/As\s+([-\d.]+)/);
    if (js) metrics.js = parseNumber(js[1]);
    if (as) metrics.as = parseNumber(as[1]);
  } else if (line.startsWith("P3 cycle")) {
    const disp = line.match(/disp\s+([-\d.]+)/);
    const loop = line.match(/loop\s+([-\d.]+)/);
    if (disp) metrics.p3Disp = parseNumber(disp[1]);
    if (loop) metrics.p3Loop = parseNumber(loop[1]);
    if (loop && disp) {
      const loopVal = Number(loop[1]);
      const dispVal = Number(disp[1]);
      if (Number.isFinite(loopVal) && Number.isFinite(dispVal)) {
        loopSamples.push({ loop: loopVal, disp: dispVal });
      }
    }
  } else if (line.startsWith("P6 M6")) {
    const m6 = line.match(/W\s+([-\d.]+)\s+N\s+([-\d.]+)\s+A\s+([-\d.]+)\s+S\s+([-\d.]+)/);
    if (m6) {
      metrics.m6w = parseNumber(m6[1]);
      metrics.m6n = parseNumber(m6[2]);
      metrics.m6a = parseNumber(m6[3]);
      metrics.m6s = parseNumber(m6[4]);
    }
  } else if (line.startsWith("Graph edges")) {
    const edges = line.match(/Graph edges\s+(\d+)/);
    const comps = line.match(/components\s+(\d+)/);
    const largest = line.match(/largest\s+(\d+)\/(\d+)/);
    if (edges) metrics.edges = parseNumber(edges[1]);
    if (comps) metrics.components = parseNumber(comps[1]);
    if (largest) {
      metrics.largest = parseNumber(largest[1]);
      metrics.graphN = parseNumber(largest[2]);
    }
  }
}

function parseOutput(output) {
  const lines = output.split("\n");
  const metrics = {};
  const loopSamples = [];
  const blocks = [];
  let currentBlock = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      if (currentBlock) {
        blocks.push(currentBlock);
        currentBlock = null;
      }
      continue;
    }
    if (line.startsWith("E=")) {
      if (currentBlock) blocks.push(currentBlock);
      currentBlock = [line];
    } else if (currentBlock) {
      currentBlock.push(line);
    }
    parseLine(line, metrics, loopSamples);
  }
  if (currentBlock) blocks.push(currentBlock);

  const loopAbsMean =
    loopSamples.length === 0
      ? null
      : loopSamples.reduce((acc, v) => acc + Math.abs(v.loop), 0) / loopSamples.length;
  const dispAbsMean =
    loopSamples.length === 0
      ? null
      : loopSamples.reduce((acc, v) => acc + Math.abs(v.disp), 0) / loopSamples.length;
  const loopNonzero =
    loopSamples.length === 0
      ? null
      : loopSamples.filter((v) => Math.abs(v.loop) > 1e-6).length / loopSamples.length;

  return { metrics, loopAbsMean, dispAbsMean, loopNonzero, blocks };
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

function runCommand(args, logPath) {
  const result = spawnSync(process.execPath, args, { encoding: "utf8", cwd: rootDir });
  if (logPath) {
    fs.writeFileSync(logPath, (result.stdout ?? "") + (result.stderr ?? ""));
  }
  if (result.status !== 0) {
    console.error(result.stderr || result.stdout || "Command failed.");
    process.exit(result.status ?? 1);
  }
  return result.stdout ?? "";
}

ensureDir(logsDir);

const summaries = [];
for (const run of runs) {
  const seedResults = [];
  for (const seed of seeds) {
    const logPath = path.join(logsDir, `${run.id}-seed${seed}.log`);
    const args = [
      path.join("scripts", "ratchet-cli.mjs"),
      "run",
      "--steps",
      String(run.steps),
      "--report-every",
      String(run.reportEvery),
      "--params",
      run.params,
      "--seed",
      String(seed),
      "--set",
      "metaLayers=0",
      "--set",
      "eta=0",
    ];
    const output = runCommand(args, logPath);
    const parsed = parseOutput(output);
    seedResults.push({
      seed,
      metrics: parsed.metrics,
      loopAbsMean: parsed.loopAbsMean,
      dispAbsMean: parsed.dispAbsMean,
      loopNonzero: parsed.loopNonzero,
      blocks: parsed.blocks,
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
    "edges",
    "largest",
  ];
  const summary = { id: run.id };
  for (const key of metricsKeys) {
    const values = seedResults.map((s) => s.metrics[key]).filter((v) => Number.isFinite(v));
    const stats = meanStd(values);
    summary[key] = stats;
  }
  const loopMean = meanStd(seedResults.map((s) => s.loopAbsMean));
  const loopFrac = meanStd(seedResults.map((s) => s.loopNonzero));
  summary.loopAbs = loopMean;
  summary.loopNonzero = loopFrac;
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
      `${fmt(s.edges.mean, 0)}±${fmt(s.edges.std, 0)}`,
      `${fmt(s.largest.mean, 0)}±${fmt(s.largest.std, 0)}`,
    ].join("\t"),
  );
}
