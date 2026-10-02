import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildTle, synthElements, tleChecksum } from '../lib/tle.ts';
import { ecefToGeodetic, gmstAt, julianDate, makeSatrec, minutesSinceEpoch, orbitPath, propagateAll, propagateTeme, stateAt, temeToEcefM } from './sgp4.ts';

// Vallado's SGP4 verification case, satellite 00005, from SGP4-VER.TLE / tcppver.out:
// at 0 min since epoch: r = 7022.46529266 -1400.08296755 0.03995155 km, v = 1.893841015 6.405893759 4.534807250 km/s.
const L1 = '1 00005U 58002B   00179.78495062  .00000023  00000-0  28098-4 0  4753';
const L2 = '2 00005  34.2682 348.7242 1859667 331.7664  19.3264 10.82419157413667';

const epochMsOf = (jdsatepoch: number) => (jdsatepoch - 2_440_587.5) * 86_400_000;

test('known TLE at its epoch matches the published SGP4 position and velocity', () => {
  const sat = makeSatrec(L1, L2)!;
  assert.ok(sat);
  const jd = sat.jdsatepoch;
  assert.equal(minutesSinceEpoch(sat, jd), 0);
  const r = propagateTeme(sat, jd)!;
  assert.ok(Math.abs(r.x - 7022.46529266) < 1e-4, `x ${r.x}`);
  assert.ok(Math.abs(r.y - -1400.08296755) < 1e-4, `y ${r.y}`);
  assert.ok(Math.abs(r.z - 0.03995155) < 1e-4, `z ${r.z}`);
  assert.ok(Math.abs(r.vx - 1.893841015) < 1e-6);
  assert.ok(Math.abs(r.vy - 6.405893759) < 1e-6);
  assert.ok(Math.abs(r.vz - 4.53480725) < 1e-6);
});

test('the same case 360 minutes later (published 2.4 km-class drift check)', () => {
  const sat = makeSatrec(L1, L2)!;
  const r = propagateTeme(sat, sat.jdsatepoch + 360 / 1440)!;
  // tcppver.out, 360.00000000 min: -7154.03120202 -3783.17682504 -3536.19412294 km.
  assert.ok(Math.abs(r.x - -7154.03120202) < 1e-3, `x ${r.x}`);
  assert.ok(Math.abs(r.y - -3783.17682504) < 1e-3, `y ${r.y}`);
  assert.ok(Math.abs(r.z - -3536.19412294) < 1e-3, `z ${r.z}`);
});

test('TEME to Earth-fixed is a rotation about z by the sidereal angle', () => {
  const sat = makeSatrec(L1, L2)!;
  const jd = sat.jdsatepoch;
  const teme = propagateTeme(sat, jd)!;
  const out = new Float64Array(3);
  temeToEcefM(teme, gmstAt(jd), out, 0);
  assert.ok(Math.abs(Math.hypot(out[0]!, out[1]!, out[2]!) - Math.hypot(teme.x, teme.y, teme.z) * 1000) < 1e-3, 'length is preserved');
  assert.ok(Math.abs(out[2]! - teme.z * 1000) < 1e-6, 'z is untouched');
});

test('ecefToGeodetic inverts the WGS84 forward transform', () => {
  const A = 6_378_137;
  const e2 = 0.0066943799901413165;
  const cases = [
    { lon: 12.5, lat: 41.9, alt: 400_000 },
    { lon: -120, lat: -33, alt: 0 },
    { lon: 179.9, lat: 89, alt: 20_000_000 },
    { lon: 0, lat: 0, alt: 35_786_000 },
  ];
  for (const c of cases) {
    const lat = (c.lat * Math.PI) / 180;
    const lon = (c.lon * Math.PI) / 180;
    const n = A / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
    const x = (n + c.alt) * Math.cos(lat) * Math.cos(lon);
    const y = (n + c.alt) * Math.cos(lat) * Math.sin(lon);
    const z = (n * (1 - e2) + c.alt) * Math.sin(lat);
    const g = ecefToGeodetic(x, y, z);
    assert.ok(Math.abs(g.lon - c.lon) < 1e-6, `lon ${g.lon}`);
    assert.ok(Math.abs(g.lat - c.lat) < 1e-6, `lat ${g.lat}`);
    assert.ok(Math.abs(g.alt - c.alt) < 0.01, `alt ${g.alt}`);
  }
});

test('a real ISS element set gives an ISS-like altitude and speed', () => {
  // CelesTrak stations, epoch 2026-10-02 00:19Z.
  const sat = makeSatrec(
    '1 25544U 98067A   26275.01380287  .00003738  00000+0  76743-4 0  9992',
    '2 25544  51.6312 131.4121 0006946 211.9293 148.1275 15.48707684588318',
  )!;
  assert.ok(sat);
  const t = epochMsOf(sat.jdsatepoch) + 3 * 3_600_000;
  const s = stateAt(sat, t)!;
  assert.ok(s.alt > 380_000 && s.alt < 450_000, `altitude ${s.alt}`);
  assert.ok(s.speedKms > 7.5 && s.speedKms < 7.8, `speed ${s.speedKms}`);
  assert.ok(Math.abs(s.lat) <= 51.7);
  assert.ok(Math.abs(Math.hypot(...s.ecef) - (6_371_000 + s.alt)) < 25_000, 'radius is Earth plus altitude');
});

test('propagateAll writes aligned positions and NaN for records that fail', () => {
  const good = makeSatrec(L1, L2)!;
  const sats = [good, null, good];
  const out = new Float64Array(9);
  const failed = propagateAll(sats, Uint32Array.from([0, 1, 2]), epochMsOf(good.jdsatepoch), out);
  assert.equal(failed, 1);
  assert.ok(Number.isFinite(out[0]!) && Number.isNaN(out[3]!) && Number.isFinite(out[6]!));
  assert.deepEqual([...out.slice(0, 3)], [...out.slice(6, 9)]);
  // A subset addresses by element index.
  const sub = new Float64Array(3);
  propagateAll(sats, Uint32Array.from([2]), epochMsOf(good.jdsatepoch), sub);
  assert.deepEqual([...sub], [...out.slice(6, 9)]);
});

test('orbit path spans one period either side, with the current position at nowIndex', () => {
  const sat = makeSatrec(L1, L2)!;
  const t = epochMsOf(sat.jdsatepoch) + 90 * 60_000;
  const periodMin = 1440 / 10.82419157;
  const path = orbitPath(sat, t, periodMin, 60);
  assert.equal(path.xyz.length / 3, 121);
  assert.equal(path.nowIndex, 60);
  const now = stateAt(sat, t)!;
  const i = path.nowIndex * 3;
  assert.ok(Math.hypot(path.xyz[i]! - now.ecef[0], path.xyz[i + 1]! - now.ecef[1], path.xyz[i + 2]! - now.ecef[2]) < 1e-3);
  // Consecutive samples are a fraction of an orbit apart, never a jump.
  for (let k = 1; k < 121; k++) {
    const d = Math.hypot(path.xyz[3 * k]! - path.xyz[3 * k - 3]!, path.xyz[3 * k + 1]! - path.xyz[3 * k - 2]!, path.xyz[3 * k + 2]! - path.xyz[3 * k - 1]!);
    assert.ok(d < 2_000_000, `step ${k}: ${d}`);
  }
});

test('julianDate of the unix epoch', () => {
  assert.equal(julianDate(0), 2_440_587.5);
});

test('synthetic bench constellation builds valid, propagatable element sets', () => {
  const now = Date.UTC(2026, 9, 2, 12);
  const els = synthElements(200, now);
  assert.equal(els.length, 200);
  assert.equal(new Set(els.map((e) => e.noradId)).size, 200);
  let ok = 0;
  for (const e of els) {
    assert.equal(e.tle1.length, 69);
    assert.equal(e.tle2.length, 69);
    assert.equal(tleChecksum(e.tle1), e.tle1.charCodeAt(68) - 48);
    assert.equal(tleChecksum(e.tle2), e.tle2.charCodeAt(68) - 48);
    const sat = makeSatrec(e.tle1, e.tle2);
    const s = sat && stateAt(sat, now);
    if (s && s.alt > 300_000 && s.alt < 700_000) ok++;
  }
  assert.equal(ok, 200);
});

test('buildTle round-trips its elements', () => {
  const { tle1, tle2 } = buildTle({ catalog: 42, inclinationDeg: 53.05, raanDeg: 120.5, eccentricity: 0.0012, argPerigeeDeg: 80, meanAnomalyDeg: 270.25, meanMotion: 15.06, epochMs: Date.UTC(2026, 0, 15, 6) });
  assert.equal(tle1.length, 69);
  assert.equal(tle2.length, 69);
  const sat = makeSatrec(tle1, tle2)!;
  assert.equal(sat.satnum, '00042');
  assert.equal(sat.epochyr % 100, 26);
  assert.ok(Math.abs(sat.inclo - (53.05 * Math.PI) / 180) < 1e-6);
});
