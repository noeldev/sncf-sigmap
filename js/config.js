/**
 * config.js — Central configuration.
 */

export const JAWG_API_KEY = 'AmqbyZ47xe9mLnAJNG7rNqIGZDFffalylyhlk7zlkaJ6hy0wPL43X6IgnkZjUT6t';

// Absolute path — resolves correctly from both page and Web Worker contexts
export const TILES_BASE = '/data/tiles/';

// Must match the TileBuilder TILE_DEG constant
export const TILE_DEG = 0.5;

// Below this zoom level, overview mode is active: limited types, spatially sampled
export const OVERVIEW_MAX_ZOOM = 10;

// Max signals shown in overview mode (zoom < OVERVIEW_MAX_ZOOM)
export const OVERVIEW_MAX_SIGNALS = 100;

// Initial map view centred on France
export const MAP_INITIAL_VIEW = { center: [46.8, 2.3], zoom: 6 };

// Default basemap key: 'jawg-transport' | 'osm' | 'satellite'
export const DEFAULT_BASEMAP = 'jawg-transport';
