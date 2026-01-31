import type { SimParams } from "./workerMessages";

export const RUN_EXPORT_VERSION = 2 as const;

export type RunMeta = {
  runId: number;
  startedAt: number;
  n: number;
  seed: number;
  bondThreshold: number;
  presetId?: string;
  presetSourcePath?: string;
  supports?: string[];
  paramsApplied: SimParams;
  captureEverySteps: number;
  uiConfig: {
    snapshotVersion: number;
    epWindowSteps: number;
    certStabilityK: number;
    turBlockSteps: number;
    opkPayloadEverySteps: number;
    maintEverySteps: number;
    bondsEverySteps?: number;
    bondsMode?: string;
    graphStatsMode?: string;
  };
};

export type SnapshotExtrasSummary = {
  ep?: {
    exactTotal?: number;
    naiveTotal?: number;
    exactByMove?: Float64Array;
  };
  clock?: {
    q?: number;
    fwd?: number;
    bwd?: number;
    state?: number;
  };
  opk?: {
    enabled?: boolean;
    budgetK?: number;
    interfaces?: number;
    rCount?: number;
    stencilId?: number;
    computedAtSteps?: number;
  };
};

export type SnapshotEntry = {
  runId: number;
  index: number;
  t: number;
  n: number;
  snapshotVersion: number;
  totalSteps: number;
  energy: unknown;
  diagnostics: unknown;
  graphStats: unknown;
  positions: Float32Array;
  bonds: Uint32Array;
  counters: Int16Array;
  apparatus: Uint16Array;
  baseSField: Uint8Array;
  metaLayers: number;
  metaS0?: Uint8Array | null;
  metaS1?: Uint8Array | null;
  metaW0?: Uint8Array | null;
  metaW1?: Uint8Array | null;
  extras?: SnapshotExtrasSummary;
  metrics?: Record<string, unknown> | null;
  stepsDelta: number;
};

const DB_NAME = "ratchet-run-cache";
const DB_VERSION = 1;
const STORE = "snapshots";
const META = "meta";

const FLUSH_EVERY = 50;
const MEMORY_KEEP = 200;

let runMeta: RunMeta | null = null;
let index = 0;
let stepAccumulator = 0;
let captureEverySteps = 2000;
let pending: SnapshotEntry[] = [];
let memory: SnapshotEntry[] = [];
let flushing = false;
let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("IndexedDB not available"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
      }
      if (!db.objectStoreNames.contains(META)) {
        db.createObjectStore(META);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Failed to open IndexedDB"));
  });
  return dbPromise;
}

async function clearDb() {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE, META], "readwrite");
    tx.objectStore(STORE).clear();
    tx.objectStore(META).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Failed to clear run cache"));
  });
}

async function writeMeta(meta: RunMeta) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(META, "readwrite");
    tx.objectStore(META).put(meta, "current");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Failed to write run meta"));
  });
}

async function flushPending(): Promise<void> {
  if (flushing || pending.length === 0) return;
  flushing = true;
  const batch = pending;
  pending = [];
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      for (const entry of batch) {
        store.add(entry);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Failed to flush run cache"));
    });
  } catch {
    pending = batch.concat(pending);
  } finally {
    flushing = false;
    if (pending.length >= FLUSH_EVERY) {
      await flushPending();
    }
  }
}

export async function startRun(meta: Omit<RunMeta, "runId" | "startedAt">) {
  runMeta = {
    runId: Date.now(),
    startedAt: Date.now(),
    ...meta,
  };
  index = 0;
  stepAccumulator = 0;
  pending = [];
  memory = [];
  try {
    await clearDb();
    await writeMeta(runMeta);
  } catch {
    // Fallback to in-memory only.
  }
}

export function addSnapshot(entry: Omit<SnapshotEntry, "runId" | "index" | "t">) {
  if (!runMeta) return;
  if (captureEverySteps <= 0) return;
  stepAccumulator += Math.max(0, entry.stepsDelta);
  if (stepAccumulator < captureEverySteps) return;
  stepAccumulator = stepAccumulator % captureEverySteps;

  const extras = entry.extras;
  const snapshot: SnapshotEntry = {
    runId: runMeta.runId,
    index,
    t: performance.now(),
    ...entry,
    positions: new Float32Array(entry.positions),
    bonds: new Uint32Array(entry.bonds),
    counters: new Int16Array(entry.counters),
    apparatus: new Uint16Array(entry.apparatus),
    baseSField: new Uint8Array(entry.baseSField),
    metaS0: entry.metaS0 ? new Uint8Array(entry.metaS0) : entry.metaS0 ?? null,
    metaS1: entry.metaS1 ? new Uint8Array(entry.metaS1) : entry.metaS1 ?? null,
    metaW0: entry.metaW0 ? new Uint8Array(entry.metaW0) : entry.metaW0 ?? null,
    metaW1: entry.metaW1 ? new Uint8Array(entry.metaW1) : entry.metaW1 ?? null,
    extras: extras
      ? {
          ...extras,
          ep: extras.ep
            ? {
                ...extras.ep,
                exactByMove: extras.ep.exactByMove
                  ? new Float64Array(extras.ep.exactByMove)
                  : undefined,
              }
            : undefined,
        }
      : undefined,
  };
  index += 1;
  pending.push(snapshot);
  memory.push(snapshot);
  if (memory.length > MEMORY_KEEP) {
    memory.shift();
  }
  if (pending.length >= FLUSH_EVERY) {
    void flushPending();
  }
}

export function setCaptureEverySteps(steps: number) {
  const v = Math.max(1, Math.floor(steps));
  captureEverySteps = v;
  if (runMeta) {
    runMeta.captureEverySteps = v;
  }
}

export function getMemory(): SnapshotEntry[] {
  return memory.slice();
}

export function getMeta(): RunMeta | null {
  return runMeta;
}

export function attachToWindow() {
  (window as any).__ratchetRunCache = {
    getMeta,
    getMemory,
    exportRun,
  };
}

export async function exportRun() {
  try {
    await flushPending();
  } catch {
    // Ignore flush errors; we'll fall back to in-memory data.
  }

  let db: IDBDatabase | null = null;
  try {
    db = await openDb();
  } catch {
    db = null;
  }

  const meta = await new Promise<RunMeta | null>((resolve, reject) => {
    if (!db) {
      resolve(runMeta);
      return;
    }
    const tx = db.transaction(META, "readonly");
    const req = tx.objectStore(META).get("current");
    req.onsuccess = () => resolve((req.result as RunMeta) ?? null);
    req.onerror = () => reject(req.error ?? new Error("Failed to read run meta"));
  });

  const parts: BlobPart[] = [];
  if (meta) {
    parts.push(
      `${JSON.stringify({
        type: "meta",
        runExportVersion: RUN_EXPORT_VERSION,
        exportedAt: Date.now(),
        ...meta,
      })}\n`
    );
  }

  let wroteSnapshots = false;
  if (db) {
    await new Promise<void>((resolve, reject) => {
      const tx = db!.transaction(STORE, "readonly");
      const store = tx.objectStore(STORE);
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
          resolve();
          return;
        }
        const entry = cursor.value as SnapshotEntry;
        parts.push(`${JSON.stringify(serializeSnapshot(entry))}\n`);
        wroteSnapshots = true;
        cursor.continue();
      };
      req.onerror = () => reject(req.error ?? new Error("Failed to read run snapshots"));
    });
  }

  if (!wroteSnapshots) {
    const fallback = pending.concat(memory);
    for (const entry of fallback) {
      parts.push(`${JSON.stringify(serializeSnapshot(entry))}\n`);
    }
  }

  const blob = new Blob(parts, { type: "application/jsonl" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const ts = meta?.startedAt ? new Date(meta.startedAt).toISOString().replace(/[:.]/g, "-") : "run";
  a.href = url;
  a.download = `ratchet-run-${ts}.jsonl`;
  a.click();
  URL.revokeObjectURL(url);
}

function serializeSnapshot(entry: SnapshotEntry) {
  const extras = entry.extras;
  return {
    type: "snapshot",
    runExportVersion: RUN_EXPORT_VERSION,
    runId: entry.runId,
    index: entry.index,
    t: entry.t,
    n: entry.n,
    snapshotVersion: entry.snapshotVersion,
    totalSteps: entry.totalSteps,
    energy: entry.energy,
    diagnostics: entry.diagnostics,
    graphStats: entry.graphStats,
    positions: Array.from(entry.positions),
    bonds: Array.from(entry.bonds),
    counters: Array.from(entry.counters),
    apparatus: Array.from(entry.apparatus),
    baseSField: Array.from(entry.baseSField),
    metaLayers: entry.metaLayers,
    metaS0: entry.metaS0 ? Array.from(entry.metaS0) : null,
    metaS1: entry.metaS1 ? Array.from(entry.metaS1) : null,
    metaW0: entry.metaW0 ? Array.from(entry.metaW0) : null,
    metaW1: entry.metaW1 ? Array.from(entry.metaW1) : null,
    extras: extras
      ? {
          ...extras,
          ep: extras.ep
            ? {
                ...extras.ep,
                exactByMove: extras.ep.exactByMove
                  ? Array.from(extras.ep.exactByMove)
                  : undefined,
              }
            : undefined,
        }
      : undefined,
    metrics: entry.metrics ?? null,
    stepsDelta: entry.stepsDelta,
  };
}
