#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const DEFAULT_PARAMS = {
  beta: 1.0,
  stepSize: 0.01,
  p3On: 0,
  p6On: 0,
  p6SFactor: 1.0,
  pWrite: 0.1,
  pNWrite: 0.05,
  pAWrite: 0.05,
  pSWrite: 0.05,
  muHigh: 0.6,
  muLow: -0.6,
  kappaRep: 500.0,
  r0: 0.25,
  kappaBond: 1.2,
  rStar: 0.22,
  lambdaW: 0.3,
  lW: 4,
  lambdaN: 0.5,
  lN: 6,
  lambdaA: 0.5,
  lA: 6,
  lambdaS: 0.5,
  lS: 6,
  gridSize: 16,
  rPropose: 0.12,
  metaLayers: 0,
  eta: 0.0,
  etaDrive: 0.0,
  opCouplingOn: 0,
  opStencil: 0,
  opBudgetK: 16,
  opKTargetWeight: 1.0,
  sCouplingMode: 0,
  opDriveOnK: 1,
  epDebug: 0,
  initRandom: 0,
  codeNoiseRate: 0,
  codeNoiseBatch: 1,
  codeNoiseLayer: 0,
  clockOn: 0,
  clockK: 8,
  clockFrac: 0.2,
  clockUsesP6: 1,
  repairClockGated: 0,
  repairGateMode: 0,
  repairGateSpan: 1,
};

function printHelp() {
  console.log(
    [
      "ratchet-cli.mjs run [options]",
      "",
      "Options:",
      "  --n <int>               particle count (default 200)",
      "  --seed <int>            RNG seed (default 1)",
      "  --steps <int>           steps to run (default 100000)",
      "  --report-every <int>    print summary every N steps (default 0)",
      "  --bond-threshold <int>  bond draw threshold (default 3)",
      "  --params <file.json>    JSON params to merge with defaults",
      "  --set key=value         override param/bondThreshold/recordEverySteps/safeThreshold",
      "",
      "Examples:",
      "  node scripts/ratchet-cli.mjs run --steps 200000",
      "  node scripts/ratchet-cli.mjs run --params ./my-params.json --set p3On=1 --set p6On=1",
    ].join("\n"),
  );
}

function parseArgs(argv) {
  const out = {
    cmd: "run",
    n: 200,
    seed: 1,
    steps: 100000,
    reportEvery: 0,
    bondThreshold: 3,
    paramsPath: null,
    sets: [],
  };
  const args = argv.slice(2);
  if (args.length === 0 || args[0] === "-h" || args[0] === "--help") {
    out.cmd = "help";
    return out;
  }
  out.cmd = args[0] ?? "run";
  for (let i = 1; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--n") out.n = Number(args[++i]);
    else if (arg === "--seed") out.seed = Number(args[++i]);
    else if (arg === "--steps") out.steps = Number(args[++i]);
    else if (arg === "--report-every") out.reportEvery = Number(args[++i]);
    else if (arg === "--bond-threshold") out.bondThreshold = Number(args[++i]);
    else if (arg === "--params") out.paramsPath = args[++i] ?? null;
    else if (arg === "--set") out.sets.push(args[++i] ?? "");
  }
  return out;
}

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function applySets(target, sets) {
  for (const item of sets) {
    if (!item) continue;
    const [key, raw] = item.split("=");
    if (!key) continue;
    const v = Number(raw);
    if (!Number.isFinite(v)) continue;
    target[key.trim()] = v;
  }
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

function formatSummary(totalSteps, energy, diag, graph, extras) {
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
  if (extras) {
    lines.push(
      `EP naive ${extras.epNaiveTotal.toFixed(4)} | rate ${extras.epNaiveRate.toFixed(6)}`,
    );
    lines.push(
      `EP exact ${extras.epExactTotal.toFixed(4)} | rate ${extras.epExactRate.toFixed(6)} | window ${extras.epExactWindowRate.toFixed(6)}`,
    );
    lines.push(
      `Clock Q ${extras.clockQ} | fwd ${extras.clockFwd} bwd ${extras.clockBwd} | drift ${extras.clockDrift.toFixed(6)}`,
    );
  }
  lines.push(
    `Graph edges ${graph.edges} | components ${graph.components} | largest ${graph.largest}/${graph.n}`,
  );
  return lines;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.cmd === "help") {
    printHelp();
    return;
  }
  if (args.cmd !== "run") {
    console.error(`Unknown command: ${args.cmd}`);
    printHelp();
    process.exit(1);
  }

  let params = { ...DEFAULT_PARAMS };
  if (args.paramsPath) {
    const extra = readJson(args.paramsPath);
    params = { ...params, ...extra };
  }
  applySets(params, args.sets);

  const wasmDir = path.resolve(rootDir, "apps/web/src/wasm/sim_core");
  const wasmJs = pathToFileURL(path.join(wasmDir, "sim_core.js")).href;
  const wasmBytes = fs.readFileSync(path.join(wasmDir, "sim_core_bg.wasm"));
  const mod = await import(wasmJs);
  mod.initSync({ module: wasmBytes });

  const sim = new mod.Sim(args.n, args.seed);
  sim.set_params(params);

  let totalSteps = 0;
  let lastEpExact = 0;
  let lastSteps = 0;
  const reportEvery = Math.max(0, Math.floor(args.reportEvery));
  const targetSteps = Math.max(0, Math.floor(args.steps));
  const chunk = reportEvery > 0 ? Math.min(reportEvery, 50000) : Math.min(targetSteps || 1, 50000);

  while (totalSteps < targetSteps) {
    const stepNow = Math.min(chunk, targetSteps - totalSteps);
    sim.step(stepNow);
    totalSteps += stepNow;
    if (reportEvery > 0 && totalSteps % reportEvery === 0) {
      const energy = sim.energy_breakdown();
      const diag = sim.diagnostics();
      const epNaiveTotal = sim.ep_naive_total();
      const epExactTotal = sim.ep_exact_total();
      const clockQ = Number(sim.clock_q());
      const clockFwd = Number(sim.clock_fwd());
      const clockBwd = Number(sim.clock_bwd());
      const epNaiveRate = totalSteps > 0 ? epNaiveTotal / totalSteps : 0;
      const epExactRate = totalSteps > 0 ? epExactTotal / totalSteps : 0;
      const windowSteps = totalSteps - lastSteps;
      const epExactWindowRate =
        windowSteps > 0 ? (epExactTotal - lastEpExact) / windowSteps : 0;
      const clockDrift = totalSteps > 0 ? clockQ / totalSteps : 0;
      const bonds = sim.bonds(Math.max(0, Math.min(255, Math.floor(args.bondThreshold))));
      const graph = graphStats(args.n, bonds);
      for (const line of formatSummary(totalSteps, energy, diag, graph, {
        epNaiveTotal,
        epNaiveRate,
        epExactTotal,
        epExactRate,
        epExactWindowRate,
        clockQ,
        clockFwd,
        clockBwd,
        clockDrift,
      })) {
        console.log(line);
      }
      console.log("");
      lastEpExact = epExactTotal;
      lastSteps = totalSteps;
    }
  }

  const energy = sim.energy_breakdown();
  const diag = sim.diagnostics();
  const epNaiveTotal = sim.ep_naive_total();
  const epExactTotal = sim.ep_exact_total();
  const clockQ = Number(sim.clock_q());
  const clockFwd = Number(sim.clock_fwd());
  const clockBwd = Number(sim.clock_bwd());
  const epNaiveRate = totalSteps > 0 ? epNaiveTotal / totalSteps : 0;
  const epExactRate = totalSteps > 0 ? epExactTotal / totalSteps : 0;
  const windowSteps = totalSteps - lastSteps;
  const epExactWindowRate =
    windowSteps > 0 ? (epExactTotal - lastEpExact) / windowSteps : 0;
  const clockDrift = totalSteps > 0 ? clockQ / totalSteps : 0;
  const bonds = sim.bonds(Math.max(0, Math.min(255, Math.floor(args.bondThreshold))));
  const graph = graphStats(args.n, bonds);
  for (const line of formatSummary(totalSteps, energy, diag, graph, {
    epNaiveTotal,
    epNaiveRate,
    epExactTotal,
    epExactRate,
    epExactWindowRate,
    clockQ,
    clockFwd,
    clockBwd,
    clockDrift,
  })) {
    console.log(line);
  }

  if (params.epDebug >= 0.5) {
    const stats = sim.ep_q_stats();
    const labels = stats.labels;
    const mean = stats.mean;
    const maxAbs = stats.maxAbs;
    const count = stats.count;
    console.log("");
    console.log("EP log q-ratio stats:");
    for (let i = 0; i < labels.length; i += 1) {
      const label = labels[i];
      console.log(
        `${label}: mean ${Number(mean[i]).toExponential(3)} | maxAbs ${Number(maxAbs[i]).toExponential(3)} | count ${count[i]}`,
      );
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
