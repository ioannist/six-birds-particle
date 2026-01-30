#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {
  loadWasm,
  mean,
  std,
  percentile,
  readJson,
  errRegionBits,
  meanAbsDiffRegion,
} from "./deadline-event-utils.mjs";
import { parseOpOffsets } from "./opk-metrics.mjs";
import {
  computeMBaseClasses,
  computeMOpClasses,
  vocabStats,
  asymmetryScore,
  coarseEPSmoothed,
  edgeFamily,
  edgeKey,
  offsetsToDxDy,
} from "./opk-motif-basis.mjs";

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function parseArgs(argv) {
  const out = {
    presetPath: null,
    seed: 1,
    condition: "A",
    outDir: path.resolve(rootDir, ".tmp", "motif_pressure_v4"),
    steps: null,
    reportEvery: null,
    eventEvery: null,
    deadline: null,
    regionType: null,
    regionIndex: null,
    gateSpan: null,
    corruptFrac: null,
    errGood: 0.1,
    sdiffGood: 1.0,
    tailWindow: 200_000,
    sampleEvery: null,
    burnIn: 200_000,
    opBinsMode: 2,
    gateConditioned: 1,
    gateCheckEvery: 5000,
    motifMode: "state",
    sets: [],
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--preset") out.presetPath = argv[++i];
    else if (arg === "--seed") out.seed = Number(argv[++i]);
    else if (arg === "--condition") out.condition = argv[++i];
    else if (arg === "--outDir") out.outDir = path.resolve(argv[++i]);
    else if (arg === "--steps") out.steps = Number(argv[++i]);
    else if (arg === "--reportEvery") out.reportEvery = Number(argv[++i]);
    else if (arg === "--eventEvery") out.eventEvery = Number(argv[++i]);
    else if (arg === "--deadline") out.deadline = Number(argv[++i]);
    else if (arg === "--regionType") out.regionType = argv[++i];
    else if (arg === "--regionIndex") out.regionIndex = Number(argv[++i]);
    else if (arg === "--gateSpan") out.gateSpan = Number(argv[++i]);
    else if (arg === "--corruptFrac") out.corruptFrac = Number(argv[++i]);
    else if (arg === "--errGood") out.errGood = Number(argv[++i]);
    else if (arg === "--sdiffGood") out.sdiffGood = Number(argv[++i]);
    else if (arg === "--tailWindow") out.tailWindow = Number(argv[++i]);
    else if (arg === "--sampleEvery") out.sampleEvery = Number(argv[++i]);
    else if (arg === "--burnIn") out.burnIn = Number(argv[++i]);
    else if (arg === "--opBinsMode") out.opBinsMode = Number(argv[++i]);
    else if (arg === "--gateConditioned") out.gateConditioned = Number(argv[++i]);
    else if (arg === "--gateCheckEvery") out.gateCheckEvery = Number(argv[++i]);
    else if (arg === "--motifMode") out.motifMode = argv[++i];
    else if (arg === "--set") out.sets.push(argv[++i] ?? "");
  }
  return out;
}

function applySets(target, sets) {
  for (const item of sets) {
    if (!item) continue;
    const [key, raw] = item.split("=");
    if (!key) continue;
    const val = Number(raw);
    if (!Number.isFinite(val)) continue;
    target[key] = val;
  }
}

function quadrantIndex(idx, g) {
  const x = idx % g;
  const y = Math.floor(idx / g);
  const qx = x < g / 2 ? 0 : 1;
  const qy = y < g / 2 ? 0 : 1;
  return qy * 2 + qx;
}

function stripeIndex(idx, g, bins) {
  const x = idx % g;
  const fx = x / g;
  return Math.min(bins - 1, Math.floor(fx * bins));
}

function inWrapSpan(active, center, span, mod) {
  const s = Math.max(0, span);
  for (let offset = -s; offset <= s; offset += 1) {
    const idx = ((center + offset) % mod + mod) % mod;
    if (idx === active) return true;
  }
  return false;
}

function hazardGateActive(clockState, params, regionIndex, gateSpan) {
  const mode = params.repairGateMode ?? 0;
  if (mode === 0) return true;
  if (mode === 1) {
    const k = params.clockK ?? 8;
    const active = ((clockState % k) + k) % k;
    return inWrapSpan(active, regionIndex, gateSpan, k);
  }
  if (mode === 2) {
    const k = 4;
    const active = ((clockState % k) + k) % k;
    return inWrapSpan(active, regionIndex, gateSpan, k);
  }
  return true;
}

function buildRegionMask(g, regionType, regionIndex, span, bins) {
  const cells = g * g;
  const mask = new Array(cells);
  if (regionType === "stripe") {
    const s = Math.max(1, span);
    for (let i = 0; i < cells; i += 1) {
      const stripe = stripeIndex(i, g, bins);
      let ok = false;
      for (let k = 0; k < s; k += 1) {
        if ((regionIndex + k) % bins === stripe) {
          ok = true;
          break;
        }
      }
      mask[i] = ok;
    }
  } else {
    for (let i = 0; i < cells; i += 1) {
      mask[i] = quadrantIndex(i, g) === regionIndex;
    }
  }
  return mask;
}

function shuffleInPlace(arr, seed) {
  let x = seed >>> 0;
  if (x === 0) x = 1;
  for (let i = arr.length - 1; i > 0; i -= 1) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    const j = x % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function buildMatchedOutsideMask(regionMask, seed) {
  const outside = [];
  const regionCount = regionMask.filter(Boolean).length;
  for (let i = 0; i < regionMask.length; i += 1) {
    if (!regionMask[i]) outside.push(i);
  }
  if (outside.length === 0) return regionMask.map(() => false);
  shuffleInPlace(outside, seed);
  const target = Math.min(regionCount, outside.length);
  const mask = new Array(regionMask.length).fill(false);
  for (let i = 0; i < target; i += 1) {
    mask[outside[i]] = true;
  }
  return mask;
}

function updateCount(map, key, delta = 1) {
  map.set(key, (map.get(key) ?? 0) + delta);
}

function updateTransition(map, fromKey, toKey, delta = 1) {
  const key = `${fromKey}|${toKey}`;
  map.set(key, (map.get(key) ?? 0) + delta);
}

function mapToPairs(map) {
  return Array.from(map.entries()).map(([key, count]) => [key, count]);
}

function addEdgeStats(counts, epSum, epAbsSum, key, epDelta) {
  counts.set(key, (counts.get(key) ?? 0) + 1);
  epSum.set(key, (epSum.get(key) ?? 0) + epDelta);
  epAbsSum.set(key, (epAbsSum.get(key) ?? 0) + Math.abs(epDelta));
}

function summarizeValues(values) {
  const nums = values.filter((v) => Number.isFinite(v));
  return {
    mean: nums.length ? mean(nums) : null,
    std: nums.length ? std(nums) : null,
  };
}

function computeCounts(classesByIface, mask) {
  const counts = new Map();
  let total = 0;
  for (const iface of classesByIface) {
    for (let q = 0; q < iface.length; q += 1) {
      if (!mask[q]) continue;
      updateCount(counts, String(iface[q]));
      total += 1;
    }
  }
  return { counts, total };
}

function computeChange(prevByIface, nextByIface, mask) {
  let changed = 0;
  let total = 0;
  for (let iface = 0; iface < nextByIface.length; iface += 1) {
    const prev = prevByIface[iface];
    const next = nextByIface[iface];
    for (let q = 0; q < next.length; q += 1) {
      if (!mask[q]) continue;
      total += 1;
      if (prev[q] !== next[q]) changed += 1;
    }
  }
  return { changed, total, frac: total > 0 ? changed / total : 0 };
}

function accumulateTransitions(prevByIface, nextByIface, mask, targetMap) {
  let changed = 0;
  for (let iface = 0; iface < nextByIface.length; iface += 1) {
    const prev = prevByIface[iface];
    const next = nextByIface[iface];
    for (let q = 0; q < next.length; q += 1) {
      if (!mask[q]) continue;
      const fromKey = String(prev[q]);
      const toKey = String(next[q]);
      if (fromKey === toKey) continue;
      updateTransition(targetMap, fromKey, toKey);
      changed += 1;
    }
  }
  return changed;
}

function emptyWindowStats() {
  return {
    countsBaseHazard: new Map(),
    countsBaseOutside: new Map(),
    countsOpHazard: new Map(),
    countsOpOutside: new Map(),
    transBaseHazard: new Map(),
    transBaseOutside: new Map(),
    transOpHazard: new Map(),
    transOpOutside: new Map(),
    changeBaseHazardCount: 0,
    changeBaseHazardTotal: 0,
    changeBaseOutsideCount: 0,
    changeBaseOutsideTotal: 0,
    changeOpHazardCount: 0,
    changeOpHazardTotal: 0,
    changeOpOutsideCount: 0,
    changeOpOutsideTotal: 0,
    changeBaseHazard: 0,
    changeBaseOutside: 0,
    changeOpHazard: 0,
    changeOpOutside: 0,
    epTotal: 0,
    epRepair: 0,
    epOpK: 0,
    samples: 0,
  };
}

function eventWindowForTime(event, t, wPre, tailWindow, deadline) {
  if (t >= event.tEvent - wPre && t < event.tEvent) return "pre";
  if (t >= event.tEvent && t <= event.tEvent + deadline) return "recovery";
  if (t > event.tEvent + deadline && t <= event.tEvent + deadline + tailWindow) return "tail";
  return null;
}

function totalTransitions(counts) {
  let total = 0;
  for (const [key, count] of counts.entries()) {
    const [from, to] = key.split("|");
    if (from === to) continue;
    total += count;
  }
  return total;
}

function buildEventRow(event) {
  const row = {
    seed: event.seed,
    condition: event.condition,
    opBinsMode: event.opBinsMode,
    eventIdx: event.idx,
    tEvent: event.tEvent,
    success: !!event.recovered,
    miss: !!event.miss,
    recovery: event.recoveryTime ?? null,
    stepsToOutcome: event.stepsToOutcome ?? null,
    recoverySamples: event.recoverySamples ?? 0,
    pre_samples: event.pre.samples,
    rec_samples: event.recovery.samples,
    tail_samples: event.tail.samples,
    preBaseHaz_counts: mapToPairs(event.pre.countsBaseHazard),
    recBaseHaz_counts: mapToPairs(event.recovery.countsBaseHazard),
    tailBaseHaz_counts: mapToPairs(event.tail.countsBaseHazard),
    preBaseOut_counts: mapToPairs(event.pre.countsBaseOutside),
    recBaseOut_counts: mapToPairs(event.recovery.countsBaseOutside),
    tailBaseOut_counts: mapToPairs(event.tail.countsBaseOutside),
    preOpHaz_counts: mapToPairs(event.pre.countsOpHazard),
    recOpHaz_counts: mapToPairs(event.recovery.countsOpHazard),
    tailOpHaz_counts: mapToPairs(event.tail.countsOpHazard),
    preOpOut_counts: mapToPairs(event.pre.countsOpOutside),
    recOpOut_counts: mapToPairs(event.recovery.countsOpOutside),
    tailOpOut_counts: mapToPairs(event.tail.countsOpOutside),
    preBaseHaz_trans: mapToPairs(event.pre.transBaseHazard),
    recBaseHaz_trans: mapToPairs(event.recovery.transBaseHazard),
    tailBaseHaz_trans: mapToPairs(event.tail.transBaseHazard),
    preBaseOut_trans: mapToPairs(event.pre.transBaseOutside),
    recBaseOut_trans: mapToPairs(event.recovery.transBaseOutside),
    tailBaseOut_trans: mapToPairs(event.tail.transBaseOutside),
    preOpHaz_trans: mapToPairs(event.pre.transOpHazard),
    recOpHaz_trans: mapToPairs(event.recovery.transOpHazard),
    tailOpHaz_trans: mapToPairs(event.tail.transOpHazard),
    preOpOut_trans: mapToPairs(event.pre.transOpOutside),
    recOpOut_trans: mapToPairs(event.recovery.transOpOutside),
    tailOpOut_trans: mapToPairs(event.tail.transOpOutside),
    pre_baseChange: event.pre.changeBaseHazard,
    rec_baseChange: event.recovery.changeBaseHazard,
    tail_baseChange: event.tail.changeBaseHazard,
    pre_baseChangeOutside: event.pre.changeBaseOutside,
    rec_baseChangeOutside: event.recovery.changeBaseOutside,
    tail_baseChangeOutside: event.tail.changeBaseOutside,
    pre_baseChangeCount: event.pre.changeBaseHazardCount,
    rec_baseChangeCount: event.recovery.changeBaseHazardCount,
    tail_baseChangeCount: event.tail.changeBaseHazardCount,
    pre_baseChangeTotal: event.pre.changeBaseHazardTotal,
    rec_baseChangeTotal: event.recovery.changeBaseHazardTotal,
    tail_baseChangeTotal: event.tail.changeBaseHazardTotal,
    pre_baseChangeOutsideCount: event.pre.changeBaseOutsideCount,
    rec_baseChangeOutsideCount: event.recovery.changeBaseOutsideCount,
    tail_baseChangeOutsideCount: event.tail.changeBaseOutsideCount,
    pre_baseChangeOutsideTotal: event.pre.changeBaseOutsideTotal,
    rec_baseChangeOutsideTotal: event.recovery.changeBaseOutsideTotal,
    tail_baseChangeOutsideTotal: event.tail.changeBaseOutsideTotal,
    pre_opChange: event.pre.changeOpHazard,
    rec_opChange: event.recovery.changeOpHazard,
    tail_opChange: event.tail.changeOpHazard,
    pre_opChangeOutside: event.pre.changeOpOutside,
    rec_opChangeOutside: event.recovery.changeOpOutside,
    tail_opChangeOutside: event.tail.changeOpOutside,
    pre_opChangeCount: event.pre.changeOpHazardCount,
    rec_opChangeCount: event.recovery.changeOpHazardCount,
    tail_opChangeCount: event.tail.changeOpHazardCount,
    pre_opChangeTotal: event.pre.changeOpHazardTotal,
    rec_opChangeTotal: event.recovery.changeOpHazardTotal,
    tail_opChangeTotal: event.tail.changeOpHazardTotal,
    pre_opChangeOutsideCount: event.pre.changeOpOutsideCount,
    rec_opChangeOutsideCount: event.recovery.changeOpOutsideCount,
    tail_opChangeOutsideCount: event.tail.changeOpOutsideCount,
    pre_opChangeOutsideTotal: event.pre.changeOpOutsideTotal,
    rec_opChangeOutsideTotal: event.recovery.changeOpOutsideTotal,
    tail_opChangeOutsideTotal: event.tail.changeOpOutsideTotal,
    pre_epTotal: event.pre.epTotal,
    rec_epTotal: event.recovery.epTotal,
    tail_epTotal: event.tail.epTotal,
    pre_epRepair: event.pre.epRepair,
    rec_epRepair: event.recovery.epRepair,
    tail_epRepair: event.tail.epRepair,
    pre_epOpK: event.pre.epOpK,
    rec_epOpK: event.recovery.epOpK,
    tail_epOpK: event.tail.epOpK,
  };
  return row;
}

async function runOnceMoveEdges(args) {
  const mod = await loadWasm();
  const presetRaw = readJson(args.presetPath);
  const baseParams = presetRaw.params ?? presetRaw;
  const params = { ...baseParams };
  applySets(params, args.sets);

  if (args.condition === "A") {
    params.opCouplingOn = 0;
    params.sCouplingMode = 0;
    params.opDriveOnK = 0;
  } else if (args.condition === "B") {
    params.opCouplingOn = 1;
    params.sCouplingMode = 1;
    params.opDriveOnK = 0;
  } else if (args.condition === "C") {
    params.opCouplingOn = 1;
    params.sCouplingMode = 1;
    params.opDriveOnK = 1;
  }

  const steps = args.steps ?? presetRaw.steps ?? 2_000_000;
  const eventEvery = args.eventEvery ?? presetRaw.eventEvery ?? 50_000;
  const deadline = args.deadline ?? presetRaw.deadline ?? 25_000;
  const regionType = args.regionType ?? (params.repairGateMode === 1 ? "stripe" : "quadrant");
  const regionIndex = args.regionIndex ?? 2;
  const gateSpan = args.gateSpan ?? params.repairGateSpan ?? 1;
  const corruptFrac = args.corruptFrac ?? 0.2;

  const gridSize = params.gridSize ?? 32;
  const bins = params.clockK ?? 8;
  const regionMask = buildRegionMask(gridSize, regionType, regionIndex, gateSpan, bins);
  const outsideMask = buildMatchedOutsideMask(regionMask, args.seed + 999);

  const sim = new mod.Sim(50, args.seed);
  sim.set_params({ ...params, epDebug: 1 });
  if (args.burnIn > 0) sim.step(args.burnIn);

  const moveLabels = sim.ep_move_labels ? Array.from(sim.ep_move_labels()) : [];
  const opkLabelIdx = moveLabels.indexOf("OpK");
  const opkMoveId = 9;
  if (opkLabelIdx >= 0 && opkLabelIdx !== opkMoveId) {
    console.warn(`OpK move label index ${opkLabelIdx} != ${opkMoveId}; using ${opkMoveId} for acceptLogMask`);
  }
  sim.set_params({
    acceptLogOn: 1,
    acceptLogMask: 1 << opkMoveId,
    acceptLogCap: 200000,
  });

  const opOffsets = sim.op_offsets ? sim.op_offsets() : new Int8Array();
  const { dx, dy } = offsetsToDxDy(opOffsets);
  const rCount = dx.length;

  const edgeCountHazard = new Map();
  const edgeEpSumHazard = new Map();
  const edgeEpAbsSumHazard = new Map();
  const edgeCountOutside = new Map();
  const edgeEpSumOutside = new Map();
  const edgeEpAbsSumOutside = new Map();
  const edgeFamCountHazard = new Map();
  const edgeFamCountOutside = new Map();

  let totalMovesHazard = 0;
  let totalMovesOutside = 0;
  let totalEpHazard = 0;
  let totalEpOutside = 0;
  let acceptLogOverflowed = false;

  const maxEventStart = steps - deadline;
  let eventIdx = 0;
  let t = 0;
  const chunkSteps = 10000;

  const applyEventAt = (tEvent) => {
    const perturb = {
      target: "metaS",
      layer: 0,
      frac: corruptFrac,
      mode: "randomize",
    };
    if (regionType === "stripe") {
      perturb.region = "stripe";
      perturb.bins = bins;
      perturb.span = gateSpan;
      perturb.bin = regionIndex;
    } else {
      perturb.region = "quadrant";
      perturb.quadrant = regionIndex;
    }
    perturb.seed = args.seed * 1000 + tEvent;
    sim.apply_perturbation(perturb);
  };

  const processLogEntries = (u32, ep) => {
    const entries = Math.min(ep.length, Math.floor(u32.length / 3));
    for (let i = 0; i < entries; i += 1) {
      const tEntry = u32[i * 3];
      const q = u32[i * 3 + 1];
      const meta = u32[i * 3 + 2];
      const moveId = meta & 0xff;
      if (moveId !== opkMoveId) continue;
      if (tEntry < eventEvery) continue;
      const t0 = Math.floor(tEntry / eventEvery) * eventEvery;
      if (t0 < eventEvery || t0 > maxEventStart) continue;
      if (tEntry - t0 >= deadline) continue;

      const qIdx = Number(q);
      const inHazard = regionMask[qIdx];
      const inOutside = outsideMask[qIdx];
      if (!inHazard && !inOutside) continue;

      const fromIdx = (meta >> 16) & 0xff;
      const toIdx = (meta >> 24) & 0xff;
      if (fromIdx >= rCount || toIdx >= rCount) continue;
      const key = edgeKey(fromIdx, toIdx);
      const epDelta = ep[i] ?? 0;

      if (inHazard) {
        addEdgeStats(edgeCountHazard, edgeEpSumHazard, edgeEpAbsSumHazard, key, epDelta);
        totalMovesHazard += 1;
        totalEpHazard += epDelta;
        if (dx.length > 0 && dy.length > 0) {
          const fam = edgeFamily(fromIdx, toIdx, dx, dy);
          edgeFamCountHazard.set(fam, (edgeFamCountHazard.get(fam) ?? 0) + 1);
        }
      } else if (inOutside) {
        addEdgeStats(edgeCountOutside, edgeEpSumOutside, edgeEpAbsSumOutside, key, epDelta);
        totalMovesOutside += 1;
        totalEpOutside += epDelta;
        if (dx.length > 0 && dy.length > 0) {
          const fam = edgeFamily(fromIdx, toIdx, dx, dy);
          edgeFamCountOutside.set(fam, (edgeFamCountOutside.get(fam) ?? 0) + 1);
        }
      }
    }
  };

  while (t < steps) {
    const nextEventTime = (eventIdx + 1) * eventEvery;
    const next = Math.min(t + chunkSteps, nextEventTime, steps);
    if (next > t) {
      sim.step(next - t);
      t = next;
    }
    if (nextEventTime <= maxEventStart && t === nextEventTime) {
      applyEventAt(nextEventTime);
      eventIdx += 1;
    }

    if (sim.accept_log_len) {
      const len = sim.accept_log_len();
      if (len > 0) {
        const u32 = sim.accept_log_u32();
        const ep = sim.accept_log_ep();
        processLogEntries(u32, ep);
      }
      acceptLogOverflowed = sim.accept_log_overflowed();
      sim.accept_log_clear();
      if (acceptLogOverflowed) {
        throw new Error("ACCEPT_LOG_OVERFLOW: reduce chunkSteps or raise acceptLogCap");
      }
    }
  }

  const topEdges = (counts, epSum, limit) => {
    const rows = [];
    for (const [key, count] of counts.entries()) {
      const [fromIdx, toIdx] = key.split("->");
      rows.push({
        fromIdx: Number(fromIdx),
        toIdx: Number(toIdx),
        count,
        epSum: epSum.get(key) ?? 0,
      });
    }
    rows.sort((a, b) => b.count - a.count);
    return rows.slice(0, limit);
  };

  const summary = {
    seed: args.seed,
    condition: args.condition,
    steps,
    eventEvery,
    deadline,
    gridSize,
    metaLayers: params.metaLayers ?? 0,
    opStencil: params.opStencil ?? 0,
    opBudgetK: params.opBudgetK ?? 0,
    totalMovesHazard,
    totalMovesOutside,
    totalEpHazard,
    totalEpOutside,
    uniqueEdgesHazard: edgeCountHazard.size,
    uniqueEdgesOutside: edgeCountOutside.size,
    topEdgesHazard: topEdges(edgeCountHazard, edgeEpSumHazard, 20),
    topEdgesOutside: topEdges(edgeCountOutside, edgeEpSumOutside, 20),
    acceptLogOverflowed,
  };

  return {
    summary,
    edgeCountHazard,
    edgeEpSumHazard,
    edgeEpAbsSumHazard,
    edgeCountOutside,
    edgeEpSumOutside,
    edgeEpAbsSumOutside,
    edgeFamCountHazard,
    edgeFamCountOutside,
  };
}

async function runOnceP5Actions(args) {
  const mod = await loadWasm();
  const presetRaw = readJson(args.presetPath);
  const baseParams = presetRaw.params ?? presetRaw;
  const params = { ...baseParams };
  applySets(params, args.sets);

  if (args.condition === "A") {
    params.opCouplingOn = 0;
    params.sCouplingMode = 0;
    params.opDriveOnK = 0;
  } else if (args.condition === "B") {
    params.opCouplingOn = 1;
    params.sCouplingMode = 1;
    params.opDriveOnK = 0;
  } else if (args.condition === "C") {
    params.opCouplingOn = 1;
    params.sCouplingMode = 1;
    params.opDriveOnK = 1;
  }

  const steps = args.steps ?? presetRaw.steps ?? 2_000_000;
  const eventEvery = args.eventEvery ?? presetRaw.eventEvery ?? 50_000;
  const deadline = args.deadline ?? presetRaw.deadline ?? 25_000;
  const regionType = args.regionType ?? (params.repairGateMode === 1 ? "stripe" : "quadrant");
  const regionIndex = args.regionIndex ?? 2;
  const gateSpan = args.gateSpan ?? params.repairGateSpan ?? 1;
  const corruptFrac = args.corruptFrac ?? 0.2;

  const gridSize = params.gridSize ?? 32;
  const bins = params.clockK ?? 8;
  const regionMask = buildRegionMask(gridSize, regionType, regionIndex, gateSpan, bins);
  const outsideMask = buildMatchedOutsideMask(regionMask, args.seed + 999);

  const sim = new mod.Sim(50, args.seed);
  sim.set_params({ ...params, epDebug: 1 });
  if (args.burnIn > 0) sim.step(args.burnIn);

  const moveLabels = sim.ep_move_labels ? Array.from(sim.ep_move_labels()) : [];
  const idxP5Base = moveLabels.indexOf("P5Base");
  const idxP5Meta = moveLabels.indexOf("P5Meta");
  if (idxP5Base < 0 || idxP5Meta < 0) {
    throw new Error(`MISSING_P5_MOVE_LABEL: ${JSON.stringify(moveLabels)}`);
  }
  if (idxP5Base > 31 || idxP5Meta > 31) {
    throw new Error("ACCEPT_LOG_MASK_OVERFLOW");
  }
  sim.set_params({
    acceptLogOn: 1,
    acceptLogMask: (1 << idxP5Base) | (1 << idxP5Meta),
    acceptLogCap: 200000,
  });
  if (sim.accept_log_clear) sim.accept_log_clear();

  const rCount = sim.op_r_count ? sim.op_r_count() : 0;
  const effR = Math.max(1, rCount);
  const metaLayers = params.metaLayers ?? 0;

  const motifCountsHazard = new Map();
  const motifEpSumHazard = new Map();
  const motifEpAbsSumHazard = new Map();
  const motifCountsOutside = new Map();
  const motifEpSumOutside = new Map();
  const motifEpAbsSumOutside = new Map();
  const transHazard = new Map();
  const transOutside = new Map();

  let totalMovesHazard = 0;
  let totalMovesOutside = 0;
  let totalEpHazard = 0;
  let totalEpOutside = 0;
  let acceptLogOverflowed = false;

  let prevHazardMotif = null;
  let prevOutsideMotif = null;

  const maxEventStart = steps - eventEvery;
  let eventIdx = 0;
  let t = 0;
  const chunkSteps = 10000;

  const applyEventAt = (tEvent) => {
    const perturb = {
      target: "metaS",
      layer: 0,
      frac: corruptFrac,
      mode: "randomize",
    };
    if (regionType === "stripe") {
      perturb.region = "stripe";
      perturb.bins = bins;
      perturb.span = gateSpan;
      perturb.bin = regionIndex;
    } else {
      perturb.region = "quadrant";
      perturb.quadrant = regionIndex;
    }
    perturb.seed = args.seed * 1000 + tEvent;
    sim.apply_perturbation(perturb);
  };

  const addMotif = (region, motifId, epDelta) => {
    if (region === "hazard") {
      motifCountsHazard.set(motifId, (motifCountsHazard.get(motifId) ?? 0) + 1);
      motifEpSumHazard.set(motifId, (motifEpSumHazard.get(motifId) ?? 0) + epDelta);
      motifEpAbsSumHazard.set(
        motifId,
        (motifEpAbsSumHazard.get(motifId) ?? 0) + Math.abs(epDelta),
      );
      totalMovesHazard += 1;
      totalEpHazard += epDelta;
    } else {
      motifCountsOutside.set(motifId, (motifCountsOutside.get(motifId) ?? 0) + 1);
      motifEpSumOutside.set(motifId, (motifEpSumOutside.get(motifId) ?? 0) + epDelta);
      motifEpAbsSumOutside.set(
        motifId,
        (motifEpAbsSumOutside.get(motifId) ?? 0) + Math.abs(epDelta),
      );
      totalMovesOutside += 1;
      totalEpOutside += epDelta;
    }
  };

  const updateTransitionEdge = (map, from, to) => {
    const key = `${from}->${to}`;
    map.set(key, (map.get(key) ?? 0) + 1);
  };

  const processLogEntries = (u32, ep) => {
    const entries = Math.min(ep.length, Math.floor(u32.length / 3));
    for (let i = 0; i < entries; i += 1) {
      const tEntry = u32[i * 3];
      const q = u32[i * 3 + 1];
      const meta = u32[i * 3 + 2];
      const moveId = meta & 0xff;
      if (moveId !== idxP5Base && moveId !== idxP5Meta) continue;
      if (tEntry < eventEvery) continue;
      const t0 = Math.floor(tEntry / eventEvery) * eventEvery;
      if (t0 < eventEvery) continue;
      if (t0 > maxEventStart) continue;
      if (tEntry - t0 >= deadline) continue;

      const qIdx = Number(q);
      const inHazard = regionMask[qIdx];
      const inOutside = outsideMask[qIdx];
      if (!inHazard && !inOutside) continue;

      const layerByte = (meta >>> 8) & 0xff;
      const mismatchBin = (meta >>> 16) & 0xff;
      const kDir = (meta >>> 24) & 0xff;

      let motifId;
      if (moveId === idxP5Base) {
        motifId = (kDir % effR) * 3 + mismatchBin;
      } else {
        const layer = layerByte;
        if (layer >= metaLayers) continue;
        motifId = effR * 3 + layer * (effR * 3) + (kDir % effR) * 3 + mismatchBin;
      }

      const epDelta = ep[i] ?? 0;
      if (inHazard) {
        if (prevHazardMotif !== null) {
          updateTransitionEdge(transHazard, prevHazardMotif, motifId);
        }
        prevHazardMotif = motifId;
        addMotif("hazard", motifId, epDelta);
      } else if (inOutside) {
        if (prevOutsideMotif !== null) {
          updateTransitionEdge(transOutside, prevOutsideMotif, motifId);
        }
        prevOutsideMotif = motifId;
        addMotif("outside", motifId, epDelta);
      }
    }
  };

  while (t < steps) {
    const nextEventTime = (eventIdx + 1) * eventEvery;
    const next = Math.min(t + chunkSteps, nextEventTime, steps);
    if (next > t) {
      sim.step(next - t);
      t = next;
    }
    if (nextEventTime <= maxEventStart && t === nextEventTime) {
      applyEventAt(nextEventTime);
      eventIdx += 1;
    }

    if (sim.accept_log_len) {
      const len = sim.accept_log_len();
      if (len > 0) {
        const u32 = sim.accept_log_u32();
        const ep = sim.accept_log_ep();
        processLogEntries(u32, ep);
      }
      acceptLogOverflowed = sim.accept_log_overflowed();
      sim.accept_log_clear();
      if (acceptLogOverflowed) {
        throw new Error("ACCEPT_LOG_OVERFLOW: reduce chunkSteps or raise acceptLogCap");
      }
    }
  }

  const summary = {
    seed: args.seed,
    condition: args.condition,
    steps,
    eventEvery,
    deadline,
    rCount,
    metaLayers,
    totalMovesHazard,
    totalMovesOutside,
    totalEpHazard,
    totalEpOutside,
    uniqueMotifsHazard: motifCountsHazard.size,
    uniqueMotifsOutside: motifCountsOutside.size,
    acceptLogOverflowed,
  };

  return {
    summary,
    motifCountsHazard,
    motifEpSumHazard,
    motifEpAbsSumHazard,
    motifCountsOutside,
    motifEpSumOutside,
    motifEpAbsSumOutside,
    transHazard,
    transOutside,
  };
}

async function runOnce(args) {
  const mod = await loadWasm();
  const presetRaw = readJson(args.presetPath);
  const baseParams = presetRaw.params ?? presetRaw;
  const params = { ...baseParams };
  applySets(params, args.sets);

  if (args.condition === "A") {
    params.opCouplingOn = 0;
    params.sCouplingMode = 0;
    params.opDriveOnK = 0;
  } else if (args.condition === "B") {
    params.opCouplingOn = 1;
    params.sCouplingMode = 1;
    params.opDriveOnK = 0;
  } else if (args.condition === "C") {
    params.opCouplingOn = 1;
    params.sCouplingMode = 1;
    params.opDriveOnK = 1;
  } else if (args.condition === "D") {
    params.opCouplingOn = 1;
    params.sCouplingMode = 1;
    params.opDriveOnK = 1;
  }

  const steps = args.steps ?? presetRaw.steps ?? 2_000_000;
  const reportEvery = args.reportEvery ?? presetRaw.reportEvery ?? 5_000;
  const eventEvery = args.eventEvery ?? presetRaw.eventEvery ?? 50_000;
  const deadline = args.deadline ?? presetRaw.deadline ?? 25_000;
  const regionType = args.regionType ?? (params.repairGateMode === 1 ? "stripe" : "quadrant");
  const regionIndex = args.regionIndex ?? 2;
  const gateSpan = args.gateSpan ?? params.repairGateSpan ?? 1;
  const corruptFrac = args.corruptFrac ?? 0.2;
  const tailWindow = args.tailWindow ?? 200_000;
  const gateConditioned = Number(args.gateConditioned ?? 1) === 1;
  const gateCheckEvery = Math.max(1, Math.floor(args.gateCheckEvery ?? 5_000));
  const sampleEvery = gateCheckEvery;
  const wPre = Math.min(50_000, deadline);

  const bins = params.clockK ?? 8;
  const gridSize = params.gridSize ?? 32;
  const cells = gridSize * gridSize;
  const regionMask = buildRegionMask(gridSize, regionType, regionIndex, gateSpan, bins);
  const outsideMask = buildMatchedOutsideMask(regionMask, args.seed + 999);

  const sim = new mod.Sim(50, args.seed);
  sim.set_params({ ...params, epDebug: 1 });
  if (args.burnIn > 0) sim.step(args.burnIn);

  const moveLabels = sim.ep_move_labels ? Array.from(sim.ep_move_labels()) : [];
  const idxP5Base = moveLabels.indexOf("P5Base");
  const idxP5Meta = moveLabels.indexOf("P5Meta");
  const idxOpK = moveLabels.indexOf("OpK");
  const idxClock = moveLabels.indexOf("Clock");
  if ([idxP5Base, idxP5Meta, idxOpK, idxClock].some((idx) => idx < 0)) {
    throw new Error(`ep_move_labels missing expected labels: ${JSON.stringify(moveLabels)}`);
  }

  const rCount = sim.op_r_count ? sim.op_r_count() : 0;
  const offsets = rCount > 0 ? parseOpOffsets(sim.op_offsets()) : [];
  const opBudgetK = params.opBudgetK ?? 1;
  const lS = params.lS ?? 1;

  const events = [];
  for (let t = eventEvery; t + deadline <= steps; t += eventEvery) {
    events.push({
      idx: events.length,
      tEvent: t,
      recovered: false,
      miss: false,
      recoveryTime: null,
      stepsToOutcome: null,
      startEp: null,
      deltaEp: null,
      opBinsMode: args.opBinsMode,
      seed: args.seed,
      condition: args.condition,
      pre: emptyWindowStats(),
      recovery: emptyWindowStats(),
      tail: emptyWindowStats(),
    });
  }

  let nextReport = reportEvery;
  let nextSample = sampleEvery;
  let eventIdx = 0;
  let lastEventTime = null;
  const graceWindow = Math.max(0, Math.floor(0.2 * deadline));
  const reportRecords = [];

  let prevBase = null;
  let prevOp = null;
  let prevEpByMove = null;
  let prevEpTotal = null;
  let hazGateOpen = false;
  let hazardGateSampleCount = 0;
  if ((params.metaLayers ?? 0) > 0) {
    const baseS = sim.base_s_field();
    const metaS = sim.meta_field();
    const tokens = sim.op_k_tokens();
    prevBase = computeMBaseClasses({ baseS, metaS, gridSize, lS, metaLayers: params.metaLayers ?? 0 });
    prevOp = computeMOpClasses({
      baseS,
      metaS,
      gridSize,
      lS,
      metaLayers: params.metaLayers ?? 0,
      tokens,
      rCount,
      offsets,
      opBudgetK,
      opBinsMode: args.opBinsMode,
    });
  }

  const hazardBaseSamples = [];
  const outsideBaseSamples = [];
  const hazardOpSamples = [];
  const outsideOpSamples = [];
  const changeBaseHazard = [];
  const changeBaseOutside = [];
  const changeOpHazard = [];
  const changeOpOutside = [];

  const runCountsBaseHazard = new Map();
  const runCountsBaseOutside = new Map();
  const runCountsOpHazard = new Map();
  const runCountsOpOutside = new Map();
  const runTransBaseHazard = new Map();
  const runTransBaseOutside = new Map();
  const runTransOpHazard = new Map();
  const runTransOpOutside = new Map();

  const edgeEpRepairBase = new Map();
  const edgeEpOpKBase = new Map();
  const edgeEpTotalBase = new Map();
  const edgeEpRepairOp = new Map();
  const edgeEpOpKOp = new Map();
  const edgeEpTotalOp = new Map();

  const epPerChangeBase = [];
  const epPerChangeOp = [];

  for (let t = 0; t < steps; ) {
    const nextEventTime = eventIdx < events.length ? events[eventIdx].tEvent : Number.POSITIVE_INFINITY;
    const next = Math.min(nextReport, nextSample, nextEventTime, steps);
    if (next > t) {
      sim.step(next - t);
      t = next;
    }

    if (eventIdx < events.length && t >= events[eventIdx].tEvent) {
      for (; eventIdx < events.length && events[eventIdx].tEvent <= t; eventIdx += 1) {
        const event = events[eventIdx];
        const perturb = {
          target: "metaS",
          layer: 0,
          frac: corruptFrac,
          mode: "randomize",
        };
        if (regionType === "stripe") {
          perturb.region = "stripe";
          perturb.bins = bins;
          perturb.span = gateSpan;
          perturb.bin = regionIndex;
        } else {
          perturb.region = "quadrant";
          perturb.quadrant = regionIndex;
        }
        perturb.seed = args.seed * 1000 + event.tEvent;
        sim.apply_perturbation(perturb);
        lastEventTime = event.tEvent;
        const epByMove = sim.ep_exact_by_move ? sim.ep_exact_by_move() : [];
        event.startEp = {
          total: sim.ep_exact_total ? sim.ep_exact_total() : 0,
          repair: (epByMove[idxP5Base] ?? 0) + (epByMove[idxP5Meta] ?? 0),
          opK: epByMove[idxOpK] ?? 0,
          clock: epByMove[idxClock] ?? 0,
        };
      }
    }

    if (t === nextSample && (params.metaLayers ?? 0) > 0) {
      const gateOpenNow = gateConditioned
        ? hazardGateActive(sim.clock_state(), params, regionIndex, gateSpan)
        : true;
      if (gateConditioned && !gateOpenNow) {
        hazGateOpen = false;
        prevBase = null;
        prevOp = null;
        prevEpByMove = null;
        prevEpTotal = null;
        nextSample += sampleEvery;
        continue;
      }

      const baseS = sim.base_s_field();
      const metaS = sim.meta_field();
      const tokens = sim.op_k_tokens();
      const currentBase = computeMBaseClasses({
        baseS,
        metaS,
        gridSize,
        lS,
        metaLayers: params.metaLayers ?? 0,
      });
      const currentOp = computeMOpClasses({
        baseS,
        metaS,
        gridSize,
        lS,
        metaLayers: params.metaLayers ?? 0,
        tokens,
        rCount,
        offsets,
        opBudgetK,
        opBinsMode: args.opBinsMode,
      });

      hazardGateSampleCount += 1;

      const baseHazCounts = computeCounts(currentBase, regionMask).counts;
      const baseOutCounts = computeCounts(currentBase, outsideMask).counts;
      const opHazCounts = computeCounts(currentOp, regionMask).counts;
      const opOutCounts = computeCounts(currentOp, outsideMask).counts;

      hazardBaseSamples.push(vocabStats(baseHazCounts));
      outsideBaseSamples.push(vocabStats(baseOutCounts));
      hazardOpSamples.push(vocabStats(opHazCounts));
      outsideOpSamples.push(vocabStats(opOutCounts));

      for (const [key, value] of baseHazCounts.entries()) updateCount(runCountsBaseHazard, key, value);
      for (const [key, value] of baseOutCounts.entries()) updateCount(runCountsBaseOutside, key, value);
      for (const [key, value] of opHazCounts.entries()) updateCount(runCountsOpHazard, key, value);
      for (const [key, value] of opOutCounts.entries()) updateCount(runCountsOpOutside, key, value);

      const epByMove = sim.ep_exact_by_move ? Array.from(sim.ep_exact_by_move()) : [];
      const epTotal = sim.ep_exact_total ? sim.ep_exact_total() : 0;

      const transBaseHaz = new Map();
      const transBaseOut = new Map();
      const transOpHaz = new Map();
      const transOpOut = new Map();
      let changeBaseHaz = { changed: 0, total: 0, frac: 0 };
      let changeBaseOut = { changed: 0, total: 0, frac: 0 };
      let changeOpHaz = { changed: 0, total: 0, frac: 0 };
      let changeOpOut = { changed: 0, total: 0, frac: 0 };
      let deltaTotal = 0;
      let deltaRepair = 0;
      let deltaOpK = 0;

      if (prevBase && prevOp && prevEpByMove && hazGateOpen) {
        changeBaseHaz = computeChange(prevBase, currentBase, regionMask);
        changeBaseOut = computeChange(prevBase, currentBase, outsideMask);
        changeOpHaz = computeChange(prevOp, currentOp, regionMask);
        changeOpOut = computeChange(prevOp, currentOp, outsideMask);

        changeBaseHazard.push(changeBaseHaz.frac);
        changeBaseOutside.push(changeBaseOut.frac);
        changeOpHazard.push(changeOpHaz.frac);
        changeOpOutside.push(changeOpOut.frac);

        const baseHazChanged = accumulateTransitions(prevBase, currentBase, regionMask, transBaseHaz);
        const baseOutChanged = accumulateTransitions(prevBase, currentBase, outsideMask, transBaseOut);
        const opHazChanged = accumulateTransitions(prevOp, currentOp, regionMask, transOpHaz);
        const opOutChanged = accumulateTransitions(prevOp, currentOp, outsideMask, transOpOut);

        for (const [key, value] of transBaseHaz.entries()) updateCount(runTransBaseHazard, key, value);
        for (const [key, value] of transBaseOut.entries()) updateCount(runTransBaseOutside, key, value);
        for (const [key, value] of transOpHaz.entries()) updateCount(runTransOpHazard, key, value);
        for (const [key, value] of transOpOut.entries()) updateCount(runTransOpOutside, key, value);

        deltaTotal = epTotal - (prevEpTotal ?? 0);
        const prevRepair = (prevEpByMove[idxP5Base] ?? 0) + (prevEpByMove[idxP5Meta] ?? 0);
        const currRepair = (epByMove[idxP5Base] ?? 0) + (epByMove[idxP5Meta] ?? 0);
        deltaRepair = currRepair - prevRepair;
        deltaOpK = (epByMove[idxOpK] ?? 0) - (prevEpByMove[idxOpK] ?? 0);

        epPerChangeBase.push(baseHazChanged > 0 ? deltaTotal / baseHazChanged : 0);
        epPerChangeOp.push(opHazChanged > 0 ? deltaOpK / opHazChanged : 0);

        const baseHazTotal = totalTransitions(transBaseHaz);
        if (baseHazTotal > 0) {
          for (const [key, count] of transBaseHaz.entries()) {
            const frac = count / baseHazTotal;
            updateCount(edgeEpRepairBase, key, frac * deltaRepair);
            updateCount(edgeEpOpKBase, key, frac * deltaOpK);
            updateCount(edgeEpTotalBase, key, frac * deltaTotal);
          }
        }

        const opHazTotal = totalTransitions(transOpHaz);
        if (opHazTotal > 0) {
          for (const [key, count] of transOpHaz.entries()) {
            const frac = count / opHazTotal;
            updateCount(edgeEpRepairOp, key, frac * deltaRepair);
            updateCount(edgeEpOpKOp, key, frac * deltaOpK);
            updateCount(edgeEpTotalOp, key, frac * deltaTotal);
          }
        }
      }

      for (const event of events) {
        const window = eventWindowForTime(event, t, wPre, tailWindow, deadline);
        if (!window) continue;
        const slot = event[window];
        for (const [key, value] of baseHazCounts.entries()) updateCount(slot.countsBaseHazard, key, value);
        for (const [key, value] of baseOutCounts.entries()) updateCount(slot.countsBaseOutside, key, value);
        for (const [key, value] of opHazCounts.entries()) updateCount(slot.countsOpHazard, key, value);
        for (const [key, value] of opOutCounts.entries()) updateCount(slot.countsOpOutside, key, value);
        for (const [key, value] of transBaseHaz.entries()) updateCount(slot.transBaseHazard, key, value);
        for (const [key, value] of transBaseOut.entries()) updateCount(slot.transBaseOutside, key, value);
        for (const [key, value] of transOpHaz.entries()) updateCount(slot.transOpHazard, key, value);
        for (const [key, value] of transOpOut.entries()) updateCount(slot.transOpOutside, key, value);
        slot.changeBaseHazard += changeBaseHaz.frac;
        slot.changeBaseOutside += changeBaseOut.frac;
        slot.changeOpHazard += changeOpHaz.frac;
        slot.changeOpOutside += changeOpOut.frac;
        slot.changeBaseHazardCount += changeBaseHaz.changed;
        slot.changeBaseHazardTotal += changeBaseHaz.total;
        slot.changeBaseOutsideCount += changeBaseOut.changed;
        slot.changeBaseOutsideTotal += changeBaseOut.total;
        slot.changeOpHazardCount += changeOpHaz.changed;
        slot.changeOpHazardTotal += changeOpHaz.total;
        slot.changeOpOutsideCount += changeOpOut.changed;
        slot.changeOpOutsideTotal += changeOpOut.total;
        slot.epTotal += deltaTotal;
        slot.epRepair += deltaRepair;
        slot.epOpK += deltaOpK;
        slot.samples += 1;
      }

      prevBase = currentBase;
      prevOp = currentOp;
      prevEpByMove = epByMove;
      prevEpTotal = epTotal;
      hazGateOpen = true;
      nextSample += sampleEvery;
    }

    if (t === nextReport) {
      const baseS = sim.base_s_field();
      const metaS = sim.meta_field();
      const meta0 = metaS.subarray(0, cells);
      const sdiff = meanAbsDiffRegion(baseS, meta0, regionMask);
      const errSample = errRegionBits(baseS, meta0, gridSize, lS, regionMask);
      const errAdj = errSample;
      const good = sdiff <= args.sdiffGood && errAdj <= args.errGood;
      const sinceEvent = lastEventTime === null ? Number.POSITIVE_INFINITY : t - lastEventTime;
      reportRecords.push({ t, err: errAdj, sdiff, good, sinceEvent });

      for (const event of events) {
        if (event.recovered || event.miss) continue;
        if (t < event.tEvent) continue;
        const elapsed = t - event.tEvent;
        if (elapsed > deadline) {
          event.miss = true;
          event.stepsToOutcome = elapsed;
        } else if (good) {
          event.recovered = true;
          event.recoveryTime = elapsed;
          event.stepsToOutcome = elapsed;
        }
      }

      nextReport += reportEvery;
    }
  }

  const epByMove = sim.ep_exact_by_move ? sim.ep_exact_by_move() : [];
  const endEp = {
    total: sim.ep_exact_total ? sim.ep_exact_total() : 0,
    repair: (epByMove[idxP5Base] ?? 0) + (epByMove[idxP5Meta] ?? 0),
    opK: epByMove[idxOpK] ?? 0,
    clock: epByMove[idxClock] ?? 0,
  };

  for (const event of events) {
    if (!event.recovered && !event.miss) {
      event.miss = true;
      event.stepsToOutcome = deadline;
    }
    if (event.startEp) {
      event.deltaEp = {
        total: endEp.total - event.startEp.total,
        repair: endEp.repair - event.startEp.repair,
        opK: endEp.opK - event.startEp.opK,
        clock: endEp.clock - event.startEp.clock,
      };
    }
    event.recoverySamples = event.recovery.samples;
  }

  const missCount = events.filter((e) => e.miss).length;
  const recoveries = events.filter((e) => e.recovered).map((e) => e.recoveryTime ?? 0);
  const tailStart = Math.max(0, steps - tailWindow);
  const tailSamples = reportRecords.filter(
    (s) => s.t >= tailStart && s.sinceEvent >= graceWindow,
  );
  const tailUptime = tailSamples.length ? tailSamples.filter((s) => s.good).length / tailSamples.length : 0;
  const tailErrMean = tailSamples.length ? mean(tailSamples.map((s) => s.err)) : 0;
  const tailSdiffMean = tailSamples.length ? mean(tailSamples.map((s) => s.sdiff)) : 0;

  const qCounts = sim.ep_q_stats().count ?? [];
  const repairRate = steps > 0 ? (qCounts[idxP5Meta] ?? 0) / steps : 0;
  const opkRate = steps > 0 ? (qCounts[idxOpK] ?? 0) / steps : 0;
  const eventRecoveryWindowSampleCountMean = events.length
    ? mean(events.map((e) => e.recovery.samples))
    : 0;
  const hazardOpChangeFracMean = changeOpHazard.length ? mean(changeOpHazard) : 0;

  const summary = {
    seed: args.seed,
    condition: args.condition,
    opBinsMode: args.opBinsMode,
    gateConditioned: gateConditioned ? 1 : 0,
    gateCheckEvery,
    steps,
    reportEvery,
    eventEvery,
    deadline,
    regionType,
    regionIndex,
    gateSpan,
    sampleEvery,
    burnIn: args.burnIn,
    missFrac: events.length > 0 ? missCount / events.length : 0,
    recoveryMean: recoveries.length ? mean(recoveries) : null,
    recoveryP95: percentile(recoveries, 0.95),
    uptimeTail: tailUptime,
    errTailMean: tailErrMean,
    sdiffTailMean: tailSdiffMean,
    epTotalRate: steps > 0 ? endEp.total / steps : 0,
    epRepairRate: steps > 0 ? endEp.repair / steps : 0,
    epOpKRate: steps > 0 ? endEp.opK / steps : 0,
    epClockRate: steps > 0 ? endEp.clock / steps : 0,
    repairRate,
    opKRate: opkRate,
    hazardGateSampleCount,
    hazardOpUniqueStatesVisited: runCountsOpHazard.size,
    hazardOpChangeFracMean,
    eventRecoveryWindowSampleCountMean,
    hazardBase_H: summarizeValues(hazardBaseSamples.map((s) => s.H_vocab)),
    hazardBase_Veff: summarizeValues(hazardBaseSamples.map((s) => s.V_eff)),
    hazardBase_topMass10: summarizeValues(hazardBaseSamples.map((s) => s.topMass10)),
    hazardBase_changeFrac: summarizeValues(changeBaseHazard),
    outsideBase_H: summarizeValues(outsideBaseSamples.map((s) => s.H_vocab)),
    outsideBase_Veff: summarizeValues(outsideBaseSamples.map((s) => s.V_eff)),
    outsideBase_topMass10: summarizeValues(outsideBaseSamples.map((s) => s.topMass10)),
    outsideBase_changeFrac: summarizeValues(changeBaseOutside),
    hazardOp_H: summarizeValues(hazardOpSamples.map((s) => s.H_vocab)),
    hazardOp_Veff: summarizeValues(hazardOpSamples.map((s) => s.V_eff)),
    hazardOp_topMass10: summarizeValues(hazardOpSamples.map((s) => s.topMass10)),
    hazardOp_changeFrac: summarizeValues(changeOpHazard),
    outsideOp_H: summarizeValues(outsideOpSamples.map((s) => s.H_vocab)),
    outsideOp_Veff: summarizeValues(outsideOpSamples.map((s) => s.V_eff)),
    outsideOp_topMass10: summarizeValues(outsideOpSamples.map((s) => s.topMass10)),
    outsideOp_changeFrac: summarizeValues(changeOpOutside),
    asymmetryBase: { mean: asymmetryScore(runTransBaseHazard), std: null },
    asymmetryOp: { mean: asymmetryScore(runTransOpHazard), std: null },
    coarseEPBase: { mean: coarseEPSmoothed(runTransBaseHazard, 0.5), std: null },
    coarseEPOp: { mean: coarseEPSmoothed(runTransOpHazard, 0.5), std: null },
    epPerChangeBase: summarizeValues(epPerChangeBase),
    epPerChangeOp: summarizeValues(epPerChangeOp),
    uniqueBaseHazard: runCountsBaseHazard.size,
    uniqueBaseOutside: runCountsBaseOutside.size,
    uniqueOpHazard: runCountsOpHazard.size,
    uniqueOpOutside: runCountsOpOutside.size,
    transitionsBaseHazard: mapToPairs(runTransBaseHazard),
    transitionsBaseOutside: mapToPairs(runTransBaseOutside),
    transitionsOpHazard: mapToPairs(runTransOpHazard),
    transitionsOpOutside: mapToPairs(runTransOpOutside),
    countsBaseHazard: mapToPairs(runCountsBaseHazard),
    countsBaseOutside: mapToPairs(runCountsBaseOutside),
    countsOpHazard: mapToPairs(runCountsOpHazard),
    countsOpOutside: mapToPairs(runCountsOpOutside),
    edgeEpRepairBase: mapToPairs(edgeEpRepairBase),
    edgeEpOpKBase: mapToPairs(edgeEpOpKBase),
    edgeEpTotalBase: mapToPairs(edgeEpTotalBase),
    edgeEpRepairOp: mapToPairs(edgeEpRepairOp),
    edgeEpOpKOp: mapToPairs(edgeEpOpKOp),
    edgeEpTotalOp: mapToPairs(edgeEpTotalOp),
  };

  const eventRows = events.map((event) => buildEventRow(event));

  return { summary, events: eventRows };
}

export async function runDeadlineOpkMotifEvents(options) {
  const args = options ?? parseArgs(process.argv);
  if (!args.presetPath) throw new Error("--preset is required");
  if (args.motifMode === "move_edges") {
    const result = await runOnceMoveEdges(args);
    ensureDir(args.outDir);
    const condDir = path.join(args.outDir, args.condition, `seed_${args.seed}`);
    ensureDir(condDir);
    const summaryPath = path.join(condDir, "move_edges_summary.json");
    fs.writeFileSync(summaryPath, JSON.stringify(result.summary, null, 2));

    const writeCountsCsv = (filename, counts, epSum, epAbsSum) => {
      const header = "fromIdx,toIdx,count,epSum,epAbsSum";
      const lines = [header];
      for (const [key, count] of counts.entries()) {
        const [fromIdx, toIdx] = key.split("->");
        lines.push(
          [fromIdx, toIdx, count, epSum.get(key) ?? 0, epAbsSum.get(key) ?? 0].join(","),
        );
      }
      fs.writeFileSync(path.join(condDir, filename), lines.join("\n") + "\n");
    };

    writeCountsCsv(
      "move_edges_counts_hazard.csv",
      result.edgeCountHazard,
      result.edgeEpSumHazard,
      result.edgeEpAbsSumHazard,
    );
    writeCountsCsv(
      "move_edges_counts_outside.csv",
      result.edgeCountOutside,
      result.edgeEpSumOutside,
      result.edgeEpAbsSumOutside,
    );

    const famLines = ["region,family,count"];
    if (result.edgeFamCountHazard && result.edgeFamCountHazard.size > 0) {
      for (const [family, count] of result.edgeFamCountHazard.entries()) {
        famLines.push(["hazard", family, count].join(","));
      }
    }
    if (result.edgeFamCountOutside && result.edgeFamCountOutside.size > 0) {
      for (const [family, count] of result.edgeFamCountOutside.entries()) {
        famLines.push(["outside", family, count].join(","));
      }
    }
    if (famLines.length > 1) {
      fs.writeFileSync(path.join(condDir, "move_edges_families.csv"), famLines.join("\n") + "\n");
    }
    return { summary: result.summary, events: [], outDir: condDir };
  }
  if (args.motifMode === "p5_actions") {
    const result = await runOnceP5Actions(args);
    ensureDir(args.outDir);
    const condDir = path.join(args.outDir, args.condition, `seed_${args.seed}`);
    ensureDir(condDir);
    const summaryPath = path.join(condDir, "p5_actions_summary.json");
    fs.writeFileSync(summaryPath, JSON.stringify(result.summary, null, 2));

    const writeCountsCsv = (filename, counts, epSum, epAbsSum) => {
      const header = "motifId,count,epSum,epAbsSum";
      const lines = [header];
      for (const [motifId, count] of counts.entries()) {
        lines.push(
          [motifId, count, epSum.get(motifId) ?? 0, epAbsSum.get(motifId) ?? 0].join(","),
        );
      }
      fs.writeFileSync(path.join(condDir, filename), lines.join("\n") + "\n");
    };

    const writeTransitionsCsv = (filename, transCounts) => {
      const header = "fromMotif,toMotif,count,countRev";
      const lines = [header];
      for (const [key, count] of transCounts.entries()) {
        const [fromMotif, toMotif] = key.split("->");
        const revKey = `${toMotif}->${fromMotif}`;
        const countRev = transCounts.get(revKey) ?? 0;
        lines.push([fromMotif, toMotif, count, countRev].join(","));
      }
      fs.writeFileSync(path.join(condDir, filename), lines.join("\n") + "\n");
    };

    writeCountsCsv(
      "p5_actions_counts_hazard.csv",
      result.motifCountsHazard,
      result.motifEpSumHazard,
      result.motifEpAbsSumHazard,
    );
    writeCountsCsv(
      "p5_actions_counts_outside.csv",
      result.motifCountsOutside,
      result.motifEpSumOutside,
      result.motifEpAbsSumOutside,
    );
    writeTransitionsCsv("p5_actions_transitions_hazard.csv", result.transHazard);
    writeTransitionsCsv("p5_actions_transitions_outside.csv", result.transOutside);

    return { summary: result.summary, events: [], outDir: condDir };
  }

  let lastResult = null;
  lastResult = await runOnce(args);

  ensureDir(args.outDir);
  const condDir = path.join(args.outDir, args.condition);
  ensureDir(condDir);
  const eventsPath = path.join(condDir, `seed_${args.seed}_events.jsonl`);
  const summaryPath = path.join(condDir, `seed_${args.seed}_run_summary.json`);

  fs.writeFileSync(eventsPath, lastResult.events.map((row) => JSON.stringify(row)).join("\n") + "\n");
  fs.writeFileSync(summaryPath, JSON.stringify(lastResult.summary, null, 2));

  const writeEdgeCsv = (filename, family, transPairs, epRepairPairs, epOpKPairs, epTotalPairs) => {
    const counts = new Map(transPairs ?? []);
    const epRepair = new Map(epRepairPairs ?? []);
    const epOpK = new Map(epOpKPairs ?? []);
    const epTotal = new Map(epTotalPairs ?? []);
    const rows = [];
    for (const [key, count] of counts.entries()) {
      const [from, to] = String(key).split("|");
      if (from === to) continue;
      const revKey = `${to}|${from}`;
      const countRev = counts.get(revKey) ?? 0;
      const epRepairSum = epRepair.get(key) ?? 0;
      const epOpKSum = epOpK.get(key) ?? 0;
      const epTotalSum = epTotal.get(key) ?? 0;
      rows.push({
        condition: args.condition,
        seed: args.seed,
        region: "hazard",
        family,
        from,
        to,
        count,
        countRev,
        epRepairSum,
        epOpKSum,
        epTotalSum,
        epRepairPerTrans: count > 0 ? epRepairSum / count : 0,
        epOpKPerTrans: count > 0 ? epOpKSum / count : 0,
        epTotalPerTrans: count > 0 ? epTotalSum / count : 0,
      });
    }
    const header =
      "condition,seed,region,family,from,to,count,countRev,epRepairSum,epOpKSum,epTotalSum,epRepairPerTrans,epOpKPerTrans,epTotalPerTrans";
    const lines = [header];
    for (const row of rows) {
      lines.push(
        [
          row.condition,
          row.seed,
          row.region,
          row.family,
          row.from,
          row.to,
          row.count,
          row.countRev,
          row.epRepairSum,
          row.epOpKSum,
          row.epTotalSum,
          row.epRepairPerTrans,
          row.epOpKPerTrans,
          row.epTotalPerTrans,
        ].join(","),
      );
    }
    fs.writeFileSync(path.join(condDir, filename), lines.join("\n") + "\n");
  };

  writeEdgeCsv(
    `transition_edges_Mbase_seed_${args.seed}.csv`,
    "M_base",
    lastResult.summary.transitionsBaseHazard,
    lastResult.summary.edgeEpRepairBase,
    lastResult.summary.edgeEpOpKBase,
    lastResult.summary.edgeEpTotalBase,
  );
  writeEdgeCsv(
    `transition_edges_Mop_seed_${args.seed}.csv`,
    "M_op",
    lastResult.summary.transitionsOpHazard,
    lastResult.summary.edgeEpRepairOp,
    lastResult.summary.edgeEpOpKOp,
    lastResult.summary.edgeEpTotalOp,
  );

  if (lastResult.summary.hazardGateSampleCount < 10) {
    console.log("MOTIF_INSTRUMENTATION_TOO_SPARSE_GATE_SAMPLES");
  }
  if (lastResult.summary.eventRecoveryWindowSampleCountMean === 0) {
    console.log("RECOVERY_WINDOW_UNOBSERVED");
  }
  if (lastResult.summary.hazardOpUniqueStatesVisited < 10) {
    console.log("MOP_COLLAPSED");
  }

  return { summary: lastResult.summary, events: lastResult.events, outDir: condDir };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runDeadlineOpkMotifEvents().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
