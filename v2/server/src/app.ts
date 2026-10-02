import { Hono } from 'hono';
import type { ApiError, ClientConfig, GeocodeResponse, HealthResponse } from '@gev/shared';
import { GeocodeUnavailableError, type Geocoder } from './geocode.ts';

export interface AppDeps {
  /** Browser-safe config served verbatim at /api/config. */
  clientConfig: ClientConfig;
  geocoder: Geocoder;
  dbStatus: () => HealthResponse['db'];
  version: string;
  now?: () => number;
}

const MAX_QUERY_LENGTH = 200;

export function createApp(deps: AppDeps): Hono {
  const now = deps.now ?? Date.now;
  const startedAt = now();
  const app = new Hono();

  const fail = (message: string): ApiError => ({ error: message });

  app.get('/api/health', (c) => {
    const body: HealthResponse = {
      ok: true,
      version: deps.version,
      uptimeS: Math.round((now() - startedAt) / 1000),
      db: deps.dbStatus(),
    };
    return c.json(body);
  });

  app.get('/api/config', (c) => c.json(deps.clientConfig));

  app.get('/api/geocode', async (c) => {
    const query = (c.req.query('q') ?? '').trim();
    if (!query) return c.json(fail('Query parameter q is required'), 400);
    if (query.length > MAX_QUERY_LENGTH) {
      return c.json(fail(`Query parameter q must be at most ${MAX_QUERY_LENGTH} characters`), 400);
    }
    try {
      const results = await deps.geocoder.search(query, c.req.raw.signal);
      const body: GeocodeResponse = { query, results };
      return c.json(body);
    } catch (err) {
      if (err instanceof GeocodeUnavailableError) return c.json(fail(err.message), 502);
      throw err;
    }
  });

  app.notFound((c) =>
    c.req.path.startsWith('/api') ? c.json(fail('Not found'), 404) : c.text('Not found', 404),
  );

  app.onError((err, c) => {
    console.error(err);
    return c.req.path.startsWith('/api')
      ? c.json(fail('Internal server error'), 500)
      : c.text('Internal server error', 500);
  });

  return app;
}
