# Product

<!-- impeccable:product-schema 1 -->

> Written unattended from the owner's brief and PLAN.md. No interview took place; every fact below is inferred from those two sources unless marked confirmed. Revisit when the owner is available.

## Platform

web

## Stack

Confirmed in PLAN.md: Svelte 5, TypeScript, CesiumJS, Hono, SQLite. Plain CSS custom properties for styling (tokens.css, base.css).

## Users

One power user (the owner) running the app self-hosted, on a laptop (about 1280x800 up to large desktop). Job: find, filter and inspect live and historical objects on a 3D globe for OSINT research, and look back in time. (Confirmed by brief.)

## Product Purpose

A browser-based 3D globe for open-source research: aircraft, ships, satellites, earthquakes, fires, weather, infrastructure, public CCTV and radio. Success is finding and understanding an object or area quickly, with clear provenance and freshness for every source.

## Positioning

A calm, credible analyst tool in the family of serious GIS products, with research features (history, track replay, area watch, export) layered on live feeds. Not a spy-console toy.

## Operating Context

Sits around a full-viewport globe with Google Photorealistic 3D Tiles and satellite imagery. Self-hosted, single user, no accounts. Server owns API keys; some layers need a key.

## Capabilities and Constraints

No runtime external network for fonts. Light and dark themes both first-class. Eight layer categories: air, sea, space, hazards, weather, infrastructure, ground, signals. Layers may be live, stale, errored, needs-key, or planned.

## Brand Commitments

MIT open-source fork; upstream attribution kept. Plain-language, sentence-case copy. The original's fake classification banners, KH-11/NIIRS readouts, letter-spaced uppercase monospace, cyan glow and sensor skins are explicitly rejected.

## Product Principles

1. The globe is the hero; chrome recedes.
2. Credibility over theater: show source, freshness and uncertainty.
3. Dense but quiet: information-rich panels, no decoration.
4. Never rely on color alone.
5. Load and draw only what is used.

## Accessibility & Inclusion

WCAG AA contrast, visible keyboard focus, prefers-reduced-motion respected, colorblind-aware data palette.
