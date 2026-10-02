import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lonLatAltToEcef } from '../lib/geo.ts';
import { SlotMirror, SlotTable, transferList, type UpsertSink } from './slots.ts';

interface Obj {
  id: string;
  lon: number;
  lat: number;
  alt?: number;
  heading?: number;
  label?: string;
}

function snapshot(table: SlotTable, objs: Obj[]) {
  table.begin();
  for (const o of objs) table.set(o.id, o.lon, o.lat, o.alt ?? 0, o.heading ?? Number.NaN, o.label ?? o.id);
  return table.end();
}

class Recorder implements UpsertSink {
  upserts: Array<{ slot: number; created: boolean; x: number; y: number; z: number; h: number }> = [];
  removes: number[] = [];
  upsert(slot: number, created: boolean, x: number, y: number, z: number, h: number) {
    this.upserts.push({ slot, created, x, y, z, h });
  }
  remove(slot: number) {
    this.removes.push(slot);
  }
}

test('first snapshot: everything is new, with ids and labels', () => {
  const t = new SlotTable();
  const p = snapshot(t, [
    { id: 'a1', lon: 10, lat: 20, heading: 90, label: 'AAL1' },
    { id: 'b2', lon: -30, lat: 5, label: 'BAW2' },
  ]);
  assert.equal(p.slots.length, 2);
  assert.deepEqual([...p.isNew], [1, 1]);
  assert.equal(p.newIds, 'a1\nb2');
  assert.equal(p.labels, 'AAL1\nBAW2');
  assert.equal(p.alive, 2);
  assert.equal(p.removed.length, 0);
  assert.equal(p.heading[0], 90);
  assert.ok(Number.isNaN(p.heading[1]!));
  const expected = new Float64Array(3);
  lonLatAltToEcef(10, 20, 0, expected);
  assert.deepEqual([...p.xyz.slice(0, 3)], [...expected]);
});

test('second snapshot only carries changes, removals and new objects', () => {
  const t = new SlotTable();
  const first = snapshot(t, [
    { id: 'a', lon: 0, lat: 0 },
    { id: 'b', lon: 1, lat: 1 },
    { id: 'c', lon: 2, lat: 2 },
  ]);
  const slotOfB = first.slots[1]!;
  const second = snapshot(t, [
    { id: 'a', lon: 0, lat: 0 }, // unchanged
    { id: 'b', lon: 1.5, lat: 1 }, // moved
    { id: 'd', lon: 3, lat: 3 }, // new; c dropped
  ]);
  assert.equal(second.alive, 3);
  assert.equal(second.removed.length, 1);
  assert.equal(second.slots.length, 2);
  assert.ok(second.slots.includes(slotOfB));
  assert.equal(second.newIds, 'd');
  assert.equal(second.removed[0], first.slots[2]); // c's slot is freed...
  const third = snapshot(t, [{ id: 'a', lon: 0, lat: 0 }, { id: 'b', lon: 1.5, lat: 1 }, { id: 'd', lon: 3, lat: 3 }, { id: 'e', lon: 4, lat: 4 }]);
  assert.equal(third.slots[0], first.slots[2]); // ...and reused by the next new object
  assert.equal(second.labelSlots.length, 1); // only d's label is new
});

test('identical snapshot produces an empty update', () => {
  const t = new SlotTable();
  const objs = [{ id: 'a', lon: 5, lat: 5, heading: 10 }, { id: 'b', lon: 6, lat: 6 }];
  snapshot(t, objs);
  const p = snapshot(t, objs);
  assert.equal(p.slots.length, 0);
  assert.equal(p.removed.length, 0);
  assert.equal(p.alive, 2);
});

test('a heading or label change alone is reported', () => {
  const t = new SlotTable();
  snapshot(t, [{ id: 'a', lon: 5, lat: 5, heading: 10, label: 'X' }]);
  const p = snapshot(t, [{ id: 'a', lon: 5, lat: 5, heading: 11, label: 'Y' }]);
  assert.equal(p.slots.length, 1);
  assert.equal(p.isNew[0], 0);
  assert.equal(p.labels, 'Y');
});

test('newlines inside labels cannot corrupt the packing', () => {
  const t = new SlotTable();
  const p = snapshot(t, [{ id: 'a', lon: 0, lat: 0, label: 'two\nlines' }, { id: 'b', lon: 1, lat: 1, label: 'ok' }]);
  assert.equal(p.labels.split('\n').length, 2);
});

test('mirror stays consistent with the table over a random sequence', () => {
  const t = new SlotTable();
  const m = new SlotMirror();
  const rec = new Recorder();
  let seed = 7;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  for (let round = 0; round < 40; round++) {
    const objs: Obj[] = [];
    for (let i = 0; i < 300; i++) if (rnd() < 0.7) objs.push({ id: `id${i}`, lon: rnd() * 360 - 180, lat: rnd() * 160 - 80, heading: rnd() * 360, label: `L${i}` });
    const p = snapshot(t, objs);
    m.apply(p, rec);
    assert.equal(m.alive, objs.length);
    assert.equal(m.slotById.size, objs.length);
    for (const o of objs) {
      const slot = m.slotById.get(o.id);
      assert.notEqual(slot, undefined);
      assert.equal(m.idBySlot[slot!], o.id);
      assert.equal(m.labelBySlot[slot!], o.label);
    }
    // slots are dense: never more slots than the peak object count
    assert.ok(Math.max(...m.slotById.values(), 0) < 300);
  }
});

test('packets can be transferred without copying', () => {
  const t = new SlotTable();
  const p = snapshot(t, [{ id: 'a', lon: 0, lat: 0 }]);
  const list = transferList(p);
  assert.equal(list.length, 6);
  assert.ok(list.every((b) => b instanceof ArrayBuffer));
});

test('reset makes the next snapshot all new', () => {
  const t = new SlotTable();
  snapshot(t, [{ id: 'a', lon: 0, lat: 0 }]);
  t.reset();
  const p = snapshot(t, [{ id: 'a', lon: 0, lat: 0 }]);
  assert.equal(p.isNew[0], 1);
});
