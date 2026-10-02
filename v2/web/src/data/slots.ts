import { lonLatAltToEcef } from '../lib/geo.ts';

/**
 * Worker-side table that gives every object a stable numeric slot and turns each
 * snapshot into a compact update: only new or changed slots travel to the main
 * thread, as typed arrays. The main thread mirrors the table with `SlotMirror`.
 */

export interface UpdatePacket {
  /** Slots that are new or changed since the previous snapshot. */
  slots: Uint32Array;
  /** Earth-fixed x, y, z in metres per entry of `slots`. */
  xyz: Float64Array;
  /** Degrees clockwise from north per entry of `slots`; NaN when unknown. */
  heading: Float32Array;
  /** 1 when the entry's slot was newly assigned (its id is next in `newIds`). */
  isNew: Uint8Array;
  /** Ids of the new entries, in order, joined with "\n". */
  newIds: string;
  /** Slots whose label is new or changed, with the labels joined with "\n". */
  labelSlots: Uint32Array;
  labels: string;
  /** Slots that left the snapshot. */
  removed: Uint32Array;
  /** Objects present after this update. */
  alive: number;
}

const SEP = '\n';
const clean = (s: string) => (s.includes(SEP) ? s.replaceAll(SEP, ' ') : s);

export class SlotTable {
  private slotOf = new Map<string, number>();
  private ids: string[] = [];
  private xyz = new Float64Array(3 * 1024);
  private heading = new Float32Array(1024);
  private labels: string[] = [];
  private seen = new Uint32Array(1024);
  private free: number[] = [];
  private next = 0;
  private epoch = 0;
  private scratch = new Float64Array(3);
  private changed: number[] = [];
  private changedNew: number[] = [];
  private newIdList: string[] = [];
  private labelSlotList: number[] = [];
  private labelList: string[] = [];

  get size(): number {
    return this.slotOf.size;
  }

  /** Start a new snapshot. */
  begin(): void {
    this.epoch++;
    this.changed.length = 0;
    this.changedNew.length = 0;
    this.newIdList.length = 0;
    this.labelSlotList.length = 0;
    this.labelList.length = 0;
  }

  private grow(min: number): void {
    let cap = this.heading.length;
    while (cap < min) cap *= 2;
    const xyz = new Float64Array(3 * cap);
    xyz.set(this.xyz);
    this.xyz = xyz;
    const heading = new Float32Array(cap);
    heading.set(this.heading);
    this.heading = heading;
    const seen = new Uint32Array(cap);
    seen.set(this.seen);
    this.seen = seen;
  }

  /** Record one object of the snapshot. `headingDeg` NaN means unknown. */
  set(id: string, lon: number, lat: number, alt: number, headingDeg: number, label: string): void {
    let slot = this.slotOf.get(id);
    const isNew = slot === undefined;
    if (slot === undefined) {
      slot = this.free.pop() ?? this.next++;
      if (slot >= this.heading.length) this.grow(slot + 1);
      this.slotOf.set(id, slot);
      this.ids[slot] = id;
    }
    lonLatAltToEcef(lon, lat, alt, this.scratch);
    const s = this.scratch;
    const o = slot * 3;
    const h = Math.fround(headingDeg);
    const lbl = clean(label);
    this.seen[slot] = this.epoch;
    const same =
      !isNew &&
      this.xyz[o] === s[0] &&
      this.xyz[o + 1] === s[1] &&
      this.xyz[o + 2] === s[2] &&
      (this.heading[slot] === h || (Number.isNaN(h) && Number.isNaN(this.heading[slot]!)));
    if (isNew || this.labels[slot] !== lbl) {
      this.labels[slot] = lbl;
      this.labelSlotList.push(slot);
      this.labelList.push(lbl);
    }
    if (same) return;
    this.xyz[o] = s[0]!;
    this.xyz[o + 1] = s[1]!;
    this.xyz[o + 2] = s[2]!;
    this.heading[slot] = h;
    this.changed.push(slot);
    this.changedNew.push(isNew ? 1 : 0);
    if (isNew) this.newIdList.push(id);
  }

  /** Finish the snapshot: drop objects that were not seen and build the packet. */
  end(): UpdatePacket {
    const removed: number[] = [];
    for (const [id, slot] of this.slotOf) {
      if (this.seen[slot] === this.epoch) continue;
      this.slotOf.delete(id);
      this.ids[slot] = '';
      this.labels[slot] = '';
      this.free.push(slot);
      removed.push(slot);
    }
    const k = this.changed.length;
    const slots = Uint32Array.from(this.changed);
    const xyz = new Float64Array(3 * k);
    const heading = new Float32Array(k);
    for (let i = 0; i < k; i++) {
      const slot = slots[i]!;
      xyz[3 * i] = this.xyz[3 * slot]!;
      xyz[3 * i + 1] = this.xyz[3 * slot + 1]!;
      xyz[3 * i + 2] = this.xyz[3 * slot + 2]!;
      heading[i] = this.heading[slot]!;
    }
    return {
      slots,
      xyz,
      heading,
      isNew: Uint8Array.from(this.changedNew),
      newIds: this.newIdList.join(SEP),
      labelSlots: Uint32Array.from(this.labelSlotList),
      labels: this.labelList.join(SEP),
      removed: Uint32Array.from(removed),
      alive: this.slotOf.size,
    };
  }

  /** Forget everything (layer turned off): the next snapshot is all new. */
  reset(): void {
    this.slotOf.clear();
    this.ids.length = 0;
    this.labels.length = 0;
    this.free.length = 0;
    this.next = 0;
    this.seen.fill(0);
    this.epoch = 0;
  }
}

/** Buffers to hand to postMessage so they move instead of being copied. */
export function transferList(p: UpdatePacket): ArrayBuffer[] {
  return [p.slots.buffer, p.xyz.buffer, p.heading.buffer, p.isNew.buffer, p.labelSlots.buffer, p.removed.buffer] as ArrayBuffer[];
}

export interface UpsertSink {
  /** `created` is true when the slot was just assigned to `id`. */
  upsert(slot: number, created: boolean, x: number, y: number, z: number, headingDeg: number): void;
  remove(slot: number): void;
}

/** Main-thread mirror of the worker's slot table: slot to id, id to slot, slot to label. */
export class SlotMirror {
  readonly idBySlot: string[] = [];
  readonly labelBySlot: string[] = [];
  readonly slotById = new Map<string, number>();
  alive = 0;

  apply(p: UpdatePacket, sink: UpsertSink): void {
    for (let i = 0; i < p.removed.length; i++) {
      const slot = p.removed[i]!;
      const id = this.idBySlot[slot];
      if (id !== undefined) this.slotById.delete(id);
      this.idBySlot[slot] = '';
      this.labelBySlot[slot] = '';
      sink.remove(slot);
    }
    const ids = p.newIds === '' ? [] : p.newIds.split(SEP);
    let nextId = 0;
    for (let i = 0; i < p.slots.length; i++) {
      const slot = p.slots[i]!;
      const created = p.isNew[i] === 1;
      if (created) {
        const id = ids[nextId++] ?? '';
        this.idBySlot[slot] = id;
        this.slotById.set(id, slot);
      }
      sink.upsert(slot, created, p.xyz[3 * i]!, p.xyz[3 * i + 1]!, p.xyz[3 * i + 2]!, p.heading[i]!);
    }
    if (p.labelSlots.length > 0) {
      const labels = p.labels.split(SEP);
      for (let i = 0; i < p.labelSlots.length; i++) this.labelBySlot[p.labelSlots[i]!] = labels[i] ?? '';
    }
    this.alive = p.alive;
  }

  clear(): void {
    this.idBySlot.length = 0;
    this.labelBySlot.length = 0;
    this.slotById.clear();
    this.alive = 0;
  }
}
