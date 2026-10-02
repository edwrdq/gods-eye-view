import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SERVER_DIR = fileURLToPath(new URL('..', import.meta.url));
const ENV_FILE = fileURLToPath(new URL('../../.env', import.meta.url));

export interface Config {
  port: number;
  host: string;
  /** Absolute directory holding gev.db. */
  dataDir: string;
  googleMapsApiKey: string | null;
  cesiumIonToken: string | null;
  /** Feed ids to run in the background (FEEDS, comma separated). */
  feeds: string[];
  /** How many days of observation history to keep (HISTORY_DAYS). */
  historyDays: number;
  /** Raw environment, for feed keys that are checked by name (see layers.ts). */
  env: Record<string, string | undefined>;
}

/** Load v2/.env into process.env when it exists; existing variables win. */
export function loadDotEnv(file: string = ENV_FILE): void {
  try {
    process.loadEnvFile(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}

function text(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function parsePort(value: string | undefined): number {
  const raw = text(value);
  if (raw === null) return 8787;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid PORT: ${raw}`);
  }
  return port;
}

function parseFeeds(value: string | undefined): string[] {
  const raw = text(value);
  if (raw === null) return ['flights', 'vessels'];
  return [...new Set(raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean))];
}

function parseHistoryDays(value: string | undefined): number {
  const raw = text(value);
  if (raw === null) return 7;
  const days = Number(raw);
  if (!Number.isFinite(days) || days <= 0 || days > 3650) throw new Error(`Invalid HISTORY_DAYS: ${raw}`);
  return days;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  return {
    port: parsePort(env.PORT),
    host: text(env.HOST) ?? '127.0.0.1',
    dataDir: path.resolve(SERVER_DIR, text(env.DATA_DIR) ?? './data'),
    googleMapsApiKey: text(env.GOOGLE_MAPS_API_KEY),
    cesiumIonToken: text(env.CESIUM_ION_TOKEN),
    feeds: parseFeeds(env.FEEDS),
    historyDays: parseHistoryDays(env.HISTORY_DAYS),
    env,
  };
}
