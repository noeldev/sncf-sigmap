/**
 * overpass.js — Pure Overpass API client.
 *
 * Constructs and executes Overpass QL queries against the public API.
 * No caching, no application state — that is the responsibility of osm-checker.js.
 *
 * Public API:
 *   fetchNodesByRef(queries, signal?) — query OSM nodes by (refTag, networkId) pairs
 */

import { map } from './map.js';


// ===== Configuration =====

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const OVERPASS_TIMEOUT = 20;   // seconds — passed directly to the Overpass server


// ===== Public API =====

/**
 * Fetch OSM nodes matching an array of (refTag, networkId) pairs.
 *
 * @param {Array<{ refTag: string, networkId: string }>} queries
 * @param {AbortSignal} [signal]
 * @returns {Promise<Map<string, number|null>>}
 *   Map keyed by "${refTag}:${networkId}":
 *     number → OSM node ID (signal found in OSM)
 *     null   → not found
 */
export async function fetchNodesByRef(queries, signal) {
    if (queries.length === 0) return new Map();

    const unique = _deduplicateQueries(queries);
    const bbox = _viewportBbox();
    const query = _buildBatchQuery(unique, bbox);
    const data = await _fetchOverpass(query, signal);

    return _parseResponse(data, unique);
}

/** Canonical key for a (refTag, networkId) pair. */
export function getIdKey({ refTag, networkId }) {
    return `${refTag}:${networkId}`;
}


// ===== Private helpers =====

/** Returns the current viewport as an Overpass bbox string "S,W,N,E". */
function _viewportBbox() {
    const b = map.getBounds();
    return `${b.getSouth()},${b.getWest()},${b.getNorth()},${b.getEast()}`;
}

/** Deduplicate queries by their cache key. */
function _deduplicateQueries(queries) {
    return [...new Map(queries.map(q => [getIdKey(q), q])).values()];
}

/** Build an Overpass union query — one node clause per unique (refTag, networkId) pair. */
function _buildBatchQuery(unique, bbox) {
    const unions = unique.map(q =>
        `node["${q.refTag}"="${q.networkId}"](${bbox});`
    ).join('');
    return `[out:json][timeout:${OVERPASS_TIMEOUT}];(${unions});out ids tags;`;
}

/** Raw Overpass POST. Throws on non-OK response. */
async function _fetchOverpass(query, signal) {
    const r = await fetch(OVERPASS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query),
        signal,
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
}

/**
 * Parse an Overpass JSON response into a Map of key -> nodeId (or null).
 * Every queried key is present in the result — null means "not found".
 */
function _parseResponse(data, unique) {
    const result = new Map();

    for (const el of (data.elements ?? [])) {
        for (const q of unique) {
            if (el.tags?.[q.refTag] === q.networkId) {
                result.set(getIdKey(q), el.id);
                break;
            }
        }
    }

    // Ensure every queried key has an entry (null = not found).
    for (const q of unique) {
        if (!result.has(getIdKey(q))) result.set(getIdKey(q), null);
    }

    return result;
}
