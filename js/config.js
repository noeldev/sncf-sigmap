/**
 * config.js — Static configuration constants.
 *
 * The Jawg API key is kept separately in js/config.secret.js (git-ignored).
 * Copy js/config.secret.example.js → js/config.secret.js and add your key.
 * If the file is absent the app falls back to the OpenStreetMap tile layer.
 */

// Base URL for the tiled GeoJSON data
export const TILES_BASE = '/data/tiles/';

// Must match the TileBuilder TILE_DEG constant
export const TILE_DEG = 0.5;

// Below this zoom level, overview mode is active: spatially sampled
export const OVERVIEW_MAX_ZOOM = 10;

// Max signals shown in overview mode (zoom < OVERVIEW_MAX_ZOOM)
export const OVERVIEW_MAX_SIGNALS = 100;

// Initial map view centred on France
export const MAP_INITIAL_VIEW = { center: [46.8, 2.3], zoom: 6 };

// Default basemap key: 'jawg-transport' | 'osm' | 'satellite'
export const DEFAULT_BASEMAP = 'jawg-transport';
