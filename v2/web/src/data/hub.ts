import type { BBox } from '@gev/shared';
import type { ApiConfig } from '../api/index.ts';
import type { FromWorker, ToWorker } from './protocol.ts';

/** Main-thread handle on the snapshot worker. */
export class SnapshotHub {
  private worker: Worker;
  private seq = 0;
  private listener: ((m: FromWorker) => void) | null = null;

  constructor(api: ApiConfig) {
    this.worker = new Worker(new URL('./snapshot.worker.ts', import.meta.url), { type: 'module', name: 'gev-snapshots' });
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => this.listener?.(e.data);
    this.post({ type: 'init', api });
  }

  onMessage(cb: (m: FromWorker) => void): void {
    this.listener = cb;
  }

  /** Ask for a snapshot; returns the sequence number the answer will carry. */
  fetch(layer: string, bbox: BBox | null, at: number | null): number {
    const seq = ++this.seq;
    this.post({ type: 'fetch', layer, seq, bbox, at });
    return seq;
  }

  drop(layer: string): void {
    this.post({ type: 'drop', layer });
  }

  destroy(): void {
    this.listener = null;
    this.worker.terminate();
  }

  private post(m: ToWorker): void {
    this.worker.postMessage(m);
  }
}
