#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { calibrateGateGaps, loadWasm, readJson } from "./deadline-event-utils.mjs";

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const outDir = path.resolve(rootDir, ".tmp", "clock_code");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function parseArgs(argv) {
  const out = {
    preset: null,
    variant: "drift",
    steps: 300_000,
    reportEvery: 1_000,
    region: "stripe",
    regionIndex: 0,
    gateSpan: null,
  };
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--preset") out.preset = args[++i];
    else if (arg === "--variant") out.variant = args[++i];
    else if (arg === "--steps") out.steps = Number(args[++i]);
    else if (arg === "--reportEvery") out.reportEvery = Number(args[++i]);
    else if (arg === "--region") out.region = args[++i];
    else if (arg === "--regionIndex") out.regionIndex = Number(args[++i]);
    else if (arg === "--gateSpan") out.gateSpan = Number(args[++i]);
  }
  return out;
}

ensureDir(outDir);
await loadWasm();

const opts = parseArgs(process.argv);
if (!opts.preset) {
  console.error("Missing --preset");
  process.exit(1);
}

const presetPath = path.resolve(rootDir, opts.preset);
const presetParams = readJson(presetPath);

const variants = opts.variant === "all" ? ["drift", "random"] : [opts.variant];
const deadlineScale = 1.2;
const rows = [];

for (const variant of variants) {
  const result = await calibrateGateGaps({
    presetPath,
    presetParams,
    variant,
    steps: opts.steps,
    reportEvery: opts.reportEvery,
    regionType: opts.region,
    regionIndex: opts.regionIndex,
    gateSpan: opts.gateSpan,
  });
  const gapP95 = result.gapP95 ?? 0;
  rows.push({
    variant,
    gapP50: result.gapP50 ?? 0,
    gapP95,
    gapMax: result.gapMax ?? 0,
    deadlineRec: Math.ceil(deadlineScale * gapP95),
  });
}

const outPath = path.join(outDir, "gate_gap_calibration.csv");
const header = ["variant", "gapP50", "gapP95", "gapMax", "deadlineRec"];
const csv = [
  header.join(","),
  ...rows.map((r) => [r.variant, r.gapP50, r.gapP95, r.gapMax, r.deadlineRec].join(",")),
];
fs.writeFileSync(outPath, csv.join("\n"));

console.log("Gate gap calibration:");
for (const row of rows) {
  console.log(
    `${row.variant} | gapP95 ${row.gapP95} | gapMax ${row.gapMax} | deadlineRec ${row.deadlineRec}`,
  );
}
