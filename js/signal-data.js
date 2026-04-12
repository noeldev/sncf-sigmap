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
 *   loadIndexData()          — fetch index.json, initialize dependent modules; resolves to null on failure
 *   getFilterData()          — { signalType, lineCode, …} or null if index not loaded
 *   getNetworkIdIndex()      — Map<networkId, tileKey>, or null if index not loaded
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
 * Resolves to null on failure (never rejects) — callers check the return value
 * of getFilterData() and getNetworkIdIndex() to detect an unsuccessful load.
 * Idempotent: returns the cached promise on subsequent calls.
 * On failure the promise cache is cleared so the next call retries the fetch.
 *
 * @returns {Promise<void>}
 */
export function loadIndexData() {
    if (_loadPromise) return _loadPromise;
    _loadPromise = _doLoad();
    return _loadPromise;
}

/**
 * Return the subset of index.json fields used by the filter system.
 * Returns null when the index has not yet loaded or failed to load.
 *
 * @returns {object}  Filter-related fields (signalType, lineCode, etc.)
 */
export function getFilterData() {
    if (!_indexData) {
        console.warn('[signal-data] getFilterData() called before index loaded');
        return null;
    }
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
 * Returns null when the index has not yet loaded or failed to load.
 *
 * @returns {Map<string, string>}
 */
export function getNetworkIdIndex() {
    if (!_indexData) {
        console.warn('[signal-data] getNetworkIdIndex() called before index loaded');
        return null;
    }
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


// ===== Private helpers =====

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
        // Reset so a subsequent loadIndexData() call can retry the fetch.
        _loadPromise = null;
        console.error('[signal-data] Failed to load index.json:', err.message);
    }
}
