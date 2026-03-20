# SNCF Signalisation Permanente

[![JavaScript](https://img.shields.io/badge/JavaScript-ES2022-f7df1e?logo=javascript&logoColor=black)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![OpenStreetMap](https://img.shields.io/badge/OpenStreetMap-compatible-7ebc6f?logo=openstreetmap&logoColor=white)](https://www.openstreetmap.org/)
[![Leaflet](https://img.shields.io/badge/Leaflet-1.9-199900?logo=leaflet&logoColor=white)](https://leafletjs.com/)
[![Netlify Status](https://api.netlify.com/api/v1/badges/ca46fbb6-49ba-4257-a4c7-77ec6ae5a894/deploy-status)](https://app.netlify.com/projects/sncf-sigmap/deploys)

Interactive map viewer for the [SNCF Signalisation Permanente](https://data.sncf.com/) (Fixed Signalling) open dataset, with OpenStreetMap integration. Signals can be exported as OSM tags to the clipboard or via [JOSM Remote Control](https://josm.openstreetmap.de/).

Only tiles visible in the current viewport are fetched — no full dataset download.

## Features

- **123,870 signals** across France, split into ~289 gzip-compressed tiles (0.5° × 0.5°)
- Progressive display: spatial sampling at low zoom, full detail at zoom ≥ 10
- Hover tooltips and click popups with signal information and OSM tags
- OSM existence check per signal via Overpass API (live badge in popup)
- Export tags to clipboard or via JOSM Remote Control
- View signal location on OpenStreetMap
- Filters by signal type, line code, track name, direction, position
- `Supported types only` toggle to highlight signals already mapped in `signal-mapping.js`
- Three basemaps: Jawg Transport, OpenStreetMap, Satellite
- Bilingual interface (EN / FR)

## Architecture

```
signalisation-permanente.geojson   (never committed — 102 MB)
        │
        ▼  TileBuilder  (C# tool)
        │
data/tiles/
  manifest.json       ← tile index (~20 KB)
  index.json          ← filter index (type_if, code_ligne values)
  -4_97.json.gz       ← one tile per 0.5° cell, 5–30 KB each
        │
        ▼  git commit + push  →  Netlify auto-deploys
        │
https://sncf-sigmap.netlify.app
```

Tiles are committed to GitHub and deployed by Netlify alongside the source code. The `netlify.toml` file sets `Content-Encoding: gzip` headers so the browser decompresses tiles transparently.

## First-time setup

### Generate tiles

Open `tools/TileBuilder/TileBuilder.csproj` in [Microsoft Visual Studio](https://visualstudio.microsoft.com/downloads/).

Set the debug profile arguments (*Project → Properties → Debug → Open debug launch profiles UI*):

| Field | Value |
|-------|-------|
| Command line arguments | `"C:\path\to\signalisation-permanente.geojson" "C:\path\to\sncf-sigmap\data\tiles"` |

Press **Ctrl+F5**. Output: `data\tiles\manifest.json`, `data\tiles\index.json`, and ~289 `.json.gz` tiles.

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

Click a signal marker to open a two-tab popup. Hold **Shift** or **Ctrl** while clicking to open directly on the OSM Tags tab.

### Signals tab

Displays the SNCF open data fields for the selected signal. When multiple co-located signals share the same geographic position, arrow buttons navigate between them.

The **OSM existence check** queries the [Overpass API](https://overpass-api.de/) to detect whether a node with the matching `railway:signal:*:ref` tag already exists in [OpenStreetMap](https://www.openstreetmap.org/). The result appears as a button next to the **ID Réseau** value:

| Icon | Meaning |
|------|---------|
| OSM logo (colour) | Signal found in OSM — click to view the node |
| Locate icon | Not yet mapped — click to open [openstreetmap.org](https://www.openstreetmap.org/) centred on the signal |
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

## JOSM integration

JOSM is optional and only required for the **Open in JOSM** button.

### Prerequisites

JOSM → Edit → Preferences → Remote Control → **Enable remote control**

### Presets

Install the [French Railway Signalling JOSM Presets](https://noeldev.github.io/FrenchRailwaySignalling) to easily edit the imported signals.

## Signal type mapping

`js/signal-mapping.js` maps each SNCF `type_if` code to an application display category and to the corresponding [OpenRailwayMap OSM tags](https://wiki.openstreetmap.org/wiki/OpenRailwayMap/Tagging_in_France). Types not present in the mapping are shown in grey and cannot be exported.

## Project structure

```
sncf-sigmap/
├── index.html
├── netlify.toml                  ← Netlify configuration file (gzip headers for tiles)
├── assets/
│   ├── png/                      ← SNCF logos, favicon, basemap thumbnails
│   └── svg/                      ← favicon, JOSM, OSM, flag icons
├── css/
│   ├── base.css                  ← reset, custom properties, shared button bases
│   ├── filters.css               ← filter panel, dropdowns, pill tags
│   ├── map.css                   ← map container, markers, tooltips, statusbar
│   ├── popup.css                 ← signal popup and OSM tags preview popup
│   └── sidebar.css               ← sidebar layout, tabs, settings, legend
├── data/tiles/                   ← generated by TileBuilder, committed to GitHub
│   ├── manifest.json
│   ├── index.json
│   └── *.json.gz
├── js/
│   ├── app.js                    ← boot sequencer, map event wiring
│   ├── config.js                 ← static constants (TILES_BASE, zoom thresholds…)
│   ├── config.local.js           ← JAWG_API_KEY — git-ignored, never committed
│   ├── config.local.example.js   ← template, safe to commit
│   ├── filters.js                ← filter state, value index, dropdown orchestration
│   ├── geojson.worker.js         ← tile fetch + spatial/attribute filtering (Web Worker)
│   ├── i18n.js                   ← Bilingual translations (EN / FR)
│   ├── josm.js                   ← JOSM Remote Control connection management
│   ├── map.js                    ← Leaflet initialisation, basemap tile layers
│   ├── map-controls.js           ← zoom, geolocate, fullscreen, sidebar toggle
│   ├── map-layer.js              ← signal marker pipeline (worker → render)
│   ├── overpass.js               ← Overpass API existence check (batch)
│   ├── progress.js               ← progress overlay
│   ├── signal-mapping.js         ← SNCF type_if → display category + OSM tag builder
│   ├── signal-popup.js           ← signal data popup, copy tags, JOSM / OSM export
│   ├── sidebar.js                ← sidebar tabs, language picker, JOSM detection panel
│   ├── statusbar.js              ← statusbar DOM updates (zoom, count, filters)
│   ├── tiles.js                  ← manifest loader, tile URL calculator
│   ├── tooltip.js                ← hover tooltip builder
│   ├── worker-contract.js        ← worker message types and postMessage helpers
│   └── ui/
│       ├── combobox.js           ← search input behaviour for filter dropdowns
│       ├── dropdown.js           ← generic accessible dropdown / listbox controller
│       ├── filter-panel.js       ← per-filter DOM panel (label, pills, combo, list)
│       └── pill-list.js          ← selected-value pill container
└── tools/
    └── TileBuilder/              ← C# tile generator
        ├── Program.cs
        └── TileBuilder.csproj
```

## Data sources

| Source | Licence |
|--------|---------|
| [Signalisation permanente SNCF](https://data.sncf.com/) | [Licence Ouverte 2.0](https://www.etalab.gouv.fr/licence-ouverte-open-licence) |
| [OpenStreetMap](https://www.openstreetmap.org/) | [ODbL](https://opendatacommons.org/licenses/odbl/) |
| [Jawg Maps](https://jawg.io/) | Commercial (free tier, optional) |
