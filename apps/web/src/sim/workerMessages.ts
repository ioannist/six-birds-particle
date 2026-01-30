export type SimInitRequest = { type: "init"; n: number; seed: number };
export type SimStepRequest = { type: "step"; steps: number };
export type SimParams = {
  beta: number;
  stepSize: number;
  p3On: number;
  p6On: number;
  etaDrive: number;
  p6SFactor: number;
  pWrite: number;
  pNWrite: number;
  pAWrite: number;
  pSWrite: number;
  muHigh: number;
  muLow: number;
  kappaRep: number;
  r0: number;
  kappaBond: number;
  rStar: number;
  lambdaW: number;
  lW: number;
  lambdaN: number;
  lN: number;
  lambdaA: number;
  lA: number;
  lambdaS: number;
  lS: number;
  gridSize: number;
  rPropose: number;
  metaLayers: number;
  eta: number;
  clockOn: number;
  clockK: number;
  clockFrac: number;
  clockUsesP6: number;
  repairClockGated: number;
  repairGateMode: number;
  repairGateSpan: number;
  codeNoiseRate: number;
  codeNoiseBatch: number;
  codeNoiseLayer: number;
  opCouplingOn: number;
  sCouplingMode: number;
  opStencil: number;
  opBudgetK: number;
  opDriveOnK: number;
};

export const SNAPSHOT_VERSION = 2 as const;

export type SimConfigRequest = { type: "config"; bondThreshold: number; params: SimParams };
export type SimPauseRequest = { type: "pause" };
export type SimResumeRequest = { type: "resume" };
export type SimRequest =
  | SimInitRequest
  | SimStepRequest
  | SimConfigRequest
  | SimPauseRequest
  | SimResumeRequest;

export type EnergyBreakdown = {
  total: number;
  uRep: number;
  uBond: number;
  eW: number;
  eN: number;
  eA: number;
  eS: number;
};

export type Diagnostics = {
  wPlus: number;
  wMinus: number;
  nPlus: number;
  nMinus: number;
  aPlus: number;
  aMinus: number;
  sPlus: number;
  sMinus: number;
  window: number;
  jW: number;
  aW: number;
  jN: number;
  aN: number;
  jA: number;
  aA: number;
  jS: number;
  aS: number;
  p3CycleLen: number;
  p3DispX: number;
  p3DispY: number;
  p3DispMag: number;
  p3LoopArea: number;
  aM6W: number;
  aM6N: number;
  aM6A: number;
  aM6S: number;
  sigmaMem: number;
  wHist: Uint32Array;
  sHist: Uint32Array;
};

export type EpSnapshotExtras = {
  exactTotal?: number;
  naiveTotal?: number;
  exactByMove?: Record<string, number>;
};

export type ClockSnapshotExtras = {
  q?: number;
  fwd?: number;
  bwd?: number;
  state?: number;
};

export type OpkSnapshotExtras = {};

export type MaintenanceSnapshotExtras = {};

export type SnapshotExtras = {
  ep?: EpSnapshotExtras;
  clock?: ClockSnapshotExtras;
  opk?: OpkSnapshotExtras;
  maintenance?: MaintenanceSnapshotExtras;
};

export type SimSnapshot = {
  snapshotVersion: 2;
  n: number;
  positions: Float32Array;
  bonds: Uint32Array; // [i0,j0,i1,j1,...] for w_ij >= threshold
  counters: Int16Array;
  apparatus: Uint16Array;
  field: Uint8Array;
  metaLayers: number;
  metaField: Uint8Array;
  baseSField: Uint8Array;
  metaNField: Int16Array;
  metaAField: Uint16Array;
  metaWEdges: Uint8Array;
  energy: EnergyBreakdown;
  diagnostics: Diagnostics;
  steps: number;
  extras: SnapshotExtras;
};

export type SimSnapshotWire = Partial<Omit<SimSnapshot, "snapshotVersion" | "extras">> & {
  snapshotVersion?: number;
  extras?: SnapshotExtras;
};

export function normalizeSnapshot(wire: SimSnapshotWire): SimSnapshot {
  const positions = wire.positions ?? new Float32Array();
  const bonds = wire.bonds ?? new Uint32Array();
  const counters = wire.counters ?? new Int16Array();
  const apparatus = wire.apparatus ?? new Uint16Array();
  const field = wire.field ?? new Uint8Array();
  const baseSField = wire.baseSField ?? (field.length ? field : new Uint8Array());
  const metaField = wire.metaField ?? new Uint8Array();
  const metaNField = wire.metaNField ?? new Int16Array();
  const metaAField = wire.metaAField ?? new Uint16Array();
  const metaWEdges = wire.metaWEdges ?? new Uint8Array();

  const energy: EnergyBreakdown = {
    total: wire.energy?.total ?? 0,
    uRep: wire.energy?.uRep ?? 0,
    uBond: wire.energy?.uBond ?? 0,
    eW: wire.energy?.eW ?? 0,
    eN: wire.energy?.eN ?? 0,
    eA: wire.energy?.eA ?? 0,
    eS: wire.energy?.eS ?? 0,
  };

  const diagnostics: Diagnostics = {
    wPlus: wire.diagnostics?.wPlus ?? 0,
    wMinus: wire.diagnostics?.wMinus ?? 0,
    nPlus: wire.diagnostics?.nPlus ?? 0,
    nMinus: wire.diagnostics?.nMinus ?? 0,
    aPlus: wire.diagnostics?.aPlus ?? 0,
    aMinus: wire.diagnostics?.aMinus ?? 0,
    sPlus: wire.diagnostics?.sPlus ?? 0,
    sMinus: wire.diagnostics?.sMinus ?? 0,
    window: wire.diagnostics?.window ?? 0,
    jW: wire.diagnostics?.jW ?? 0,
    aW: wire.diagnostics?.aW ?? 0,
    jN: wire.diagnostics?.jN ?? 0,
    aN: wire.diagnostics?.aN ?? 0,
    jA: wire.diagnostics?.jA ?? 0,
    aA: wire.diagnostics?.aA ?? 0,
    jS: wire.diagnostics?.jS ?? 0,
    aS: wire.diagnostics?.aS ?? 0,
    p3CycleLen: wire.diagnostics?.p3CycleLen ?? 0,
    p3DispX: wire.diagnostics?.p3DispX ?? 0,
    p3DispY: wire.diagnostics?.p3DispY ?? 0,
    p3DispMag: wire.diagnostics?.p3DispMag ?? 0,
    p3LoopArea: wire.diagnostics?.p3LoopArea ?? 0,
    aM6W: wire.diagnostics?.aM6W ?? 0,
    aM6N: wire.diagnostics?.aM6N ?? 0,
    aM6A: wire.diagnostics?.aM6A ?? 0,
    aM6S: wire.diagnostics?.aM6S ?? 0,
    sigmaMem: wire.diagnostics?.sigmaMem ?? 0,
    wHist: wire.diagnostics?.wHist ?? new Uint32Array(),
    sHist: wire.diagnostics?.sHist ?? new Uint32Array(),
  };

  return {
    snapshotVersion: SNAPSHOT_VERSION,
    n: wire.n ?? 0,
    positions,
    bonds,
    counters,
    apparatus,
    field,
    metaLayers: wire.metaLayers ?? 0,
    metaField,
    baseSField,
    metaNField,
    metaAField,
    metaWEdges,
    energy,
    diagnostics,
    steps: wire.steps ?? 0,
    extras: wire.extras ?? {},
  };
}

export type SimSnapshotMessage = { type: "snapshot"; snapshot: SimSnapshotWire };
export type SimReadyMessage = { type: "ready" };
export type SimErrorMessage = { type: "error"; message: string };
export type SimDebugMessage = { type: "debug"; message: string };
export type SimMessage = SimSnapshotMessage | SimReadyMessage | SimErrorMessage | SimDebugMessage;
