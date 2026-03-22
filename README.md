# SNCF Signalisation Permanente

[![JavaScript](https://img.shields.io/badge/JavaScript-ES2022-f7df1e?logo=javascript&logoColor=black)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![OpenStreetMap](https://img.shields.io/badge/OpenStreetMap-compatible-7ebc6f?logo=openstreetmap&logoColor=white)](https://www.openstreetmap.org/)
[![Leaflet](https://img.shields.io/badge/Leaflet-1.9-199900?logo=leaflet&logoColor=white)](https://leafletjs.com/)
[![Netlify Status](https://api.netlify.com/api/v1/badges/ca46fbb6-49ba-4257-a4c7-77ec6ae5a894/deploy-status)](https://app.netlify.com/projects/sncf-sigmap/deploys)

Interactive map viewer for the [SNCF Signalisation Permanente](https://data.sncf.com/) (Fixed Signalling) open dataset, with OpenStreetMap integration. Signals can be exported as OSM tags to the clipboard or via [JOSM Remote Control](https://josm.openstreetmap.de/).

At low zoom, all tiles are fetched once for a spatial overview sample. At high zoom, only tiles covering the current viewport are fetched.

## Features

- **123,870 signals** across France, split into ~289 gzip-compressed tiles (0.5° × 0.5°)
- Progressive display: spatial sampling at low zoom for performance, full detail at zoom 10 and above
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
sncf-data/
  signalisation-permanente.geojson          (never committed — 102 MB)
  mode-de-cantonnement-des-lignes.geojson   (never committed — 2 MB)
        │
        ▼  TileBuilder  (C# tool)
        │
data/tiles/
  manifest.json   ← tile index (~20 KB)
  index.json      ← filter values, line labels, cantonment modes (~300 KB)
  -4_97.json.gz   ← one tile per 0.5° cell, 5–30 KB each
        │
        ▼  git commit + push  →  Netlify auto-deploys
        │
https://sncf-sigmap.netlify.app
```

Tiles are committed to GitHub and deployed by Netlify alongside the source code. The `netlify.toml` file sets `Content-Encoding: gzip` headers so the browser decompresses tiles transparently.

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

Press **Ctrl+F5**. Output: `data\tiles\manifest.json`, `data\tiles\index.json`, and ~289 `.json.gz` tiles.

The `tools/TileBuilder/tilebuilder.config.json` file controls the input file names and the canton mode abbreviation table. Edit it to add new acronyms without recompiling.

To rebuild only `index.json` and `manifest.json` without regenerating tile files, add `-n` (`--no-tiles`) to the arguments.

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

## Data files

### `data/tiles/manifest.json`

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

### `data/tiles/index.json`

Filter and lookup index produced by TileBuilder. Loaded once at startup by `filters.js` and `cantonment.js`.

```json
{
  "type_if": {
    "CARRE": 16571,
    "Z":     7930
  },
  "code_ligne": {
    "570000": { "count": 1820, "label": "Ligne de Paris-Austerlitz à Bordeaux-Saint-Jean" },
    "100000": { "count": 36,   "label": null }
  },
  "cantons": [ "BAL", "BAPR de double voie", "BM", "CT de voie unique", "…" ],
  "canton_segs": [
    ["205000", 69350, 72241, 0],
    ["205000", 72241, 85000, 1]
  ]
}
```

| Field | Consumer | Description |
|-------|----------|-------------|
| `type_if` | `filters.js` | Signal type → count (full dataset). Populates the TYPE IF filter dropdown with global counts. |
| `code_ligne` | `filters.js`, `cantonment.js` | Line code → `{ count, label }`. `count` is the signal count; `label` is the line display name from the cantonment dataset (`null` when absent). Populates the CODE LIGNE filter and the popup *Libellé ligne* field. |
| `cantons` | `cantonment.js` | Ordered list of abbreviated cantonment mode labels, indexed by position. |
| `canton_segs` | `cantonment.js` | Compact segment array: `[code_ligne, pkd_m, pkf_m, canton_idx]`. `pkd_m` / `pkf_m` are integer metres from the line origin (e.g. `"069+350"` → `69350`). `canton_idx` is the index into `cantons`. Used to resolve the *Mode canton* field in the popup. |

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
│   ├── cantonment.js             ← line label and cantonment mode lookup from index.json
│   ├── cat-mapping.js            ← application signal categories, colours, and legend
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
│   ├── sidebar.js                ← sidebar tabs, language picker, JOSM detection panel
│   ├── signal-mapping.js         ← SNCF type_if → OSM tag builder
│   ├── signal-popup.js           ← signal data popup, copy tags, JOSM / OSM export
│   ├── sncf-convert.js           ← shared SNCF field conversion utilities (PK, direction…)
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
        ├── AcronymEntry.cs         ← canton label abbreviation entry record
        ├── BuildConfig.cs          ← deserialized tilebuilder.config.json
        ├── CantonProcessor.cs      ← reads cantonnement GeoJSON, builds index tables
        ├── CantonResult.cs         ← output record of CantonProcessor
        ├── CliOptions.cs           ← CLI argument parsing
        ├── ConfigLoader.cs         ← loads tilebuilder.config.json
        ├── Constants.cs            ← shared constants (TileDeg, default filenames)
        ├── CrossCheck.cs           ← DEBUG-only cross-check between datasets
        ├── IndexWriter.cs          ← writes index.json
        ├── LigneInfo.cs            ← merged line entry (signal count + label)
        ├── Program.cs              ← entry point and orchestration
        ├── Signal.cs               ← signal point record (tile serialisation)
        ├── SignalData.cs           ← output record of SignalReader
        ├── SignalReader.cs         ← reads signal GeoJSON, groups into tiles
        ├── TileWriter.cs           ← writes .json.gz tiles and manifest.json
        ├── tilebuilder.config.json ← SNCF filenames + canton acronym table
        └── TileBuilder.csproj
```

## Data sources

| Source | Licence |
|--------|---------|
| [Signalisation permanente SNCF](https://data.sncf.com/) | [Licence Ouverte 2.0](https://www.etalab.gouv.fr/licence-ouverte-open-licence) |
| [Mode de cantonnement des lignes SNCF](https://data.sncf.com/explore/dataset/mode-de-cantonnement-des-lignes/) | [Licence Ouverte 2.0](https://www.etalab.gouv.fr/licence-ouverte-open-licence) |
| [OpenStreetMap](https://www.openstreetmap.org/) | [ODbL](https://opendatacommons.org/licenses/odbl/) |
| [Jawg Maps](https://jawg.io/) | Commercial (free tier, optional) |
