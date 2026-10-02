// Fetches and parses layer snapshots off the main thread, diffs them against
// the previous snapshot, and posts compact typed arrays. The main thread only
// writes the changed objects into its batched primitives.
import type { BBox, LayerSnapshot } from '@gev/shared';
import { ApiRequestError, configureApi, fetchSnapshot, isAbort } from '../api/index.ts';
import type { FromWorker, ToWorker } from './protocol.ts';
import { labelOf } from './labels.ts';
import { SlotTable, transferList } from './slots.ts';

interface LayerState {
  table: SlotTable;
  abort: AbortController | null;
  latestSeq: number;
}

const layers = new Map<string, LayerState>();
const scope = self as unknown as { postMessage(m: FromWorker, t?: Transferable[]): void; onmessage: ((e: MessageEvent<ToWorker>) => void) | null };

function stateOf(layer: string): LayerState {
  let s = layers.get(layer);
  if (!s) {
    s = { table: new SlotTable(), abort: null, latestSeq: 0 };
    layers.set(layer, s);
  }
  return s;
}

function pack(snapshot: LayerSnapshot, table: SlotTable) {
  table.begin();
  const objs = snapshot.objects;
  for (let i = 0; i < objs.length; i++) {
    const o = objs[i]!;
    table.set(o.objectId, o.lon, o.lat, o.alt ?? 0, o.heading ?? Number.NaN, labelOf(o.props, o.objectId));
  }
  return table.end();
}

async function run(layer: string, seq: number, bbox: BBox | null, at: number | null) {
  const st = stateOf(layer);
  st.abort?.abort();
  const ctl = new AbortController();
  st.abort = ctl;
  st.latestSeq = seq;
  const t0 = performance.now();
  try {
    const snapshot = await fetchSnapshot(layer, { bbox, at }, ctl.signal);
    if (ctl.signal.aborted || st.latestSeq !== seq) return;
    const t1 = performance.now();
    const packet = pack(snapshot, st.table);
    const parseMs = performance.now() - t1;
    scope.postMessage(
      { type: 'update', layer, seq, at: snapshot.at, historical: snapshot.historical, feed: snapshot.feed, truncated: snapshot.truncated, received: snapshot.objects.length, packet, fetchMs: t1 - t0, parseMs },
      transferList(packet),
    );
  } catch (e) {
    if (isAbort(e) || ctl.signal.aborted || st.latestSeq !== seq) return;
    const err = e instanceof ApiRequestError ? e : new ApiRequestError('network', 0, e instanceof Error ? e.message : 'Request failed');
    scope.postMessage({ type: 'failed', layer, seq, failure: err.failure, status: err.status, message: err.message });
  } finally {
    if (st.abort === ctl) st.abort = null;
  }
}

scope.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') configureApi(m.api);
  else if (m.type === 'fetch') void run(m.layer, m.seq, m.bbox, m.at);
  else if (m.type === 'drop') {
    const st = layers.get(m.layer);
    if (!st) return;
    st.abort?.abort();
    st.latestSeq = -1;
    st.table.reset();
  }
};
