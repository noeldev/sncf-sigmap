# SNCF Signalisation Permanente

[![JavaScript](https://img.shields.io/badge/JavaScript-ES2022-f7df1e?logo=javascript&logoColor=black)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![OpenStreetMap](https://img.shields.io/badge/OpenStreetMap-compatible-7ebc6f?logo=openstreetmap&logoColor=white)](https://www.openstreetmap.org/)
[![Leaflet](https://img.shields.io/badge/Leaflet-1.9-199900?logo=leaflet&logoColor=white)](https://leafletjs.com/)
[![Netlify Status](https://api.netlify.com/api/v1/badges/ca46fbb6-49ba-4257-a4c7-77ec6ae5a894/deploy-status)](https://app.netlify.com/projects/sncf-sigmap/deploys)

Interactive map viewer for the [SNCF Signalisation Permanente](https://data.sncf.com/) (Permanent Signalling) open dataset, with OpenStreetMap integration. Signals can be exported as OSM tags to the clipboard or via [JOSM Remote Control](https://josm.openstreetmap.de/).

On first visit, all tiles are fetched and cached by the browser. On subsequent visits, if a last position was saved, only the tiles for that area are loaded from cache. At low zoom a spatial sample is displayed for performance; at high zoom the full detail is shown.

## Features

- **123,870 signals** across France, split into ~289 gzip-compressed tiles (0.5° × 0.5°)
- Progressive display: spatial overview sample at low zoom, full detail at zoom 10 and above
- On first visit all tiles are cached; subsequent visits restore the last map position and load only the tiles for that area from cache
- Hover tooltips and click popups with signal information and OSM tags
- OSM existence check per signal via Overpass API (live badge in popup)
- **Filter clipboard**: chevron (›) button on each filter panel and the Pinned Signals panel opens Copy / Cut / Paste / Delete. Copy writes `text/plain` (CSV) + a custom MIME payload (`web application/sncf-sigmap`) for validated internal paste. `dataType` in the payload gates compatibility — `networkId` filters and Pinned Signals share the same type and can exchange values freely. Keyboard shortcuts Ctrl+C / Ctrl+X / Ctrl+V / Del active on focused tag lists.
- **Background OSM index**: `map-layer.js` triggers a viewport scan after 30 seconds of inactivity or on tooltip hover when guards pass (zoom ≥ 14, ≤ 100 visible signals, lat delta ≤ 0.35°, lng delta ≤ 0.5°). `osm-index.js` is a pure data service that queries Overpass for all `railway=signal` nodes in the padded fetch area and indexes them permanently for the session. Indexed results feed back into `osm-checker.js` so subsequent popup checks resolve instantly. Tooltip indicators update automatically: a **dotted underline** on the ID Réseau of each individually mapped signal, and an **OSM logo** on the first signal row when at least one signal in the group is confirmed in OSM
- **OSM diff visualisation**: when a signal exists in OSM, the OSM Tags tab automatically renders a GitHub-style comparison between the generated tags and the live OSM ones — divergences and user merges are visible at a glance. Right-click opens a context menu to **merge** an OSM value into the target or **undo** a modification; **Merge all** and **Undo all** are always available, and `Ctrl+Z` / `Ctrl+Y` walk the per-node history stack
- Export tags to clipboard or via JOSM Remote Control
- View signal location on OpenStreetMap
- Filters by signal type, line code, track name, direction, placement, network ID
- **Line code** filter: search by code (numeric prefix) or by line label (text); dropdown shows code + truncated label with tooltip; clicking a line code tag flies the map with animation to the full extent of that line
- **Network ID** filter: searches all 123,870 signals; clicking a tag flies the map to that signal with a location marker; hovering a tag shows a transient teardrop marker at the signal's position — even when the signal is not currently rendered in the viewport (async tile fetch with a generation-token cancellation guard so rapid hover sequences never leave stale markers)
- **Pinned signals hover preview**: hovering a pinned signal tag works identically — fast path when the signal is visible, async slow path otherwise
- Active filters persist across sessions and are restored on next visit
- `Supported types only` toggle to highlight signal types that have an OSM mapping (defined in `signal-types.js`)
- **Validation tool** (`validate.html`): four independent analyses run in parallel — (1) co-location conflicts (signals at the same location and direction that would force multiple OSM nodes due to a duplicate category); (2) unmapped SNCF signal types (GAIA codes absent from `signal-types.js`); (3) wiki spec diff (cross-checks `signal-types.js` OSM `{cat, type}` pairs against `OpenRailwayMap/Tagging_in_France`, reporting types only in the wiki, only in code, and fully matched); (4) JOSM preset sync (loads the `French_Railway_Signalling.xml` presets — from a configured local file/URL or the published GitHub copy — and diffs every `railway:signal:*` value against the wiki, reporting values only in the presets and only in the wiki). The wiki cross-checks (3) and (4) compare all value namespaces except those listed in `excludedNamespaces` (default `ETCS:`, documented in a separate spec). Header stats summarise the four sections. Results export two ways from an **Export** menu, both built from a single cached node-generation pass so they stay node-for-node consistent: a standard **GeoJSON** FeatureCollection (immediate download), or **MapRoulette cooperative challenges** — RFC 7464 line-by-line GeoJSON, every task carrying a base64 `.osc` so JOSM pre-creates the node(s). The export writes one file per leading line-code digit (0–9), one regional challenge each. A modal lists the ten files with their informal SNCF region label and per-file task/node counts; the footer total follows the current selection (the grand total — the parity figure to cross-check against the GeoJSON node count — when all are selected). Files download separately, or, with **merge** ticked, are concatenated into a single challenge file (ticking all ten yields one whole-France challenge on demand). Each MapRoulette task feature also carries a display-only `code_voie` (the SNCF track code shared by the node's signals), deliberately kept out of the `.osc` so it never reaches OSM; a challenge instruction can then name the target track — e.g. `Attach this signal to track {{code_voie}}` — to disambiguate multi-track areas without leaving anything to clean up. Co-located nodes are offset by ~50 cm so JOSM keeps them distinct. Signal chips link directly to the main app via `/?networkId=`. Duplicate networkId+signalType+trackCode combinations are highlighted in the conflict table with the chip's group color. Outlier detection uses an isolation-score algorithm (minimum networkId delta from the cluster) to identify the suspect node among duplicate signal types. Active conflict filters (excluded categories, mechanical toggle) are serialised to the URL hash (`#exclude=main&mech=0`) and restored on page load.
- **Pinned signals**: Ctrl+click any signal to bookmark it; pinned signals appear in the Filters tab; clicking a pinned signal tag flies the map to it
- **Context menu**: right-click any signal for quick access to Zoom to, Pin/Unpin, Properties, Share, and Locate on Google Maps. The "Locate on Maps" item opens Google Maps centred on the signal coordinates — from there, Street View is one click away, useful for confirming a signal's physical presence on the ground. All items display a colour-coded SVG icon (blue `var(--accent2)`) aligned in a fixed column — items without icons keep the column space so all labels align
- **URL parameters**: `?networkId=<id>` and `?lineCode=<code>` restore a specific signal or line on page load. networkId takes priority when both are present. Generated by the Share action — shareable links work across devices
- **Share**: right-click a signal → Share opens the native Web Share sheet (mobile/desktop) or copies the shareable URL to the clipboard as a fallback with a flash confirmation. Implemented in `webshare.js`
- Alt+click any signal to zoom and center without opening the popup
- Three basemaps: Jawg Transport, OpenStreetMap, Satellite — switchable from a floating panel on the map toolbar
- Collapsible map toolbar
- Persistent user preferences: default popup tab, JOSM confirmation, last map position, active filters, last basemap, pinned signals, collapsible panel states
- Bilingual interface (EN / FR) with runtime language switching
- Keyboard accessible (focus trap in popup, keyboard navigation in all dropdowns)
- **Adaptive signal cap**: the number of rendered marker groups is capped at `OVERVIEW_MAX_SIGNALS` in both overview and detail modes. When the cap is reached, a status badge appears and the sampling strategy adapts to the situation (see [Worker pipeline](#worker-pipeline) below)

## Architecture

```
sncf-data/
  signalisation-permanente.geojson          (never committed — 102 MB)
  mode-de-cantonnement-des-lignes.geojson   (never committed — 2 MB)
  formes-des-lignes-du-rfn.geojson          (never committed — variable size)
        │
        ▼  TileBuilder  (C# tool)
        │
data/
  manifest.json   ← tile index (~20 KB)
  index.json      ← signal types, line names + bboxes, block types, block segments, networkId spatial index (~1.2 MB)
data/tiles/
  -4_97.json.gz   ← one tile per 0.5° cell, 5–30 KB each
        │
        ▼  git commit + push  →  Netlify auto-deploys
        │
https://sncf-sigmap.netlify.app
```

Tiles are committed to GitHub and deployed by Netlify alongside the source code.

### Module dependency boundaries

```
app.js
  ├── map.js           (initMap → marker layer + controls + basemap label rebuild)
  ├── map-layer.js     (refresh, isSampled, flyToSignal, flyToLine)
  ├── sidebar.js       (initSidebar → all sidebar UI)
  ├── statusbar.js     (updateZoomStatus, setRecordCount, updateFilterCount, setSampledBadge)
  └── progress.js      (showProgress, hideProgress)

map.js
  ├── map-controls.js  (initMapControls — wired inside initMap)
  ├── map-layer.js     (initLayer — wired inside initMap)
  └── translation.js   (translateElement, onLangChange → basemap label rebuild)

map-layer.js
  ├── osm-index.js     (fetchViewport, abortScan, onUpdate — background OSM scanning;
  │                     guards and bbox computation owned by map-layer, not osm-index)
  ├── signal-popup.js  (openSignalPopup, closeSignalPopup, resolveStartTab)
  ├── context-menu.js  (showContextMenu, closeContextMenu)
  ├── pins.js          (togglePin, isPinned)
  └── webshare.js      (shareSignal, canShare — Share context menu item)

sidebar.js
  ├── collapsible-panel.js
  ├── lang-picker.js      (language dropdown)
  ├── legend.js           (category buttons → filterByGroup)
  ├── filters.js          (initFilters)
  ├── filter-toolbar.js   (initFilterToolbar, updateFilterToolbar)
  └── pins.js             (initPins)

filters.js
  ├── filter-config.js     (FILTER_FIELDS_META, getFilterFieldKeys — field registry shared with data layer)
  ├── filter-data.js       (accumulateSignals, getCandidateValues, getCountMap, …)
  └── filter-panel.js      (FilterPanel: DOM + UI controllers for one filter)

signal-popup.js
  ├── osm-checker.js      (OsmStatusChecker: lifecycle, caches, retry)
  ├── osm-diff.js         (computeTagDiff + editable target state with undo/redo)
  └── pins.js             (isPinned, togglePin, onPinsChange)

osm-checker.js
  ├── overpass.js         (fetchNodesByRef, getIdKey)
  ├── osm-index.js        (getOsmNode — instant resolution from permanent index; primeFromPopup — cross-feed on IN_OSM confirmation)
  └── signal-mapping.js   (getOsmNodes — mast grouping, getSignalId, isSupported)

tooltip.js
  └── osm-index.js        (getOsmNode — dotted underline on mapped IDs; group OSM badge on first row)

translation.js
  └── utils/observable.js (onLangChange fan-out)

pins.js
  └── utils/observable.js (onPinsChange fan-out)

prefs.js
  └── utils/observable.js (onPrefsChange fan-out)
```

### Worker pipeline

`tiles-worker.js` runs off the main thread and drives two independent concerns:

**Loading strategy** — controlled by the `forceOverview` flag from `map-layer.js`:
- `forceOverview = true` (zoom < `OVERVIEW_MAX_ZOOM`): all tiles are fetched in parallel with `Promise.all`, then filtered and sampled in a single pass before one `done` message is sent. This keeps the overview stable with no intermediate renders.
- `forceOverview = false` (detail mode): tiles are fetched sequentially; a `partial` message is sent after each tile so markers appear progressively. When the raw location count (`byKey.size`) exceeds `OVERVIEW_MAX_SIGNALS`, partial updates stop to avoid flooding the main thread, but loading continues silently until all tiles are processed.

**Sampling strategy** — determined by the actual filtered group count at the end, independently of the loading strategy. This matters when a filter (e.g. a single line code) greatly reduces the visible markers: `safetyTriggered` may be set (raw viewport is dense) while `sampled` remains false (filtered output fits within the cap). The cap is only declared and the badge only shown when `groups.length > OVERVIEW_MAX_SIGNALS` after filtering.

When sampling is needed, `_capGroups()` selects the strategy based on the excess ratio:
- **Small excess** (≤ 50% above the cap): sort by group size descending and slice to the cap. Preserves the most informative co-located groups and avoids the grid collisions that the spatial algorithm produces on a narrow viewport (e.g. a dense urban area at zoom 12–14, where all groups fall in the same grid cells).
- **Large excess** (> 50% above the cap): two-phase spatial grid sampling for a geographically representative distribution. Designed for the overview case (all of France with 120k+ signals).

## User interface documentation

Usage documentation for all interactive features (signal popup, OSM diff mode, hover tooltip indicators, keyboard shortcuts, filters, pinned signals) is available in the `/help/` pages, opened from within the app via the **?** buttons.

## External help

Help content lives in standalone HTML pages under `/help/{locale}/` (e.g. `/help/en-us/map.html`, `/help/fr-fr/popup.html`). Each locale has its own set of pages — no runtime language toggling in the help pages. The app controls which locale path to open via `openHelpPage(page)` in `translation.js`, using the current app language.

A `?` button in the map toolbar opens the **Map & Controls** help page; a matching `?` button in the popup nav-bar opens the **Signal Popup** page. Both reuse the same named browser tab (`HELP_WINDOW` in `translation.js`) so multiple clicks don't spawn new tabs.

`BroadcastChannel` (channel name private to `help-channel.js`) enables cross-tab communication: links in the help pages (e.g. "Filters", "Settings") send a `switch-tab` message that `sidebar.js` listens for and forwards to `_switchToTab()`.

## JOSM integration

JOSM is optional and only required for the **Open in JOSM** button.

### Prerequisites

JOSM → Edit → Preferences → Remote Control → **Enable remote control**

### Presets

Install the [French Railway Signalling JOSM Presets](https://noeldev.github.io/FrenchRailwaySignalling) to easily edit the imported signals.

## Internationalisation

UI strings are loaded from `strings/strings.{locale}.json` at boot time. The active language is detected from the browser locale, saved in localStorage, and can be switched at runtime from the Settings tab without a page reload.

String files support:
- `**bold**` → `<strong>bold</strong>`
- `*italic*` → `<em>italic</em>`
- `[label](url)` → external link
- `[label](#tab-id)` → internal tab link
- `[label](#panel:id)` → scroll-to-panel link
- `* item` → bulleted list item

Strings containing markup are precompiled to HTML at load time; `data-i18n` elements receive plain text, `data-i18n-html` elements receive the compiled HTML.

Subscriptions to language changes go through `utils/observable.js` (`onLangChange(fn) → unsubscribe`). The same shared observer pattern is reused by `pins.js` for `onPinsChange`.

## Signal type mapping

`js/signal-types.js` maps each SNCF signal type code (`type_if` in the raw data) to an application display category and to the corresponding [OpenRailwayMap OSM tags](https://wiki.openstreetmap.org/wiki/OpenRailwayMap/Tagging_in_France). Types not present in the mapping are shown in gray and cannot be exported.

`signal-mapping.js` owns the translation of one or more co-located features into OSM nodes (`getOsmNodes`): it groups features by direction and category, handles category conflicts by creating additional nodes, and builds the final tag map for each resulting node. Unsupported types at a location are aggregated into a single `fixme=*` tag on the node that shares their direction.

## Data files

### `data/manifest.json`

Tile index produced by TileBuilder. Loaded once at startup by `tiles.js`.

```json
{
  "tile_deg": 0.5,
  "tiles": {
    "-4:97": 12,
    "3:94":  847
  }
}
```

| Field | Description |
|-------|-------------|
| `tile_deg` | Spatial tile size in decimal degrees (0.5° × 0.5°). Must match `TILE_DEG` in `config.js`. |
| `tiles` | Map of tile key → signal count. Key is `"tx:ty"` where `tx = floor(lng / tile_deg)` and `ty = floor(lat / tile_deg)`. Used by `tiles.js` to resolve which tiles exist before fetching them. |

### `data/index.json`

Filter and lookup index produced by TileBuilder. Loaded once at startup by `signal-data.js`, which initialises `block-system.js`. Called by `app.js` in parallel with `loadManifest()`; `filters.js` awaits via `loadIndexData()`.

```json
{
  "signalType": {
    "CARRE": 16571,
    "Z":     7930
  },
  "lineCode": {
    "570000": {
      "count": 1820,
      "label": "Ligne de Paris-Austerlitz à Bordeaux-Saint-Jean",
      "bbox":  [[44.82536, -0.57412], [48.84673, 2.37065]]
    },
    "100000": { "count": 36, "label": null }
  },
  "blockType": [
    "BAL",
    "BAPR de double voie",
    "BM",
    "CT de voie unique",
    "…"
  ],
  "blockSegments": [
    ["205000", 69350, 72241, 0],
    ["205000", 72241, 85000, 1]
  ],
  "networkId": {
    "3:94": ["10045678", "10045679"],
    "-4:97": ["20001234"]
  }
}
```

| Field | Consumer | Description |
|-------|----------|-------------|
| `signalType` | `filters.js` | Signal type → count (full dataset). Populates the Signal type filter dropdown with global counts. |
| `lineCode` | `filters.js`, `block-system.js`, `map-layer.js` | Line code → `{ count, label?, bbox? }`. `count` is the signal count; `label` is the line display name from the block system dataset (`null` when absent); `bbox` is the line's geographic extent in Leaflet LatLngBounds format `[[minLat, minLng], [maxLat, maxLng]]` — absent when the line does not appear in the geometry dataset. Used by the Line code filter, the popup *Line name* field, and `flyToLine()`. |
| `blockType` | `block-system.js` | Ordered list of abbreviated block signaling type labels, indexed by position. |
| `blockSegments` | `block-system.js` | Compact segment array: `[line_code, start_m, end_m, block_idx]`. `start_m` / `end_m` are integer meters from the line origin (e.g. `"069+350"` → `69350`). `block_idx` indexes into `blockType`. Used to resolve the *Block system* field in the popup. |
| `networkId` | `signal-data.js` | Tile key → `[networkId, …]` compact spatial index. Used by `map-layer.js` (`flyToSignal`) and the networkId filter dropdown. `signal-data.js` also maintains a flat lexicographically sorted list of all networkIds for O(log n) prefix search via binary search. |

## Project structure

```
sncf-sigmap/
├── index.html
├── validate.html                 ← validation tool (co-location conflicts, unmapped types, wiki spec diff, JOSM preset sync)
├── netlify.toml                  ← Netlify configuration file (gzip headers for tiles)
├── robots.txt
├── assets/
│   ├── png/                      ← SNCF logos, favicon, basemap thumbnails
│   └── svg/                      ← favicon, JOSM, OSM, flag icons
├── css/
│   ├── app.css                   ← reset, layout, scrollbars, button foundations (index.html only)
│   ├── filters.css               ← filter panels, dropdowns, active value tags, empty states
│   ├── map.css                   ← map container, markers, tooltips, statusbar, toolbar, basemap panel
│   ├── markup.css                ← Markdown-rendered elements styling (About tab only; removable once About migrates to help/)
│   ├── panel.css                 ← collapsible panels and subpanels layout styling
│   ├── popup.css                 ← signal popup (two-tab: Signals + OSM Tags, diff rows)
│   ├── shared.css                ← CSS shared between index.html and validate.html
│   │                               (.app-header-brand/.app-header-logo, .logo-row, .logo-title, .beta-badge)
│   ├── sidebar.css               ← sidebar layout, tabs, settings, about
│   ├── tokens.css                ← CSS custom properties (palette, typography) — shared source of truth
│   └── validate.css              ← validate.html only: sticky page header, progress bar, stats grid,
│                                   conflict chips, filter dropdown, spec diff; extends tokens.css
├── data/                         ← generated by TileBuilder, committed to GitHub
│   ├── index.json
│   ├── manifest.json
│   └── tiles/
│       └── *.json.gz
├── help/                         ← standalone help pages (opened in a separate browser tab)
│   ├── help.css                  ← dark theme for help pages (replicates tokens.css variables)
│   ├── help.js                   ← BroadcastChannel listener for cross-tab sidebar commands
│   ├── en-us/                    ← English help pages
│   │   ├── index.html            ← hub — links to map.html and popup.html
│   │   ├── map.html              ← finding signals, map interaction, mouse/keyboard shortcuts
│   │   └── popup.html            ← signal properties, OSM Diff mode, export, popup shortcuts
│   └── fr-fr/                    ← French help pages (same structure)
│       ├── index.html
│       ├── map.html
│       └── popup.html
├── js/
│   ├── app.js                    ← boot sequencer; loads manifest + index in parallel, wires map events
│   ├── block-system.js           ← line label and block signaling type lookup; initialized by signal-data.js
│   ├── cat-mapping.js            ← application signal categories and colors (no DOM)
│   ├── clipboard.js              ← shared clipboard helpers (canPaste, copyValues, readNewValues,
│   │                               buildTagMenu, handleTagsKeydown); used by filter-panel.js and pins.js
│   ├── collapsible-panel.js      ← cp-panel open/close state; initCollapsiblePanels() with localStorage;
│   │                               initCollapsiblePanelsInRoot() without persistence (for validate.html)
│   ├── config.js                 ← static constants (DATA_BASE, TILES_BASE, zoom thresholds,
│   │                               OVERVIEW_MAX_SIGNALS, basemap defaults, APP_ID, CLIPBOARD_MIME_TYPE)
│   ├── config.local.js           ← JAWG_API_KEY (local only, git-ignored)
│   ├── config.local.example.js   ← template for API key, safe to commit
│   ├── context-menu.js           ← floating context menu with event delegation and keyboard navigation
│   ├── field-keys.js             ← canonical FIELD constant object; single source of truth for all field
│   │                               key strings (filterable + display-only); imported everywhere string
│   │                               literals would otherwise appear
│   ├── filter-config.js          ← ordered FILTER_FIELDS_META registry (field key → UI + behavior metadata);
│   │                               getFilterFieldKeys() is the data-layer accessor — analogous to
│   │                               getSupportedTypes() in signal-mapping.js; no circular dependency risk
│   │                               (imports only field-keys.js and config.js)
│   ├── filter-data.js            ← per-field count accumulation and value index (pure data layer, no DOM)
│   ├── filter-panel.js           ← per-filter DOM panel (label, active tags, combo input, dropdown list)
│   ├── filter-toolbar.js         ← "Add filter" button and dropdown menu (IoC, no state)
│   ├── filters.js                ← filter state, value index, dropdown orchestration; ALL_FILTER_FIELDS
│   │                               is derived from FILTER_FIELDS_META at load time (no manual sync)
│   ├── help-channel.js           ← BroadcastChannel to send/receive commands between help page and main app
│   ├── josm.js                   ← JOSM Remote Control connection management
│   ├── lang-picker.js            ← language picker dropdown
│   ├── legend.js                 ← legend panel DOM builder and category filter shortcuts
│   ├── map.js                    ← Leaflet init, basemap layers, position persistence, location marker
│   ├── map-controls.js           ← toolbar wiring (delegated): zoom, geolocate, fullscreen, basemap, help, collapse
│   ├── map-layer.js              ← signal marker pipeline (worker → render); flyToSignal; flyToLine;
│   │                               handleUrlParams (startup URL parameter dispatch); async
│   │                               showSignalPreview with generation-token cancellation;
│   │                               Alt/Ctrl/right-click handling; owns OSM scan wiring (idle timer,
│   │                               movestart/moveend, guard evaluation, bbox computation); _visibleCount
│   │                               is authoritative source read by _buildScanContext()
│   ├── markup.js                 ← Markdown-like markup parser for string compilation (About tab only)
│   ├── osm-checker.js            ← OSM state machine: multi-node grouping, IN_OSM session cache,
│   │                               NOT_IN_OSM instance cache, micro-bbox queries, AbortController, auto-retry
│   ├── osm-index.js              ← pure data service: permanent OSM signal presence index; no Leaflet
│   │                               dependency, no guard logic; fetchViewport(bbox, paddedBbox) checks coverage
│   │                               and runs Overpass scan; getOsmNode() for tooltip and checker;
│   │                               primeFromPopup() for popup cross-feed; abortScan() on map movement
│   ├── osm-diff.js               ← tag comparison + editable target state
│   │                               (merge / undo / mergeAll / undoAll + history stack)
│   │                               used by signal-popup.js for the OSM Tags diff mode
│   ├── overpass.js               ← pure Overpass API client (no cache, no state, AbortSignal-aware)
│   ├── pins.js                   ← pinned signals management, panel, navigation, onPinsChange observable;
│   │                               clipboard Copy/Cut/Paste/Delete menu via chevron button;
│   │                               dataType = FIELD.NETWORK_ID compatible with Network ID filter
│   ├── prefs.js                  ← single source of truth for all localStorage access; onPrefsChange observable
│   ├── progress.js               ← progress overlay and flash messages
│   ├── sidebar.js                ← sidebar orchestration: tabs, legend, filters, pins, JOSM panel,
│   │                               BroadcastChannel listener for external help page commands
│   ├── signal-data.js            ← index.json loader; exposes loadIndexData(), getFilterData()
│   │                               (field keys sourced from filter-config.js, no manual sync needed),
│   │                               getNetworkIdIndex(), searchNetworkIds() (binary prefix search),
│   │                               getLineLabel(), getLineBbox(), searchLineCodes()
│   ├── signal-mapping.js         ← signal type → display category, OSM tag builder, getOsmNodes
│   │                               (delegates to signal-grouping.js); contrastColor (W3C luminance,
│   │                               shared between signal-popup.js and report-renderer.js)
│   ├── signal-grouping.js        ← OSM node grouping logic (canFit, groupFeats, getTypePriority);
│   │                               shared between signal-mapping.js and validate/conflict-detector.js;
│   │                               no translation.js dependency; handles linkedCat affinity
│   ├── signal-popup.js           ← signal popup: two-tab display, OSM/JOSM export, help button,
│   │                               OsmStatusChecker integration, interactive OSM Tags
│   │                               diff mode (merge / undo via osm-diff.js + Ctrl+Z/Y)
│   ├── signal-types.js           ← SIGNAL_MAPPING data table (type → group, OpenRailwayMap category/tags);
│   │                               optional linkedCat field groups co-located signals (e.g. FR:Z with its FR:TIV-D)
│   ├── sncf-convert.js           ← SNCF raw data normalization
│   ├── statusbar.js              ← statusbar DOM updates (zoom, count, filters, sample badge)
│   ├── tiles.js                  ← manifest loader, tile URL calculator, tile fetch helpers
│   ├── tiles-worker.js           ← tile fetch, normalization, filtering, adaptive sampling (Web Worker)
│   ├── tiles-worker-contract.js  ← worker message types and postMessage helpers
│   ├── tooltip.js                ← hover tooltip builder; OSM indicators: dotted underline on mapped
│   │                               ID Réseau, OSM logo badge on first row (via osm-index.js)
│   ├── translation.js            ← i18n: strings loader, t(), openHelpPage(); uses prefs.js for lang persistence; onLangChange observable
│   ├── webshare.js               ← Web Share API integration (shareSignal, shareLine, canShare);
│   │                               clipboard URL fallback with flash notification; FIELD keys used
│   │                               as URL parameter names so sharing stays in sync with field-keys.js
│   ├── ui/
│   │   ├── combobox.js           ← search input behavior for filter dropdowns
│   │   ├── dropdown.js           ← generic accessible dropdown / listbox controller
│   │   └── tag-list.js           ← active-value tag container (event delegation, Shift+remove)
│   ├── utils/
│   │   └── observable.js         ← minimal observer pattern — subscribe(fn) → unsubscribe; notify(...args)
│   └── validate/
│       ├── conflict-detector.js         ← location group builder and OSM node conflict detection;
│       │                                  delegates grouping to signal-grouping.js (no mirrored logic)
│       ├── conflict-filter.js           ← conflict table filter state (_excludedCats, _showMechanical);
│       │                                  applies row visibility, renumbers visible rows, serialises
│       │                                  active filters to the URL hash and restores them on load
│       ├── outlier-detector.js          ← isolation-score algorithm to identify the outlier instance
│       │                                  among duplicate signal types at the same location; used by
│       │                                  validate-main.js to guide the two-pass groupFeats() call
│       ├── preset-parser.js             ← JOSM preset XML parser: flat [key, value] tuple extraction
│       │                                  (combo/multiselect/list_entry; check value_on=yes/value_off=no
│       │                                  defaults + disable_off); reference/chunk resolution with cycle
│       │                                  guard; pure module, network access isolated in fetchPresetXML()
│       ├── report-renderer.js           ← DOM rendering for all validation sections incl. preset sync
│       │                                  and header stats; template-based, no HTML strings; lazy OSM
│       │                                  hrefs; filter state and hash delegated to conflict-filter.js
│       ├── spec-compare.js              ← wiki cross-checks: compareSpecs (signal-types.js {cat, type}
│       │                                  vs wiki catalog) and comparePresetToWiki (presets vs wiki);
│       │                                  all value namespaces except EXCLUDED_NAMESPACES (default ETCS:)
│       ├── validate-config.example.json ← template for the local, git-ignored validate-config.json:
│       │                                  presetSource, wikiSource (optional local file/URL),
│       │                                  excludedNamespaces
│       ├── validate-main.js             ← validation orchestrator: parallel wiki fetch + tile scan, plus
│       │                                  the automatic preset cross-check; loads validate-config.json;
│       │                                  try/catch per tile so one failing tile never aborts the run
│       └── wiki-parser.js               ← MediaWiki parse API (prop=wikitext) or local file via
│                                          wikiSource; extracts all railway:signal {{Tag}}/{{TagValue}}
│                                          values; API result cached in sessionStorage (1 h TTL)
├── strings/
│   ├── strings.en-us.json        ← English UI strings (main app)
│   ├── strings.fr-fr.json        ← French UI strings (main app)
│   └── validate.en-us.json       ← English UI strings for validate.html
└── tools/
    └── TileBuilder/              ← C# tile generator
        ├── AcronymEntry.cs
        ├── BlockProcessor.cs
        ├── BlockResult.cs
        ├── BuildConfig.cs
        ├── CliOptions.cs
        ├── ConfigLoader.cs
        ├── Constants.cs
        ├── CrossCheck.cs
        ├── GeometryProcessor.cs
        ├── IndexWriter.cs
        ├── LineInfo.cs
        ├── Program.cs
        ├── Signal.cs
        ├── SignalData.cs
        ├── SignalReader.cs
        ├── TileWriter.cs
        ├── tilebuilder.config.json
        └── TileBuilder.csproj
```

## First-time setup

### Generate tiles

Open `tools/TileBuilder/TileBuilder.csproj` in [Microsoft Visual Studio](https://visualstudio.microsoft.com/downloads/).

Download the SNCF open data files from [data.sncf.com](https://data.sncf.com/) into a local folder (never committed):

| File | URL | Required |
|------|-----|----------|
| `signalisation-permanente.geojson` | [data.sncf.com](https://data.sncf.com/explore/dataset/signalisation-permanente/) | **Required** |
| `mode-de-cantonnement-des-lignes.geojson` | [data.sncf.com](https://data.sncf.com/explore/dataset/mode-de-cantonnement-des-lignes/) | Optional — provides block system types and line labels |
| `formes-des-lignes-du-rfn.geojson` | [data.sncf.com](https://data.sncf.com/explore/dataset/formes-des-lignes-du-rfn/) | Optional — provides line bounding boxes for `flyToLine()` |

Set the debug profile arguments (*Project → Properties → Debug → Open debug launch profiles UI*):

| Field | Value |
|-------|-------|
| Command line arguments | `-s "C:\path\to\sncf-data" -o "C:\path\to\sncf-sigmap\data"` |

Press **Ctrl+F5**. Output: `data\manifest.json`, `data\index.json`, and ~289 `.json.gz` tile files in `data\tiles\` (created automatically).

The `tools/TileBuilder/tilebuilder.config.json` file controls the input file names and the block type abbreviation table. Edit it to add new acronyms without recompiling.

To rebuild only `data\index.json` and `data\manifest.json` without regenerating tile files, add `-n` (`--no-tiles`) to the arguments.

### Configure the Jawg API key (optional)

The app works without a Jawg key — it falls back to standard OpenStreetMap tiles automatically.

To enable it:
- Copy `js/config.local.example.js` to `js/config.local.js`
- Edit `js/config.local.js` and fill in your key:
```js
export const JAWG_API_KEY = 'your-token-here';
```

Get a free key at [jawg.io](https://jawg.io). `config.local.js` is listed in `.gitignore` and will never be committed.

### Configure the validation tool (optional)

`validate.html` needs no configuration: the wiki is read from the live MediaWiki API and the JOSM presets from the published GitHub copy. To validate **local, uncommitted** edits instead, copy `js/validate/validate-config.example.json` to `js/validate/validate-config.json` (git-ignored) and set:

- `presetSource` — path or URL to a local `French_Railway_Signalling.xml`
- `wikiSource` — path or URL to a local wikitext dump (omit to use the API)
- `excludedNamespaces` — value namespaces skipped in the wiki cross-checks (default `["ETCS:"]`)

Because the dev server's web root is `sncf-sigmap`, point these at a sibling repo through a junction/symlink inside the root (e.g. `mklink /J FrenchRailwaySignalling ..\FrenchRailwaySignalling` on Windows). Keep that junction out of git via `.git/info/exclude`.

## Local development

### Serving locally with Caddy (recommended)

```caddy
localhost {
    root * C:\path\to\sncf-sigmap
    encode gzip
    @gz {
        path *.json.gz
    }
    header @gz Content-Encoding gzip
    header @gz Content-Type application/json
    file_server
    tls internal
}
```

### Testing with Netlify locally

For closer-to-production testing without Caddy, the [Netlify CLI](https://docs.netlify.com/cli/get-started/) can replicate the redirect and header rules from `netlify.toml`:

```
# Serve locally with Netlify rules (port 8888 by default)
npm install -g netlify-cli
netlify login # one-time authentication
netlify dev
```

> **Note**: `netlify dev` does not replicate the `.json.gz` tile decompression from `netlify.toml` — tiles will fail to load. Use `netlify deploy` (below) for real-condition testing.

To deploy a live draft for real-condition testing without touching the production URL:

```
# Creates a draft URL (e.g. https://abc123def456--sncf-sigmap.netlify.app)
netlify deploy
```

Push to `main` to trigger an automatic production deploy via the Netlify GitHub integration.

## Data sources

| Source | Licence |
|--------|---------|
| [Signalisation permanente SNCF](https://data.sncf.com/explore/dataset/signalisation-permanente/) | [Licence Ouverte 2.0](https://www.etalab.gouv.fr/licence-ouverte-open-licence) |
| [Mode de cantonnement des lignes SNCF](https://data.sncf.com/explore/dataset/mode-de-cantonnement-des-lignes/) | [Licence Ouverte 2.0](https://www.etalab.gouv.fr/licence-ouverte-open-licence) |
| [Formes des lignes du RFN](https://data.sncf.com/explore/dataset/formes-des-lignes-du-rfn/) | [Licence Ouverte 2.0](https://www.etalab.gouv.fr/licence-ouverte-open-licence) |
| [OpenStreetMap](https://www.openstreetmap.org/) | [ODbL](https://opendatacommons.org/licenses/odbl/) |
| [Jawg Maps](https://jawg.io/) | Commercial (free tier, optional) |

## License

This project is licensed under the [GNU Affero General Public License v3.0 or later](https://www.gnu.org/licenses/agpl-3.0.html) (AGPL-3.0-or-later).
All source files carry an [SPDX](https://spdx.dev/) identifier in their header:

```
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Noël Danjou
```
