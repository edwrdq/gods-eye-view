import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LivePicture, pickProps, type LivePictureOptions } from './live-picture.ts';
import { clock, obs } from './test-utils.ts';

function make(over: Partial<LivePictureOptions> = {}) {
  const c = clock(0);
  const pic = new LivePicture({
    timeoutMs: 10_000,
    maxObjects: 100,
    throttle: { minIntervalMs: 60_000, minMoveM: 1_000, minHeadingDeg: 15 },
    now: c.now,
    compactProps: (p) => pickProps(p, ['keep']),
    ...over,
  });
  return { pic, c };
}

test('first observation of an object is always queued for history', () => {
  const { pic } = make();
  assert.ok(pic.upsert(obs({ t: 0 })));
  assert.equal(pic.takePending().length, 1);
  assert.equal(pic.takePending().length, 0);
});

test('throttle: skipped when recent, close and straight; kept on time, distance or turn', () => {
  const { pic } = make();
  pic.upsert(obs({ t: 0, lon: 10, lat: 20, heading: 90 }));
  pic.takePending();
  // 30 s later, 100 m away, 5 degrees of turn: skipped
  pic.upsert(obs({ t: 30_000, lon: 10.001, lat: 20, heading: 95 }));
  assert.equal(pic.takePending().length, 0);
  // the live picture still holds the newest observation
  assert.equal(pic.get('abc123')!.t, 30_000);
  // 30 s after that: 60 s since last *stored* point -> stored
  pic.upsert(obs({ t: 60_000, lon: 10.001, lat: 20, heading: 95 }));
  assert.equal(pic.takePending().length, 1);
  // moved ~1.1 km within 10 s
  pic.upsert(obs({ t: 70_000, lon: 10.001 + 0.0105, lat: 20, heading: 95 }));
  assert.equal(pic.takePending().length, 1);
  // 20 degree turn within 5 s, no movement
  pic.upsert(obs({ t: 75_000, lon: 10.0116, lat: 20, heading: 115 }));
  assert.equal(pic.takePending().length, 1);
  // 10 degree turn (shortest way around 0/360) within 5 s: skipped
  pic.upsert(obs({ t: 80_000, lon: 10.0116, lat: 20, heading: 125 }));
  assert.equal(pic.takePending().length, 0);
});

test('throttle compares against the last stored point, not the last seen one', () => {
  const { pic } = make();
  pic.upsert(obs({ t: 0, lon: 0, lat: 0 }));
  pic.takePending();
  // Creeping 400 m per step: never exceeds 1 km from the previous step, but does from the stored point.
  let stored = 0;
  for (let i = 1; i <= 4; i++) {
    pic.upsert(obs({ t: i * 1000, lon: i * 0.0036, lat: 0 }));
    stored += pic.takePending().length;
  }
  assert.equal(stored, 1);
});

test('stored rows carry compact props; the live map keeps the full set', () => {
  const { pic } = make();
  pic.upsert(obs({ props: { keep: 1, drop: 2 } }));
  assert.deepEqual(pic.takePending()[0]!.props, { keep: 1 });
  assert.deepEqual(pic.get('abc123')!.props, { keep: 1, drop: 2 });
  assert.deepEqual(pic.query({ limit: 10 }).objects[0]!.props, { keep: 1 });
});

test('older observations are ignored', () => {
  const { pic } = make();
  pic.upsert(obs({ t: 5000, lon: 1 }));
  assert.equal(pic.upsert(obs({ t: 4000, lon: 2 })), false);
  assert.equal(pic.get('abc123')!.lon, 1);
});

test('objects expire after the timeout, measured from last update', () => {
  const { pic, c } = make();
  pic.upsert(obs({ objectId: 'a' }));
  c.advance(6000);
  pic.upsert(obs({ objectId: 'b', t: 2000 }));
  c.advance(5000); // a is 11 s old, b is 5 s old
  assert.deepEqual(pic.expire(), ['a']);
  assert.equal(pic.size, 1);
  // refreshing a surviving object keeps it alive
  c.advance(4000);
  pic.upsert(obs({ objectId: 'b', t: 3000 }));
  c.advance(6000);
  assert.deepEqual(pic.expire(), []);
  c.advance(5000);
  assert.deepEqual(pic.expire(), ['b']);
});

test('maxObjects evicts the least recently updated', () => {
  const { pic, c } = make({ maxObjects: 3 });
  for (const id of ['a', 'b', 'c']) {
    pic.upsert(obs({ objectId: id }));
    c.advance(1);
  }
  pic.upsert(obs({ objectId: 'a', t: 2000 })); // refresh a -> b is now oldest
  pic.upsert(obs({ objectId: 'd' }));
  assert.equal(pic.size, 3);
  assert.equal(pic.get('b'), undefined);
  assert.ok(pic.get('a') && pic.get('c') && pic.get('d'));
});

test('query filters by bbox (incl. antimeridian), include, and truncates at limit', () => {
  const { pic } = make();
  pic.upsert(obs({ objectId: 'w', lon: 179, lat: 0 }));
  pic.upsert(obs({ objectId: 'e', lon: -179, lat: 0 }));
  pic.upsert(obs({ objectId: 'm', lon: 0, lat: 0, props: { keep: 'mil' } }));
  assert.deepEqual(
    pic.query({ bbox: [170, -10, -170, 10], limit: 10 }).objects.map((o) => o.objectId).sort(),
    ['e', 'w'],
  );
  assert.deepEqual(pic.query({ bbox: [-10, -10, 10, 10], limit: 10 }).objects.map((o) => o.objectId), ['m']);
  assert.deepEqual(
    pic.query({ include: (o) => o.props.keep === 'mil', limit: 10 }).objects.map((o) => o.objectId),
    ['m'],
  );
  const capped = pic.query({ limit: 2 });
  assert.equal(capped.objects.length, 2);
  assert.equal(capped.truncated, true);
  assert.equal(pic.query({ limit: 3 }).truncated, false);
});

test('patchProps merges without queuing history and refreshes the compact form', () => {
  const { pic } = make();
  pic.upsert(obs());
  pic.takePending();
  assert.ok(pic.patchProps('abc123', { keep: 'x', other: 1 }));
  assert.equal(pic.pendingCount, 0);
  assert.deepEqual(pic.query({ limit: 1 }).objects[0]!.props, { keep: 'x' });
  assert.equal(pic.patchProps('nope', { a: 1 }), false);
});

test('requeue restores rows ahead of newer ones', () => {
  const { pic } = make();
  pic.upsert(obs({ objectId: 'a' }));
  const first = pic.takePending();
  pic.upsert(obs({ objectId: 'b' }));
  pic.requeue(first);
  assert.deepEqual(pic.takePending().map((o) => o.objectId), ['a', 'b']);
});

test('pending queue is bounded', () => {
  const { pic } = make({ maxPending: 5, maxObjects: 1000 });
  for (let i = 0; i < 20; i++) pic.upsert(obs({ objectId: `o${i}` }));
  assert.equal(pic.pendingCount, 5);
  assert.equal(pic.takePending()[4]!.objectId, 'o19');
});

test('idle objects use the idle interval and ignore heading jitter', () => {
  const { pic } = make({ throttle: { minIntervalMs: 60_000, minMoveM: 1_000, minHeadingDeg: 15, idleSpeedMps: 1, idleIntervalMs: 600_000 } });
  pic.upsert(obs({ t: 0, speed: 0, heading: 10 }));
  pic.takePending();
  pic.upsert(obs({ t: 120_000, speed: 0.2, heading: 200 })); // 2 min, wild heading, parked
  assert.equal(pic.takePending().length, 0);
  pic.upsert(obs({ t: 600_000, speed: 0.2, heading: 200 }));
  assert.equal(pic.takePending().length, 1);
  pic.upsert(obs({ t: 660_000, speed: 5, heading: 200 })); // now moving: normal 60 s rule
  assert.equal(pic.takePending().length, 1);
  pic.upsert(obs({ t: 700_000, speed: 0.2, lon: 11, heading: 200 })); // moved > 1 km: always stored
  assert.equal(pic.takePending().length, 1);
});
