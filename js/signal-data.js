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
 *   searchNetworkIds(prefix) — string[] of networkIds starting with prefix (binary search)
 */

import { INDEX_FILE } from './config.js';
import { FIELD } from './field-keys.js';
import { getFilterFieldKeys } from './filter-config.js';
import { initBlockSystem } from './block-system.js';
import { registerDataTypes } from './signal-mapping.js';


// ===== Precompiled regular expressions =====

const RE_DIACRITIC = /\p{Diacritic}/gu;
const RE_NUMERIC = /^\d+$/;
const RE_BLANK = / /g;

// ===== Module state =====

/** @type {object|null}  Cached parsed index.json. */
let _indexData = null;

/** @type {Promise<void>|null}  In-flight (or completed) fetch promise. */
let _loadPromise = null;

/** @type {string[]} Strictly lexicographically sorted IDs for binary search */
let _sortedNetworkIds = [];   // flat, sorted list of all networkIds


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
 * Field keys come from getFilterFieldKeys() (filter-config.js) so this
 * function stays in sync with ALL_FILTER_FIELDS automatically — no manual
 * update needed when a new filterable field is added.
 *
 * @returns {object | null}  Filter-related fields (signalType, lineCode, etc.)
 */
export function getFilterData() {
    if (!_indexData) {
        console.warn('[signal-data] getFilterData() called before index loaded');
        return null;
    }
    const result = {};
    for (const key of getFilterFieldKeys()) {
        if (_indexData[key]) result[key] = _indexData[key];
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
    const net = _indexData[FIELD.NETWORK_ID];
    if (net) {
        for (const [tileKey, ids] of Object.entries(net)) {
            for (const id of ids) map.set(id, tileKey);
        }
    }
    return map;
}

/**
 * Return all known networkIds that start with the given prefix.
 * Uses a binary search (B-tree search logic) for O(log n) performance.
 * @param {string} prefix
 * @returns {string[]}
 */
export function searchNetworkIds(prefix) {
    if (!_sortedNetworkIds.length || !prefix) return [];

    const startIdx = _findFirstPrefixIndex(prefix);
    if (startIdx === -1) return [];

    const results = [];
    for (let i = startIdx; i < _sortedNetworkIds.length; i++) {
        if (_sortedNetworkIds[i].startsWith(prefix)) {
            results.push(_sortedNetworkIds[i]);
        } else {
            break;
        }
    }
    return results;
}

/**
 * Return the full label for the given line code, or null when unknown.
 * Used by filters.js to populate pill tooltips after index.json has loaded.
 *
 * @param {string} lineCode  e.g. "395000"
 * @returns {string|null}    e.g. "Ligne de St-Cyr à Surdon", or null
 */
export function getLineLabel(lineCode) {
    if (!_indexData?.lineCode) return null;
    return _indexData.lineCode[lineCode]?.label ?? null;
}

/**
 * Return the precomputed bounding box for the given line code, or null.
 * Bbox format: [minLng, minLat, maxLng, maxLat]  (GeoJSON / OGC convention).
 *
 * @param {string} lineCode
 * @returns {[number,number,number,number]|null}
 */
export function getLineBbox(lineCode) {
    if (!_indexData?.lineCode) return null;
    return _indexData.lineCode[lineCode]?.bbox ?? null;
}

/**
 * Search line codes by code fragment or label fragment.
 * Matching is accent-insensitive and case-insensitive.
 *
 * @param {string} query - Raw search string (may be empty).
 * @returns {Array<{code: string, label: string | null, count: number}>}
 */
export function searchLineCodes(query) {
    if (!_indexData?.lineCode) return [];

    const entries = Object.entries(_indexData.lineCode);
    const formatResult = (code, info) => ({
        code,
        label: info?.label ?? null,
        count: info?.count ?? (typeof info === 'number' ? info : 0)
    });

    // Empty query (returns all entries)
    if (!query) {
        return entries.map(([code, info]) => formatResult(code, info));
    }

    // Strip spaces before deciding the search mode.
    // "395 " or "100 000" typed with accidental/intentional spaces must still
    // be treated as a code prefix search, not switch to label search mode.
    // Spaces are meaningful only in label search (line names contain spaces).
    const queryDigits = query.replace(RE_BLANK, '');
    const isNumericQuery = queryDigits.length > 0 && RE_NUMERIC.test(queryDigits);
    const nq = isNumericQuery ? queryDigits : _normalizeForSearch(query);
    const results = [];

    for (const [code, info] of entries) {
        if (isNumericQuery) {
            // Numeric search: prefix match on the code (spaces stripped from query).
            if (code.startsWith(nq)) {
                results.push(formatResult(code, info));
            }
        } else {
            // Textual search: accent-insensitive substring match on the label.
            const label = info?.label;
            if (label && _normalizeForSearch(label).includes(nq)) {
                results.push(formatResult(code, info));
            }
        }
    }

    return results;
}

// ===== Private helpers =====

function _normalizeForSearch(str) {
    return str.toUpperCase().normalize('NFD').replace(RE_DIACRITIC, '');
}

function _buildNetworkIdIndex() {
    if (!_indexData?.[FIELD.NETWORK_ID]) {
        _sortedNetworkIds = [];
        return;
    }
    const allIds = new Set();
    for (const ids of Object.values(_indexData[FIELD.NETWORK_ID])) {
        for (const id of ids) allIds.add(id);
    }

    _sortedNetworkIds = [...allIds].sort();
}

/**
 * Perform a binary search (B-tree search) to find
 * the first occurrence of a prefix in _sortedNetworkIds.
 * @param {string} prefix
 * @returns {number} The first index found, or -1.
 */
function _findFirstPrefixIndex(prefix) {
    let left = 0;
    let right = _sortedNetworkIds.length - 1;
    let foundIndex = -1;

    while (left <= right) {
        const mid = (left + right) >> 1;
        const val = _sortedNetworkIds[mid];

        if (val.startsWith(prefix)) {
            foundIndex = mid;
            right = mid - 1; // Look further left for the absolute first match
        } else if (val < prefix) {
            left = mid + 1;
        } else {
            right = mid - 1;
        }
    }
    return foundIndex;
}

async function _doLoad() {
    try {
        const res = await fetch(INDEX_FILE);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        _indexData = await res.json();

        // Build the networkId index and sorted array for fast lookup and search.
        _buildNetworkIdIndex();

        // block-system.js needs the full index object — it reads lineCode,
        // blockType, and blockSegments directly by their index.json key names.
        initBlockSystem(_indexData);

        // Make the full list of signalType codes available to signal-mapping.js
        // so the 'unsupported' group can be enumerated for legend clicks and for
        // active-group detection in filters.js.
        registerDataTypes(Object.keys(_indexData[FIELD.SIGNAL_TYPE] || {}));

        console.info('[signal-data] index.json loaded');
    } catch (err) {
        // Reset so a subsequent loadIndexData() call can retry the fetch.
        _loadPromise = null;
        console.error('[signal-data] Failed to load index.json:', err.message);
    }
}
