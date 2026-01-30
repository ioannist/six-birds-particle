import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

let wasmMod = null;
let wasmInit = false;

export async function loadWasm() {
  if (wasmInit) return wasmMod;
  const wasmDir = path.resolve(rootDir, "apps/web/src/wasm/sim_core");
  const wasmJs = pathToFileURL(path.join(wasmDir, "sim_core.js")).href;
  const wasmBytes = fs.readFileSync(path.join(wasmDir, "sim_core_bg.wasm"));
  const mod = await import(wasmJs);
  mod.initSync({ module: wasmBytes });
  wasmMod = mod;
  wasmInit = true;
  return wasmMod;
}

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function mean(values) {
  return values.reduce((acc, v) => acc + v, 0) / values.length;
}

export function std(values) {
  const m = mean(values);
  const variance = values.reduce((acc, v) => acc + (v - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export function percentile(values, p) {
  const nums = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (nums.length === 0) return null;
  const idx = Math.min(nums.length - 1, Math.floor(p * (nums.length - 1)));
  return nums[idx];
}

export function parseSeedList(seedArg) {
  if (!seedArg) return [1, 2, 3];
  return seedArg
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((v) => Number.isFinite(v) && v > 0);
}

export function quadrantIndex(idx, g) {
  const x = idx % g;
  const y = Math.floor(idx / g);
  const qx = x < g / 2 ? 0 : 1;
  const qy = y < g / 2 ? 0 : 1;
  return qy * 2 + qx;
}

export function quadrantMeans(field, g, mask) {
  const sums = [0, 0, 0, 0];
  const counts = [0, 0, 0, 0];
  for (let i = 0; i < field.length; i += 1) {
    if (mask && !mask[i]) continue;
    const q = quadrantIndex(i, g);
    sums[q] += field[i];
    counts[q] += 1;
  }
  return sums.map((sum, i) => (counts[i] > 0 ? sum / counts[i] : 0));
}

export function logicalBitsFromField(field, g, lS, mask) {
  const sums = [0, 0, 0, 0];
  const counts = [0, 0, 0, 0];
  for (let i = 0; i < field.length; i += 1) {
    if (mask && !mask[i]) continue;
    const q = quadrantIndex(i, g);
    sums[q] += field[i];
    counts[q] += 1;
  }
  const threshold = lS / 2;
  return sums.map((sum, i) => {
    const meanVal = counts[i] > 0 ? sum / counts[i] : 0;
    return meanVal >= threshold ? 1 : 0;
  });
}

export function errorRate(bitsA, bitsB) {
  let mismatches = 0;
  for (let i = 0; i < bitsA.length; i += 1) {
    if (bitsA[i] !== bitsB[i]) mismatches += 1;
  }
  return mismatches / bitsA.length;
}

export function errRegionBits(baseField, metaField, g, lS, regionMask) {
  const baseBits = logicalBitsFromField(baseField, g, lS, regionMask);
  const metaBits = logicalBitsFromField(metaField, g, lS, regionMask);
  return errorRate(metaBits, baseBits);
}

export function errQuadrantMean(baseField, metaField, g, lS, regionMask) {
  const denom = lS > 0 ? lS : 1;
  const baseMeans = quadrantMeans(baseField, g, regionMask);
  const metaMeans = quadrantMeans(metaField, g, regionMask);
  let acc = 0;
  for (let i = 0; i < 4; i += 1) {
    acc += Math.abs(baseMeans[i] - metaMeans[i]);
  }
  return acc / (4 * denom);
}

export function makeMask(seed, size, frac) {
  let x = seed >>> 0;
  if (x === 0) x = 1;
  const mask = new Array(size);
  for (let i = 0; i < size; i += 1) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    const r = (x >>> 8) / (1 << 24);
    mask[i] = r < frac;
  }
  return mask;
}

export function errF05(baseBits, metaField, g, lS, seed) {
  const trials = 20;
  let acc = 0;
  for (let t = 0; t < trials; t += 1) {
    const mask = makeMask(seed + t * 101, metaField.length, 0.5);
    const bits = logicalBitsFromField(metaField, g, lS, mask);
    acc += errorRate(bits, baseBits);
  }
  return acc / trials;
}

export function errF05Region(baseField, metaField, g, lS, seed, regionMask) {
  const trials = 20;
  let acc = 0;
  for (let t = 0; t < trials; t += 1) {
    const mask = makeMask(seed + t * 101, metaField.length, 0.5);
    if (regionMask) {
      for (let i = 0; i < mask.length; i += 1) {
        mask[i] = mask[i] && regionMask[i];
      }
    }
    const baseBits = logicalBitsFromField(baseField, g, lS, mask);
    const metaBits = logicalBitsFromField(metaField, g, lS, mask);
    acc += errorRate(metaBits, baseBits);
  }
  return acc / trials;
}

function stripeIndex(idx, g, bins) {
  const x = idx % g;
  const fx = x / g;
  return Math.min(bins - 1, Math.floor(fx * bins));
}

function regionMask(g, regionType, regionIndex, span, bins) {
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

export function meanAbsDiffRegion(a, b, mask) {
  let sum = 0;
  let count = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (!mask[i]) continue;
    sum += Math.abs(a[i] - b[i]);
    count += 1;
  }
  return count === 0 ? 0 : sum / count;
}

function gateAllowsRegion(params, active, regionType, regionIndex, gateSpan, bins) {
  if (!params.repairClockGated) return true;
  if (regionType === "stripe") {
    const span = Math.min(bins, Math.max(1, gateSpan ?? 1));
    const activeBin = active % bins;
    for (let i = 0; i < span; i += 1) {
      if ((activeBin + i) % bins === regionIndex) return true;
    }
    return false;
  }
  return (active % 4) === regionIndex;
}

export async function calibrateGateGaps({
  presetPath,
  presetParams,
  variant,
  steps,
  reportEvery,
  regionType,
  regionIndex,
  gateSpan,
}) {
  const mod = await loadWasm();
  const baseParams = presetParams ?? readJson(path.resolve(rootDir, presetPath));
  const params = { ...baseParams };
  params.codeNoiseRate = 0.0;
  params.codeNoiseBatch = params.codeNoiseBatch ?? 1;
  params.codeNoiseLayer = params.codeNoiseLayer ?? 0;
  params.repairClockGated = 1;
  if (variant === "drift") {
    params.clockOn = 1;
    params.clockUsesP6 = 1;
  } else if (variant === "random") {
    params.clockOn = 1;
    params.clockUsesP6 = 0;
  } else {
    params.clockOn = 0;
    params.clockUsesP6 = 1;
  }
  if (gateSpan) params.repairGateSpan = gateSpan;

  const bins = params.clockK ?? 8;
  const effectiveSpan = gateSpan ?? params.repairGateSpan ?? 1;
  const sim = new mod.Sim(50, 1);
  sim.set_params(params);

  const gaps = [];
  let lastAllowed = null;
  for (let t = reportEvery; t <= steps; t += reportEvery) {
    sim.step(reportEvery);
    const active = sim.clock_state();
    if (gateAllowsRegion(params, active, regionType, regionIndex, effectiveSpan, bins)) {
      if (lastAllowed !== null) {
        gaps.push(t - lastAllowed);
      }
      lastAllowed = t;
    }
  }

  return {
    gaps,
    gapP50: percentile(gaps, 0.5),
    gapP95: percentile(gaps, 0.95),
    gapMax: gaps.length ? Math.max(...gaps) : null,
  };
}

export async function runDeadlineEvents({
  presetPath,
  presetParams,
  variant,
  seeds,
  steps,
  reportEvery,
  eventEvery,
  deadline,
  regionType,
  regionIndex,
  gateSpan,
  corruptFrac,
  errGood,
  sdiffGood,
  tailWindow,
  includeEvents = false,
}) {
  const mod = await loadWasm();
  const baseParams = presetParams ?? readJson(path.resolve(rootDir, presetPath));
  const params = { ...baseParams, epDebug: 1 };
  if (variant === "drift") {
    params.clockOn = 1;
    params.clockUsesP6 = 1;
  } else if (variant === "random") {
    params.clockOn = 1;
    params.clockUsesP6 = 0;
  } else {
    params.clockOn = 0;
    params.clockUsesP6 = 1;
  }
  if (gateSpan) params.repairGateSpan = gateSpan;

  const bins = params.clockK ?? 8;
  const effectiveSpan = gateSpan ?? params.repairGateSpan ?? 1;
  const regionMaskArr = regionMask(params.gridSize, regionType, regionIndex, effectiveSpan, bins);
  const tailWindowSteps = tailWindow ?? 200_000;
  const graceWindow = Math.max(0, Math.floor(0.2 * deadline));

  const runs = [];
  const MOVE_P5_META = 8;
  const MOVE_OPK = 9;
  const MOVE_CLOCK = 10;
  const eventsPerRun = Math.floor((steps - deadline) / eventEvery);
  const eventTimes = [];
  for (let t = eventEvery; t + deadline <= steps; t += eventEvery) {
    eventTimes.push(t);
  }

  for (const seed of seeds) {
    const sim = new mod.Sim(50, seed);
    sim.set_params(params);
    const readCounts = () => {
      const stats = sim.ep_q_stats();
      const counts = stats.count;
      return Array.from(counts);
    };
    let lastCounts = readCounts();
    const events = eventTimes.map((t) => ({ tEvent: t, recovered: false, recovery: null, miss: false }));
    let eventIdx = 0;
    let lastEventTime = null;
    let misses = 0;
    let recoveries = [];
    let p5MetaRecovered = [];
    let opkRecovered = [];
    let uptimeGood = 0;
    let sampleCount = 0;
    const sampleRecords = [];
    const baselineSamples = [];
    let errFloor = null;

    for (let t = reportEvery; t <= steps; t += reportEvery) {
      sim.step(reportEvery);
      const countsNow = readCounts();

      if (eventIdx < events.length && t >= events[eventIdx].tEvent) {
        for (; eventIdx < events.length && events[eventIdx].tEvent <= t; eventIdx += 1) {
          const event = events[eventIdx];
          const perturb = {
            target: "metaS",
            layer: 0,
            frac: corruptFrac ?? 1.0,
            mode: "randomize",
          };
          if (regionType === "stripe") {
            perturb.region = "stripe";
            perturb.bins = bins;
            perturb.span = gateSpan ?? 1;
            perturb.bin = regionIndex;
          } else {
            perturb.region = "quadrant";
            perturb.quadrant = regionIndex;
          }
          perturb.seed = seed * 1000 + event.tEvent;
          sim.apply_perturbation(perturb);
          lastEventTime = event.tEvent;
          event.startCounts = {
            p5Meta: countsNow[MOVE_P5_META] ?? 0,
            opk: countsNow[MOVE_OPK] ?? 0,
            clock: countsNow[MOVE_CLOCK] ?? 0,
            total: countsNow.reduce((acc, v) => acc + v, 0),
          };
        }
      }

      const baseS = sim.base_s_field();
      const metaS = sim.meta_field();
      const cells = baseS.length;
      const meta0 = metaS.subarray(0, cells);
      const sdiff = meanAbsDiffRegion(baseS, meta0, regionMaskArr);
      const lS = params.lS ?? 1;
      const errSample = errRegionBits(baseS, meta0, params.gridSize, lS, regionMaskArr);
      if (t < eventEvery) {
        baselineSamples.push(errSample);
      } else if (errFloor === null) {
        errFloor = baselineSamples.length > 0 ? mean(baselineSamples) : 0;
      }
      const errAdj = errFloor === null ? 0 : Math.max(0, errSample - errFloor);
      const good = sdiff <= sdiffGood && errAdj <= errGood;
      uptimeGood += good ? 1 : 0;
      sampleCount += 1;
      const sinceEvent = lastEventTime === null ? Number.POSITIVE_INFINITY : t - lastEventTime;
      sampleRecords.push({ t, err: errAdj, sdiff, good, sinceEvent });

      for (const event of events) {
        if (event.recovered || event.miss) continue;
        if (t < event.tEvent) continue;
        const elapsed = t - event.tEvent;
        if (elapsed > deadline) {
          event.miss = true;
          misses += 1;
          if (event.startCounts) {
            event.windowCounts = {
              p5Meta: (countsNow[MOVE_P5_META] ?? 0) - event.startCounts.p5Meta,
              opk: (countsNow[MOVE_OPK] ?? 0) - event.startCounts.opk,
              clock: (countsNow[MOVE_CLOCK] ?? 0) - event.startCounts.clock,
              total: countsNow.reduce((acc, v) => acc + v, 0) - event.startCounts.total,
            };
            event.p5MetaAcceptedToOutcome = event.windowCounts.p5Meta;
            event.opkAcceptedToOutcome = event.windowCounts.opk;
            event.clockAcceptedToOutcome = event.windowCounts.clock;
            event.stepsToOutcome = elapsed;
          }
          continue;
        }
        if (good) {
          event.recovered = true;
          event.recovery = elapsed;
          recoveries.push(elapsed);
          if (event.startCounts) {
            event.windowCounts = {
              p5Meta: (countsNow[MOVE_P5_META] ?? 0) - event.startCounts.p5Meta,
              opk: (countsNow[MOVE_OPK] ?? 0) - event.startCounts.opk,
              clock: (countsNow[MOVE_CLOCK] ?? 0) - event.startCounts.clock,
              total: countsNow.reduce((acc, v) => acc + v, 0) - event.startCounts.total,
            };
            event.p5MetaAcceptedToOutcome = event.windowCounts.p5Meta;
            event.opkAcceptedToOutcome = event.windowCounts.opk;
            event.clockAcceptedToOutcome = event.windowCounts.clock;
            event.stepsToOutcome = elapsed;
            p5MetaRecovered.push(event.windowCounts.p5Meta);
            opkRecovered.push(event.windowCounts.opk);
          }
        }
      }

      lastCounts = countsNow;
    }

    for (const event of events) {
      if (!event.recovered && !event.miss) {
        event.miss = true;
        misses += 1;
      }
    }


    const baseS = sim.base_s_field();
    const metaS = sim.meta_field();
    const cells = baseS.length;
    const meta0 = metaS.subarray(0, cells);
    const lS = params.lS ?? 1;
    const baseBits = logicalBitsFromField(baseS, params.gridSize, lS, regionMaskArr);
    const errEnd = errorRate(baseBits, logicalBitsFromField(meta0, params.gridSize, lS, regionMaskArr));
    const sdiffEnd = meanAbsDiffRegion(baseS, meta0, regionMaskArr);

    const tailStart = Math.max(0, steps - tailWindowSteps);
    const tailSamples = sampleRecords.filter(
      (s) => s.t >= tailStart && s.sinceEvent >= graceWindow,
    );
    const tailUptime = tailSamples.length
      ? tailSamples.filter((s) => s.good).length / tailSamples.length
      : 0;
    const tailErrMean = tailSamples.length ? mean(tailSamples.map((s) => s.err)) : 0;
    const tailSdiffMean = tailSamples.length ? mean(tailSamples.map((s) => s.sdiff)) : 0;
    const errP95 = percentile(sampleRecords.map((s) => s.err), 0.95);

    const p5MetaSuccess = [];
    const p5MetaMiss = [];
    const opkSuccess = [];
    const opkMiss = [];
    const clockSuccess = [];
    const clockMiss = [];
    const stepsToRecover = [];
    const stepsToMiss = [];
    const repairEfficiency = [];

    for (const event of events) {
      if (event.recovered && event.windowCounts) {
        p5MetaSuccess.push(event.windowCounts.p5Meta ?? 0);
        opkSuccess.push(event.windowCounts.opk ?? 0);
        clockSuccess.push(event.windowCounts.clock ?? 0);
        stepsToRecover.push(event.stepsToOutcome ?? 0);
        if ((event.windowCounts.p5Meta ?? 0) > 0 && event.stepsToOutcome != null) {
          repairEfficiency.push(event.stepsToOutcome / event.windowCounts.p5Meta);
        }
      } else if (event.miss && event.windowCounts) {
        p5MetaMiss.push(event.windowCounts.p5Meta ?? 0);
        opkMiss.push(event.windowCounts.opk ?? 0);
        clockMiss.push(event.windowCounts.clock ?? 0);
        stepsToMiss.push(event.stepsToOutcome ?? deadline);
      }
    }

    const epTotal = sim.ep_exact_total();
    const epByMove = sim.ep_exact_by_move();
    const epClock = epByMove[10] ?? 0;
    const epRepair = (epByMove[7] ?? 0) + (epByMove[8] ?? 0);
    const epOpK = epByMove[9] ?? 0;
    const epNoise = 0;
    const epOther = epTotal - epClock - epRepair - epOpK;
    const finalCounts = readCounts();
    const repairRate = steps > 0 ? (finalCounts[MOVE_P5_META] ?? 0) / steps : 0;
    const opkRate = steps > 0 ? (finalCounts[MOVE_OPK] ?? 0) / steps : 0;

    runs.push({
      seed,
      missFrac: events.length > 0 ? misses / events.length : 0,
      recoveryMean: recoveries.length > 0 ? mean(recoveries) : null,
      recoveryP95: percentile(recoveries, 0.95),
      recoveryMax: recoveries.length > 0 ? Math.max(...recoveries) : null,
      p5MetaToRecoverMean: p5MetaRecovered.length > 0 ? mean(p5MetaRecovered) : null,
      p5MetaToRecoverP95: percentile(p5MetaRecovered, 0.95),
      opkToRecoverMean: opkRecovered.length > 0 ? mean(opkRecovered) : null,
      opkToRecoverP95: percentile(opkRecovered, 0.95),
      p5MetaToRecoverSuccessMean: p5MetaSuccess.length > 0 ? mean(p5MetaSuccess) : null,
      p5MetaToRecoverSuccessP95: percentile(p5MetaSuccess, 0.95),
      p5MetaBeforeMissMean: p5MetaMiss.length > 0 ? mean(p5MetaMiss) : null,
      p5MetaBeforeMissP95: percentile(p5MetaMiss, 0.95),
      opkToRecoverSuccessMean: opkSuccess.length > 0 ? mean(opkSuccess) : null,
      opkToRecoverSuccessP95: percentile(opkSuccess, 0.95),
      opkBeforeMissMean: opkMiss.length > 0 ? mean(opkMiss) : null,
      opkBeforeMissP95: percentile(opkMiss, 0.95),
      clockToRecoverSuccessMean: clockSuccess.length > 0 ? mean(clockSuccess) : null,
      clockToRecoverSuccessP95: percentile(clockSuccess, 0.95),
      clockBeforeMissMean: clockMiss.length > 0 ? mean(clockMiss) : null,
      clockBeforeMissP95: percentile(clockMiss, 0.95),
      recoveriesCount: p5MetaSuccess.length,
      missesCount: p5MetaMiss.length,
      repairEfficiencySuccessMean: repairEfficiency.length > 0 ? mean(repairEfficiency) : null,
      repairEfficiencySuccessMedian:
        repairEfficiency.length > 0 ? percentile(repairEfficiency, 0.5) : null,
      repairRate,
      opkRate,
      uptime: sampleCount > 0 ? uptimeGood / sampleCount : 0,
      uptimeTail: tailUptime,
      errTailMean: tailErrMean,
      sdiffTailMean: tailSdiffMean,
      errP95,
      errEnd,
      sdiffEnd,
      epTotal,
      epClock,
      epRepair,
      epOpK,
      epNoise,
      epOther,
      epTotalRate: steps > 0 ? epTotal / steps : 0,
      epClockRate: steps > 0 ? epClock / steps : 0,
      epRepairRate: steps > 0 ? epRepair / steps : 0,
      epOpKRate: steps > 0 ? epOpK / steps : 0,
      epNoiseRate: 0,
      epOtherRate: steps > 0 ? epOther / steps : 0,
      events: events.length,
      eventOutcomes: includeEvents
        ? events.map((event) => ({
            success: !!event.recovered,
            miss: !!event.miss,
            repairsUsed:
              event.p5MetaAcceptedToOutcome == null
                ? Number.POSITIVE_INFINITY
                : event.p5MetaAcceptedToOutcome,
            stepsUsed: event.stepsToOutcome ?? null,
          }))
        : null,
    });
  }

  return { params, runs };
}
