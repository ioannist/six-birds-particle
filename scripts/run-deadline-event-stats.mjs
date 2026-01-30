#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {
  loadWasm,
  mean,
  std,
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
    preset: null,
    variant: "drift",
    seeds: [1, 2, 3],
    steps: 2_000_000,
    reportEvery: 5_000,
    eventEvery: 50_000,
    deadline: 25_000,
    region: "quadrant",
    regionIndex: 2,
    gateSpan: null,
    corruptFrac: 0.2,
    errGood: 0.1,
    sdiffGood: 1.0,
    tailWindow: 200_000,
  };
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--preset") out.preset = args[++i];
    else if (arg === "--variant") out.variant = args[++i];
    else if (arg === "--seeds") out.seeds = parseSeedList(args[++i]);
    else if (arg === "--steps") out.steps = Number(args[++i]);
    else if (arg === "--reportEvery") out.reportEvery = Number(args[++i]);
    else if (arg === "--eventEvery") out.eventEvery = Number(args[++i]);
    else if (arg === "--deadline") out.deadline = Number(args[++i]);
    else if (arg === "--region") out.region = args[++i];
    else if (arg === "--regionIndex") out.regionIndex = Number(args[++i]);
    else if (arg === "--gateSpan") out.gateSpan = Number(args[++i]);
    else if (arg === "--corruptFrac") out.corruptFrac = Number(args[++i]);
    else if (arg === "--errGood") out.errGood = Number(args[++i]);
    else if (arg === "--sdiffGood") out.sdiffGood = Number(args[++i]);
    else if (arg === "--tailWindow") out.tailWindow = Number(args[++i]);
  }
  return out;
}

ensureDir(outDir);
const opts = parseArgs(process.argv);
if (!opts.preset) {
  console.error("Missing --preset");
  process.exit(1);
}

await loadWasm();
const presetPath = path.resolve(rootDir, opts.preset);
const presetParams = readJson(presetPath);

const variants = opts.variant === "all" ? ["drift", "random", "static"] : [opts.variant];
const rawPath = path.join(outDir, "deadline_event_stats_raw.jsonl");
const summaryPath = path.join(outDir, "deadline_event_stats_summary.csv");
const rawLines = [];
const summaries = [];

for (const variant of variants) {
  const { runs } = await runDeadlineEvents({
    presetPath,
    presetParams,
    variant,
    seeds: opts.seeds,
    steps: opts.steps,
    reportEvery: opts.reportEvery,
    eventEvery: opts.eventEvery,
    deadline: opts.deadline,
    regionType: opts.region,
    regionIndex: opts.regionIndex,
    gateSpan: opts.gateSpan,
    corruptFrac: opts.corruptFrac,
    errGood: opts.errGood,
    sdiffGood: opts.sdiffGood,
    tailWindow: opts.tailWindow,
  });
  for (const r of runs) {
    rawLines.push(JSON.stringify({ variant, ...r }));
  }

  const missFrac = runs.map((r) => r.missFrac);
  const recP95 = runs.map((r) => r.recoveryP95 ?? 0);
  const uptime = runs.map((r) => r.uptime);
  const errEnd = runs.map((r) => r.errEnd);
  const sdiffEnd = runs.map((r) => r.sdiffEnd);
  const uptimeTail = runs.map((r) => r.uptimeTail);
  const errTail = runs.map((r) => r.errTailMean);
  const sdiffTail = runs.map((r) => r.sdiffTailMean);
  const errP95 = runs.map((r) => r.errP95 ?? 0);
  const epTotal = runs.map((r) => r.epTotalRate);
  const epClock = runs.map((r) => r.epClockRate);
  const epRepair = runs.map((r) => r.epRepairRate);
  const epNoise = runs.map((r) => r.epNoiseRate);

  summaries.push({
    variant,
    missFracMean: mean(missFrac),
    missFracStd: std(missFrac),
    recoveryP95Mean: mean(recP95),
    recoveryP95Std: std(recP95),
    uptimeMean: mean(uptime),
    uptimeStd: std(uptime),
    errEndMean: mean(errEnd),
    errEndStd: std(errEnd),
    sdiffEndMean: mean(sdiffEnd),
    sdiffEndStd: std(sdiffEnd),
    uptimeTailMean: mean(uptimeTail),
    uptimeTailStd: std(uptimeTail),
    errTailMean: mean(errTail),
    errTailStd: std(errTail),
    sdiffTailMean: mean(sdiffTail),
    sdiffTailStd: std(sdiffTail),
    errP95Mean: mean(errP95),
    errP95Std: std(errP95),
    epTotalRateMean: mean(epTotal),
    epClockRateMean: mean(epClock),
    epRepairRateMean: mean(epRepair),
    epNoiseRateMean: mean(epNoise),
  });
}

fs.writeFileSync(rawPath, rawLines.join("\n"));

const header = [
  "variant",
  "missFracMean",
  "missFracStd",
  "recoveryP95Mean",
  "recoveryP95Std",
  "uptimeMean",
  "uptimeStd",
  "errEndMean",
  "errEndStd",
  "sdiffEndMean",
  "sdiffEndStd",
  "uptimeTailMean",
  "uptimeTailStd",
  "errTailMean",
  "errTailStd",
  "sdiffTailMean",
  "sdiffTailStd",
  "errP95Mean",
  "errP95Std",
  "epTotalRateMean",
  "epClockRateMean",
  "epRepairRateMean",
  "epNoiseRateMean",
];
const csv = [
  header.join(","),
  ...summaries.map((summary) =>
    [
      summary.variant,
      summary.missFracMean,
      summary.missFracStd,
      summary.recoveryP95Mean,
      summary.recoveryP95Std,
      summary.uptimeMean,
      summary.uptimeStd,
      summary.errEndMean,
      summary.errEndStd,
      summary.sdiffEndMean,
      summary.sdiffEndStd,
      summary.uptimeTailMean,
      summary.uptimeTailStd,
      summary.errTailMean,
      summary.errTailStd,
      summary.sdiffTailMean,
      summary.sdiffTailStd,
      summary.errP95Mean,
      summary.errP95Std,
      summary.epTotalRateMean,
      summary.epClockRateMean,
      summary.epRepairRateMean,
      summary.epNoiseRateMean,
    ].join(","),
  ),
];
fs.writeFileSync(summaryPath, csv.join("\n"));

console.log("Deadline event stats summary:");
for (const summary of summaries) {
  console.log(
    `${summary.variant} | missFrac ${summary.missFracMean.toFixed(3)} | recP95 ${summary.recoveryP95Mean.toFixed(0)} | uptimeTail ${summary.uptimeTailMean.toFixed(3)} | errTail ${summary.errTailMean.toFixed(3)}`,
  );
}
