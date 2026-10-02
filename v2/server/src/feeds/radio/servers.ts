import { promises as dns } from 'node:dns';
import { getJson } from '../http.ts';
import type { FetchLike } from '../types.ts';

/**
 * Finding a Radio Browser server, the way its API documentation asks: look up
 * all.api.radio-browser.info (one A record per server), reverse-resolve each
 * address to the server's name, shuffle, and fall through the list on failure.
 * The documented HTTP list (`/json/servers`) and a short built-in list back it up.
 */

export const DISCOVERY_HOST = 'all.api.radio-browser.info';
export const SERVER_LIST_URL = `https://${DISCOVERY_HOST}/json/servers`;
export const FALLBACK_SERVERS: readonly string[] = ['de1.api.radio-browser.info', 'de2.api.radio-browser.info', 'nl1.api.radio-browser.info'];

const NAME = /^[a-z0-9-]+\.api\.radio-browser\.info$/;

export interface ServerDeps {
  resolve4(host: string): Promise<string[]>;
  reverse(ip: string): Promise<string[]>;
  fetch: FetchLike;
  random?: () => number;
}

export const realDns = { resolve4: (h: string) => dns.resolve4(h), reverse: (ip: string) => dns.reverse(ip) };

/** Only names under api.radio-browser.info are ever contacted, whatever a lookup returns. */
export function serverOrigin(name: unknown): string | null {
  const host = typeof name === 'string' ? name.trim().toLowerCase().replace(/\.$/, '') : '';
  return NAME.test(host) && host !== DISCOVERY_HOST ? `https://${host}` : null;
}

export function shuffle<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

async function viaDns(d: ServerDeps): Promise<string[]> {
  const ips = await d.resolve4(DISCOVERY_HOST);
  const names = await Promise.allSettled(ips.map((ip) => d.reverse(ip)));
  return names.flatMap((n) => (n.status === 'fulfilled' ? n.value : []));
}

async function viaHttp(d: ServerDeps): Promise<string[]> {
  const rows = await getJson(d.fetch, SERVER_LIST_URL, { timeoutMs: 10_000, maxBytes: 256 * 1024 });
  return Array.isArray(rows) ? rows.map((r) => (r as { name?: unknown })?.name as string) : [];
}

/** Server origins in the order to try them: random among those found, the built-in ones after. */
export async function discoverServers(d: ServerDeps, log?: (msg: string) => void): Promise<string[]> {
  let found: string[] = [];
  for (const [how, find] of [['DNS', viaDns], ['HTTP list', viaHttp]] as const) {
    try {
      found = (await find(d)).map(serverOrigin).filter((o): o is string => o !== null);
      if (found.length > 0) {
        log?.(`radio: ${new Set(found).size} server(s) from the ${how}`);
        break;
      }
    } catch (err) {
      log?.(`radio: server discovery by ${how} failed: ${(err as Error).message}`);
    }
  }
  const unique = [...new Set(found)];
  const fallback = FALLBACK_SERVERS.map(serverOrigin).filter((o): o is string => o !== null && !unique.includes(o));
  return [...shuffle(unique, d.random), ...shuffle(fallback, d.random)];
}
