# God's Eye View v2 - Design direction

Mode: Operate. A research tool for one power user, sitting around a full-viewport globe. Decisions below were made unattended from the owner's brief and PLAN.md (see PRODUCT.md); nothing here was confirmed in an interview.

Source of truth for values: `web/src/styles/tokens.css`. Reset and utilities: `web/src/styles/base.css`. Visual reference: `design/shell-mock.html` and the screenshots beside it.

## Direction in one paragraph

Quiet, dense, trustworthy. The globe is the content; every panel is a plain, slightly translucent slate surface that stays out of the way. Type is the system sans in sentence case; monospace appears only for coordinates, timestamps and identifiers. One restrained indigo accent marks interaction (switches on, selection, focus, primary button). Color is reserved for data: eight category hues and four status colors, each paired with an icon, shape or word. Think analyst GIS tool or a good map product, not a cockpit.

## Principles

1. The globe is the hero. Chrome is flat, low-contrast, and never competes with imagery. Panels float with a gutter; no decorative frames, corners, scanlines or glow.
2. Say what it is. Plain-language labels, sentence case, no jargon-as-costume. Provenance and freshness are first-class content (source, "2 s ago", "elements 3 h old").
3. Information-dense but quiet. Use hierarchy (size, weight, secondary text color) not decoration. Group with whitespace and hairlines.
4. Never color alone. Every status and category has a second channel: icon, shape, or text.
5. Calm motion. 120-240 ms, state changes only (toggle, expand, hover). No entrance choreography, no pulsing except skeleton loading. Honors `prefers-reduced-motion`.
6. Both themes are first-class. Panels follow the theme; map markers do not (they sit on imagery).

## What to avoid (the original app, inverted)

- Fake classification banners, "TOP SECRET // NOFORN", KH-11/NIIRS/GSD readouts, REC timers, corner brackets, vertical telemetry text.
- Letter-spaced uppercase monospace for labels. No all-caps UI text.
- Cyan/neon glow, text-shadow, box-shadow halos; sensor skins; scanlines.
- Mixed icon fonts / glyph-names-as-text (the original rendered "layers_cle", "bolt" as raw ligature text). Use one inline SVG set.
- Display fonts, gradient text, decorative blur, nested cards, same-size icon-heading-text card grids.
- Modals for tasks that can be inline. Reserve for destructive confirmation only.
- Network-loaded fonts or icons at runtime.

## Typography

System stacks only; nothing to install.

- Sans: `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif` (`--font-sans`).
- Mono: `ui-monospace, "SF Mono", SFMono-Regular, "Cascadia Mono", Menlo, Consolas, "Liberation Mono", monospace` (`--font-mono`).
- Mono is bundled: `@fontsource-variable/jetbrains-mono` ("JetBrains Mono Variable"), imported by the web app and prepended to `--font-mono`. Sans stays the system stack.

Scale is fixed rem, ratio about 1.125; UI is dense at 13 px.

| Token | Size | Use |
| --- | --- | --- |
| `--text-2xs` | 11 px | tiny badges only |
| `--text-xs` | 12 px | meta, descriptions, status bar, chips |
| `--text-sm` | 13 px | default UI text, layer names, values |
| `--text-md` | 15 px | panel titles, search input |
| `--text-lg` | 18 px | detail panel heading |
| `--text-xl` | 22 px | rare empty-state or page title |

Weights: 400 body, 500 labels and layer names, 600 headings. Line-height 1.4 UI, 1.55 prose. Minimum text size 12 px (11 px badges only). Prose measure 65-75ch (empty states cap at 30ch).

Numerals: use `.num` (tabular figures in the sans) for counts, altitudes and speeds so columns align; use `.mono` for coordinates, timestamps, ICAO hex, registrations, squawk, callsign headings. Never monospace labels or buttons.

## Spacing, radii, elevation, layout

- Spacing, 4 px base: 2, 4, 8, 12, 16, 24, 32, 48 (`--space-1` to `--space-8`). Tight inside groups (4-8), 12-16 between related blocks, 24+ between sections.
- Radii: 3 (badges), 6 (controls, rows), 10 (panels, top bar), 14 (mobile sheets), full (switch).
- Elevation: three shadows with offset and soft blur. `--shadow-1` bars and chips, `--shadow-2` floating panels, `--shadow-3` popovers (search results, menus). Panels also carry a 1 px `--border-default`; in dark mode the border does most of the work. Panel blur (`--panel-blur: 14px`) exists only so text stays legible over busy imagery behind 94% opaque surfaces.
- Shell metrics: gutter 12 px; top bar 44; status bar 28; left panel 336; right panel 340 (312/300 under 1100 px); control height 32; touch height 40 on narrow screens.

## Color tokens

Neutral slate with a faint cool tint. One accent. Values are in tokens.css; ratios are against `--surface-panel-solid`.

| Role | Dark | Light |
| --- | --- | --- |
| canvas / panel / raised | #0a0e13 / #131920 (94%) / #1a212a | #dfe5ec / #ffffff (95%) / #f1f4f8 |
| text primary | #e8edf3 (15.0:1) | #141a22 (17.5:1) |
| text secondary | #a9b4c2 (8.4:1) | #4a5666 (7.5:1) |
| text tertiary, placeholders | #8793a3 (5.7:1) | #5f6b7a (5.4:1) |
| border subtle / default / strong | #232c37 / #2f3a47 / #4a586a | #e2e7ee / #cfd6e0 / #7d8a9b |
| accent | #7c9cff (6.8:1; accent-on #0a0e13 7.2:1) | #2f4fd0 (6.7:1; accent-on #ffffff) |
| focus ring | #a9bdff | #2f4fd0 |

`--border-strong` is for control outlines (switch, outlined button) and meets 3:1 non-text contrast. `--text-disabled` is decorative only; disabled things always also carry words ("Planned", "Needs API key").

Accent is used for: switch on-state, primary button, selected result/row tint, focus ring, links. Never for decoration or inactive states.

### Categorical palette (8 layer categories)

Chosen from an Okabe-Ito-style spread (blue, bluish-green, violet, vermillion, yellow, pink, yellow-green, neutral), tuned for luminance separation. Two sets:

| Category | Shape (map) | Icon (Lucide) | UI dark `--cat-*` | UI light `--cat-*` | Map `--map-*` (both themes) |
| --- | --- | --- | --- | --- | --- |
| air | triangle (rotates to heading) | plane | #42aef5 | #1565c9 | #42aef5 |
| sea | diamond | ship | #22c4ab | #007a6c | #22c4ab |
| space | four-point star | satellite | #b890fa | #6a45d0 | #b890fa |
| hazards | filled circle | triangle-alert | #ff6450 | #c4321f | #ff6450 |
| weather | rounded square (field/fill) | cloud | #ffd23f | #8f6700 | #ffd23f |
| infrastructure | square | factory | #f28cc2 | #b0307c | #f28cc2 |
| ground | hexagon | video | #a3d64f | #4a7a0c | #a3d64f |
| signals | ring (hollow circle) | radio | #dfe6ee | #445163 | #dfe6ee |

Contrast: all UI category colors are at least 6.1:1 on the dark panel and 5.1:1 on the light panel (above the 3:1 non-text requirement). Map colors are theme-independent because they draw on imagery, not panels: always render markers with a 1.5 px dark halo (`--map-halo`) so yellow, lime and white stay readable on snow, cloud, desert and bright 3D tiles, and light colors stay visible on dark ocean. Selected objects get a white ring (`--map-selection`).

Colorblind notes: hazards (vermillion) and ground (lime) can merge for red-green deficiency, and air (blue) / sea (teal) for some blue-green deficiency, so category is never carried by hue alone: each has a distinct marker shape and icon, and the layer panel always shows the category icon and name. Pick label text from the layer, not from a legend.

### Status palette (not color alone)

| State | Meaning | Dark / light color | Second channel |
| --- | --- | --- | --- |
| live / fresh | data within its expected cadence | #4cc38a / #0f7a46 | filled dot + "Live" |
| stale | older than cadence | #e0a43a / #8a5a00 | clock icon + "Stale" + age |
| error | last fetch failed | #ff7b72 / #c0281d | triangle-alert icon + "Error" + reason + Retry |
| needs key | no API key configured | #b6a2ff / #5b3fc4 | key icon + "Needs API key" + link; switch disabled |
| planned | not built yet | #8793a3 / #5f6b7a | dashed outline + "Planned"; row and switch disabled |
| loading | in flight | secondary text | skeleton bars (or thin determinate bar), `aria-busy` |

Each chip is color text on a 10-14% tinted fill: all status text meets 5.4:1 or better. Status text always includes a short noun, never just a dot.

## Components

### Panel
Floating, 10 px radius, `--surface-panel` (94-95% opaque), 1 px border, `--shadow-2`. Header 48 px: title (15 px/600), muted meta, icon button to collapse. Body scrolls (`.scroll-y`), header and filter stay fixed. Left and right panels sit 12 px from the edges and below the top bar; they never overlap the status bar. Collapsed state: panel shrinks to a 44 px icon button at its corner. Under 760 px: layers become a full-width drawer opened by the Layers button; the detail panel becomes a bottom sheet (max 45% height, 14 px radius); only one is open at a time.

### Layer group and layer row
- Group header (40 px): category icon in category color, name (13/600), "2 of 3 on" in secondary text, chevron; `aria-expanded`. Collapsible; collapsed by default when the group has nothing enabled and the panel is short. The user's collapsed/expanded choice persists across sessions (localStorage `gev.v2.layerGroups.collapsed`).
- Row: left 3 px category tick (35% opacity off, 100% on; a small marker, not a card border), name (13/500), switch top-right, one-to-two line description (12 px secondary), and a status line when relevant: chip + count + age ("11,482 aircraft . 2 s ago"). On rows get a faint accent tint. Off rows show only name and description unless there is a problem (error, needs key), which is always visible.
- Planned rows: name and description in tertiary text, dashed "Planned" chip, switch disabled and labeled "(planned)" for assistive tech. No hover.
- Row hover: `--hover-overlay`. Keyboard: the switch is the tab stop; the whole row is not.

### Toggle (switch)
36 x 20 `role="switch"`, `aria-checked`, `aria-label` = layer name. Off: transparent with 1.5 px `--border-strong` outline, grey thumb. On: accent fill, thumb moves 16 px (position is the non-color cue). Disabled: dashed outline at 45% opacity. 180 ms ease-out; none under reduced motion. Min 40 px hit area on narrow screens.

### Search box and results list
44 px, same surface as the top bar, centered, max 440 px. Placeholder: "Search places or coordinates". Accepts place names and coordinates in decimal or DMS (`37.62, -122.38`, `37°37'N 122°22'W`). Combobox pattern: `role="combobox"`, results `role="listbox"`, `aria-activedescendant`. Results popover (shadow-3) is grouped under "Places" and "Coordinates"; each result shows bold matched text, region, mono coordinates, and a type label ("City", "Airport"). The active result has the selected tint; arrows move, Enter flies to it, Esc closes, `/` focuses the box. Debounce 200 ms; show 3 skeleton rows while loading; "No places match 'xyz'. Try a larger area or enter coordinates." when empty; "Search is unavailable right now. Check your connection and try again." with Retry on error.

### Top bar
Three floating islands: app menu (menu icon + "God's Eye View" in 13/600, no logo glow), search, tools (theme toggle; room for share and settings). Menu holds Settings, API keys, About and attribution. Under 1100 px the name hides; under 760 px the Layers button joins the left island.

### Status bar
28 px, floating, 12 px text. Left: "Cursor" + mono coordinates (falls back to "Center" when the pointer is off the globe or on touch), "Altitude" camera height (km or m with thousands separators). Right: freshness button ("Live - 4 of 5 sources fresh", opens per-source list with ages and errors), Time ("Now"; later expands into the time slider docked above the bar), and an "Imagery & data attribution" link (required by Cesium and Google tiles; always visible, never hidden on narrow screens). All values update without animation.

### Detail panel
Header: category tile, identifier in mono 18/600 (callsign, MMSI, norad), subtitle (type, registration, operator), close. Actions row: Follow (primary), Show track, Copy link. Then the freshness chip and "Last seen". Sections as definition lists (label 112 px secondary, value primary, units and qualifiers in tertiary small): Position, Aircraft (or Vessel...), Source (feed, received time in UTC, whether the value was reported or estimated). Provenance is always last and always present. Scrolls internally beyond about 460 px.

### States
- Empty (detail, phase 1): cursor icon, "Nothing selected", one sentence telling how to select. No illustration, no marketing.
- Loading: skeleton bars matching the final layout, `aria-busy="true"`; no centered spinners. Layer rows show "Loading" chip with a thin indeterminate bar only while the first fetch is in flight.
- Error: warning icon, say what failed and what to do ("Couldn't load this object. The flights source didn't respond."), a Try again button; `role="alert"`. Layer-level errors stay inline in the row with Retry.
- Stale: keep showing the last data, mark the chip "Stale" with age; never blank a layer because it is old.

## Iconography

Lucide (ISC license), inlined as SVG symbols; in Svelte use `lucide-svelte` or `@lucide/svelte` tree-shaken, or paste individual symbols. 24 px grid, 1.75 px stroke, round caps and joins, rendered at 18 px (14 px dense, 12 px inside chips). One stroke weight everywhere. No icon fonts, no emoji, no Unicode glyphs as icons. The mock inlines the ones used: search, menu, sun/moon, chevrons, plane, ship, satellite, triangle-alert, cloud, factory, video, radio, key-round, clock, x, map-pin, crosshair, copy, layers, route.

## Accessibility checklist

- AA contrast verified for all text and status tokens in both themes (ratios above); 3:1 for control outlines and category colors.
- Visible focus: 2 px `--focus-ring` outline, 2 px offset, on every interactive element (`:focus-visible`); search and filter fields show the ring on the container.
- Targets at least 24 px (WCAG 2.2), 40 px on narrow screens.
- Switches, combobox, listbox and expandable groups use native or ARIA roles with names; icon-only buttons have `aria-label`.
- `prefers-reduced-motion`: durations collapse to about 0 via tokens and base.css.
- `forced-colors` focus handled in base.css; selection and scrollbars themed.
- Keyboard: all shell controls reachable; Esc closes popovers; panels collapse with a button, not only a gesture.

## Theming mechanics

Dark is the default on `:root`. Light applies through `@media (prefers-color-scheme: light)` on `:root:not([data-theme])`, or explicitly with `<html data-theme="light">`; `data-theme="dark"` forces dark. Components use only semantic tokens. The globe stage is not themed. The theme choice (system / light / dark) should be stored client-side and applied before first paint.

## Phase 3 map encodings

Shapes and hues stay the category's (see the table above); everything below is a second and third channel inside the category. Each layer row carries a collapsible "Key" (open the first time, then remembered) drawn from the same functions as the map, so the legend cannot drift from the markers. Code: `web/src/lib/quakeStyle.ts`, `featureStyle.ts`, `globe/layers/markers.ts`.

**Earthquakes** (hazards, circle). Size is magnitude: diameter 3.2 x 1.45^M px, clamped to 7-44 and bucketed to half units (M3 10 px, M5 21, M6 30, M7 43). Age is fill opacity in four steps against the viewed time (under 1 h 100%, under 6 h 80%, under 12 h 60%, older 42%); the rim fades far less, so old quakes stay readable as rings on dark ocean. Depth is a dark centre dot at 70 km and deeper; shallow is solid. Biggest events draw first so small ones stay visible on top. Labels (`M 5.1`) appear below 3,000 km camera height for the 60 nearest the view centre, and always for the selected one.

**Cyclones** (weather, rounded square). The storm centre is a rounded square with a dark eye, sized by class (depression 16 px, tropical storm 18, H1 20, H2 22, H3 25, H4 28, H5 30) and always labelled "Name H3": a handful of identities, not clutter. The recorded track is a solid 2 px line, the forecast a dashed 2 px line (not happened yet), forecast times 10 px translucent squares labelled "+24 h" when zoomed in, and the uncertainty cone a single 16% fill with a 1.5 px outline. Lines and cone sit 150 m above the surface; markers are pulled 2 km towards the camera so lines never cover them. No active storms: the row says "No active storms" and the Key hides.

**Launches** (space, star). Pad state is form, not hue: solid 26 px star = upcoming (drawn on top), hollow 20 px star = launched, hollow 22 px star with a cross in hazard red = failed or partial. Labels read "Mission · T-3 d" or "Mission · 26 d ago", one per spot and decluttered on screen ("+3 more here" when several launches share a pad).

**Satellites** (space, small star). Small 14 px stars; the selected satellite gets the white ring, a label, and its orbit for one period either side of the viewed time: dim for the part already flown, bright for the part ahead. Group filter is a native select in the row ("All groups (956)", "Space stations (20)"); more than four options, so not chips.

**Bikeshare** (ground, hexagon). The hexagon is a gauge: the category hue fills it from the bottom in proportion to the bikes at the station over its docks, in five steps (empty, 30%, 50%, 72%, solid), against a dark body with a hue rim. The ends mean trouble for a rider and are reserved for it: empty only when there is no bike to take (or the station is not renting), solid only when there is no dock free (or it is not accepting returns); one bike or one free dock always lands on a middle step. Fill is a position, not a hue, so it holds for colour-blind viewers and on any imagery. Other forms: a centred dot (bikes present, no dock count to measure against), a dim dashed rim with a cross (out of service), a dashed hollow rim (no reading yet). Size is dock count in three steps (14, 16, 18 px). Stations that need attention (empty, full) draw on top of healthy ones. Labels are station names, decluttered like the other point layers. The layer loads one city at a time: with a view wider than 12 degrees the row says "Zoom in to a city" and nothing is fetched.

**Radio** (signals, ring). A hollow ring; a centred dot means the stream plays in the browser, a bare ring means it opens as a link (HLS playlists, unknown or unsupported codecs, http streams on an https page). Ring diameter is how often the station is started on Radio Browser, in three steps (14, 17, 20 px), so well-known stations stand out at world zoom, where the list is thinned evenly over the map to 1,500. The detail panel has the only audio control: Play starts the stream on click (never before), Stop ends it and closes the connection, and leaving the station stops it. A note under the control says the audio comes straight from the station's server.

**Public cameras** (ground, hexagon). The hexagon is the camera; the wedge is the way it looks. A camera whose facing is a fact (the operator publishes it, the name says "EB", or it was set by hand from imagery) is a solid hexagon with a translucent 52 degree wedge pointing along its heading, drawn under every marker and rotated about the marker's centre so north stays north however the view is turned. A camera whose facing is only a placeholder (the source says nothing; the app draws a bearing from the camera id so views do not all point one way) is a hollow hexagon with a dashed rim and no wedge at all: drawing a direction nobody measured would be a false claim, and for a source with no facings (Austin, TfL) a field of dashed wedges would also bury the map. Known cameras draw on top of estimated ones. A small play notch in the hexagon marks a camera that publishes live video only. One size (15 px): a camera has no magnitude. Wedges show below 1,500 km camera height; labels (the camera name) follow the same declutter as other point layers below 3,000 km. The detail panel restates the encoding in words: a "Known direction" or dashed "Estimated direction" chip with the compass point, one sentence on where the direction comes from, and the full reason in the View section. The panel's picture is a 16:9 frame; the caption gives the time the picture was taken (from the source) and its age, in warning colour when older than three refresh intervals. "Look from here" flies the camera to the position and heading of the selected camera and says it is approximate: the lens, mount height and tilt are not known.

**Detail icons.** The detail panel tile uses the layer's own Lucide icon (bike for bikeshare, cctv for cameras, bus for transit, radio, rocket, activity for earthquakes and so on; `web/src/lib/layerIcons.ts`), falling back to the category icon. The category icon (ground: video) stays the layer panel's group icon only.

**History.** Cameras only have live pictures (the row says "Pictures are live only" while a past time is viewed). Bikeshare and radio only know the present ("Current" for bikeshare, "Snapshot" for the radio directory). Earthquakes follow the time slider (24 h up to the viewed time, chip "Recorded"). Cyclones and launches only know the present: the row shows "Current" and "Not recorded for past times". Satellites are computed for the viewed time ("Computed").

## Owner decisions (2026-10-02)

1. Indigo accent: approved.
2. Fonts: bundle JetBrains Mono for mono; system sans for UI.
3. Categories: approved (CCTV under ground, radio/SDR under signals).
4. Layer group collapsed state persists between sessions.
5. UI work uses the impeccable skill (critique/audit/polish before shipping).
