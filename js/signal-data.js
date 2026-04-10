/**
 * signal-data.js — Centralised loader and provider for index.json data.
 *
 * Owns the index.json lifecycle — the same pattern as tiles.js for manifest.json:
 *   app.js calls loadIndexData() explicitly; subsequent calls return the cached promise.
 *
 * Responsibilities:
 *   - Fetch index.json once and cache it.
 *   - Initialize block-system.js with its required data subset.
 *   - Provide typed accessors for the subsystems that depend on index.json:
 *       filters.js   → getFilterData()
 *       map-layer.js → getNetworkIdIndex()
 *       filters.js   → searchNetworkIds(prefix)
 *
 * Public API:
 *   loadIndexData()          — fetch index.json and initialize dependent modules
 *   indexReady               — Promise that resolves when the index is fully loaded
 *   getFilterData()          — { signalType, lineCode, trackName, direction, placement, networkId }
 *   getNetworkIdIndex()      — Map<networkId, tileKey>
 *   searchNetworkIds(prefix) — string[] of networkIds starting with prefix
 */

import { INDEX_FILE } from './config.js';
import { initBlockSystem } from './block-system.js';


// ===== Module state =====

/** @type {object|null}  Cached parsed index.json. */
let _indexData = null;

/** @type {Promise<void>|null}  In-flight (or completed) fetch promise. */
let _loadPromise = null;


// ===== Public API =====

/**
 * Fetch index.json, initialize block-system, and cache the result.
 * Safe to call multiple times — subsequent calls return the cached promise.
 * Called explicitly by app.js alongside loadManifest() during boot.
 *
 * @returns {Promise<void>}
 */
export function loadIndexData() {
    if (_loadPromise) return _loadPromise;
    _loadPromise = _doLoad();
    return _loadPromise;
}

/**
 * Promise that resolves when index.json has been fully loaded and processed.
 * Filters.js attaches a .then() callback to this promise to populate its
 * dropdowns as soon as the data is available, without polling or callbacks.
 *
 * Starts automatically when this module is first imported (because
 * loadIndexData() is idempotent, app.js calling it explicitly is harmless
 * and ensures parallel loading alongside the manifest).
 */
export const indexReady = loadIndexData();


/**
 * Return the subset of index.json fields used by the filter system.
 * Must only be called after indexReady has resolved.
 *
 * @returns {object}  Filter-related fields (signalType, lineCode, etc.)
 */
export function getFilterData() {
    if (!_indexData) throw new Error('[signal-data] Index not loaded yet');
    const fields = ['signalType', 'lineCode', 'trackName', 'direction', 'placement', 'networkId'];
    const result = {};
    for (const f of fields) {
        if (_indexData[f]) result[f] = _indexData[f];
    }
    return result;
}

/**
 * Build and return a Map from networkId to tileKey.
 * Used by map-layer.js for the flyToSignal fast-path lookup.
 * Must only be called after indexReady has resolved.
 *
 * @returns {Map<string, string>}
 */
export function getNetworkIdIndex() {
    if (!_indexData) throw new Error('[signal-data] Index not loaded yet');
    const map = new Map();
    const net = _indexData.networkId;
    if (net) {
        for (const [tileKey, ids] of Object.entries(net)) {
            for (const id of ids) map.set(id, tileKey);
        }
    }
    return map;
}

/**
 * Return all known networkIds that start with the given prefix.
 * Used by the networkId filter dropdown to populate search suggestions.
 * Returns an empty array when the index is not yet loaded or prefix is empty.
 *
 * @param {string} prefix
 * @returns {string[]}
 */
export function searchNetworkIds(prefix) {
    if (!_indexData?.networkId || !prefix) return [];
    const matches = [];
    for (const ids of Object.values(_indexData.networkId)) {
        for (const id of ids) {
            if (id.startsWith(prefix)) matches.push(id);
        }
    }
    return matches;
}


// ===== Private =====

async function _doLoad() {
    try {
        const res = await fetch(INDEX_FILE);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        _indexData = await res.json();

        // block-system.js needs the full index object — it reads lineCode,
        // blockType, and blockSegments directly by their index.json key names.
        initBlockSystem(_indexData);

        console.info('[signal-data] index.json loaded');
    } catch (err) {
        console.error('[signal-data] Failed to load index.json:', err.message);
        throw err;
    }
}
