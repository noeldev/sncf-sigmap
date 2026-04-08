# SNCF Signalisation Permanente

[![JavaScript](https://img.shields.io/badge/JavaScript-ES2022-f7df1e?logo=javascript&logoColor=black)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![OpenStreetMap](https://img.shields.io/badge/OpenStreetMap-compatible-7ebc6f?logo=openstreetmap&logoColor=white)](https://www.openstreetmap.org/)
[![Leaflet](https://img.shields.io/badge/Leaflet-1.9-199900?logo=leaflet&logoColor=white)](https://leafletjs.com/)
[![Netlify Status](https://api.netlify.com/api/v1/badges/ca46fbb6-49ba-4257-a4c7-77ec6ae5a894/deploy-status)](https://app.netlify.com/projects/sncf-sigmap/deploys)

Interactive map viewer for the [SNCF Signalisation Permanente](https://data.sncf.com/) (Fixed Signaling) open dataset, with OpenStreetMap integration. Signals can be exported as OSM tags to the clipboard or via [JOSM Remote Control](https://josm.openstreetmap.de/).

On first visit, all tiles are fetched and cached by the browser. On subsequent visits, if a last position was saved, only the tiles for that area are loaded from cache. At low zoom a spatial sample is displayed for performance; at high zoom the full detail is shown.

## Features

- **123,870 signals** across France, split into ~289 gzip-compressed tiles (0.5° × 0.5°)
- Progressive display: spatial overview sample at low zoom, full detail at zoom 10 and above
- On first visit all tiles are cached; subsequent visits restore the last map position and load only the tiles for that area from cache
- Hover tooltips and click popups with signal information and OSM tags
- OSM existence check per signal via Overpass API (live badge in popup)
- Export tags to clipboard or via JOSM Remote Control
- View signal location on OpenStreetMap
- Filters by signal type, line code, track name, direction, placement, network ID
- Network ID filter searches all 123,870 signals; clicking a pill flies the map to that signal with a location marker
- Active filters persist across sessions and are restored on next visit
- `Supported types only` toggle to highlight signals already mapped in `signal-mapping.js`
- **Pinned signals**: Ctrl+click any signal to bookmark it; pinned signals appear in the Filters tab and can be used to fly back to any signal
- **Context menu**: right-click any signal for quick access to Zoom to, Pin/Unpin, and Properties
- Alt+click any signal to zoom and center without opening the popup
- Three basemaps: Jawg Transport, OpenStreetMap, Satellite — switchable from a floating panel on the map toolbar
- Collapsible map toolbar
- Persistent user preferences: default popup tab, JOSM confirmation, last map position, active filters, last basemap, pinned signals, collapsible panel states
- Bilingual interface (EN / FR) with runtime language switching
- Keyboard accessible (focus trap in popup, keyboard navigation in all dropdowns)

## Architecture

```
sncf-data/
  signalisation-permanente.geojson          (never committed — 102 MB)
  mode-de-cantonnement-des-lignes.geojson   (never committed — 2 MB)
        │
        ▼  TileBuilder  (C# tool)
        │
data/tiles/
  manifest.json   ← tile index (~20 KB)
  index.json      ← signal types, line names, block types, block segments, networkId spatial index (~1.2 MB)
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
  ├── map-layer.js     (refresh, isSampled)
  ├── sidebar.js       (initSidebar → all sidebar UI)
  ├── statusbar.js     (updateZoomStatus, setRecordCount, updateFilterCount)
  └── progress.js      (showProgress, hideProgress)

map.js
  ├── map-controls.js  (initMapControls — wired inside initMap)
  ├── map-layer.js     (initLayer — wired inside initMap)
  └── translation.js   (translateElement, onLangChange → basemap label rebuild)

map-layer.js
  ├── ui/context-menu.js  (showContextMenu, closeContextMenu)
  └── pins.js             (togglePin, isPinned)

sidebar.js
  ├── collapsible-panel.js
  ├── lang-picker.js      (language dropdown)
  ├── legend.js           (category buttons → filterByGroup)
  ├── filters.js          (initFilters, loadFilterIndex)
  ├── filter-toolbar.js   (initFilterToolbar, updateFilterToolbar)
  └── pins.js             (initPins — after index load)

filters.js
  ├── cat-mapping.js     (getCategoryEntries — for _detectActiveGroup)
  ├── map-layer.js       (isSampled, getSignalLatlng)
  └── map.js             (flyToLocationWithMarker)

prefs.js               (single source of truth for all localStorage access)
markup.js              (pure functions for parsing inline markdown/lists)
translation.js         (uses getLangPref / setLangPref from prefs.js, uses markup.js)```
```

Tiles are stored as `.json.gz` files but requested by the app as `.json` URLs:
- **Netlify**: `netlify.toml` redirects `.json` → `.json.gz` and sets `Content-Encoding: gzip`
- **Caddy (local)**: a `handle @tiles` block rewrites `.json` requests to `.json.gz` and sets `Content-Encoding: gzip`

See the Caddyfile snippet in [Local development](#local-development) below.

## Local development

The app is served locally via [Caddy](https://caddyserver.com/).
Tile files are stored as `.json.gz` but requested as `.json` — the `handle @tiles` block rewrites the URL and sets the correct headers so the browser decompresses transparently, identical to Netlify in production.

```
localhost:8443 {
	root * {system.wd}

	@tiles {
		path /data/tiles/*.json
		not file {path}
	}
	handle @tiles {
		rewrite * {path}.gz
		header Content-Type     application/json
		header Content-Encoding gzip
		header Cache-Control    "public, max-age=86400, must-revalidate"
		file_server
	}

	file_server
    tls internal
}
```

## First-time setup

### Generate tiles

Open `tools/TileBuilder/TileBuilder.csproj` in [Microsoft Visual Studio](https://visualstudio.microsoft.com/downloads/).

Download the two SNCF open data files from [data.sncf.com](https://data.sncf.com/) into a local folder (never committed):

- `signalisation-permanente.geojson`
- `mode-de-cantonnement-des-lignes.geojson`

Set the debug profile arguments (*Project → Properties → Debug → Open debug launch profiles UI*):

| Field | Value |
|-------|-------|
| Command line arguments | `-s "C:\path\to\sncf-data" -o "C:\path\to\sncf-sigmap\data\tiles"` |

Press **Ctrl+F5**. Output: `data\manifest.json`, `data\index.json`, and ~289 `.json.gz` tile files in `data\tiles\`.

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

### Signals tab

Displays the SNCF open data fields for the selected signal. When multiple co-located signals share the same geographic position, arrow buttons navigate between them.

The **OSM existence check** queries the [Overpass API](https://overpass-api.de/) to detect whether a node with the matching `railway:signal:*:ref` tag already exists in [OpenStreetMap](https://www.openstreetmap.org/). The result appears as a button next to the **ID Réseau** value:

| Icon | Meaning |
|------|---------|
| OSM logo (color) | Signal found in OSM — click to view the node |
| Locate icon | Not yet mapped — click to open [openstreetmap.org](https://www.openstreetmap.org/) centered on the signal |
| … | Check in progress |
| ↻ | Check failed — click to retry |

Results are cached for the session. Unsupported signal types skip the Overpass check and show the locate button immediately.

The **Signal Node** badge at the bottom shows which OSM node the signal maps to (`X / N` when the group produces multiple nodes). Click it or the **OSM Tags** tab to switch to the export view. Unsupported types show **N/A**.

### OSM Tags tab

Displays the generated OSM tags for the current node. When a group produces multiple nodes, arrow buttons navigate between them — each node corresponds to a distinct physical signal or panel at the same location.

### Copy tags

Click **Copy tags** to copy the current node's OSM tags to the clipboard.

### Open in JOSM

Click **Open in JOSM** to create a node at the signal's exact coordinates with all OSM tags pre-filled via JOSM Remote Control. The browser must allow HTTP requests to `127.0.0.1` from HTTPS pages. A confirmation dialog appears if the signal is already in OSM.

## Pinned signals

Hold **Ctrl** and click any signal marker to pin it. Pinned signals appear as pill tags in the **Pinned Signals** panel in the Filters tab. Clicking a pill flies the map to that signal's location (fetching it from cache if necessary) and shows a temporary location marker. Pins persist across sessions.

## Sidebar

The sidebar has four tabs:

- **Filters** — add/remove attribute filters (collapsible panels); pinned signals and legend below
- **Settings** — basemap selector, language picker (EN/FR), behavior toggles, JOSM Remote Control status
- **Help** — mouse interactions, keyboard shortcuts (with "How to use" outer panel), and filter pill interactions
- **About** — intro, links, disclaimer, credits

Collapsible panels (`cp-panel`) remember their open/closed state across sessions via localStorage.

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

## Signal type mapping

`js/signal-mapping.js` maps each SNCF signal type code (`type_if` in the raw data) to an application display category and to the corresponding [OpenRailwayMap OSM tags](https://wiki.openstreetmap.org/wiki/OpenRailwayMap/Tagging_in_France). Types not present in the mapping are shown in gray and cannot be exported.

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

Filter and lookup index produced by TileBuilder. Loaded once at startup by `filters.js` (which also initialises `block-system.js` from the same data).

```json
{
  "signalType": {
    "CARRE": 16571,
    "Z":     7930
  },
  "lineCode": {
    "570000": { "count": 1820, "label": "Ligne de Paris-Austerlitz à Bordeaux-Saint-Jean" },
    "100000": { "count": 36,   "label": null }
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
| `lineCode` | `filters.js`, `block-system.js` | Line code → `{ count, label }`. `count` is the signal count; `label` is the line display name from the block system dataset (`null` when absent). Populates the Line code filter and the popup *Line name* field. |
| `blockType` | `block-system.js` | Ordered list of abbreviated block signaling type labels, indexed by position. |
| `blockSegments` | `block-system.js` | Compact segment array: `[line_code, start_m, end_m, block_idx]`. `start_m` / `end_m` are integer meters from the line origin (e.g. `"069+350"` → `69350`). `block_idx` indexes into `blockType`. Used to resolve the *Block system* field in the popup. |
| `networkId` | `filters.js` | Tile key → `[networkId, …]` compact spatial index. Used to locate any signal by Network ID across the full dataset. Loaded lazily after the map displays. |

## Project structure

```
sncf-sigmap/
├── index.html
├── netlify.toml                  ← Netlify configuration file (gzip headers for tiles)
├── assets/
│   ├── png/                      ← SNCF logos, favicon, basemap thumbnails
│   └── svg/                      ← favicon, JOSM, OSM, flag icons
├── css/
│   ├── base.css                  ← reset, custom properties, shared button bases, toggle switch
│   ├── filters.css               ← filter panels, dropdowns, pill tags, empty states
│   ├── map.css                   ← map container, markers, tooltips, statusbar, toolbar, basemap panel
│   ├── markup.css                ← Markdown-rendered elements styling
│   ├── panel.css                 ← panel,collapsible panels and subpanels layout styling
│   ├── popup.css                 ← signal popup (two-tab: Signals + OSM Tags)
│   └── sidebar.css               ← sidebar layout, tabs, settings, about
├── data/                         ← generated by TileBuilder, committed to GitHub
│   ├── index.json
│   ├── manifest.json
│   └── tiles/
│       └── *.json.gz
├── js/
│   ├── app.js                    ← boot sequencer; knows only map, sidebar, statusbar, progress
│   ├── block-system.js           ← line label and block signaling type lookup (called from filters.js)
│   ├── cat-mapping.js            ← application signal categories and colors (no DOM)
│   ├── collapsible-panel.js      ← cp-panel open/close state, localStorage persistence, ARIA
│   ├── config.js                 ← static constants (DATA_BASE, TILES_BASE, zoom thresholds…)
│   ├── config.local.js           ← JAWG_API_KEY (local only)
│   ├── config.local.example.js   ← template for API key, safe to commit
│   ├── filter-panel.js           ← per-filter DOM panel (label, pills, combo, list)
│   ├── filter-toolbar.js         ← "Add filter" button and dropdown menu (IoC, no state)
│   ├── filters.js                ← filter state, value index, dropdown orchestration
│   ├── josm.js                   ← JOSM Remote Control connection management
│   ├── lang-picker.js            ← language picker dropdown
│   ├── legend.js                 ← legend panel DOM builder and category filter shortcuts
│   ├── map.js                    ← Leaflet init, basemap layers, position persistence, location marker
│   ├── map-controls.js           ← toolbar wiring (delegated): zoom, geolocate, fullscreen, basemap, collapse
│   ├── map-layer.js              ← signal marker pipeline (worker → render); Alt/Ctrl/right-click handling
│   ├── markup.js                 ← Markdown-like markup parser for string compilation│   ├── overpass.js               ← Overpass API existence check (batch)
│   ├── pins.js                   ← pinned signals management, panel, navigation
│   ├── prefs.js                  ← single source of truth for all localStorage access
│   ├── progress.js               ← progress overlay and flash messages
│   ├── sidebar.js                ← sidebar orchestration: tabs, legend, filters, pins, JOSM panel
│   ├── signal-mapping.js         ← signal type → display category + OSM tag builder
│   ├── signal-popup.js           ← signal data popup, copy tags, JOSM / OSM export
│   ├── sncf-convert.js           ← SNCF raw data normalization
│   ├── statusbar.js              ← statusbar DOM updates (zoom, count, filters)
│   ├── tiles.js                  ← manifest loader, tile URL calculator
│   ├── tiles.worker.js           ← tile fetch, normalization, spatial/attribute filtering (Web Worker)
│   ├── tooltip.js                ← hover tooltip builder
│   ├── translation.js            ← i18n: strings loader, t(); uses prefs.js for lang persistence
│   ├── worker-contract.js        ← worker message types and postMessage helpers
│   └── ui/
│       ├── combobox.js           ← search input behavior for filter dropdowns
│       ├── context-menu.js       ← floating context menu with event delegation and keyboard navigation
│       ├── dropdown.js           ← generic accessible dropdown / listbox controller
│       └── pill-list.js          ← selected-value pill container (event delegation, Shift+remove)
├── strings/
│   ├── strings.en-us.json        ← English UI strings
│   └── strings.fr-fr.json        ← French UI strings
└── tools/
    └── TileBuilder/              ← C# tile generator
        ├── AcronymEntry.cs
        ├── BuildConfig.cs
        ├── BlockProcessor.cs
        ├── BlockResult.cs
        ├── CliOptions.cs
        ├── ConfigLoader.cs
        ├── Constants.cs
        ├── CrossCheck.cs
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

## Data sources

| Source | Licence |
|--------|---------|
| [Signalisation permanente SNCF](https://data.sncf.com/) | [Licence Ouverte 2.0](https://www.etalab.gouv.fr/licence-ouverte-open-licence) |
| [Mode de cantonnement des lignes SNCF](https://data.sncf.com/explore/dataset/mode-de-cantonnement-des-lignes/) | [Licence Ouverte 2.0](https://www.etalab.gouv.fr/licence-ouverte-open-licence) |
| [OpenStreetMap](https://www.openstreetmap.org/) | [ODbL](https://opendatacommons.org/licenses/odbl/) |
| [Jawg Maps](https://jawg.io/) | Commercial (free tier, optional) |
