import type { FeedStatus, ObjectDetail } from '@gev/shared';
import type { ApiConfig } from '../../api/index.ts';
import { OrbitHub } from '../../data/orbitHub.ts';
import type { ActiveMessage, FromOrbitWorker, InspectedMessage, LoadedMessage, PositionsMessage, SelectedMessage } from '../../data/orbitProtocol.ts';
import { SATELLITE_PX } from '../../lib/featureStyle.ts';
import { CATEGORY_MAP_COLOR } from '../../lib/markerStyle.ts';
import { buildSatelliteDetail } from '../../lib/satDetail.ts';
import { LabelPool } from './labelPool.ts';
import type { ControllerHost, LayerController } from './host.ts';
import { markerCanvas } from './markers.ts';
import { PICK_SEP } from './pointLayer.ts';
import type { LayerRunState, LayerSpec } from './types.ts';
import { withAlpha } from './featureLayer.ts';

const LAYER = 'satellites';
const LABEL_MAX_ALTITUDE_M = 4_000_000;
const LABEL_CAP = 40;
const MARKER_SCALE = 0.36;
const RETRY_MS = 5_000;
const MAX_RETRY_MS = 60_000;

type Cartesian3 = import('cesium').Cartesian3;

/**
 * Satellites. The worker loads element sets, runs SGP4 and posts Earth-fixed
 * positions; this class only moves one billboard per satellite when a packet
 * arrives (about once a second), plus the selected satellite's orbit path.
 */
export class OrbitController implements LayerController {
  private readonly hub: OrbitHub;
  private spec: LayerSpec | null = null;
  private readonly billboards: import('cesium').BillboardCollection;
  private readonly labels: LabelPool;
  private readonly paths: import('cesium').PolylineCollection;
  private bySlot: import('cesium').Billboard[] = [];
  private ids: string[] = [];
  private names: string[] = [];
  private slotOfId = new Map<string, number>();
  private active: Uint32Array = new Uint32Array(0);
  private shownSlots = new Set<number>();
  private state: LayerRunState = emptyState();
  private groupName: string | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private failures = 0;
  private loading = false;
  private lastFeedSuccess: number | null = null;
  private selectedId: string | null = null;
  private pinnedId: string | null = null;
  private pending = new Map<number, { resolve: (d: ObjectDetail | null) => void; drawPath: boolean; noradId: string }>();
  private readonly scratch: Cartesian3;
  private destroyed = false;
  private readonly image: { key: string; canvas: HTMLCanvasElement };
  private readonly scaleByDistance: import('cesium').NearFarScalar;
  private orbits: NonNullable<LayerRunState['orbits']> = { groups: [], total: 0, shown: 0, oldestEpoch: null, newestEpoch: null };
  private readonly onVisibility = () => {
    this.hub.pause(document.hidden);
    if (!document.hidden && this.state.hasData === false) this.load();
  };

  constructor(
    private readonly host: ControllerHost,
    api: ApiConfig,
    bench: number,
  ) {
    const C = host.Cesium;
    this.hub = new OrbitHub(api, bench);
    this.hub.onMessage((m) => this.onMessage(m));
    this.billboards = host.scene.primitives.add(new C.BillboardCollection({ scene: host.scene, blendOption: C.BlendOption.TRANSLUCENT }));
    this.labels = new LabelPool(C, host.scene, LAYER);
    this.paths = host.scene.primitives.add(new C.PolylineCollection());
    this.scratch = new C.Cartesian3();
    this.scaleByDistance = new C.NearFarScalar(3e5, 1, 2.5e7, 0.5);
    this.image = markerCanvas('star', CATEGORY_MAP_COLOR.space);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  owns(layer: string): boolean {
    return layer === LAYER && this.spec !== null;
  }

  enable(spec: LayerSpec): void {
    if (this.spec || this.destroyed) return;
    this.spec = spec;
    this.state = emptyState();
    this.emit();
    this.hub.setTime(this.host.timeAt());
    this.hub.pause(document.hidden);
    this.load();
  }

  disable(layer: string): void {
    if (layer !== LAYER || !this.spec) return;
    this.spec = null;
    clearTimeout(this.timer);
    this.billboards.removeAll();
    this.bySlot = [];
    this.slotOfId.clear();
    this.shownSlots.clear();
    this.active = new Uint32Array(0);
    this.paths.removeAll();
    this.labels.show([]);
    this.hub.select(null);
    this.selectedId = this.pinnedId = null;
    this.host.emit(LAYER, null);
    this.host.scene.requestRender();
  }

  setTime(at: number | null): void {
    this.hub.setTime(at);
  }

  retry(): void {
    this.failures = 0;
    this.load();
  }

  setGroup(group: string | null): void {
    this.groupName = group;
    this.hub.setGroup(group);
  }

  noteFeed(feed: FeedStatus): void {
    // The server refreshed its element sets: fetch them again.
    if (!this.spec || feed.layer !== LAYER || feed.lastSuccess === null) return;
    if (this.lastFeedSuccess !== null && feed.lastSuccess > this.lastFeedSuccess && !this.loading) this.load();
  }

  positionOf(layer: string, objectId: string): Cartesian3 | undefined {
    if (layer !== LAYER) return undefined;
    const slot = this.slotOfId.get(objectId);
    const b = slot === undefined ? undefined : this.bySlot[slot];
    return b && b.show ? b.position : undefined;
  }

  sizeOf(): number {
    return SATELLITE_PX;
  }

  pin(sel: { layer: string; objectId: string } | null): void {
    this.pinnedId = sel && sel.layer === LAYER ? sel.objectId : null;
  }

  /** Select a satellite (or none): the worker propagates it faster and its orbit path is drawn once described. */
  select(noradId: string | null): void {
    this.selectedId = noradId;
    this.paths.removeAll();
    this.hub.select(noradId);
    this.host.scene.requestRender();
  }

  /**
   * Detail for the panel, built from the worker's answer. `drawPath` also draws the
   * orbit path (on select and when the viewed time changes, not on every refresh).
   */
  describe(noradId: string, drawPath: boolean): Promise<ObjectDetail | null> {
    return new Promise((resolve) => {
      const reqId = this.hub.inspect(noradId);
      this.pending.set(reqId, { resolve, drawPath, noradId });
    });
  }

  updateLabels(center: Cartesian3 | null, altitude: number): void {
    if (!this.spec) return;
    const items: Array<{ id: string; text: string; position: Cartesian3; px: number; d: number }> = [];
    const pinned = this.pinnedId;
    if (center && altitude < LABEL_MAX_ALTITUDE_M) {
      for (const slot of this.shownSlots) {
        const b = this.bySlot[slot]!;
        const id = this.ids[slot]!;
        if (id === pinned || !b.show) continue;
        const p = b.position;
        const d = p.x * center.x + p.y * center.y + p.z * center.z;
        if (items.length < LABEL_CAP) items.push({ id, text: this.names[slot] ?? id, position: p, px: SATELLITE_PX, d });
        else {
          let wi = 0;
          for (let i = 1; i < items.length; i++) if (items[i]!.d < items[wi]!.d) wi = i;
          if (d > items[wi]!.d) items[wi] = { id, text: this.names[slot] ?? id, position: p, px: SATELLITE_PX, d };
        }
      }
    }
    if (pinned) {
      const slot = this.slotOfId.get(pinned);
      const b = slot === undefined ? undefined : this.bySlot[slot];
      if (slot !== undefined && b && b.show) items.push({ id: pinned, text: this.names[slot] ?? pinned, position: b.position, px: SATELLITE_PX, d: 0 });
    }
    this.labels.show(items);
  }

  busy(): boolean {
    return this.loading;
  }

  destroy(): void {
    this.destroyed = true;
    clearTimeout(this.timer);
    document.removeEventListener('visibilitychange', this.onVisibility);
    const scene = this.host.scene;
    scene.primitives.remove(this.billboards);
    scene.primitives.remove(this.paths);
    this.labels.destroy();
    this.hub.destroy();
    for (const p of this.pending.values()) p.resolve(null);
    this.pending.clear();
  }

  // --- internals

  private emit(): void {
    if (!this.spec) return;
    this.host.emit(LAYER, { ...this.state, orbits: { ...this.orbits } });
  }

  private load(): void {
    clearTimeout(this.timer);
    if (this.destroyed || !this.spec) return;
    this.loading = true;
    this.hub.load();
  }

  private scheduleRetry(): void {
    clearTimeout(this.timer);
    if (this.destroyed || !this.spec || document.hidden) return;
    const delay = Math.min(MAX_RETRY_MS, RETRY_MS * 2 ** Math.min(this.failures, 4));
    this.timer = setTimeout(() => this.load(), delay);
  }

  private onMessage(m: FromOrbitWorker): void {
    if (!this.spec) {
      if (m.type === 'inspected') this.pending.get(m.reqId)?.resolve(null);
      return;
    }
    switch (m.type) {
      case 'loaded':
        return this.onLoaded(m);
      case 'failed':
        this.loading = false;
        this.failures++;
        this.state = { ...this.state, phase: 'error', error: { failure: m.failure, message: m.message } };
        this.emit();
        this.scheduleRetry();
        return;
      case 'active':
        return this.onActive(m);
      case 'positions':
        return this.onPositions(m);
      case 'selected':
        return this.onSelected(m);
      case 'inspected':
        return this.onInspected(m);
    }
  }

  private onLoaded(m: LoadedMessage): void {
    const t0 = performance.now();
    this.loading = false;
    this.lastFeedSuccess = m.feed.lastSuccess;
    this.ids = m.ids === '' ? [] : m.ids.split('\n');
    this.names = m.names === '' ? [] : m.names.split('\n');
    this.slotOfId = new Map(this.ids.map((id, i) => [id, i]));
    // One billboard per element set, hidden until the worker says it is active.
    const C = this.host.Cesium;
    this.billboards.removeAll();
    this.bySlot = new Array(this.ids.length);
    this.shownSlots.clear();
    for (let i = 0; i < this.ids.length; i++) {
      const b = this.billboards.add({ position: C.Cartesian3.ZERO, scale: MARKER_SCALE, scaleByDistance: this.scaleByDistance, show: false });
      b.setImage(this.image.key, this.image.canvas);
      b.id = LAYER + PICK_SEP + this.ids[i];
      this.bySlot[i] = b;
    }
    this.orbits = { groups: m.groups, total: m.total, shown: 0, oldestEpoch: m.oldestEpoch, newestEpoch: m.newestEpoch };
    const hasData = m.total > 0;
    this.state = { phase: 'ready', hasData, feed: m.feed, truncated: false, at: null, historical: this.host.timeAt() !== null, drawn: m.total, error: null };
    this.emit();
    this.host.metric({ layer: LAYER, received: m.total, written: m.total, applyMs: performance.now() - t0, fetchMs: m.fetchMs, parseMs: m.initMs });
    if (hasData) this.failures = 0;
    else {
      // The server has no element sets yet: ask again soon.
      this.failures++;
      this.scheduleRetry();
    }
    if (this.groupName !== null && !m.groups.some((g) => g.name === this.groupName)) this.setGroup(null);
    else if (this.groupName !== null) this.hub.setGroup(this.groupName);
  }

  private onActive(m: ActiveMessage): void {
    this.active = m.indices;
    const keep = new Set<number>(m.indices);
    for (const slot of this.shownSlots) if (!keep.has(slot)) this.bySlot[slot]!.show = false;
    this.shownSlots = keep;
    this.orbits = { ...this.orbits, shown: m.indices.length };
    this.emit();
  }

  private onPositions(m: PositionsMessage): void {
    const t0 = performance.now();
    const act = this.active;
    if (m.xyz.length !== 3 * act.length) return; // a stale packet from before a group change
    const s = this.scratch;
    const bb = this.bySlot;
    for (let k = 0; k < act.length; k++) {
      const x = m.xyz[3 * k]!;
      const b = bb[act[k]!]!;
      if (x !== x) {
        b.show = false;
        continue;
      }
      s.x = x;
      s.y = m.xyz[3 * k + 1]!;
      s.z = m.xyz[3 * k + 2]!;
      b.position = s;
      b.show = true;
    }
    this.host.moved(LAYER);
    this.host.scene.requestRender();
    this.host.metric({ layer: LAYER, received: act.length, written: act.length, applyMs: performance.now() - t0, fetchMs: m.ms, parseMs: 0 });
  }

  private onSelected(m: SelectedMessage): void {
    if (m.noradId !== this.selectedId) return;
    const slot = this.slotOfId.get(m.noradId);
    const b = slot === undefined ? undefined : this.bySlot[slot];
    if (!b) return;
    const s = this.scratch;
    s.x = m.xyz[0]!;
    s.y = m.xyz[1]!;
    s.z = m.xyz[2]!;
    b.position = s;
    this.host.moved(LAYER);
    this.host.scene.requestRender();
  }

  private onInspected(m: InspectedMessage): void {
    const p = this.pending.get(m.reqId);
    if (!p) return;
    this.pending.delete(m.reqId);
    if (p.drawPath && p.noradId === this.selectedId) this.drawPath(m.path, m.nowIndex);
    p.resolve(m.elements ? buildSatelliteDetail(m.elements, m.state, m.t, Date.now()) : null);
  }

  /** Past part dimmer, future part brighter; both in the space hue. */
  private drawPath(xyz: Float64Array, nowIndex: number): void {
    this.paths.removeAll();
    const C = this.host.Cesium;
    const n = xyz.length / 3;
    if (n < 3) return;
    const seg = (a: number, b: number, alpha: number, width: number) => {
      if (b - a < 2) return;
      const positions: Cartesian3[] = [];
      for (let i = a; i < b; i++) positions.push(new C.Cartesian3(xyz[3 * i]!, xyz[3 * i + 1]!, xyz[3 * i + 2]!));
      this.paths.add({
        positions,
        width,
        material: C.Material.fromType('Color', { color: C.Color.fromCssColorString(withAlpha(CATEGORY_MAP_COLOR.space, alpha)) }),
      });
    };
    seg(0, nowIndex + 1, 0.4, 2);
    seg(nowIndex, n, 0.95, 2.5);
    this.host.scene.requestRender();
  }
}

function emptyState(): LayerRunState {
  return { phase: 'loading', hasData: false, feed: null, truncated: false, at: null, historical: false, drawn: 0, error: null };
}
