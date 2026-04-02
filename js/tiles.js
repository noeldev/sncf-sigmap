/**
 * tiles.js — Tile manifest loader and URL calculator.
 */

import { TILE_DEG, TILES_BASE } from './config.js';

let _manifest = null;

/**
 * Load and cache the tile manifest from the server.
 * Returns the cached manifest on subsequent calls.
 * Returns null when the network request fails.
 * @returns {Promise<object|null>}
 */
export async function loadManifest() {
    if (_manifest) return _manifest;
    try {
        const res = await fetch(TILES_BASE + 'manifest.json');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        _manifest = await res.json();
        return _manifest;
    } catch (err) {
        console.error('[Tiles] manifest.json failed:', err.message);
        return null;
    }
}


/**
 * Compute total signal count and tile count from the manifest.
 * @param {object|null} manifest
 * @returns {{ tileCount: number, totalSignals: number }}
 */
export function getManifestStats(manifest) {
    if (!manifest) return { tileCount: 0, totalSignals: 0 };
    let total = 0;
    for (const v of Object.values(manifest.tiles)) total += v;
    return { tileCount: Object.keys(manifest.tiles).length, totalSignals: total };
}

/**
 * Returns tile URLs that intersect the given Leaflet bounds,
 * optionally expanded by a buffer of extra tile rows/columns.
 *
 * The buffer pre-fetches neighboring tiles so they are in the HTTP cache
 * before the viewport reaches them. A buffer of 1 means one extra tile in
 * each direction (N, S, E, W), adding at most ~12 tiles around the viewport
 * at zoom 14 on a typical screen. Those tiles are fetched in the background
 * and served from cache when the user pans into them.
 *
 * @param {L.LatLngBounds} bounds
 * @param {object}         manifest
 * @param {number}         [buffer=1]  Extra tile rows/cols to prefetch.
 */
export function getTileUrlsForBounds(bounds, manifest, buffer = 1) {
    if (!manifest) return [];

    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();

    const txMin = Math.floor(sw.lng / TILE_DEG) - buffer;
    const txMax = Math.floor(ne.lng / TILE_DEG) + buffer;
    const tyMin = Math.floor(sw.lat / TILE_DEG) - buffer;
    const tyMax = Math.floor(ne.lat / TILE_DEG) + buffer;

    const urls = [];
    for (let tx = txMin; tx <= txMax; tx++) {
        for (let ty = tyMin; ty <= tyMax; ty++) {
            const key = `${tx}:${ty}`;
            if (manifest.tiles[key]) {
                urls.push(TILES_BASE + `${tx}_${ty}.json`);
            }
        }
    }
    return urls;
}

/**
 * Fetch a tile URL and return its signal array.
 * Tiles are requested as .json — both Caddy (precompressed gzip via rewrite)
 * and Netlify (redirect + Content-Encoding) serve the .json.gz transparently.
 * Returns an empty array on HTTP error or parse failure.
 * @param {string} url
 * @returns {Promise<object[]>}
 */
export async function fetchTile(url) {
    try {
        const res = await fetch(url);
        if (!res.ok) {
            if (res.status !== 404) console.warn(`[tiles] ${url} → ${res.status}`);
            return [];
        }
        const data = await res.json();
        if (Array.isArray(data)) return data;
        if (data?.features && Array.isArray(data.features)) return data.features;
        return [];
    } catch (err) {
        console.warn('[tiles] fetch failed:', url, err.message);
        return [];
    }
}

/**
 * Fetch a single tile by key and return its raw signal array.
 * The browser cache makes this instant on repeat calls.
 * Returns an empty array on error.
 * @param {string} tileKey  e.g. '3:94'
 * @returns {Promise<object[]>}
 */
export async function fetchTileByKey(tileKey) {
    const [tx, ty] = tileKey.split(':').map(Number);
    return fetchTile(TILES_BASE + `${tx}_${ty}.json`);
}

/**
 * Find the [lat, lng] of a signal by networkId within a tile's signal array.
 * Returns null when the signal is not found.
 * @param {object[]} signals  Raw tile signal array.
 * @param {string}   networkId
 * @returns {[number, number] | null}
 */
export function findSignalLocation(signals, networkId) {
    const s = signals.find(sig => String(sig.idreseau) === networkId);
    return s ? [s.lat, s.lng] : null;
}
