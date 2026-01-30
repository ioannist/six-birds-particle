#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {
  loadWasm,
  readJson,
  mean,
  std,
  percentile,
  parseSeedList,
  meanAbsDiffRegion,
  errRegionBits,
} from "./deadline-event-utils.mjs";
import { parseOpOffsets } from "./opk-metrics.mjs";

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
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

function hazardIndicesStripe(gridSize, bins, hazardCount) {
  const indices = [];
  for (let i = 0; i < hazardCount; i += 1) {
    const pos = Math.floor((i + 0.5) * gridSize / hazardCount);
    const idx = Math.min(bins - 1, Math.floor((pos / gridSize) * bins));
    indices.push(idx);
  }
  return Array.from(new Set(indices));
}

function hazardIndicesQuadrant() {
  return [0, 1, 2, 3];
}

function entropyFromCounts(counts) {
  let total = 0;
  for (const val of counts.values()) total += val;
  if (total === 0) return 0;
  let h = 0;
  for (const val of counts.values()) {
    if (val <= 0) continue;
    const p = val / total;
    h += -p * Math.log(p);
  }
  return h;
}

function transitionEntropy(counts) {
  return entropyFromCounts(counts);
}

function symmetryGap(counts) {
  const pairMap = new Map();
  for (const [key, count] of counts.entries()) {
    const [fromStr, toStr] = key.split("->");
    const from = Number(fromStr);
    const to = Number(toStr);
    if (Number.isNaN(from) || Number.isNaN(to) || from === to) continue;
    const a = Math.min(from, to);
    const b = Math.max(from, to);
    const pairKey = `${a}|${b}`;
    const prev = pairMap.get(pairKey) ?? { ab: 0, ba: 0, a, b };
    if (from === a) prev.ab += count;
    else prev.ba += count;
    pairMap.set(pairKey, prev);
  }
  let num = 0;
  let denom = 0;
  for (const pair of pairMap.values()) {
    num += Math.abs(pair.ab - pair.ba);
    denom += pair.ab + pair.ba;
  }
  return denom > 0 ? num / denom : 0;
}

function coarseEPFromCounts(counts, alpha = 0.5) {
  const pairMap = new Map();
  for (const [key, count] of counts.entries()) {
    const [fromStr, toStr] = key.split("->");
    const from = Number(fromStr);
    const to = Number(toStr);
    if (Number.isNaN(from) || Number.isNaN(to) || from === to) continue;
    const a = Math.min(from, to);
    const b = Math.max(from, to);
    const pairKey = `${a}|${b}`;
    const prev = pairMap.get(pairKey) ?? { ab: 0, ba: 0 };
    if (from === a) prev.ab += count;
    else prev.ba += count;
    pairMap.set(pairKey, prev);
  }
  let total = 0;
  for (const pair of pairMap.values()) {
    const nij = pair.ab;
    const nji = pair.ba;
    const c1 = nij + alpha;
    const c2 = nji + alpha;
    total += (nij - nji) * Math.log(c1 / c2);
  }
  return total;
}

function computeMotifStats(counts, transitions, sampleCount, threshold = 20) {
  const statsOk = sampleCount >= threshold;
  return {
    motifSamples: sampleCount,
    motifCount: counts.size,
    motifEntropy: statsOk ? entropyFromCounts(counts) : null,
    transitionEntropy: statsOk ? transitionEntropy(transitions) : null,
    symmetryGap: statsOk ? symmetryGap(transitions) : null,
    coarseEP: statsOk ? coarseEPFromCounts(transitions, 0.5) : null,
    motifStatsOk: statsOk,
  };
}

function computeContextSensitivity(motifByHazard) {
  const jsDivergence = (pMap, qMap) => {
    const keys = new Set([...pMap.keys(), ...qMap.keys()]);
    let sumP = 0;
    let sumQ = 0;
    for (const k of keys) {
      sumP += pMap.get(k) ?? 0;
      sumQ += qMap.get(k) ?? 0;
    }
    if (sumP === 0 || sumQ === 0) return 0;
    let js = 0;
    for (const k of keys) {
      const p = (pMap.get(k) ?? 0) / sumP;
      const q = (qMap.get(k) ?? 0) / sumQ;
      const m = 0.5 * (p + q);
      if (p > 0) js += 0.5 * p * Math.log(p / m);
      if (q > 0) js += 0.5 * q * Math.log(q / m);
    }
    return js;
  };

  const hazardKeys = Array.from(motifByHazard.keys());
  let jsAcc = 0;
  let jsCount = 0;
  for (let i = 0; i < hazardKeys.length; i += 1) {
    for (let j = i + 1; j < hazardKeys.length; j += 1) {
      jsAcc += jsDivergence(motifByHazard.get(hazardKeys[i]), motifByHazard.get(hazardKeys[j]));
      jsCount += 1;
    }
  }
  const avgPairwiseJSD = jsCount > 0 ? jsAcc / jsCount : 0;

  const totalByHazard = new Map();
  const totalByMotif = new Map();
  let total = 0;
  for (const [hazard, counts] of motifByHazard.entries()) {
    for (const [motifId, count] of counts.entries()) {
      totalByHazard.set(hazard, (totalByHazard.get(hazard) ?? 0) + count);
      totalByMotif.set(motifId, (totalByMotif.get(motifId) ?? 0) + count);
      total += count;
    }
  }
  let mutualInfoHM = 0;
  if (total > 0) {
    for (const [hazard, counts] of motifByHazard.entries()) {
      for (const [motifId, count] of counts.entries()) {
        const pHM = count / total;
        const pH = (totalByHazard.get(hazard) ?? 0) / total;
        const pM = (totalByMotif.get(motifId) ?? 0) / total;
        if (pHM > 0 && pH > 0 && pM > 0) {
          mutualInfoHM += pHM * Math.log(pHM / (pH * pM));
        }
      }
    }
  }

  return {
    avgPairwiseJSD,
    mutualInfoHM,
    motifAlphabetSize: totalByMotif.size,
    sampleCount: total,
  };
}

function opkStatsForMask({
  tokens,
  offsets,
  rCount,
  opBudgetK,
  gridSize,
  metaLayers,
  mask,
}) {
  const cells = gridSize * gridSize;
  const budget = Math.max(1, opBudgetK ?? 1);
  const eps = 1e-9;
  let hSum = 0;
  let r2Sum = 0;
  let dMagSum = 0;
  let count = 0;

  for (let iface = 0; iface < metaLayers; iface += 1) {
    for (let q = 0; q < cells; q += 1) {
      if (!mask[q]) continue;
      const start = (iface * cells + q) * rCount;
      let h = 0;
      let r2 = 0;
      let dxAcc = 0;
      let dyAcc = 0;
      for (let r = 0; r < rCount; r += 1) {
        const k = tokens[start + r] / budget;
        if (k > 0) h += -k * Math.log(k + eps);
        const [dx, dy] = offsets[r];
        r2 += k * (dx * dx + dy * dy);
        dxAcc += k * dx;
        dyAcc += k * dy;
      }
      hSum += h;
      r2Sum += r2;
      dMagSum += Math.hypot(dxAcc, dyAcc);
      count += 1;
    }
  }

  if (count === 0) {
    return { Hk: 0, R2: 0, dMag: 0 };
  }
  return {
    Hk: hSum / count,
    R2: r2Sum / count,
    dMag: dMagSum / count,
  };
}

function motifIdFromMeta({ moveId, idxP5Base, idxP5Meta, layerByte, mismatchBin, kDir, effR }) {
  if (moveId === idxP5Base) {
    return (kDir % effR) * 3 + mismatchBin;
  }
  if (moveId === idxP5Meta) {
    return effR * 3 + layerByte * (effR * 3) + (kDir % effR) * 3 + mismatchBin;
  }
  return null;
}

function parseArgs(argv) {
  const out = {
    seeds: "1,2,3,4,5,6,7,8,9,10",
    steps: 2_000_000,
    eventEvery: null,
    deadline: null,
    reportEvery: null,
    hazardHoldEvents: 4,
    hazardCount: 8,
    region: "stripe",
    logMotifs: 1,
    variants: "A,B,C,D",
    errGood: 0.1,
    sdiffGood: 1.0,
    corruptFrac: 0.2,
    tailWindow: 200_000,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--seeds") out.seeds = argv[++i];
    else if (arg === "--steps") out.steps = Number(argv[++i]);
    else if (arg === "--eventEvery") out.eventEvery = Number(argv[++i]);
    else if (arg === "--deadline") out.deadline = Number(argv[++i]);
    else if (arg === "--reportEvery") out.reportEvery = Number(argv[++i]);
    else if (arg === "--hazardHoldEvents") out.hazardHoldEvents = Number(argv[++i]);
    else if (arg === "--hazardCount") out.hazardCount = Number(argv[++i]);
    else if (arg === "--region") out.region = argv[++i];
    else if (arg === "--logMotifs") out.logMotifs = Number(argv[++i]);
    else if (arg === "--variants") out.variants = argv[++i];
    else if (arg === "--errGood") out.errGood = Number(argv[++i]);
    else if (arg === "--sdiffGood") out.sdiffGood = Number(argv[++i]);
    else if (arg === "--corruptFrac") out.corruptFrac = Number(argv[++i]);
    else if (arg === "--tailWindow") out.tailWindow = Number(argv[++i]);
  }
  return out;
}

function pickPreset() {
  const preferred = path.resolve(rootDir, "scripts/params/clock_code/deadline_fidelity_found.json");
  const fallback = path.resolve(rootDir, "scripts/params/clock_code/code_deadline_gated_clock.json");
  if (fs.existsSync(preferred)) return preferred;
  return fallback;
}

export async function runMovingHazardHomeostasis({
  presetPath,
  seeds,
  steps,
  eventEvery,
  deadline,
  reportEvery,
  hazardHoldEvents,
  hazardCount,
  region,
  logMotifs,
  variants,
  writeOutputs = true,
  commonOverrides = {},
  errGood = 0.1,
  sdiffGood = 1.0,
  corruptFrac = 0.2,
  tailWindow = 200_000,
}) {
  const mod = await loadWasm();
  const presetRaw = readJson(presetPath);
  const baseParams = presetRaw.params ?? presetRaw;

  const stepsVal = steps ?? presetRaw.steps ?? 2_000_000;
  const eventEveryVal = eventEvery ?? presetRaw.eventEvery ?? 50_000;
  const deadlineVal = deadline ?? presetRaw.deadline ?? 15_000;
  const reportEveryVal = reportEvery ?? presetRaw.reportEvery ?? 1_000;
  const hazardHoldEventsVal = hazardHoldEvents ?? 4;
  const hazardCountVal = hazardCount ?? 8;
  const regionType = region ?? "stripe";

  const variantsList = variants ?? ["A", "B", "C", "D"];
  const seedList = Array.isArray(seeds) ? seeds : parseSeedList(seeds);

  const rawRows = [];
  const finalStates = [];

  const summaryAgg = new Map();
  const byHazardAgg = new Map();
  const motifByHazardAgg = new Map();
  const trackingAgg = new Map();

  for (const variant of variantsList) {
    for (const seed of seedList) {
      const params = { ...baseParams, ...commonOverrides, epDebug: 1 };
      if (variant === "A") {
        params.opCouplingOn = 0;
        params.sCouplingMode = 0;
        params.opDriveOnK = 0;
      } else if (variant === "B") {
        params.opCouplingOn = 1;
        params.sCouplingMode = 0;
        params.opDriveOnK = 0;
      } else if (variant === "C") {
        params.opCouplingOn = 1;
        params.sCouplingMode = 1;
        params.opDriveOnK = 0;
      } else if (variant === "D") {
        params.opCouplingOn = 1;
        params.sCouplingMode = 1;
        params.opDriveOnK = 1;
      }
      if (variant === "C" || variant === "D") {
        params.opStencil = 1;
        params.opBudgetK = 32;
        params.opKTargetWeight = 0.1;
      }

      const bins = params.clockK ?? 8;
      const gridSize = params.gridSize ?? 32;
      const hazardIndices =
        regionType === "quadrant"
          ? hazardIndicesQuadrant()
          : hazardIndicesStripe(gridSize, bins, hazardCountVal);
      const hazardMasks = new Map();
      const outsideMasks = new Map();
      for (const idx of hazardIndices) {
        const mask = buildRegionMask(gridSize, regionType, idx, params.repairGateSpan ?? 1, bins);
        hazardMasks.set(idx, mask);
        outsideMasks.set(idx, buildMatchedOutsideMask(mask, seed + idx * 997));
      }

      const maxEventStart = stepsVal - Math.max(deadlineVal, eventEveryVal);
      const eventCount = Math.floor(maxEventStart / eventEveryVal);
      const events = [];
      for (let e = 0; e < eventCount; e += 1) {
        const tEvent = (e + 1) * eventEveryVal;
        const epochIndex = Math.floor(e / hazardHoldEventsVal);
        const hazardIndex = hazardIndices[epochIndex % hazardIndices.length];
        const eventIndexWithinEpoch = e % hazardHoldEventsVal;
        events.push({
          idx: e,
          tEvent,
          epochIndex,
          hazardIndex,
          eventIndexWithinEpoch,
          recovered: false,
          miss: false,
          recoverySteps: null,
          samples: [],
          motifCountsHazard: new Map(),
          motifCountsOutside: new Map(),
          motifTransHazard: new Map(),
          motifTransOutside: new Map(),
          motifEpHazard: new Map(),
          motifEpOutside: new Map(),
          motifEpAbsHazard: new Map(),
          motifEpAbsOutside: new Map(),
          motifSamplesHazard: 0,
          motifSamplesOutside: 0,
          prevHazardMotif: null,
          prevOutsideMotif: null,
          startEp: null,
          endEp: null,
          startCounts: null,
          endCounts: null,
          tracking: null,
        });
      }

      const sim = new mod.Sim(50, seed);
      sim.set_params(params);
      if (logMotifs) {
        const moveLabels = sim.ep_move_labels ? Array.from(sim.ep_move_labels()) : [];
        const idxP5Base = moveLabels.indexOf("P5Base");
        const idxP5Meta = moveLabels.indexOf("P5Meta");
        if (idxP5Base >= 0 && idxP5Meta >= 0) {
          sim.set_params({
            acceptLogOn: 1,
            acceptLogMask: (1 << idxP5Base) | (1 << idxP5Meta),
            acceptLogCap: 200000,
          });
        }
      }
      if (sim.accept_log_clear) sim.accept_log_clear();

      const moveLabels = sim.ep_move_labels ? Array.from(sim.ep_move_labels()) : [];
      const idxP5Base = moveLabels.indexOf("P5Base");
      const idxP5Meta = moveLabels.indexOf("P5Meta");
      const idxOpK = moveLabels.indexOf("OpK");
      const idxClock = moveLabels.indexOf("Clock");

      const rCount = sim.op_r_count ? sim.op_r_count() : 0;
      const effR = Math.max(1, rCount);
      const metaLayers = params.metaLayers ?? 0;
      const opOffsets = sim.op_offsets ? sim.op_offsets() : new Int8Array();
      const offsets = parseOpOffsets(opOffsets);

      const readCounts = () => {
        const stats = sim.ep_q_stats();
        return Array.from(stats.count);
      };

      const baselineErr = [];
      let errFloor = null;
      let currentEventIdx = -1;
      let nextEventIdx = 0;

      const updateEventOutcome = (event, t, good) => {
        const elapsed = t - event.tEvent;
        if (!event.recovered && !event.miss && elapsed > deadlineVal) {
          event.miss = true;
          event.recoverySteps = null;
        } else if (!event.recovered && !event.miss && good) {
          event.recovered = true;
          event.recoverySteps = elapsed;
        }
        if ((event.recovered || event.miss) && !event.endEp) {
          const epTotal = sim.ep_exact_total();
          const epByMove = sim.ep_exact_by_move();
          const epRepair = (epByMove[idxP5Base] ?? 0) + (epByMove[idxP5Meta] ?? 0);
          const epOpK = epByMove[idxOpK] ?? 0;
          const epClock = epByMove[idxClock] ?? 0;
          event.endEp = { total: epTotal, repair: epRepair, opk: epOpK, clock: epClock };
          const countsNow = readCounts();
          event.endCounts = {
            p5Base: countsNow[idxP5Base] ?? 0,
            p5Meta: countsNow[idxP5Meta] ?? 0,
            opk: countsNow[idxOpK] ?? 0,
            clock: countsNow[idxClock] ?? 0,
          };
          if (params.opCouplingOn && metaLayers > 0 && rCount > 0) {
            const tokens = sim.op_k_tokens();
            const hazardMask = hazardMasks.get(event.hazardIndex);
            const outsideMask = outsideMasks.get(event.hazardIndex);
            const hazardStats = opkStatsForMask({
              tokens,
              offsets,
              rCount,
              opBudgetK: params.opBudgetK,
              gridSize,
              metaLayers,
              mask: hazardMask,
            });
            const outsideStats = opkStatsForMask({
              tokens,
              offsets,
              rCount,
              opBudgetK: params.opBudgetK,
              gridSize,
              metaLayers,
              mask: outsideMask,
            });
            event.tracking = {
              hazard: hazardStats,
              outside: outsideStats,
              delta: {
                Hk: hazardStats.Hk - outsideStats.Hk,
                R2: hazardStats.R2 - outsideStats.R2,
                dMag: hazardStats.dMag - outsideStats.dMag,
              },
            };
          } else {
            event.tracking = { available: false };
          }
        }
      };

      const processAcceptLog = () => {
        if (!logMotifs || !sim.accept_log_len) return;
        const len = sim.accept_log_len();
        if (len === 0) return;
        const u32 = sim.accept_log_u32();
        const ep = sim.accept_log_ep();
        const entries = Math.min(ep.length, Math.floor(u32.length / 3));
        for (let i = 0; i < entries; i += 1) {
          const tEntry = u32[i * 3];
          const q = u32[i * 3 + 1];
          const meta = u32[i * 3 + 2];
          const moveId = meta & 0xff;
          if (moveId !== idxP5Base && moveId !== idxP5Meta) continue;
          if (tEntry < eventEveryVal) continue;
          const t0 = Math.floor(tEntry / eventEveryVal) * eventEveryVal;
          if (t0 < eventEveryVal) continue;
          if (t0 > maxEventStart) continue;
          if (tEntry - t0 >= deadlineVal) continue;
          const eventIdx = Math.floor(tEntry / eventEveryVal) - 1;
          if (eventIdx < 0 || eventIdx >= events.length) continue;
          const event = events[eventIdx];
          const hazardMask = hazardMasks.get(event.hazardIndex);
          const outsideMask = outsideMasks.get(event.hazardIndex);
          const qIdx = Number(q);
          const inHazard = hazardMask ? hazardMask[qIdx] : false;
          const inOutside = outsideMask ? outsideMask[qIdx] : false;
          if (!inHazard && !inOutside) continue;

          const layerByte = (meta >>> 8) & 0xff;
          const mismatchBin = (meta >>> 16) & 0xff;
          const kDir = (meta >>> 24) & 0xff;
          const motifId = motifIdFromMeta({
            moveId,
            idxP5Base,
            idxP5Meta,
            layerByte,
            mismatchBin,
            kDir,
            effR,
          });
          if (motifId === null) continue;

          const epDelta = ep[i] ?? 0;
          if (inHazard) {
            event.motifSamplesHazard += 1;
            event.motifCountsHazard.set(motifId, (event.motifCountsHazard.get(motifId) ?? 0) + 1);
            event.motifEpHazard.set(motifId, (event.motifEpHazard.get(motifId) ?? 0) + epDelta);
            event.motifEpAbsHazard.set(
              motifId,
              (event.motifEpAbsHazard.get(motifId) ?? 0) + Math.abs(epDelta),
            );
            if (event.prevHazardMotif != null) {
              const key = `${event.prevHazardMotif}->${motifId}`;
              event.motifTransHazard.set(key, (event.motifTransHazard.get(key) ?? 0) + 1);
            }
            event.prevHazardMotif = motifId;
          } else if (inOutside) {
            event.motifSamplesOutside += 1;
            event.motifCountsOutside.set(
              motifId,
              (event.motifCountsOutside.get(motifId) ?? 0) + 1,
            );
            event.motifEpOutside.set(motifId, (event.motifEpOutside.get(motifId) ?? 0) + epDelta);
            event.motifEpAbsOutside.set(
              motifId,
              (event.motifEpAbsOutside.get(motifId) ?? 0) + Math.abs(epDelta),
            );
            if (event.prevOutsideMotif != null) {
              const key = `${event.prevOutsideMotif}->${motifId}`;
              event.motifTransOutside.set(key, (event.motifTransOutside.get(key) ?? 0) + 1);
            }
            event.prevOutsideMotif = motifId;
          }
        }
        sim.accept_log_clear();
      };

      for (let t = reportEveryVal; t <= stepsVal; t += reportEveryVal) {
        sim.step(reportEveryVal);
        processAcceptLog();

        while (nextEventIdx < events.length && t >= events[nextEventIdx].tEvent) {
          const event = events[nextEventIdx];
          const perturb = {
            target: "metaS",
            layer: 0,
            frac: corruptFrac,
            mode: "randomize",
          };
          if (regionType === "stripe") {
            perturb.region = "stripe";
            perturb.bins = bins;
            perturb.span = params.repairGateSpan ?? 1;
            perturb.bin = event.hazardIndex;
          } else {
            perturb.region = "quadrant";
            perturb.quadrant = event.hazardIndex;
          }
          perturb.seed = seed * 1000 + event.tEvent;
          sim.apply_perturbation(perturb);
          currentEventIdx = nextEventIdx;
          nextEventIdx += 1;

          const epTotal = sim.ep_exact_total();
          const epByMove = sim.ep_exact_by_move();
          const epRepair = (epByMove[idxP5Base] ?? 0) + (epByMove[idxP5Meta] ?? 0);
          const epOpK = epByMove[idxOpK] ?? 0;
          const epClock = epByMove[idxClock] ?? 0;
          event.startEp = { total: epTotal, repair: epRepair, opk: epOpK, clock: epClock };
          const countsNow = readCounts();
          event.startCounts = {
            p5Base: countsNow[idxP5Base] ?? 0,
            p5Meta: countsNow[idxP5Meta] ?? 0,
            opk: countsNow[idxOpK] ?? 0,
            clock: countsNow[idxClock] ?? 0,
          };
        }

        if (currentEventIdx >= 0) {
          const event = events[currentEventIdx];
          if (!event.recovered && !event.miss) {
            const hazardMask = hazardMasks.get(event.hazardIndex);
            const baseS = sim.base_s_field();
            const metaS = sim.meta_field();
            const cells = baseS.length;
            const meta0 = metaS.subarray(0, cells);
            const lS = params.lS ?? 1;
            const errSample = errRegionBits(baseS, meta0, gridSize, lS, hazardMask);
            if (t < eventEveryVal) {
              baselineErr.push(errSample);
            } else if (errFloor === null) {
              errFloor = baselineErr.length ? mean(baselineErr) : 0;
            }
            const errAdj = errFloor === null ? 0 : Math.max(0, errSample - errFloor);
            const sdiff = meanAbsDiffRegion(baseS, meta0, hazardMask);
            const good = sdiff <= sdiffGood && errAdj <= errGood;
            event.samples.push({ t, err: errAdj, sdiff, good });
            updateEventOutcome(event, t, good);
          }
        }
      }

      for (const event of events) {
        if (!event.recovered && !event.miss) {
          event.miss = true;
        }
      }

      const baseSFinal = sim.base_s_field();
      const metaFinal = sim.meta_field();
      const baseSum = baseSFinal.reduce((acc, v) => acc + v, 0);
      const metaSum = metaFinal.reduce((acc, v) => acc + v, 0);
      const epTotalFinal = sim.ep_exact_total();
      const epByMoveFinal = sim.ep_exact_by_move();
      const finalCounts = readCounts();
      finalStates.push({
        variant,
        seed,
        epExactTotal: epTotalFinal,
        epRepairTotal: (epByMoveFinal[idxP5Base] ?? 0) + (epByMoveFinal[idxP5Meta] ?? 0),
        epOpKTotal: epByMoveFinal[idxOpK] ?? 0,
        epClockTotal: epByMoveFinal[idxClock] ?? 0,
        countP5Base: finalCounts[idxP5Base] ?? 0,
        countP5Meta: finalCounts[idxP5Meta] ?? 0,
        countOpK: finalCounts[idxOpK] ?? 0,
        countClock: finalCounts[idxClock] ?? 0,
        baseSum,
        metaSum,
        baseLen: baseSFinal.length,
        metaLen: metaFinal.length,
      });

      for (const event of events) {
        const tailStart = event.tEvent + Math.max(0, deadlineVal - tailWindow);
        const tailEnd = event.tEvent + deadlineVal;
        const tailSamples = event.samples.filter((s) => s.t >= tailStart && s.t <= tailEnd);
        const uptimeTail = tailSamples.length
          ? tailSamples.filter((s) => s.good).length / tailSamples.length
          : 0;
        const errTail = tailSamples.length ? mean(tailSamples.map((s) => s.err)) : 0;
        const sdiffTail = tailSamples.length ? mean(tailSamples.map((s) => s.sdiff)) : 0;

        const motifStatsHaz = computeMotifStats(
          event.motifCountsHazard,
          event.motifTransHazard,
          event.motifSamplesHazard,
        );
        const motifStatsOut = computeMotifStats(
          event.motifCountsOutside,
          event.motifTransOutside,
          event.motifSamplesOutside,
        );

        const epTotal = event.endEp && event.startEp ? event.endEp.total - event.startEp.total : 0;
        const epRepair = event.endEp && event.startEp ? event.endEp.repair - event.startEp.repair : 0;
        const epOpK = event.endEp && event.startEp ? event.endEp.opk - event.startEp.opk : 0;
        const epClock = event.endEp && event.startEp ? event.endEp.clock - event.startEp.clock : 0;

        const repairCount = event.endCounts && event.startCounts
          ? (event.endCounts.p5Base - event.startCounts.p5Base) +
            (event.endCounts.p5Meta - event.startCounts.p5Meta)
          : 0;
        const opkCount = event.endCounts && event.startCounts
          ? event.endCounts.opk - event.startCounts.opk
          : 0;
        const epRepairPerAction = repairCount > 0 ? epRepair / repairCount : 0;

        rawRows.push({
          variant,
          seed,
          eventIndex: event.idx,
          epochIndex: event.epochIndex,
          hazardIndex: event.hazardIndex,
          eventIndexWithinEpoch: event.eventIndexWithinEpoch,
          success: event.recovered,
          miss: event.miss,
          recoverySteps: event.recoverySteps,
          uptimeTail,
          errTail,
          sdiffTail,
          epTotal,
          epRepair,
          epOpK,
          epClock,
          repairCount,
          opkCount,
          epRepairPerAction,
          motifSamplesHazard: motifStatsHaz.motifSamples,
          motifEntropyHazard: motifStatsHaz.motifEntropy,
          transitionEntropyHazard: motifStatsHaz.transitionEntropy,
          symmetryGapHazard: motifStatsHaz.symmetryGap,
          coarseEPHazard: motifStatsHaz.coarseEP,
          motifStatsOkHazard: motifStatsHaz.motifStatsOk,
          motifSamplesOutside: motifStatsOut.motifSamples,
          motifEntropyOutside: motifStatsOut.motifEntropy,
          symmetryGapOutside: motifStatsOut.symmetryGap,
          coarseEPOutside: motifStatsOut.coarseEP,
          trackingAvailable: event.tracking && event.tracking.available === false ? false : !!event.tracking,
          hazard_Hk_mean: event.tracking?.hazard?.Hk ?? null,
          outside_Hk_mean: event.tracking?.outside?.Hk ?? null,
          hazard_R2_mean: event.tracking?.hazard?.R2 ?? null,
          outside_R2_mean: event.tracking?.outside?.R2 ?? null,
          hazard_dmag_mean: event.tracking?.hazard?.dMag ?? null,
          outside_dmag_mean: event.tracking?.outside?.dMag ?? null,
          hazard_minus_outside_Hk: event.tracking?.delta?.Hk ?? null,
          hazard_minus_outside_R2: event.tracking?.delta?.R2 ?? null,
          hazard_minus_outside_dmag: event.tracking?.delta?.dMag ?? null,
        });

        if (logMotifs && event.motifSamplesHazard > 0) {
          const key = `${variant}|${event.hazardIndex}`;
          const entry = motifByHazardAgg.get(key) ?? {
            variant,
            hazardIndex: event.hazardIndex,
            counts: new Map(),
          };
          for (const [motifId, count] of event.motifCountsHazard.entries()) {
            entry.counts.set(motifId, (entry.counts.get(motifId) ?? 0) + count);
          }
          motifByHazardAgg.set(key, entry);
        }
      }
    }
  }

  const summaryRows = [];
  const byHazardRows = [];
  const motifByHazardRows = [];
  const trackingRows = [];
  const contextSensitivityRows = [];

  const groupBy = (rows, keys) => {
    const map = new Map();
    for (const row of rows) {
      const key = keys.map((k) => row[k]).join("|");
      const arr = map.get(key) ?? [];
      arr.push(row);
      map.set(key, arr);
    }
    return map;
  };

  const byVariant = groupBy(rawRows, ["variant"]);
  for (const [key, rows] of byVariant.entries()) {
    const misses = rows.filter((r) => r.miss).length;
    const missFrac = rows.length > 0 ? misses / rows.length : 0;
    const recoverySteps = rows
      .filter((r) => Number.isFinite(r.recoverySteps))
      .map((r) => r.recoverySteps);
    const motifRows = rows.filter((r) => r.motifStatsOkHazard);
    summaryRows.push({
      variant: key,
      missFrac,
      uptimeTailMean: rows.length ? mean(rows.map((r) => r.uptimeTail)) : 0,
      errTailMean: rows.length ? mean(rows.map((r) => r.errTail)) : 0,
      recoveryMedian: percentile(recoverySteps, 0.5),
      recoveryP95: percentile(recoverySteps, 0.95),
      epTotalMean: rows.length ? mean(rows.map((r) => r.epTotal)) : 0,
      epRepairMean: rows.length ? mean(rows.map((r) => r.epRepair)) : 0,
      epOpKMean: rows.length ? mean(rows.map((r) => r.epOpK)) : 0,
      epClockMean: rows.length ? mean(rows.map((r) => r.epClock)) : 0,
      epTotalRateMean: rows.length ? mean(rows.map((r) => r.epTotal / deadlineVal)) : 0,
      epRepairPerActionMean: rows.length ? mean(rows.map((r) => r.epRepairPerAction)) : 0,
      epRepairPerActionMedian: percentile(rows.map((r) => r.epRepairPerAction), 0.5),
      motifEntropyMean: motifRows.length ? mean(motifRows.map((r) => r.motifEntropyHazard)) : null,
      motifSymmetryGapMean: motifRows.length ? mean(motifRows.map((r) => r.symmetryGapHazard)) : null,
      motifCoarseEPMean: motifRows.length ? mean(motifRows.map((r) => r.coarseEPHazard)) : null,
      trackingDeltaHkMean: rows.length
        ? mean(rows.map((r) => r.hazard_minus_outside_Hk ?? 0))
        : null,
      trackingDeltaR2Mean: rows.length
        ? mean(rows.map((r) => r.hazard_minus_outside_R2 ?? 0))
        : null,
      trackingDeltaDmagMean: rows.length
        ? mean(rows.map((r) => r.hazard_minus_outside_dmag ?? 0))
        : null,
    });
  }

  const byVariantHazard = groupBy(rawRows, ["variant", "hazardIndex"]);
  for (const [key, rows] of byVariantHazard.entries()) {
    const [variant, hazardIndex] = key.split("|");
    const misses = rows.filter((r) => r.miss).length;
    const missFrac = rows.length > 0 ? misses / rows.length : 0;
    const recoverySteps = rows
      .filter((r) => Number.isFinite(r.recoverySteps))
      .map((r) => r.recoverySteps);
    const motifRows = rows.filter((r) => r.motifStatsOkHazard);
    byHazardRows.push({
      variant,
      hazardIndex: Number(hazardIndex),
      missFrac,
      recoveryMedian: percentile(recoverySteps, 0.5),
      uptimeTailMean: rows.length ? mean(rows.map((r) => r.uptimeTail)) : 0,
      epRepairPerActionMean: rows.length ? mean(rows.map((r) => r.epRepairPerAction)) : 0,
      motifEntropyMean: motifRows.length ? mean(motifRows.map((r) => r.motifEntropyHazard)) : null,
      motifSymmetryGapMean: motifRows.length ? mean(motifRows.map((r) => r.symmetryGapHazard)) : null,
      motifCoarseEPMean: motifRows.length ? mean(motifRows.map((r) => r.coarseEPHazard)) : null,
      trackingDeltaHkMean: rows.length
        ? mean(rows.map((r) => r.hazard_minus_outside_Hk ?? 0))
        : null,
      trackingDeltaR2Mean: rows.length
        ? mean(rows.map((r) => r.hazard_minus_outside_R2 ?? 0))
        : null,
      trackingDeltaDmagMean: rows.length
        ? mean(rows.map((r) => r.hazard_minus_outside_dmag ?? 0))
        : null,
    });
  }

  const motifGroups = new Map();
  for (const entry of motifByHazardAgg.values()) {
    motifGroups.set(`${entry.variant}|${entry.hazardIndex}`, entry);
  }

  const jsByVariant = new Map();
  for (const entry of motifGroups.values()) {
    const key = entry.variant;
    const list = jsByVariant.get(key) ?? [];
    list.push(entry);
    jsByVariant.set(key, list);
  }

  for (const entry of motifGroups.values()) {
    const counts = entry.counts;
    let total = 0;
    for (const val of counts.values()) total += val;
    if (total === 0) continue;
    const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
    const top = sorted.slice(0, 10);
    let rank = 0;
    for (const [motifId, count] of top) {
      motifByHazardRows.push({
        variant: entry.variant,
        hazardIndex: entry.hazardIndex,
        motifId,
        prob: count / total,
        rank,
      });
      rank += 1;
    }
  }

  for (const [variant, entries] of jsByVariant.entries()) {
    const hazardMap = new Map();
    for (const entry of entries) {
      hazardMap.set(entry.hazardIndex, entry.counts);
    }
    const ctx = computeContextSensitivity(hazardMap);
    contextSensitivityRows.push({ variant, ...ctx });
    for (const row of summaryRows) {
      if (row.variant === variant) {
        row.avgPairwiseJSD = ctx.avgPairwiseJSD;
        row.mutualInfoHM = ctx.mutualInfoHM;
      }
    }
    for (const row of byHazardRows) {
      if (row.variant === variant) {
        row.avgPairwiseJSD = ctx.avgPairwiseJSD;
        row.mutualInfoHM = ctx.mutualInfoHM;
      }
    }
  }

  const byVariantEpoch = groupBy(rawRows, ["variant", "epochIndex"]);
  for (const [key, rows] of byVariantEpoch.entries()) {
    const [variant, epochIndexStr] = key.split("|");
    const epochIndex = Number(epochIndexStr);
    const first = rows.filter((r) => r.eventIndexWithinEpoch === 0);
    const last = rows.filter((r) => r.eventIndexWithinEpoch === Math.max(...rows.map((r) => r.eventIndexWithinEpoch)));
    const deltaMiss = first.length && last.length
      ? mean(last.map((r) => (r.miss ? 1 : 0))) - mean(first.map((r) => (r.miss ? 1 : 0)))
      : null;
    const deltaCoarseEP = first.length && last.length
      ? mean(last.map((r) => r.coarseEPHazard ?? 0)) - mean(first.map((r) => r.coarseEPHazard ?? 0))
      : null;
    const deltaSymmetry = first.length && last.length
      ? mean(last.map((r) => r.symmetryGapHazard ?? 0)) - mean(first.map((r) => r.symmetryGapHazard ?? 0))
      : null;
    trackingRows.push({
      variant,
      epochIndex,
      hazardIndex: rows[0]?.hazardIndex ?? null,
      deltaMiss,
      deltaCoarseEP,
      deltaSymmetryGap: deltaSymmetry,
      trackingDeltaHkMean: rows.length
        ? mean(rows.map((r) => r.hazard_minus_outside_Hk ?? 0))
        : null,
      trackingDeltaR2Mean: rows.length
        ? mean(rows.map((r) => r.hazard_minus_outside_R2 ?? 0))
        : null,
      trackingDeltaDmagMean: rows.length
        ? mean(rows.map((r) => r.hazard_minus_outside_dmag ?? 0))
        : null,
    });
  }

  if (writeOutputs) {
    const outDir = path.resolve(rootDir, ".tmp", "homeostasis");
    ensureDir(outDir);

    const rawPath = path.join(outDir, "moving_hazard_raw.jsonl");
    fs.writeFileSync(rawPath, rawRows.map((row) => JSON.stringify(row)).join("\n") + "\n");

    const summaryHeader = [
      "variant",
      "missFrac",
      "uptimeTailMean",
      "errTailMean",
      "recoveryMedian",
      "recoveryP95",
      "epTotalMean",
      "epRepairMean",
      "epOpKMean",
      "epClockMean",
      "epTotalRateMean",
      "epRepairPerActionMean",
      "epRepairPerActionMedian",
      "motifEntropyMean",
      "motifSymmetryGapMean",
      "motifCoarseEPMean",
      "avgPairwiseJSD",
      "mutualInfoHM",
      "trackingDeltaHkMean",
      "trackingDeltaR2Mean",
      "trackingDeltaDmagMean",
    ];
    const summaryLines = [summaryHeader.join(",")];
    for (const row of summaryRows) {
      summaryLines.push(summaryHeader.map((k) => row[k]).join(","));
    }
    fs.writeFileSync(path.join(outDir, "moving_hazard_summary.csv"), summaryLines.join("\n") + "\n");

    const byHazardHeader = [
      "variant",
      "hazardIndex",
      "missFrac",
      "recoveryMedian",
      "uptimeTailMean",
      "epRepairPerActionMean",
      "motifEntropyMean",
      "motifSymmetryGapMean",
      "motifCoarseEPMean",
      "avgPairwiseJSD",
      "mutualInfoHM",
      "trackingDeltaHkMean",
      "trackingDeltaR2Mean",
      "trackingDeltaDmagMean",
    ];
    const byHazardLines = [byHazardHeader.join(",")];
    for (const row of byHazardRows) {
      byHazardLines.push(byHazardHeader.map((k) => row[k]).join(","));
    }
    fs.writeFileSync(path.join(outDir, "moving_hazard_by_hazard.csv"), byHazardLines.join("\n") + "\n");

    const motifHeader = ["variant", "hazardIndex", "motifId", "prob", "rank"];
    const motifLines = [motifHeader.join(",")];
    for (const row of motifByHazardRows) {
      motifLines.push(motifHeader.map((k) => row[k]).join(","));
    }
    fs.writeFileSync(path.join(outDir, "moving_hazard_motif_by_hazard.csv"), motifLines.join("\n") + "\n");

    const ctxHeader = [
      "variant",
      "avgPairwiseJSD",
      "mutualInfoHM",
      "motifAlphabetSize",
      "sampleCount",
    ];
    const ctxLines = [ctxHeader.join(",")];
    for (const row of contextSensitivityRows) {
      ctxLines.push(ctxHeader.map((k) => row[k]).join(","));
    }
    fs.writeFileSync(
      path.join(outDir, "moving_hazard_context_sensitivity.csv"),
      ctxLines.join("\n") + "\n",
    );

    const trackingHeader = [
      "variant",
      "epochIndex",
      "hazardIndex",
      "deltaMiss",
      "deltaCoarseEP",
      "deltaSymmetryGap",
      "trackingDeltaHkMean",
      "trackingDeltaR2Mean",
      "trackingDeltaDmagMean",
    ];
    const trackingLines = [trackingHeader.join(",")];
    for (const row of trackingRows) {
      trackingLines.push(trackingHeader.map((k) => row[k]).join(","));
    }
    fs.writeFileSync(path.join(outDir, "moving_hazard_tracking.csv"), trackingLines.join("\n") + "\n");
  }

  return {
    rawRows,
    summaryRows,
    byHazardRows,
    motifByHazardRows,
    trackingRows,
    finalStates,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv);
  const presetPath = pickPreset();
  const variants = args.variants.split(",").map((v) => v.trim()).filter(Boolean);
  const seeds = parseSeedList(args.seeds);
  const result = await runMovingHazardHomeostasis({
    presetPath,
    seeds,
    steps: args.steps,
    eventEvery: args.eventEvery,
    deadline: args.deadline,
    reportEvery: args.reportEvery,
    hazardHoldEvents: args.hazardHoldEvents,
    hazardCount: args.hazardCount,
    region: args.region,
    logMotifs: args.logMotifs === 1,
    variants,
    errGood: args.errGood,
    sdiffGood: args.sdiffGood,
    corruptFrac: args.corruptFrac,
    tailWindow: args.tailWindow,
  });

  const summaryLine = result.summaryRows
    .map((row) => `${row.variant}: miss=${row.missFrac.toFixed(3)}`)
    .join(" | ");
  const motifLine = result.summaryRows
    .map((row) => `${row.variant}: H=${row.motifEntropyMean ?? "na"}, gap=${row.motifSymmetryGapMean ?? "na"}`)
    .join(" | ");
  const trackingAvailable = result.summaryRows.some((row) => row.trackingDeltaHkMean !== null);

  console.log(`MOVING_HAZARD_SUMMARY: ${summaryLine}`);
  console.log(`MOVING_HAZARD_MOTIFS: ${motifLine}`);
  console.log(`TRACKING_AVAILABLE: ${trackingAvailable}`);
}
