# God's Eye View v2 — rewrite plan

v2 is a ground-up rewrite that lives beside the original app. The original
code at the repository root stays untouched until v2 reaches parity; it is the
ground truth for feed behaviour, data normalisation and edge cases.

## Goals

- **Useful over gimmicky.** An OSINT / research tool: find, filter, inspect and
  look back in time. No fake classification banners, sensor skins, fake
  detection boxes or cinematic HUD chrome.
- **Fast.** Nothing loads until it is used. The globe redraws only when
  something changes.
- **Calm UI.** Plain language, readable type, light and dark themes,
  information-dense panels instead of decoration.
- **Self-hosted, single user.** No accounts or multi-tenant concerns. Remains an
  open-source (MIT) fork with upstream attribution kept.

## Stack

| Part | Choice | Why |
| --- | --- | --- |
| Language | TypeScript everywhere | One language; old JS feed logic ports nearly 1:1 |
| Globe | CesiumJS | Mature globe + Google Photorealistic 3D Tiles |
| UI | Svelte 5 | Dense panels/tables with a tiny runtime |
| Heavy client work | Web workers | Parsing, filtering, spatial index off the main thread |
| Server | Node + Hono | Small, typed HTTP layer; owns keys, fetching, caching |
| Storage | SQLite (spatial) | Feed history for research queries; one file, no ops. Schema kept portable to Postgres/PostGIS |
| SDR | WebUSB in browser | Port of the existing `@jtarrio/webrtlsdr` integration |

## Layout

```
/            original app (reference, untouched)
/v2/web      Svelte + Cesium client
/v2/server   Hono API, feed ingesters, SQLite history
/v2/shared   types, feed schemas, geo utilities
```

## Scope

**Keep / port:** flights, military flights, ships (AIS), satellites, launches,
earthquakes, fires (FIRMS), weather, wind, cyclones, submarine cables,
datacenters, installations, transit, bikeshare, traffic, ALPR, CCTV,
radio / SDR, search and geocoding, share links, Photorealistic 3D Tiles.

**Drop:** visual sensor styles (CRT/NVG/FLIR/Noir/Snow/Anime), detection
overlay, military HUD, cockpit view, cyber sonar, split-flap text, scene
director / tours, voice agent, Bhote Koshi event scene, decorative HUD
readouts.

**Add (research features):** object detail panel, per-layer filters and
sorting, data freshness per source, time slider over recorded history, track
history for an object, area watch, CSV / GeoJSON export.

**Future:** further OSINT tools on top of the stored history.

## Performance targets

Measured against the original app's baseline (see `docs/PERFORMANCE.md`):

- Initial JS (excluding Cesium) under 300 KB gzipped; original: 795 KB.
- Startup to interactive globe under 1.5 s on the reference machine.
- No layer code or data fetched until the layer is enabled.
- 60 fps with 12k vessels; original: 22 fps.
- Large static datasets (boundaries, names, geoid) fetched on demand, never
  bundled as JS.

## Rendering rules

- Batched primitives only (`PointPrimitiveCollection`, `BillboardCollection`,
  `LabelCollection`, primitives); no per-object `Entity` + `CallbackProperty`
  for feed data.
- Updates are applied when data arrives, not per frame.
- `requestRenderMode` on; render requested explicitly on change.

## Phases

1. **Skeleton.** v2 scaffold, design direction, globe with 3D tiles, search,
   layer panel, server with health/config, SQLite wiring.
2. **First feeds end to end.** Flights and ships: ingest, history, batched
   rendering, detail panel, time slider. Verify against the original app and
   the performance targets.
3. **Port remaining feeds** one at a time, using the original tests as the
   reference. CCTV and SDR are separate workstreams.
4. **Research features.** Track history, area watch, saved searches, export.
5. **Cut-over.** When v2 covers the kept scope, retire the original code.
