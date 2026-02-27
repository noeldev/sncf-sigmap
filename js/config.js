/**
 * config.js
 * Central application configuration.
 * Edit this file to set your API keys and data paths.
 */

// ---- Jawg Maps API key ----
// Free account at https://www.jawg.io/ (75,000 tiles/month)
// Paste your Access Token below.
export const JAWG_API_KEY = 'AmqbyZ47xe9mLnAJNG7rNqIGZDFffalylyhlk7zlkaJ6hy0wPL43X6IgnkZjUT6t';

// ---- Hosted GeoJSON data ----
// Path relative to index.html. Set to null to disable auto-loading (manual only).
export const DATA_URLS = {
  signals: './data/signalisation-permanente.geojson',
};

// ---- Initial map view ----
export const MAP_INITIAL_VIEW = {
  center: [46.8, 2.3],
  zoom:   6,
};

// ---- Default basemap ----
// Options: 'jawg-transport', 'jawg-sunny', 'jawg-dark', 'osm', 'satellite'
export const DEFAULT_BASEMAP = 'jawg-transport';
