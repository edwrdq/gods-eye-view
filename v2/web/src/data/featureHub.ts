import type { ApiConfig } from '../api/index.ts';
import type { FromFeatureWorker, ToFeatureWorker } from './featureProtocol.ts';

/** Main-thread handle on the features worker. */
export class FeatureHub {
  private worker: Worker;
  private seq = 0;
  private listener: ((m: FromFeatureWorker) => void) | null = null;

  constructor(api: ApiConfig) {
    this.worker = new Worker(new URL('./features.worker.ts', import.meta.url), { type: 'module', name: 'gev-features' });
    this.worker.onmessage = (e: MessageEvent<FromFeatureWorker>) => this.listener?.(e.data);
    this.post({ type: 'init', api });
  }

  onMessage(cb: (m: FromFeatureWorker) => void): void {
    this.listener = cb;
  }

  /** Returns the sequence number the answer will carry. */
  fetch(layer: string, window: { from?: number; to?: number }): number {
    const seq = ++this.seq;
    this.post({ type: 'fetch', layer, seq, from: window.from, to: window.to });
    return seq;
  }

  drop(layer: string): void {
    this.post({ type: 'drop', layer });
  }

  destroy(): void {
    this.listener = null;
    this.worker.terminate();
  }

  private post(m: ToFeatureWorker): void {
    this.worker.postMessage(m);
  }
}
