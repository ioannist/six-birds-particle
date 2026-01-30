#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {
  loadWasm,
  mean,
  percentile,
  parseSeedList,
  readJson,
  runDeadlineEvents,
} from "./deadline-event-utils.mjs";

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const outDir = path.resolve(rootDir, ".tmp", "clock_code");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function parseArgs(argv) {
  const out = {
    found: "scripts/params/clock_code/deadline_fidelity_found.json",
    seeds: null,
    seedCount: 30,
    steps: 2_000_000,
    reportEvery: 1_000,
    eventEvery: 50_000,
    corruptFrac: 0.1,
    tailWindow: 200_000,
    errGood: 0.1,
    sdiffGood: 1.0,
    region: "stripe",
    regionIndex: null,
  };
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--found") out.found = args[++i];
    else if (arg === "--seeds") out.seeds = parseSeedList(args[++i]);
    else if (arg === "--seedCount") out.seedCount = Number(args[++i]);
    else if (arg === "--steps") out.steps = Number(args[++i]);
    else if (arg === "--reportEvery") out.reportEvery = Number(args[++i]);
    else if (arg === "--eventEvery") out.eventEvery = Number(args[++i]);
    else if (arg === "--corruptFrac") out.corruptFrac = Number(args[++i]);
    else if (arg === "--tailWindow") out.tailWindow = Number(args[++i]);
    else if (arg === "--errGood") out.errGood = Number(args[++i]);
    else if (arg === "--sdiffGood") out.sdiffGood = Number(args[++i]);
    else if (arg === "--region") out.region = args[++i];
    else if (arg === "--regionIndex") out.regionIndex = Number(args[++i]);
  }
  return out;
}

function makeSeedList(opts) {
  if (opts.seeds && opts.seeds.length > 0) return opts.seeds;
  const count = Number.isFinite(opts.seedCount) ? opts.seedCount : 30;
  return Array.from({ length: count }, (_, i) => i + 1);
}

function lcg(seed) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function bootstrapMean(values, samples = 2000, seed = 12345) {
  const rand = lcg(seed);
  const n = values.length;
  const means = [];
  for (let i = 0; i < samples; i += 1) {
    let acc = 0;
    for (let j = 0; j < n; j += 1) {
      const idx = Math.floor(rand() * n);
      acc += values[idx];
    }
    means.push(acc / n);
  }
  return means;
}

function ciFromSamples(samples) {
  return {
    low: percentile(samples, 0.025),
    high: percentile(samples, 0.975),
  };
}

function successRate(runs) {
  const ok = runs.map(
    (r) => r.missFrac <= 0.2 && r.uptimeTail >= 0.8 && r.errTailMean <= 0.05,
  );
  const count = ok.filter(Boolean).length;
  return { count, rate: ok.length ? count / ok.length : 0 };
}

ensureDir(outDir);
await loadWasm();

const opts = parseArgs(process.argv);
const foundPath = path.resolve(rootDir, opts.found);
const found = readJson(foundPath);
const baseParams = found.params ?? found;
const deadline = found.deadline ?? opts.deadline;
const seeds = makeSeedList(opts);

const regionIndex =
  Number.isFinite(opts.regionIndex) && opts.regionIndex !== null
    ? opts.regionIndex
    : Math.floor((baseParams.clockK ?? baseParams.gridSize) / 2);

const runArgs = {
  presetParams: baseParams,
  seeds,
  steps: opts.steps,
  reportEvery: opts.reportEvery,
  eventEvery: opts.eventEvery,
  deadline,
  regionType: opts.region,
  regionIndex,
  gateSpan: baseParams.repairGateSpan ?? 1,
  corruptFrac: opts.corruptFrac,
  errGood: opts.errGood,
  sdiffGood: opts.sdiffGood,
  tailWindow: opts.tailWindow,
};

const drift = await runDeadlineEvents({ ...runArgs, variant: "drift" });
const random = await runDeadlineEvents({ ...runArgs, variant: "random" });
const staticCtrl = await runDeadlineEvents({ ...runArgs, variant: "static" });

const variants = { drift, random, static: staticCtrl };

function summarize(runs) {
  return {
    missFrac: runs.map((r) => r.missFrac),
    uptimeTail: runs.map((r) => r.uptimeTail),
    errTail: runs.map((r) => r.errTailMean),
    epClock: runs.map((r) => r.epClockRate),
  };
}

const summary = {};
for (const [name, data] of Object.entries(variants)) {
  const stats = summarize(data.runs);
  const missSamples = bootstrapMean(stats.missFrac, 2000, 101 + stats.missFrac.length);
  const uptimeSamples = bootstrapMean(stats.uptimeTail, 2000, 202 + stats.uptimeTail.length);
  const errSamples = bootstrapMean(stats.errTail, 2000, 303 + stats.errTail.length);
  const epSamples = bootstrapMean(stats.epClock, 2000, 404 + stats.epClock.length);
  const success = successRate(data.runs);
  const successSamples = bootstrapMean(
    data.runs.map((r) =>
      r.missFrac <= 0.2 && r.uptimeTail >= 0.8 && r.errTailMean <= 0.05 ? 1 : 0,
    ),
    2000,
    505 + data.runs.length,
  );
  summary[name] = {
    missMean: mean(stats.missFrac),
    missCI: ciFromSamples(missSamples),
    uptimeMean: mean(stats.uptimeTail),
    uptimeCI: ciFromSamples(uptimeSamples),
    errMean: mean(stats.errTail),
    errCI: ciFromSamples(errSamples),
    epClockMean: mean(stats.epClock),
    epClockCI: ciFromSamples(epSamples),
    successRate: success.rate,
    successCI: ciFromSamples(successSamples),
  };
}

function diffCI(aVals, bVals, seedBase) {
  const aSamples = bootstrapMean(aVals, 2000, seedBase);
  const bSamples = bootstrapMean(bVals, 2000, seedBase + 1234);
  const diffs = aSamples.map((v, i) => v - bSamples[i]);
  return { mean: mean(diffs), ...ciFromSamples(diffs) };
}

const driftStats = summarize(drift.runs);
const randomStats = summarize(random.runs);
const diffMiss = diffCI(driftStats.missFrac, randomStats.missFrac, 7001);
const diffUptime = diffCI(driftStats.uptimeTail, randomStats.uptimeTail, 8001);
const diffErr = diffCI(randomStats.errTail, driftStats.errTail, 9001);
const diffEpClock = diffCI(driftStats.epClock, randomStats.epClock, 10001);

const rawPath = path.join(outDir, "deadline_success_ci_raw.jsonl");
const summaryPath = path.join(outDir, "deadline_success_ci_summary.csv");
const diffPath = path.join(outDir, "deadline_success_ci_diffs.csv");

const rawLines = [];
for (const [variant, data] of Object.entries(variants)) {
  for (const run of data.runs) {
    rawLines.push(JSON.stringify({ variant, ...run }));
  }
}
fs.writeFileSync(rawPath, rawLines.join("\n"));

const summaryHeader = [
  "variant",
  "seeds",
  "missFracMean",
  "missFracCI_low",
  "missFracCI_high",
  "uptimeTailMean",
  "uptimeTailCI_low",
  "uptimeTailCI_high",
  "errTailMean",
  "errTailCI_low",
  "errTailCI_high",
  "epClockRateMean",
  "epClockCI_low",
  "epClockCI_high",
  "successRate",
  "successCI_low",
  "successCI_high",
];
const summaryLines = [summaryHeader.join(",")];
for (const [variant, stats] of Object.entries(summary)) {
  summaryLines.push(
    [
      variant,
      seeds.length,
      stats.missMean,
      stats.missCI.low,
      stats.missCI.high,
      stats.uptimeMean,
      stats.uptimeCI.low,
      stats.uptimeCI.high,
      stats.errMean,
      stats.errCI.low,
      stats.errCI.high,
      stats.epClockMean,
      stats.epClockCI.low,
      stats.epClockCI.high,
      stats.successRate,
      stats.successCI.low,
      stats.successCI.high,
    ].join(","),
  );
}
fs.writeFileSync(summaryPath, summaryLines.join("\n"));

const diffHeader = [
  "metric",
  "mean",
  "ci_low",
  "ci_high",
];
const diffLines = [
  diffHeader.join(","),
  ["missFrac_drift_minus_random", diffMiss.mean, diffMiss.low, diffMiss.high].join(","),
  ["uptimeTail_drift_minus_random", diffUptime.mean, diffUptime.low, diffUptime.high].join(","),
  ["errTail_random_minus_drift", diffErr.mean, diffErr.low, diffErr.high].join(","),
  ["deltaEPClockRate", diffEpClock.mean, diffEpClock.low, diffEpClock.high].join(","),
];
fs.writeFileSync(diffPath, diffLines.join("\n"));

console.log("Deadline success + CI summary:");
for (const [variant, stats] of Object.entries(summary)) {
  console.log(
    `${variant} | success ${(stats.successRate * 100).toFixed(1)}% | uptimeTail ${stats.uptimeMean.toFixed(
      3,
    )} | errTail ${stats.errMean.toFixed(3)} | miss ${stats.missMean.toFixed(3)}`,
  );
}
console.log("Diffs (drift vs random):");
console.log(`missFrac diff mean ${diffMiss.mean.toFixed(3)} CI [${diffMiss.low.toFixed(3)}, ${diffMiss.high.toFixed(3)}]`);
console.log(
  `uptimeTail diff mean ${diffUptime.mean.toFixed(3)} CI [${diffUptime.low.toFixed(3)}, ${diffUptime.high.toFixed(3)}]`,
);
console.log(`errTail diff mean ${diffErr.mean.toFixed(3)} CI [${diffErr.low.toFixed(3)}, ${diffErr.high.toFixed(3)}]`);
console.log(
  `deltaEPClockRate mean ${diffEpClock.mean.toFixed(4)} CI [${diffEpClock.low.toFixed(4)}, ${diffEpClock.high.toFixed(4)}]`,
);
