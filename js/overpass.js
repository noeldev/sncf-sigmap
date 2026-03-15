/**
 * overpass.js
 * Check whether signals already exist in OpenStreetMap via the Overpass API.
 * Returns the OSM node ID when found so the popup can link to openstreetmap.org/node/<id>.
 * Results are cached in memory for the session.
 *
 * Public API:
 *   checkSignalGroup(feats, force?)     - check a co-located group in one request
 *   invalidateSignalGroup(feats)        - clear 'not-in-osm' cache entries after export
 *
 * Each signal is checked under both its forward and backward ref key in a
 * single Overpass union query, so a hit on either counts as 'in-osm'.
 */

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

import { map } from './map.js';
import { getSignalId, getBackwardSignalId } from './signal-mapping.js';


/* ===== Viewport helper ===== */

/**
 * Returns the current map viewport as an Overpass bbox string: "S,W,N,E".
 * Querying only the visible area is much faster than querying the whole country
 * and reduces load on the public Overpass server. The signal that triggered
 * the popup is always visible, so it is always within this bbox.
 */
function _viewportBbox() {
    const b = map.getBounds();
    return `${b.getSouth()},${b.getWest()},${b.getNorth()},${b.getEast()}`;
}


/* ===== Cache and in-flight state ===== */

/*
 * Result shape:
 *   { status: 'in-osm',      nodeId: 12345678 }
 *   { status: 'not-in-osm',  nodeId: null }
 *   { status: 'unsupported', nodeId: null }
 *   { status: 'error',       nodeId: null }
 */

const _cache = new Map();   // cacheKey -> result
const _pending = new Map();   // pendingKey -> Promise

// AbortController for the current in-flight batch request.
// Aborted when a new popup opens before the previous batch resolves,
// reducing unnecessary load on the public Overpass server.
let _batchAbort = null;

// Cache key: "<refTag>:<idreseau>"
// Both forward and backward hits are stored under the same forward-based key
// since we only need to know "is this idreseau present in OSM, in any form".
function _cacheKey(refTag, idreseau) { return `${refTag}:${idreseau}`; }


/* ===== Internal fetch helper ===== */

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


/* ===== Public API ===== */

/**
 * Remove 'not-in-osm' cache entries for the given features so that the next
 * popup open triggers a fresh Overpass check.
 * Call after a successful copy or JOSM export.
 */
export function invalidateSignalGroup(feats) {
    for (const f of feats) {
        const refTag = getSignalId(f.p.type_if);
        if (!refTag || !f.p.idreseau) continue;
        // Clear the forward key (used as the canonical cache key for both directions).
        const key = _cacheKey(refTag, f.p.idreseau);
        if (_cache.get(key)?.status === 'not-in-osm') _cache.delete(key);
        // Also clear a potential entry keyed under the backward ref tag,
        // in case the signal was found via its :ref:backward key in a previous check.
        const bwdTag = getBackwardSignalId(f.p.type_if);
        if (bwdTag) {
            const bwdKey = _cacheKey(bwdTag, f.p.idreseau);
            if (_cache.get(bwdKey)?.status === 'not-in-osm') _cache.delete(bwdKey);
        }
    }
}

/**
 * Check a group of co-located signals in a single Overpass request.
 * Returns Promise<Array<{ status, nodeId }>> -- one entry per feat, in order.
 *
 * Each signal generates two union clauses (forward ref + backward ref) so the
 * check succeeds whether the signal is the principal or backward member of an
 * existing OSM node. force=true clears cached results before querying.
 */
export function checkSignalGroup(feats, force = false) {
    // Abort any previous in-flight batch to avoid stale results overwriting
    // a popup that has already been replaced, and to spare the Overpass server.
    _batchAbort?.abort();
    _batchAbort = new AbortController();
    const { signal } = _batchAbort;

    // Build one descriptor per feat carrying both ref keys and the cache key.
    const entries = feats.map(f => {
        const refTag = getSignalId(f.p.type_if);
        const bwdTag = getBackwardSignalId(f.p.type_if);
        if (!refTag || !f.p.idreseau) {
            return { key: null, refTag: null, bwdTag: null, idreseau: null };
        }
        return { key: _cacheKey(refTag, f.p.idreseau), refTag, bwdTag, idreseau: f.p.idreseau };
    });

    if (force) entries.forEach(e => e.key && _cache.delete(e.key));

    // Entries that need a fresh network request (not yet in cache).
    const toFetch = entries.filter(e => e.key && !_cache.has(e.key));

    let networkPromise;

    if (toFetch.length === 0) {
        networkPromise = Promise.resolve(false);
    } else {
        // Deduplicate by cache key (same idreseau appearing twice in the group).
        const unique = [...new Map(toFetch.map(e => [e.key, e])).values()];
        const bbox = _viewportBbox();
        const batchKey = '_batch:' + unique.map(e => e.key).join('|');

        if (_pending.has(batchKey)) {
            networkPromise = _pending.get(batchKey);
        } else {
            // Two union clauses per signal: forward ref AND backward ref.
            // One HTTP round-trip for the whole group.
            const unions = unique.flatMap(e => [
                `node["${e.refTag}"="${e.idreseau}"](${bbox});`,
                `node["${e.bwdTag}"="${e.idreseau}"](${bbox});`,
            ]).join('');
            const query = `[out:json][timeout:15];(${unions});out ids tags;`;

            const p = _fetchOverpass(query, signal)
                .then(data => {
                    // Match each returned element back to a cache entry.
                    // A hit on either the forward or backward ref key counts as 'in-osm'.
                    for (const el of (data.elements || [])) {
                        for (const e of unique) {
                            if (_cache.has(e.key)) continue;   // already resolved
                            if (el.tags?.[e.refTag] === e.idreseau ||
                                el.tags?.[e.bwdTag] === e.idreseau) {
                                _cache.set(e.key, { status: 'in-osm', nodeId: el.id });
                            }
                        }
                    }
                    // Entries not matched by any element were not found in OSM.
                    for (const e of unique) {
                        if (!_cache.has(e.key)) {
                            _cache.set(e.key, { status: 'not-in-osm', nodeId: null });
                        }
                    }
                    _pending.delete(batchKey);
                    return false;   // no error
                })
                .catch(err => {
                    _pending.delete(batchKey);
                    // AbortError is expected when a newer popup opens -- not a real failure.
                    if (err.name === 'AbortError') return 'aborted';
                    console.warn('[overpass batch]', err.message);
                    // Errors are NOT cached -- allows automatic retry on next popup open.
                    return true;   // error flag
                });

            _pending.set(batchKey, p);
            networkPromise = p;
        }
    }

    return networkPromise.then(hadError =>
        entries.map(e => {
            if (!e.key) return { status: 'unsupported', nodeId: null };
            // 'aborted' means this batch was superseded by a newer popup.
            // Leave status as 'checking' rather than flashing an error.
            if (hadError === 'aborted') return { status: 'checking', nodeId: null };
            return _cache.get(e.key)
                ?? (hadError ? { status: 'error', nodeId: null }
                    : { status: 'not-in-osm', nodeId: null });
        })
    );
}
