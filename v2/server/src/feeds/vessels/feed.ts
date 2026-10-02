import type { FeedStatus, ObjectDetail, Observation } from '@gev/shared';
import { FeedHealth } from '../health.ts';
import { LivePicture, pickProps, type ThrottlePolicy } from '../live-picture.ts';
import { realTimers, type Feed, type FeedLayer, type ObservationSink, type Timers } from '../types.ts';
import { buildVesselDetail } from './detail.ts';
import {
  classifyAisError,
  LAYER,
  MESSAGE_TYPES,
  mergeStatic,
  parseAisEnvelope,
  staticProps,
  VESSEL_COMPACT_KEYS,
  type VesselStatic,
} from './parse.ts';

export const VESSELS_FRESHNESS_MS = 120_000;
/** Vessels not heard from for this long leave the live picture (as in the original). */
export const VESSELS_TIMEOUT_MS = 30 * 60_000;
export const VESSELS_MAX_OBJECTS = 50_000;
/** Static data is remembered for vessels not currently on the map, up to this many. */
const MAX_STATICS = 150_000;
/**
 * Global AIS is large (tens of thousands of vessels), so history is thinner than
 * for aircraft: a point every 5 minutes, or sooner after 2 km of movement or a
 * 15 degree turn. Vessels under 0.3 m/s (moored, anchored) are stored every 15 minutes.
 */
export const VESSELS_THROTTLE: ThrottlePolicy = {
  minIntervalMs: 300_000,
  minMoveM: 2_000,
  minHeadingDeg: 15,
  idleSpeedMps: 0.3,
  idleIntervalMs: 900_000,
};

export const AISSTREAM_URL = 'wss://stream.aisstream.io/v0/stream';
const BACKOFF_MS = [5_000, 15_000, 60_000, 300_000];
const DOWN_RETRY_MS = 900_000;
const AUTH_PROBE_MS = 3_600_000;
const RATE_LIMIT_MS = 300_000;
const RECYCLE_PAUSE_MS = 5_000;
const FLUSH_TICK_MS = 5_000;

/** The subset of the WHATWG WebSocket the feed uses; tests supply a fake. */
export interface WebSocketLike {
  binaryType?: string;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}
export type WebSocketCtor = new (url: string) => WebSocketLike;

export interface VesselsFeedDeps {
  apiKey: string | null;
  url?: string;
  WebSocket: WebSocketCtor;
  now?: () => number;
  timers?: Timers;
  store: ObservationSink;
  /** [[lat,lon],[lat,lon]] boxes; defaults to the whole world. */
  boundingBoxes?: number[][][];
  /** No-record time before the feed reports silence; 0 disables the watchdog. */
  silenceReportMs?: number;
  storeIntervalMs?: number;
}

export class VesselsFeed implements Feed {
  readonly id = 'vessels';
  readonly freshnessMs = VESSELS_FRESHNESS_MS;
  readonly layers: readonly FeedLayer[] = [
    { id: 'vessels', storageLayer: LAYER, lookbackMs: 60 * 60_000 },
  ];
  readonly live: LivePicture;

  private readonly now: () => number;
  private readonly timers: Timers;
  private readonly health: FeedHealth;
  private readonly statics = new Map<string, VesselStatic>();
  private socket: WebSocketLike | null = null;
  private generation = 0;
  private connectedAt = 0;
  private lastRecordAt: number | null = null;
  private nextAttemptAt = 0;
  private attempt = 0;
  private timer: unknown = null;
  private started = false;

  private readonly deps: VesselsFeedDeps;

  constructor(deps: VesselsFeedDeps) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
    this.timers = deps.timers ?? realTimers;
    this.health = new FeedHealth(this.now, VESSELS_FRESHNESS_MS);
    this.health.needsKey = !deps.apiKey;
    this.live = new LivePicture({
      timeoutMs: VESSELS_TIMEOUT_MS,
      maxObjects: VESSELS_MAX_OBJECTS,
      throttle: { ...VESSELS_THROTTLE, minIntervalMs: deps.storeIntervalMs ?? VESSELS_THROTTLE.minIntervalMs },
      now: this.now,
      compactProps: (p) => pickProps(p, VESSEL_COMPACT_KEYS),
    });
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.health.running = true;
    if (!this.deps.apiKey) return; // needs-key: nothing to run
    this.timer = this.timers.setInterval(() => this.tick(), FLUSH_TICK_MS);
    this.tick();
  }

  async stop(): Promise<void> {
    if (this.timer !== null) this.timers.clearInterval(this.timer);
    this.timer = null;
    this.started = false;
    this.health.running = false;
    this.detach('stopped');
    this.flush();
  }

  status(layer: string = LAYER): FeedStatus {
    return {
      layer,
      state: this.health.state(),
      source: 'AISStream',
      lastSuccess: this.health.lastSuccess,
      lastError: this.health.lastError,
      count: this.live.size,
      freshnessMs: VESSELS_FRESHNESS_MS,
    };
  }

  async detail(layer: string, obs: Observation, historical: boolean): Promise<ObjectDetail> {
    return { ...buildVesselDetail(obs, historical), layer };
  }

  // ------------------------------------------------------------ connection

  /** Driven by a timer; also callable directly (tests). */
  tick(): void {
    if (!this.started || !this.deps.apiKey) return;
    const now = this.now();
    this.live.expire();
    this.flush();
    if (this.socket === null) {
      if (now >= this.nextAttemptAt) this.connect();
      return;
    }
    const silenceMs = this.deps.silenceReportMs ?? 120_000;
    if (silenceMs > 0) {
      const quiet = now - (this.lastRecordAt ?? this.connectedAt);
      if (quiet > silenceMs * 2.5) {
        this.health.fail(`No AIS records for ${Math.round(quiet / 1000)} s; reconnecting`);
        this.detach('silence');
        this.attempt++;
        this.nextAttemptAt = now + RECYCLE_PAUSE_MS;
      } else if (quiet > silenceMs && this.health.lastError === null) {
        this.health.fail(`No AIS records for ${Math.round(quiet / 1000)} s`);
      }
    }
  }

  private connect(): void {
    const gen = ++this.generation;
    let ws: WebSocketLike;
    try {
      ws = new this.deps.WebSocket(this.deps.url ?? AISSTREAM_URL);
    } catch (err) {
      this.health.fail(`connect failed: ${(err as Error).message}`);
      this.scheduleRetry();
      return;
    }
    ws.binaryType = 'arraybuffer';
    this.socket = ws;
    this.connectedAt = this.now();
    this.lastRecordAt = null;
    const current = () => gen === this.generation && this.socket === ws;
    ws.onopen = () => {
      if (!current()) return;
      ws.send(
        JSON.stringify({
          APIKey: this.deps.apiKey,
          BoundingBoxes: this.deps.boundingBoxes ?? [[[-90, -180], [90, 180]]],
          FilterMessageTypes: MESSAGE_TYPES,
        }),
      );
    };
    ws.onmessage = (ev) => {
      if (!current()) return;
      const data = ev.data;
      if (typeof data === 'string') this.handleFrame(data);
      else if (data instanceof ArrayBuffer) this.handleFrame(new TextDecoder().decode(data));
      else if (typeof Blob !== 'undefined' && data instanceof Blob) {
        void data.text().then((t) => current() && this.handleFrame(t));
      }
    };
    ws.onerror = () => {
      if (!current()) return;
      if (this.health.lastError === null) this.health.fail('AISStream websocket error');
    };
    ws.onclose = () => {
      if (!current()) return;
      this.socket = null;
      this.generation++;
      if (this.health.lastError === null) this.health.fail('AISStream connection closed');
      this.scheduleRetry();
    };
  }

  /** Abandon the current socket without waiting for its close handshake. */
  private detach(reason: string): void {
    const ws = this.socket;
    this.socket = null;
    this.generation++;
    if (!ws) return;
    ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
    try {
      ws.close(1000, reason);
    } catch {
      // already closed
    }
  }

  private scheduleRetry(): void {
    const now = this.now();
    const ladder = this.attempt < BACKOFF_MS.length ? BACKOFF_MS[this.attempt]! : DOWN_RETRY_MS;
    this.attempt++;
    this.nextAttemptAt = Math.max(this.nextAttemptAt, now + ladder);
  }

  // ------------------------------------------------------------ messages

  /** Process one text frame. Exposed for tests. */
  handleFrame(text: string): void {
    let env: unknown;
    try {
      env = JSON.parse(text);
    } catch {
      return;
    }
    const err = (env as { error?: unknown } | null)?.error;
    if (err) {
      this.handleErrorFrame(String(err));
      return;
    }
    this.ingest(env);
  }

  private handleErrorFrame(message: string): void {
    const kind = classifyAisError(message);
    this.health.fail(`AISStream: ${message}`);
    const now = this.now();
    if (kind === 'auth') {
      // Retrying cannot fix a bad key; probe rarely in case the fault was upstream.
      this.nextAttemptAt = now + AUTH_PROBE_MS;
    } else if (kind === 'rate') {
      this.nextAttemptAt = now + RATE_LIMIT_MS;
    }
    this.detach('error frame');
    if (kind === 'transport') this.scheduleRetry();
  }

  /** Apply one decoded envelope; returns true when it was a real AIS record. */
  ingest(env: unknown): boolean {
    const now = this.now();
    const parsed = parseAisEnvelope(env, now);
    if (!parsed) return false;
    this.lastRecordAt = now;
    this.attempt = 0;
    this.health.ok(now);

    const { mmsi } = parsed;
    if (parsed.static) {
      const merged = mergeStatic(this.statics.get(mmsi), parsed.static);
      this.statics.delete(mmsi);
      this.statics.set(mmsi, merged);
      if (this.statics.size > MAX_STATICS) {
        const oldest = this.statics.keys().next().value;
        if (oldest !== undefined) this.statics.delete(oldest);
      }
      this.live.patchProps(mmsi, staticProps(merged));
    }
    const pos = parsed.position;
    if (pos && now - pos.t <= VESSELS_TIMEOUT_MS) {
      const st = this.statics.get(mmsi);
      if (st) pos.props = { ...staticProps(st), ...pos.props };
      this.live.upsert(pos);
    }
    return true;
  }

  private flush(): void {
    const rows = this.live.takePending();
    if (rows.length === 0) return;
    try {
      this.deps.store(rows);
    } catch (err) {
      console.error('[vessels] history write failed:', (err as Error).message);
      this.live.requeue(rows);
    }
  }
}
