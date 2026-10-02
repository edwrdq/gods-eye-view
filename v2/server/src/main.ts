import { readFileSync } from 'node:fs';
import path from 'node:path';
import { serve } from '@hono/node-server';
import type { ClientConfig } from '@gev/shared';
import { createApp } from './app.ts';
import { loadConfig, loadDotEnv } from './config.ts';
import { openDb } from './db/index.ts';
import { createGeocoder } from './geocode.ts';
import { buildFeedManager, implementedLayers } from './feeds/registry.ts';
import { buildLayers } from './layers.ts';

loadDotEnv();
const config = loadConfig();
const db = openDb(path.join(config.dataDir, 'gev.db'));
const { version } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { version?: string };

const clientConfig: ClientConfig = {
  googleMapsApiKey: config.googleMapsApiKey,
  cesiumIonToken: config.cesiumIonToken,
  layers: buildLayers(config.env, implementedLayers(config.feeds)),
};

const feeds = buildFeedManager({ config, db });

const app = createApp({
  clientConfig,
  geocoder: createGeocoder(),
  dbStatus: () => ({ path: db.path, sizeBytes: db.sizeBytes() }),
  version: version ?? '0.0.0',
  feeds,
  observations: db.observations,
});
const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  console.log(`gev server v${version ?? '0.0.0'} listening on http://${config.host}:${info.port} (db ${db.path})`);
  // Start feeds only once listening, so a failed start records nothing.
  feeds.start();
});
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `Port ${config.port} on ${config.host} is already in use, probably by another gev server.\n` +
        `Stop it (lsof -i :${config.port}, then kill the PID) or set PORT in v2/.env.`,
    );
  } else {
    console.error(err);
  }
  db.close();
  process.exit(1);
});

let closing = false;
function shutdown(signal: string): void {
  if (closing) return;
  closing = true;
  console.log(`${signal} received, shutting down`);
  server.close(() => {
    void feeds.stop().finally(() => {
      db.close();
      process.exit(0);
    });
  });
  (server as { closeAllConnections?: () => void }).closeAllConnections?.();
  setTimeout(() => {
    db.close();
    process.exit(1);
  }, 5000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
