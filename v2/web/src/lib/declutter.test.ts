import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isNamedLabel, labelRect, mayLabel, selectLabels, type LabelCandidate, type Rect } from './declutter.ts';

const cand = (id: string, x: number, y: number, rank = 0, text = id, px = 20): LabelCandidate => ({ id, x, y, text, px, rank });

test('overlapping labels: the higher rank wins, the other is dropped', () => {
  const out = selectLabels([cand('a', 100, 100, 1, 'MAASVLAKTE'), cand('b', 110, 104, 5, 'EUROPOORT')], { cap: 10 });
  assert.deepEqual(out.map((c) => c.id), ['b']);
});

test('labels side by side without overlap are all kept', () => {
  const out = selectLabels([cand('a', 100, 100, 0, 'AAAA'), cand('b', 400, 100, 0, 'BBBB'), cand('c', 100, 300, 0, 'CCCC')], { cap: 10 });
  assert.equal(out.length, 3);
});

test('a label wide enough to reach the next marker blocks it', () => {
  const a = cand('a', 100, 100, 2, 'A VERY LONG VESSEL NAME');
  const r = labelRect(a.x, a.y, a.text, a.px);
  const b = cand('b', r.x + r.w - 10, 100, 1, 'X');
  assert.deepEqual(selectLabels([a, b], { cap: 10 }).map((c) => c.id), ['a']);
});

test('the cap holds, and occupied boxes block overlap', () => {
  const many = Array.from({ length: 50 }, (_, i) => cand(`n${i}`, 40 + (i % 10) * 300, 40 + Math.floor(i / 10) * 100, 50 - i));
  assert.equal(selectLabels(many, { cap: 7, perCell: 99 }).length, 7);
  const occupied = [labelRect(100, 100, 'SELECTED', 20)];
  const out = selectLabels([cand('x', 105, 102, 9, 'XX'), cand('y', 800, 600, 1, 'YY')], { cap: 3, occupied });
  assert.deepEqual(out.map((c) => c.id), ['y']);
  assert.equal(occupied.length, 2, 'the placed label is added to the shared list');
});

test('layers sharing one occupied list do not overlap each other', () => {
  const occupied: Rect[] = [];
  const ships = selectLabels([cand('ship', 300, 300, 1, 'NOORD')], { cap: 5, occupied });
  const planes = selectLabels([cand('plane', 310, 304, 1, 'KLM33K'), cand('plane2', 700, 500, 1, 'RYR1')], { cap: 5, occupied });
  assert.deepEqual(ships.map((c) => c.id), ['ship']);
  assert.deepEqual(planes.map((c) => c.id), ['plane2']);
});

test('density: at most perCell labels in one screen block', () => {
  // 30 labels in a staggered grid, none overlapping, all inside one 240 x 120 block is impossible, so use a larger block.
  const cs = Array.from({ length: 12 }, (_, i) => cand(`d${i}`, 10 + (i % 4) * 56, 10 + Math.floor(i / 4) * 20, 12 - i, 'Q', 10));
  const out = selectLabels(cs, { cap: 99, cellW: 400, cellH: 400, perCell: 4 });
  assert.equal(out.length, 4);
  assert.deepEqual(out.map((c) => c.id), ['d0', 'd1', 'd2', 'd3']);
});

test('equal ranks keep the caller order', () => {
  const out = selectLabels([cand('first', 100, 100), cand('second', 105, 100)], { cap: 5 });
  assert.deepEqual(out.map((c) => c.id), ['first']);
});

test('a dense harbour yields a bounded, non-overlapping set (selection, not clutter)', () => {
  const cs: LabelCandidate[] = [];
  for (let i = 0; i < 3000; i++) cs.push(cand(`s${i}`, 300 + ((i * 37) % 400), 300 + ((i * 91) % 300), (i * 7) % 13, `VESSEL ${i}`));
  const out = selectLabels(cs, { cap: 60 });
  assert.ok(out.length <= 60);
  assert.ok(out.length > 0);
  const rects = out.map((c) => labelRect(c.x, c.y, c.text, c.px));
  for (let i = 0; i < rects.length; i++)
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i]!;
      const b = rects[j]!;
      assert.ok(!(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h), `${i} and ${j} overlap`);
    }
  // default density: nothing beyond 3 per 260 x 150 block
  const blocks = new Map<string, number>();
  for (const r of rects) {
    const k = `${Math.floor((r.x + r.w / 2) / 260)},${Math.floor((r.y + r.h / 2) / 150)}`;
    blocks.set(k, (blocks.get(k) ?? 0) + 1);
  }
  for (const n of blocks.values()) assert.ok(n <= 3);
});

test('named labels: callsigns and names yes; ids, bare numbers and blanks no', () => {
  assert.equal(isNamedLabel('KLM959', '484b7f'), true);
  assert.equal(isNamedLabel('MAAS TRADER', '244620905'), true);
  assert.equal(isNamedLabel('244620905', '244620905'), false);
  assert.equal(isNamedLabel('244620905', 'x'), false);
  assert.equal(isNamedLabel('484b7f', '484b7f'), false);
  assert.equal(isNamedLabel('  ', 'x'), false);
});

test('numeric ids are labelled only very close or when selected', () => {
  assert.equal(mayLabel('244620905', '244620905', 150_000, false), false);
  assert.equal(mayLabel('244620905', '244620905', 2_000, false), true);
  assert.equal(mayLabel('244620905', '244620905', 150_000, true), true);
  assert.equal(mayLabel('MAAS TRADER', '244620905', 150_000, false), true);
});
