#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { runMovingHazardHomeostasis } from "./run-moving-hazard-homeostasis.mjs";

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const outDir = path.resolve(rootDir, ".tmp", "homeostasis");
fs.mkdirSync(outDir, { recursive: true });

const presetPathCandidates = [
  path.resolve(rootDir, "scripts/params/clock_code/deadline_fidelity_found.json"),
  path.resolve(rootDir, "scripts/params/clock_code/code_deadline_gated_clock.json"),
];
const presetPath = presetPathCandidates.find((p) => fs.existsSync(p)) ?? presetPathCandidates[1];

const baseConfig = {
  presetPath,
  seeds: [1],
  steps: 300_000,
  eventEvery: 50_000,
  deadline: 15_000,
  reportEvery: 1_000,
  hazardHoldEvents: 2,
  hazardCount: 8,
  region: "stripe",
  variants: ["C"],
  writeOutputs: false,
};

const runWith = async (logMotifs) => {
  const res = await runMovingHazardHomeostasis({
    ...baseConfig,
    logMotifs,
  });
  return res.finalStates[0];
};

const a = await runWith(true);
const b = await runWith(false);

const rows = [];
const addRow = (name, v1, v2, tol) => {
  const diff = Math.abs(v1 - v2);
  const pass = diff <= tol;
  rows.push({ metric: name, valueA: v1, valueB: v2, diff, pass });
};

addRow("epExactTotal", a.epExactTotal, b.epExactTotal, 1e-9);
addRow("epRepairTotal", a.epRepairTotal, b.epRepairTotal, 1e-9);
addRow("epOpKTotal", a.epOpKTotal, b.epOpKTotal, 1e-9);
addRow("epClockTotal", a.epClockTotal, b.epClockTotal, 1e-9);
addRow("countP5Base", a.countP5Base, b.countP5Base, 0);
addRow("countP5Meta", a.countP5Meta, b.countP5Meta, 0);
addRow("countOpK", a.countOpK, b.countOpK, 0);
addRow("countClock", a.countClock, b.countClock, 0);
addRow("baseSum", a.baseSum, b.baseSum, 0);
addRow("metaSum", a.metaSum, b.metaSum, 0);
addRow("baseLen", a.baseLen, b.baseLen, 0);
addRow("metaLen", a.metaLen, b.metaLen, 0);

const header = "metric,valueA,valueB,diff,pass";
const lines = [header];
for (const row of rows) {
  lines.push([row.metric, row.valueA, row.valueB, row.diff, row.pass].join(","));
}
const outPath = path.join(outDir, "instrumentation_invariance.csv");
fs.writeFileSync(outPath, lines.join("\n") + "\n");

const allPass = rows.every((row) => row.pass);
console.log(`INSTRUMENTATION_INVARIANCE: ${allPass ? "PASS" : "FAIL"}`);
