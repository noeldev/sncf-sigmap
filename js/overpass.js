/**
 * overpass.js
 * Check whether signals already exist in OpenStreetMap via the Overpass API.
 * Returns the OSM node ID when found so the popup can link to openstreetmap.org/node/<id>.
 * Results are cached in memory for the session.
 *
 * Public API:
 *   checkSignalGroup(feats, force?)  — check a co-located group in one request
 *   invalidateSignalGroup(feats)     — clear 'not-in-osm' cache entries after export
 *
 * Each signal is checked by its railway:signal:<cat>:ref tag in a single
 * Overpass union query — one clause per supported signal.
 *
 * Result shape per feat:
 *   { status: 'in-osm',      nodeId: number }
 *   { status: 'not-in-osm',  nodeId: null }
 *   { status: 'unsupported', nodeId: null }
 *   { status: 'error',       nodeId: null }
 */

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

import { map } from './map.js';
import { getSignalId } from './signal-mapping.js';


/* ===== Cache and in-flight state ===== */

const _cache = new Map();   // cacheKey  → result
const _pending = new Map();   // batchKey  → Promise

// Aborted when a new popup opens before the previous batch resolves,
// sparing the Overpass server from stale in-flight requests.
let _batchAbort = null;

// Cache key: "<refTag>:<networkId>"
function _cacheKey(refTag, networkId) { return `${refTag}:${networkId}`; }


/* ===== Private helpers ===== */

/** Returns the current viewport as an Overpass bbox string "S,W,N,E". */
function _viewportBbox() {
    const b = map.getBounds();
    return `${b.getSouth()},${b.getWest()},${b.getNorth()},${b.getEast()}`;
}

/** Raw Overpass POST. Accepts an optional AbortSignal. */
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
 * Build one descriptor per feat.
 * Feats without a known ref tag get key=null (unsupported).
 */
function _buildEntries(feats) {
    return feats.map(f => {
        const refTag = getSignalId(f.p.signalType);
        if (!refTag || !f.p.networkId) {
            return { key: null, refTag: null, networkId: null };
        }
        return { key: _cacheKey(refTag, f.p.networkId), refTag, networkId: f.p.networkId };
    });
}

/**
 * Build an Overpass union query — one node clause per unique entry.
 */
function _buildBatchQuery(unique, bbox) {
    const unions = unique.map(e =>
        `node["${e.refTag}"="${e.networkId}"](${bbox});`
    ).join('');
    return `[out:json][timeout:45];(${unions});out ids tags;`;
}

/**
 * Populate _cache from an Overpass response.
 * Matched entries → 'in-osm'. Unmatched → 'not-in-osm'.
 */
function _updateCacheFromResponse(data, unique) {
    for (const el of (data.elements || [])) {
        for (const e of unique) {
            if (_cache.has(e.key)) continue;
            if (el.tags?.[e.refTag] === e.networkId) {
                _cache.set(e.key, { status: 'in-osm', nodeId: el.id });
            }
        }
    }
    for (const e of unique) {
        if (!_cache.has(e.key)) {
            _cache.set(e.key, { status: 'not-in-osm', nodeId: null });
        }
    }
}

/**
 * Map entries to per-feat result objects once the network promise resolves.
 * @param {Array}                entries
 * @param {false|true|'aborted'} hadError
 */
function _resolveStatuses(entries, hadError) {
    return entries.map(e => {
        if (!e.key) return { status: 'unsupported', nodeId: null };
        if (hadError === 'aborted') return { status: 'checking', nodeId: null };
        if (hadError) return { status: 'error', nodeId: null };
        return _cache.get(e.key) ?? { status: 'not-in-osm', nodeId: null };
    });
}


/* ===== Public API ===== */

/**
 * Remove 'not-in-osm' cache entries for the given features so that the next
 * popup open triggers a fresh Overpass check.
 * Call after a successful copy or JOSM export.
 */
export function invalidateSignalGroup(feats) {
    for (const f of feats) {
        const refTag = getSignalId(f.p.signalType);
        if (!refTag || !f.p.networkId) continue;
        const key = _cacheKey(refTag, f.p.networkId);
        if (_cache.get(key)?.status === 'not-in-osm') _cache.delete(key);
    }
}

/**
 * Check a group of co-located signals in a single Overpass request.
 * Returns Promise<Array<{ status, nodeId }>> — one entry per feat, in order.
 * force=true clears cached results before querying.
 */
export function checkSignalGroup(feats, force = false) {
    _batchAbort?.abort();
    _batchAbort = new AbortController();
    const { signal } = _batchAbort;

    const entries = _buildEntries(feats);
    if (force) entries.forEach(e => e.key && _cache.delete(e.key));

    const toFetch = entries.filter(e => e.key && !_cache.has(e.key));

    if (toFetch.length === 0) {
        return Promise.resolve(_resolveStatuses(entries, false));
    }

    const unique = [...new Map(toFetch.map(e => [e.key, e])).values()];
    const bbox = _viewportBbox();
    const batchKey = '_batch:' + unique.map(e => e.key).join('|');

    if (!_pending.has(batchKey)) {
        const query = _buildBatchQuery(unique, bbox);
        const p = _fetchOverpass(query, signal)
            .then(data => {
                _updateCacheFromResponse(data, unique);
                _pending.delete(batchKey);
                return false;
            })
            .catch(err => {
                _pending.delete(batchKey);
                if (err.name === 'AbortError') return 'aborted';
                console.warn('[overpass batch]', err.message);
                return true;
            });
        _pending.set(batchKey, p);
    }

    return _pending.get(batchKey).then(hadError => _resolveStatuses(entries, hadError));
}
