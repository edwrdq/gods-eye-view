# God's Eye View v2

Ground-up rewrite of the app at the repository root. See [PLAN.md](PLAN.md)
for scope and phases, [DESIGN.md](DESIGN.md) for the design system.

## Run

Requires Node 22.13 or newer.

```sh
cd v2
npm install
cp .env.example .env   # optional keys
npm run dev            # server on 127.0.0.1:8787, web on Vite's dev port
```

`npm run check` type-checks every package, `npm test` runs the unit tests and
`npm run build` builds the web client into `web/dist`.

## Keys

All optional. Without keys the globe uses Esri World Imagery with keyless
terrain. `GOOGLE_MAPS_API_KEY` switches to Google Photorealistic 3D Tiles,
`CESIUM_ION_TOKEN` to Cesium ion imagery and terrain. Feed keys are listed
next to each layer in the app.

The server binds to 127.0.0.1 by default. It holds your keys and history, so
keep it off the public internet.
