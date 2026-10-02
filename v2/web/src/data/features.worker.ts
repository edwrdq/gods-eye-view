// Fetches features layers and packs them into typed arrays off the main thread.
import type { BBox } from '@gev/shared';
import { ApiRequestError, configureApi, fetchFeatures, isAbort } from '../api/index.ts';
import { packFeatures, packTransfer } from '../lib/geometryPack.ts';
import type { FromFeatureWorker, ToFeatureWorker } from './featureProtocol.ts';

const scope = self as unknown as { postMessage(m: FromFeatureWorker, t?: Transferable[]): void; onmessage: ((e: MessageEvent<ToFeatureWorker>) => void) | null };
const inflight = new Map<string, { ctl: AbortController; seq: number }>();

async function run(layer: string, seq: number, from: number | undefined, to: number | undefined, bbox: BBox | undefined): Promise<void> {
  inflight.get(layer)?.ctl.abort();
  const ctl = new AbortController();
  inflight.set(layer, { ctl, seq });
  const t0 = performance.now();
  try {
    const res = await fetchFeatures(layer, { from, to, bbox }, ctl.signal);
    if (ctl.signal.aborted || inflight.get(layer)?.seq !== seq) return;
    const t1 = performance.now();
    const pack = packFeatures(layer, res.features);
    const packMs = performance.now() - t1;
    scope.postMessage(
      { type: 'features', layer, seq, feed: res.feed, truncated: res.truncated, pending: res.pending === true, received: res.features.length, pack, fetchMs: t1 - t0, packMs },
      packTransfer(pack),
    );
  } catch (e) {
    if (isAbort(e) || ctl.signal.aborted || inflight.get(layer)?.seq !== seq) return;
    const failure = e instanceof ApiRequestError ? e : null;
    scope.postMessage({
      type: 'failed',
      layer,
      seq,
      failure: failure?.failure ?? 'network',
      status: failure?.status ?? 0,
      message: e instanceof Error ? e.message : String(e),
    });
  }
}

scope.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') configureApi(m.api);
  else if (m.type === 'fetch') void run(m.layer, m.seq, m.from, m.to, m.bbox);
  else if (m.type === 'drop') {
    inflight.get(m.layer)?.ctl.abort();
    inflight.delete(m.layer);
  }
};
