# v2 status and handoff

Living note for whoever (human or agent session) picks up v2 next. Update it
at the end of each work session.

## Working agreement

- Work on branch `claude/upbeat-volta-1au1ch`; update `main` only when the
  owner asks. Before any push to `main`, verify a fresh clone:
  `git clone . /tmp/x && cd /tmp/x/v2 && npm ci && npm run check && npm test && npm run build`.
- The orchestrating session plans, writes the shared contract
  (`shared/src/index.ts`) and reviews; Sonnet subagents implement, each owning
  explicit files. The orchestrator verifies (check, tests, build, screenshots)
  before committing.
- UI work goes through the `impeccable` skill (design, then critique/polish).
- Follow PLAN.md (scope, perf targets, rendering rules) and DESIGN.md (owner
  decisions at the bottom are binding).
- Keys come from environment variables (`GOOGLE_MAPS_API_KEY`,
  `CESIUM_ION_TOKEN`, `OPENSKY_CLIENT_ID`, `OPENSKY_CLIENT_SECRET`,
  `AISSTREAM_API_KEY`) or `v2/.env`. Never print or commit them.

## Done

- Phase 1: workspace, design system, globe shell, search, server, SQLite history.
- Phase 2: flights (OpenSky global with credentials, else adsb.lol areas),
  military flights, ships (AISStream), recorded history with throttled writes,
  batched worker-driven rendering, detail panel, tracks, time slider,
  base-map picker (Esri, NASA GIBS, Sentinel-2, OSM, Google 3D, ion).
- Dev launcher (`npm run dev`) stops both processes together.

## Verified with real keys (2026-10-02, headless Chromium, software WebGL)

- OpenSky global: OAuth client-credentials token (30 min lifetime, cached),
  `states/all?extended=1` returns about 13 000 aircraft (1.7 MB) in 1-2 s,
  `x-rate-limit-remaining` header is read (3 984 credits after the first
  call, 4 per call). Snapshot units are right (alt m, speed m/s, heading deg;
  e.g. 12 314 m = FL390, 242 m/s = 470 kt). adsbdb enrichment fills operator,
  route and registration country in the detail panel. Track, follow and the
  recorded `?at=` snapshot (13.5 k aircraft, 0.2 s) work.
- AISStream: connects and goes live within seconds, grows to about 33 000
  vessels in 20 minutes. Static data merges into name, IMO, call sign, type
  category, dimensions, destination and ETA (10 k of 31 k vessels named after
  18 minutes, rising as static messages arrive every ~6 minutes). Detail and
  track endpoints work; the live and historical vessel snapshot is capped at
  20 000 objects (`truncated: true`), which the web client avoids by passing a
  bbox.
- Browser, with the ion token only (no Google key): Google Photorealistic 3D
  through ion asset 2275207 (NYC, 626 k triangles), Bing aerial through ion,
  Cesium World Terrain (Alps), OSM Buildings (NYC) all load with no console
  errors and their credits show in the attribution popover. Screenshots in
  `design/keys-*.png`. Flights over Europe and Rotterdam, ships over
  Rotterdam, select, show track, follow and dragging the slider back 10
  minutes (recorded flights and ships render) all work on real data.
- History growth, flights plus vessels together, 20 minute sample: about
  148 MB/hour (about 3.5 GB/day). Flights about 95 MB/hour (about 430 k rows/h
  at about 220 B/row incl. indexes), vessels about 40 MB/hour measured after
  the initial ramp and likely to settle higher. Set `FLIGHTS_STORE_INTERVAL_S`
  and `VESSELS_STORE_INTERVAL_S` to taste.

## Still unverified

- Google Photorealistic 3D with a direct `GOOGLE_MAPS_API_KEY` (none was set in
  the test environment; only the ion route was exercised).
- Frame rate: sandbox has software WebGL only; use `?bench=12000` on a GPU.
- Sandbox quirks, not app bugs: Node's fetch ignores `HTTPS_PROXY`, so start
  the server with `NODE_USE_ENV_PROXY=1` behind an egress proxy (otherwise
  OpenSky times out); Chromium needs the proxy CA in `~/.pki/nssdb`; Cesium
  requests Bing tiles over plain `http://` when the page is served over http,
  which that proxy refuses (a normal network is fine, and Bing allows https).

## Next

1. Clean-up pass: military marker distinct from civil, time slider drives the
   NASA GIBS date, font path not relative into node_modules, full impeccable
   audit of the UI. (adsb.lol politeness done: 60 s polls, 3 viewport areas.)
2. Phase 3 keyless layers: earthquakes (USGS), satellites (CelesTrak TLE),
   launches, cyclones (NHC). Then keyed/heavier: fires (FIRMS), weather/wind,
   cables, datacenters, installations, transit, bikeshare, traffic, ALPR,
   CCTV, radio/SDR.
3. Settle history defaults with the owner (HISTORY_DAYS, store intervals);
   global OpenSky and AIS each record a few GB per day at current defaults.

## Known issues

- Historical snapshot of 12k objects takes ~120 ms (node:sqlite row
  materialisation); live snapshots ~25 ms.
- node:sqlite is synchronous; a 12k-row OpenSky batch blocks ~0.25 s per poll.
- Fly-to altitude is relative to the ellipsoid (can be low over high terrain).
