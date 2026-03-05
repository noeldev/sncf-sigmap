# SNCF Signalisation Permanente

[![JavaScript](https://img.shields.io/badge/JavaScript-ES2022-f7df1e?logo=javascript&logoColor=black)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![OpenStreetMap](https://img.shields.io/badge/OpenStreetMap-compatible-7ebc6f?logo=openstreetmap&logoColor=white)](https://www.openstreetmap.org/)
[![Leaflet](https://img.shields.io/badge/Leaflet-1.9-199900?logo=leaflet&logoColor=white)](https://leafletjs.com/)
[![Netlify Status](https://api.netlify.com/api/v1/badges/ca46fbb6-49ba-4257-a4c7-77ec6ae5a894/deploy-status)](https://app.netlify.com/projects/sncf-sigmap/deploys)

Interactive map viewer for the [SNCF permanent railway signalling](https://data.sncf.com/) open dataset, with OpenStreetMap integration. Signals can be exported as OSM tags to the clipboard or exported via [JOSM Remote Control](https://josm.openstreetmap.de/).

Only tiles visible in the current viewport are fetched — no full dataset download.

## Features

- **123,870 signals** across France, split into ~289 gzip-compressed tiles (0.5° × 0.5°)
- Progressive display: spatial sampling at low zoom, full detail at zoom ≥ 10
- Hover tooltips and click popups with signal information and OSM tags
- OSM existence check per signal via Overpass API (live badge in popup)
- Export to JOSM via Remote Control (`127.0.0.1:8111`) or copy tags to clipboard
- Filters by signal type, line code, track name, direction, position
- "Supported types only" toggle to highlight signals already mapped in `signal-mapping.js`
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
- Copy `js/config.secret.example.js` to `js/config.secret.js`
- Edit `js/config.secret.js` and fill in your key:
```js
export const JAWG_API_KEY = 'your-token-here';
```

Get a free key at [lab.jawg.io](https://lab.jawg.io). `config.secret.js` is listed in `.gitignore` and will never be committed.

## Updating tiles

Re-run TileBuilder after a source data update, then commit and push. Only changed tiles are re-deployed (Netlify caches unchanged files).

## Signal popup user interface

Click a signal marker to open a popup with detailed information and OSM tags.

### OSM existence check

Each signal popup queries the [Overpass API](https://overpass-api.de/) to check whether a node with the corresponding `railway:signal:*:ref` tag already exists in OSM:

| Badge | Meaning |
|-------|---------|
| OSM | Signal found — export will show a confirmation prompt |
| OSM (dimmed) | Not yet mapped |
| … | Check in progress |
| ↻ | Check failed — click to retry |

Results are cached for the session.

### View on OpenStreetMap

Click the **⊕** button next to the coordinates to open OpenStreetMap centered on the signal's location at zoom 18.

### Copy tags button

Click **Copy tags** to copy the tags of the signal(s) to the clipboard.

### Open in JOSM

Click **Open in JOSM** to create a node at the signal's exact coordinates with all OSM tags pre-filled. 
The browser must allow HTTP requests to `127.0.0.1` from HTTPS pages. 
There will be a confirmation message box in the browser and in JOSM.

If a signal is already in OSM, a confirmation dialog also appears before exporting.

## JOSM integration
JOSM is optional, it just makes it easier to integrate the signals.

### Prerequisites
JOSM → Edit → Preferences → Remote Control → **Enable remote control**

The JOSM Remote Control must be enabled for **Open in JOSM** to work.

### Presets

Install the [French Railway Signalling JOSM Presets](https://noeldev.github.io/FrenchRailwaySignalling) to easily edit the imported signals.
### Open in JOSM

## Project structure

```
sncf-sigmap/
├── index.html
├── netlify.toml                  ← gzip Content-Encoding headers for tiles
├── assets/
│   ├── png/                      ← SNCF logo, favicon, basemap thumbnails
│   └── svg/                      ← favicon, JOSM, OSM, flag icons
├── css/style.css
├── data/tiles/                   ← generated by TileBuilder, committed to Git
│   ├── manifest.json
│   ├── index.json
│   └── *.json.gz
├── js/
│   ├── app.js                    ← orchestration, tile loading, marker rendering
│   ├── config.js                 ← public constants (TILES_BASE, zoom thresholds…)
│   ├── config.secret.js          ← JAWG_API_KEY — git-ignored, never committed
│   ├── config.secret.example.js  ← template, safe to commit
│   ├── filters.js                ← filter panel (type, line, track, direction…)
│   ├── geojson.worker.js         ← tile fetch + spatial/attribute filtering (Web Worker)
│   ├── i18n.js                   ← EN / FR translations
│   ├── map.js                    ← Leaflet, basemaps, controls, legend
│   ├── osm-check.js              ← Overpass API existence check (batch)
│   ├── popup.js                  ← signal popup, copy tags, JOSM / OSM export
│   ├── signal-mapping.js         ← SNCF type_if → OSM tag mapping
│   └── tiles.js                  ← manifest loader, tile URL calculator
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
| [Jawg Maps](https://jawg.io/) | Commercial (free tier) |
