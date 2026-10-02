/**
 * Build the bundled bikeshare systems index (static-data/gbfs/systems.json).
 *
 *   NODE_USE_ENV_PROXY=1 node --experimental-strip-types src/feeds/bikeshare/build-index.ts [--out file] [--limit n]
 *
 * The MobilityData catalogue lists every public GBFS system but not where it is.
 * This tool contacts each listed system once (gbfs.json, vehicle_types when
 * present, station_information), keeps the ones that rent bicycles from docked
 * stations, and records the bounding box of their stations. It is a maintainer
 * tool, run by hand a few times a year, never by the server. It is polite: a
 * descriptive User-Agent, 4 requests at a time and 2 per host.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getJson, getText, HttpError } from '../http.ts';
import { isPublicHttpsUrl } from '../url.ts';
import { CATALOGUE_URL } from './feed.ts';
import { parseCatalogue, parseDiscovery, parseStationInformation, parseVehicleTypes, stationsBBox, type CatalogueSystem } from './gbfs.ts';
import { INDEX_VERSION, type IndexedSystem } from './systems.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const arg = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const OUT = path.resolve(arg('out') ?? path.join(HERE, '../../../static-data/gbfs/systems.json'));
const LIMIT = Number(arg('limit') ?? 0);
const fetchFn = (url: string, init?: RequestInit) => fetch(url, init);

const hostBusy = new Map<string, number>();
async function polite<T>(url: string, fn: () => Promise<T>): Promise<T> {
  const host = new URL(url).hostname;
  while ((hostBusy.get(host) ?? 0) >= 2) await new Promise((r) => setTimeout(r, 150));
  hostBusy.set(host, (hostBusy.get(host) ?? 0) + 1);
  try {
    return await fn();
  } finally {
    hostBusy.set(host, hostBusy.get(host)! - 1);
  }
}

/** One request, retried up to twice when the operator says to slow down (429) or is briefly unavailable (503). */
async function get(url: string): Promise<unknown> {
  if (!isPublicHttpsUrl(url)) throw new Error('not a public https URL');
  for (let attempt = 0; ; attempt++) {
    try {
      return await polite(url, () => getJson(fetchFn, url, { timeoutMs: 15_000, maxBytes: 16 * 1024 * 1024 }));
    } catch (err) {
      const slow = err instanceof HttpError && (err.status === 429 || err.status === 503);
      if (!slow || attempt >= 2) throw err;
      await new Promise((r) => setTimeout(r, Math.min(30_000, (err as HttpError).retryAfterMs ?? 5_000 * (attempt + 1))));
    }
  }
}

type Outcome = { kind: 'ok'; system: IndexedSystem } | { kind: 'skip'; why: string };

async function probe(c: CatalogueSystem): Promise<Outcome> {
  try {
    const d = parseDiscovery(await get(c.discoveryUrl), c.discoveryUrl);
    if (!d?.stationInformation) return { kind: 'skip', why: 'no stations (free-floating)' };
    if (d.vehicleTypes) {
      // Unreadable vehicle types leave the fleet unknown, and car sharing also has stations: leave it out.
      const vt = parseVehicleTypes(await get(d.vehicleTypes));
      if (!vt.bikes) return { kind: 'skip', why: 'not a bicycle-only fleet' };
    }
    const info = parseStationInformation(await get(d.stationInformation));
    const bbox = stationsBBox(info.stations);
    if (!bbox || info.stations.length < 2) return { kind: 'skip', why: 'fewer than 2 stations' };
    return { kind: 'ok', system: { ...c, bbox, stations: info.stations.length } };
  } catch (err) {
    return { kind: 'skip', why: `error: ${(err as Error).message}` };
  }
}

async function main(): Promise<void> {
  const { text } = await getText(fetchFn, CATALOGUE_URL, { timeoutMs: 30_000 });
  let { systems } = parseCatalogue(text);
  if (LIMIT > 0) systems = systems.slice(0, LIMIT);
  console.log(`catalogue: ${systems.length} systems without authentication`);
  const kept: IndexedSystem[] = [];
  const why = new Map<string, number>();
  let next = 0;
  let done = 0;
  const worker = async () => {
    for (;;) {
      const c = systems[next++];
      if (!c) return;
      const r = await probe(c);
      if (r.kind === 'ok') kept.push(r.system);
      else why.set(r.why, (why.get(r.why) ?? 0) + 1);
      if (++done % 100 === 0) console.log(`  ${done}/${systems.length}, ${kept.length} kept`);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  kept.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({ version: INDEX_VERSION, generatedAt: new Date().toISOString(), systems: kept }));
  console.log(`kept ${kept.length} systems, wrote ${OUT}`);
  for (const [k, n] of [...why].sort((a, b) => b[1] - a[1])) console.log(`  skipped ${n}: ${k}`);
}

await main();
