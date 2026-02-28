/**
 * config.js — Central configuration.
 */

export const JAWG_API_KEY = 'AmqbyZ47xe9mLnAJNG7rNqIGZDFffalylyhlk7zlkaJ6hy0wPL43X6IgnkZjUT6t';

// Absolute path — resolves correctly from both page and Web Worker contexts
export const TILES_BASE = '/data/tiles/';

// Must match TileBuilder TILE_DEG constant
export const TILE_DEG = 0.5;

// Below this zoom, overview mode: limited signal types, spatially sampled
// At this zoom and above, all signals in the viewport are shown (no restriction)
export const OVERVIEW_MAX_ZOOM = 10;

// Max signals shown in overview mode (zoom < OVERVIEW_MAX_ZOOM)
export const OVERVIEW_MAX_SIGNALS = 100;

// Initial map view (France)
export const MAP_INITIAL_VIEW = { center: [46.8, 2.3], zoom: 6 };

// Default basemap: 'jawg-transport' | 'osm' | 'satellite'
export const DEFAULT_BASEMAP = 'jawg-transport';
