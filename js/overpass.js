/**
 * overpass.js — Pure Overpass API client.
 *
 * Constructs and executes Overpass QL queries against the public API.
 *
 * Public API:
 * fetchNodesByRef(queries, bboxString, signal?) — query OSM nodes by (refTag, networkId) pairs
 * fetchSignalsInBbox(bboxString, signal) -- fetch all railway=signal nodes in a bbox (for viewport-wide scans)
 */

// ===== Configuration =====

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const OVERPASS_TIMEOUT = 20; // seconds — passed directly to the Overpass server

// ===== Public API =====

/**
 * Fetch OSM nodes matching an array of (refTag, networkId) pairs within a bbox.
 *
 * @param {Array<{ refTag: string, networkId: string }>} queries
 * @param {string} bboxString - Required bounding box "S,W,N,E".
 * @param {AbortSignal} [signal] - Optional signal to cancel the fetch.
 * @returns {Promise<Map<string, { id: number, tags: object } | null>>}
 *    Map keyed by "${refTag}:${networkId}":
 *    { id, tags } → OSM node found (id + all its tags)
 *    null         → not found
 */
export async function fetchNodesByRef(queries, bboxString, signal) {
    if (!queries?.length || !bboxString) return new Map();

    const unique = _deduplicateQueries(queries);
    const query = _buildBatchQuery(unique, bboxString);
    const data = await _fetchOverpass(query, signal);

    return _parseResponse(data, unique);
}

/**
 * Generate a unique key for a query pair. 
 * Exported because it's used by osm-checker.js to key its caches.
 */
export function getIdKey({ refTag, networkId }) {
    return `${refTag}:${networkId}`;
}

/**
 * Fetch all railway=signal nodes within a bounding box.
 * Used by osm-index.js for viewport-wide scans.
 * Returns raw elements with lat/lon — caller is responsible for ref extraction.
 *
 * @param {string}      bboxString - "S,W,N,E" format.
 * @param {AbortSignal} [signal]
 * @returns {Promise<Array<{ id: number, tags: object, lat: number, lon: number }>>}
 */
export async function fetchSignalsInBbox(bboxString, signal) {
    if (!bboxString) return [];
    const query = _buildBboxQuery(bboxString);
    const data = await _fetchOverpass(query, signal);
    return data.elements ?? [];
}

// ===== Private helpers =====

/** Returns an array of unique query objects based on their ID key. */
function _deduplicateQueries(queries) {
    const uniqueMap = new Map();
    for (const q of queries) {
        uniqueMap.set(getIdKey(q), q);
    }
    return [...uniqueMap.values()];
}

/** Build the Overpass QL batch query. */
function _buildBatchQuery(queries, bbox) {
    const clauses = queries
        .map(q => `node["${q.refTag}"="${q.networkId}"](${bbox});`)
        .join('');

    return `[out:json][timeout:${OVERPASS_TIMEOUT}];(${clauses});out tags;`;
}

/** Build a simple Overpass QL query to fetch all signal nodes in a bbox. */
function _buildBboxQuery(bboxString) {
    return `[out:json][timeout:${OVERPASS_TIMEOUT}];`
        + `node["railway"="signal"](${bboxString});`
        + `out body;`;
}

/** Execute the network request. */
async function _fetchOverpass(query, signal) {
    const response = await fetch(OVERPASS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query),
        signal,
    });

    if (!response.ok) throw new Error(`Overpass HTTP Error: ${response.status}`);
    return response.json();
}

/**
 * Parse an Overpass JSON response into a Map of key -> { id, tags } (or null).
 * Every queried key is guaranteed to be present in the resulting Map, 
 * either as null (if not found) or as the node data.
 *
 * @param {object} data - The JSON response received from Overpass API.
 * @param {Array<{refTag: string, networkId: string}>} queries - The unique queries list.
 * @returns {Map<string, { id: number, tags: object } | null>}
 */
function _parseResponse(data, queries) {
    const results = new Map();

    // Initialize all requested keys to null to ensure a complete result map
    for (const q of queries) {
        results.set(getIdKey(q), null);
    }

    // Map found elements to their query keys
    for (const el of (data.elements ?? [])) {
        const tags = el.tags ?? {};
        for (const q of queries) {
            if (tags[q.refTag] === q.networkId) {
                results.set(getIdKey(q), {
                    id: el.id,
                    tags: tags
                });
                // Do not break – continue to associate the same node with other keys
            }
        }
    }
    return results;
}
