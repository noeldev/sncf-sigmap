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
- **OSM diff visualisation**: when a signal exists in OSM, the OSM Tags tab automatically renders a GitHub-style comparison between the generated tags and the live OSM ones — divergences and user merges are visible at a glance. Right-click opens a context menu to **merge** an OSM value into the target or **undo** a modification; **Merge all** and **Undo all** are always available, and `Ctrl+Z` / `Ctrl+Y` walk the per-node history stack
- Export tags to clipboard or via JOSM Remote Control
- View signal location on OpenStreetMap
- Filters by signal type, line code, track name, direction, placement, network ID
- **Line code** filter: search by code (numeric prefix) or by line label (text); dropdown shows code + truncated label with tooltip; clicking a line code tag flies the map with animation to the full extent of that line
- **Network ID** filter: searches all 123,870 signals; clicking a tag flies the map to that signal with a location marker
- Active filters persist across sessions and are restored on next visit
- `Supported types only` toggle to highlight signal types that have an OSM mapping (defined in `signal-types.js`)
- **Pinned signals**: Ctrl+click any signal to bookmark it; pinned signals appear in the Filters tab; clicking a pinned signal tag flies the map to it
- **Context menu**: right-click any signal for quick access to Zoom to, Pin/Unpin, and Properties
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
  ├── signal-popup.js  (openSignalPopup, closeSignalPopup, resolveStartTab)
  ├── context-menu.js  (showContextMenu, closeContextMenu)
  └── pins.js          (togglePin, isPinned)

sidebar.js
  ├── collapsible-panel.js
  ├── lang-picker.js      (language dropdown)
  ├── legend.js           (category buttons → filterByGroup)
  ├── filters.js          (initFilters)
  ├── filter-toolbar.js   (initFilterToolbar, updateFilterToolbar)
  └── pins.js             (initPins)

filters.js
  ├── filter-data.js       (accumulateSignals, getCandidateValues, getCountMap, …)
  └── filter-panel.js      (FilterPanel: DOM + UI controllers for one filter)

signal-popup.js
  ├── osm-checker.js      (OsmStatusChecker: lifecycle, caches, retry)
  ├── osm-diff.js         (computeTagDiff + editable target state with undo/redo)
  └── pins.js             (isPinned, togglePin, onPinsChange)

osm-checker.js
  ├── overpass.js         (fetchNodesByRef, getIdKey)
  └── signal-mapping.js   (getOsmNodes — mast grouping, getSignalId, isSupported)

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

## Signal popup

Click a signal marker to open a two-tab popup.

| Shortcut | Action |
|----------|--------|
| Click | Open signal popup |
| Shift+Click | Open popup on the alternate tab (configurable in Settings) |
| Ctrl+Click | Pin / unpin the signal |
| Alt+Click | Zoom to and center on the signal |
| Right-click | Open context menu (Zoom to, Pin/Unpin, Properties) |
| + / - | Zoom in / out |
| Home | Reset to initial map extent |
| F11 | Toggle fullscreen |
| B | Open / close basemap picker |
| L | Show My Location |
| S | Toggle sidebar |
| T | Collapse / expand map toolbar |
| Shift+F10 | Open context menu on focused signal (Tab to a signal first) |
| Enter | Open signal popup on focused signal |
| ? | Open help page |

### Signals tab

Displays the SNCF open data fields for the selected signal. When multiple co-located signals share the same geographic position, arrow buttons navigate between them.

The **OSM existence check** queries the [Overpass API](https://overpass-api.de/) to detect whether a node with the matching `railway:signal:*:ref` tag already exists in [OpenStreetMap](https://www.openstreetmap.org/). The query is scoped to a micro-bbox (~111 m half-width) around the signal group to keep Overpass queries cheap. The result appears as a button next to the **ID Réseau** value:

| Icon | Meaning |
|------|---------|
| OSM logo (color) | Signal found in OSM — click to view the node |
| Locate icon | Not yet mapped — click to open [openstreetmap.org](https://www.openstreetmap.org/) centered on the signal |
| … | Check in progress |
| ↻ | Check failed — click to retry |

IN_OSM results are cached permanently for the session. NOT_IN_OSM results are cached only for the current popup instance so a retry after a successful JOSM export sees the new node. Unknown signal types skip the Overpass check and show the locate button immediately. In-flight requests are cancelled via `AbortController` when the popup closes.

The **Signal Node** badge at the bottom shows which OSM node the signal maps to (`X / N` when the group produces multiple nodes). Click it or the **OSM Tags** tab to switch to the export view. Unknown types show **N/A**.

### OSM Tags tab

Displays the generated OSM tags for the current node. When a group produces multiple nodes, arrow buttons navigate between them — each node corresponds to a distinct physical signal or panel at the same location.

Once OSM data has been fetched for the node, the list switches to **Diff mode**: rows are rendered GitHub-style and become interactive (right-click menu, keyboard shortcuts). When OSM data is not available (loading, error, or signal not yet mapped), the list falls back to a flat read-only view.

#### Diff mode rendering

| Row style | Meaning |
|-----------|---------|
| Normal (no tint) | Target value equals both the app-generated value and OSM |
| Red (`−`) | OSM-only value, or OSM value conflicting with the target (rendered above the green target row) |
| Green (`+`) | Target value missing from OSM, or conflicting with OSM |
| Orange (`~`) | Target value has been modified by the user (merged from OSM or previously edited) |

Stale OSM-only keys are appended at the bottom as red rows.

#### Interactive merge workflow

In Diff mode, right-click (or Shift+F10 / Menu key when a row is focused) opens a unified context menu. Row-specific items appear first when the pointer is over a tag row, followed by the global batch actions:

| Context | Item | Effect |
|---------|------|--------|
| Red row | **Merge** | Write the OSM value into the target (overwrites any existing target value for that key) |
| Orange row | **Undo** | Restore the key to its original app-generated value; remove the key from the target if it was merged from an OSM-only row |
| Anywhere (global) | **Merge all** | Overwrite every in-scope target value with the OSM one (existing target choices are replaced — recoverable via **Undo all** or `Ctrl+Z`) |
| Anywhere (global) | **Undo all** | Restore every key to the original app-generated state |

App-generated tags are the source of truth (SNCF data + the OpenRailwayMap schema). They are never deleted — at worst their value is rolled back. Only keys that were added by merging an OSM-only row can be removed from the target, via **Undo** on that row.

`Ctrl+Z` and `Ctrl+Y` navigate the per-node history stack over every data mutation — bounded to 100 entries. The shortcuts are active only on the Tags tab when OSM data is available, so they never shadow the browser's native Ctrl+Z elsewhere.

Comparison scope is the SNCF signal schema (`railway=signal`, `railway:signal:*`) — OSM-only metadata (`source`, `operator`, `note`, `survey:date`, `ref`, …) is ignored by design so it never shows up as a false divergence or pollutes the target during **Merge all**. The scope predicate is parameterisable in `computeTagDiff()` and `mergeAll()` for future reuse.

Per-node target state is preserved while navigating between co-located nodes and reset on popup close.

### Copy tags

Click **Copy tags** to copy the current node's OSM tags to the clipboard.

### Open in JOSM

Click **Open in JOSM** to create a node at the signal's exact coordinates with all OSM tags pre-filled via JOSM Remote Control. The browser must allow HTTP requests to `127.0.0.1` from HTTPS pages. A confirmation dialog appears if the signal is already in OSM.

## Pinned signals

Hold **Ctrl** and click any signal marker to pin it. Pinned signals appear as tags in the **Pinned Signals** panel in the Filters tab. Clicking a pinned signal tag flies the map to that signal's location (fetching it from cache if necessary) and shows a temporary location marker. Pins persist across sessions.

## Sidebar

The sidebar has three tabs:

- **Filters** — add/remove attribute filters (collapsible panels); pinned signals and legend below
- **Settings** — basemap selector, language picker (EN/FR), behavior toggles, JOSM Remote Control status
- **About** — intro, links, disclaimer, credits

Collapsible panels (`cp-panel`) remember their open/closed state across sessions via localStorage.

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
├── netlify.toml                  ← Netlify configuration file (gzip headers for tiles)
├── robots.txt
├── assets/
│   ├── png/                      ← SNCF logos, favicon, basemap thumbnails
│   └── svg/                      ← favicon, JOSM, OSM, flag icons
├── css/
│   ├── base.css                  ← reset, custom properties, shared button bases, toggle switch
│   ├── filters.css               ← filter panels, dropdowns, active value tags, empty states
│   ├── map.css                   ← map container, markers, tooltips, statusbar, toolbar, basemap panel
│   ├── markup.css                ← Markdown-rendered elements styling (About tab only; removable once About migrates to help/)
│   ├── panel.css                 ← collapsible panels and subpanels layout styling
│   ├── popup.css                 ← signal popup (two-tab: Signals + OSM Tags, diff rows)
│   └── sidebar.css               ← sidebar layout, tabs, settings, about
├── data/                         ← generated by TileBuilder, committed to GitHub
│   ├── index.json
│   ├── manifest.json
│   └── tiles/
│       └── *.json.gz
├── help/                         ← standalone help pages (opened in a separate browser tab)
│   ├── help.css                  ← dark theme for help pages (replicates base.css tokens)
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
│   ├── collapsible-panel.js      ← cp-panel open/close state, localStorage persistence, ARIA
│   ├── config.js                 ← static constants (DATA_BASE, TILES_BASE, zoom thresholds,
│   │                               OVERVIEW_MAX_SIGNALS, basemap defaults, etc.)
│   ├── config.local.js           ← JAWG_API_KEY (local only, git-ignored)
│   ├── config.local.example.js   ← template for API key, safe to commit
│   ├── context-menu.js           ← floating context menu with event delegation and keyboard navigation
│   ├── filter-panel.js           ← per-filter DOM panel (label, active tags, combo input, dropdown list)
│   ├── filter-toolbar.js         ← "Add filter" button and dropdown menu (IoC, no state)
│   ├── filters.js                ← filter state, value index, dropdown orchestration
│   ├── help-channel.js           ← BroadcastChannel to send/receive commands between help page and main app
│   ├── josm.js                   ← JOSM Remote Control connection management
│   ├── lang-picker.js            ← language picker dropdown
│   ├── legend.js                 ← legend panel DOM builder and category filter shortcuts
│   ├── map.js                    ← Leaflet init, basemap layers, position persistence, location marker
│   ├── map-controls.js           ← toolbar wiring (delegated): zoom, geolocate, fullscreen, basemap, help, collapse
│   ├── map-layer.js              ← signal marker pipeline (worker → render); flyToSignal; flyToLine; Alt/Ctrl/right-click handling
│   ├── markup.js                 ← Markdown-like markup parser for string compilation (About tab only)
│   ├── osm-checker.js            ← OSM state machine: multi-node grouping, IN_OSM session cache,
│   │                               NOT_IN_OSM instance cache, micro-bbox queries, AbortController, auto-retry
│   ├── osm-diff.js               ← tag comparison + editable target state
│   │                               (merge / undo / mergeAll / undoAll + history stack)
│   │                               used by signal-popup.js for the OSM Tags diff mode
│   ├── overpass.js               ← pure Overpass API client (no cache, no state, AbortSignal-aware)
│   ├── pins.js                   ← pinned signals management, panel, navigation, onPinsChange observable
│   ├── prefs.js                  ← single source of truth for all localStorage access; onPrefsChange observable
│   ├── progress.js               ← progress overlay and flash messages
│   ├── sidebar.js                ← sidebar orchestration: tabs, legend, filters, pins, JOSM panel,
│   │                               BroadcastChannel listener for external help page commands
│   ├── signal-data.js            ← index.json loader; exposes loadIndexData(), getFilterData(),
│   │                               getNetworkIdIndex(), searchNetworkIds() (binary prefix search),
│   │                               getLineLabel(), getLineBbox(), searchLineCodes()
│   ├── signal-mapping.js         ← signal type → display category, OSM tag builder, getOsmNodes (mast grouping)
│   ├── signal-popup.js           ← signal popup: two-tab display, OSM/JOSM export, help button,
│   │                               OsmStatusChecker integration, interactive OSM Tags
│   │                               diff mode (merge / undo via osm-diff.js + Ctrl+Z/Y)
│   ├── signal-types.js           ← SIGNAL_MAPPING data table (type → group, OpenRailwayMap category/tags)
│   ├── sncf-convert.js           ← SNCF raw data normalization
│   ├── statusbar.js              ← statusbar DOM updates (zoom, count, filters, sample badge)
│   ├── tiles.js                  ← manifest loader, tile URL calculator, tile fetch helpers
│   ├── tiles-worker.js           ← tile fetch, normalization, filtering, adaptive sampling (Web Worker)
│   ├── tiles-worker-contract.js  ← worker message types and postMessage helpers
│   ├── tooltip.js                ← hover tooltip builder
│   ├── translation.js            ← i18n: strings loader, t(), openHelpPage(); uses prefs.js for lang persistence; onLangChange observable
│   ├── ui/
│   │   ├── combobox.js           ← search input behavior for filter dropdowns
│   │   ├── dropdown.js           ← generic accessible dropdown / listbox controller
│   │   └── tag-list.js           ← active-value tag container (event delegation, Shift+remove)
│   └── utils/
│       └── observable.js         ← minimal observer pattern — subscribe(fn) → unsubscribe; notify(...args)
├── strings/
│   ├── strings.en-us.json        ← English UI strings
│   └── strings.fr-fr.json        ← French UI strings
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
