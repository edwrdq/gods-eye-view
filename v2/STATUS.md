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

## Verified only with fixtures or fakes

- Google 3D tiles, Cesium ion imagery/terrain/buildings: no keys yet.
- OpenSky global and AISStream: fake fetch / fake WebSocket tests only.
- Frame rate: sandbox has software WebGL only; use `?bench=12000` on a GPU.

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
