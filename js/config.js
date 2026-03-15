/**
 * config.js — Static configuration constants.
 *
 * The Jawg API key is kept separately in js/config.local.js (git-ignored).
 * Copy js/config.local.example.js → js/config.local.js and add your key.
 * If the file is absent the app falls back to the OpenStreetMap tile layer.
 */

// Base URL for the tiled GeoJSON data
export const TILES_BASE = '/data/tiles/';

// Must match the TileBuilder TILE_DEG constant
export const TILE_DEG = 0.5;

// Below this zoom level, overview mode is active: spatially sampled
export const OVERVIEW_MAX_ZOOM = 10;

// Max signals shown in overview mode (zoom < OVERVIEW_MAX_ZOOM)
export const OVERVIEW_MAX_SIGNALS = 300;

// Geographic bounds for the mapped area — all location-specific values in one place.
// Leaflet LatLngBounds format: [[swLat, swLng], [neLat, neLng]].
// Used both for map.fitBounds() on startup and to clip Overpass queries if needed.
//export const MAP_BBOX = [[41.3, -5.2], [51.1, 9.6]];
export const MAP_BBOX = [[41.2, -5.3], [51.2, 9.7]];

// Zoom cap applied to fitBounds() on first load.
// Prevents the map from opening at an overly zoomed-in level on small screens.
export const MAP_STARTUP_ZOOM = 6;

// Default basemap key: 'jawg-transport' | 'osm' | 'satellite'
export const DEFAULT_BASEMAP = 'jawg-transport';

// Dropdown search: when a value list exceeds this count, require the user to
// type characters before rendering any items. The minimum character count is
// derived dynamically from the list size in filters.js.
export const MIN_SEARCH_THRESHOLD = 300;
