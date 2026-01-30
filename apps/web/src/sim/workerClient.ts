import type { SimMessage, SimRequest, SimSnapshot, SimSnapshotWire } from "./workerMessages";
import { normalizeSnapshot } from "./workerMessages";
// Use Vite's ?worker import for proper bundling (compiles TS and handles production correctly)
import SimWorker from "./sim.worker.ts?worker";

export class SimWorkerClient {
  private readonly worker: Worker;
  private snapshotHandlers: Array<(s: SimSnapshot) => void> = [];
  private errorHandlers: Array<(m: string) => void> = [];
  private debugHandlers: Array<(m: string) => void> = [];
  private readyHandlers: Array<() => void> = [];
  // Queue messages that arrive before handlers are registered
  private pendingDebug: string[] = [];
  private pendingReady = false;
  private terminated = false;

  constructor() {
    try {
      this.worker = new SimWorker();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to create worker: ${message}`);
    }

    this.worker.onmessage = (ev: MessageEvent<SimMessage>) => {
      const msg = ev.data;
      if (msg.type === "snapshot") {
        const normalized = normalizeSnapshot(msg.snapshot as SimSnapshotWire);
        if (import.meta.env.DEV) {
          (window as any).__ratchetLastSnapshot = normalized;
        }
        this.snapshotHandlers.forEach((h) => h(normalized));
      }
      if (msg.type === "ready") {
        if (this.readyHandlers.length) {
          this.readyHandlers.forEach((h) => h());
        } else {
          this.pendingReady = true;
        }
      }
      if (msg.type === "error") this.errorHandlers.forEach((h) => h(msg.message));
      if (msg.type === "debug") {
        if (this.debugHandlers.length) {
          this.debugHandlers.forEach((h) => h(msg.message));
        } else {
          this.pendingDebug.push(msg.message);
        }
      }
    };
    this.worker.onerror = (ev) => {
      const detail =
        ev instanceof ErrorEvent
          ? `${ev.message}${ev.filename ? ` (${ev.filename}:${ev.lineno}:${ev.colno})` : ""}`
          : String(ev);
      this.errorHandlers.forEach((h) => h(`Worker error: ${detail}`));
    };
    this.worker.onmessageerror = () => {
      this.errorHandlers.forEach((h) => h("Worker message error (structured clone failed)."));
    };
  }

  onSnapshot(handler: (s: SimSnapshot) => void) {
    this.snapshotHandlers.push(handler);
    return () => (this.snapshotHandlers = this.snapshotHandlers.filter((h) => h !== handler));
  }

  onReady(handler: () => void) {
    this.readyHandlers.push(handler);
    // Flush pending ready if it arrived before handler was registered
    if (this.pendingReady) {
      this.pendingReady = false;
      handler();
    }
    return () => (this.readyHandlers = this.readyHandlers.filter((h) => h !== handler));
  }

  onError(handler: (m: string) => void) {
    this.errorHandlers.push(handler);
    return () => (this.errorHandlers = this.errorHandlers.filter((h) => h !== handler));
  }

  onDebug(handler: (m: string) => void) {
    this.debugHandlers.push(handler);
    // Flush pending debug messages that arrived before handler was registered
    if (this.pendingDebug.length) {
      const pending = this.pendingDebug;
      this.pendingDebug = [];
      pending.forEach((m) => handler(m));
    }
    return () => (this.debugHandlers = this.debugHandlers.filter((h) => h !== handler));
  }

  send(req: SimRequest) {
    if (this.terminated) {
      return;
    }
    this.worker.postMessage(req);
  }

  terminate() {
    this.terminated = true;
    this.worker.terminate();
  }
}
