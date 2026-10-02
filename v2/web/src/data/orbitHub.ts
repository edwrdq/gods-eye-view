import type { ApiConfig } from '../api/index.ts';
import type { FromOrbitWorker, ToOrbitWorker } from './orbitProtocol.ts';

/** Main-thread handle on the orbits worker (SGP4 and element loading live there). */
export class OrbitHub {
  private worker: Worker;
  private seq = 0;
  private req = 0;
  private listener: ((m: FromOrbitWorker) => void) | null = null;

  constructor(api: ApiConfig, bench: number) {
    this.worker = new Worker(new URL('./orbits.worker.ts', import.meta.url), { type: 'module', name: 'gev-orbits' });
    this.worker.onmessage = (e: MessageEvent<FromOrbitWorker>) => this.listener?.(e.data);
    this.post({ type: 'init', api, bench });
  }

  onMessage(cb: (m: FromOrbitWorker) => void): void {
    this.listener = cb;
  }

  load(): number {
    const seq = ++this.seq;
    this.post({ type: 'load', seq });
    return seq;
  }

  setGroup(group: string | null): void {
    this.post({ type: 'group', group });
  }

  setTime(at: number | null): void {
    this.post({ type: 'time', at });
  }

  select(noradId: string | null): void {
    this.post({ type: 'select', noradId });
  }

  pause(paused: boolean): void {
    this.post({ type: 'pause', paused });
  }

  inspect(noradId: string): number {
    const reqId = ++this.req;
    this.post({ type: 'inspect', reqId, noradId });
    return reqId;
  }

  destroy(): void {
    this.listener = null;
    this.worker.terminate();
  }

  private post(m: ToOrbitWorker): void {
    this.worker.postMessage(m);
  }
}
