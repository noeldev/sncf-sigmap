/**
 * osm-check.js
 * Check whether signals already exist in OpenStreetMap via the Overpass API.
 * Returns the OSM node ID when found so the popup can link to openstreetmap.org/node/<id>.
 * Results are cached in memory for the session.
 *
 * checkOsm()      — single signal
 * checkOsmBatch() — one Overpass request for a whole co-located group (preferred)
 */

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

import { map } from './map.js';
import { TYPE_REF_TAG } from './signal-mapping.js';

/**
 * Returns the current map viewport as an Overpass bbox string: "swLat,swLng,neLat,neLng".
 * Querying only the visible area is much faster than querying the full country,
 * and reduces load on the public Overpass server.
 * The signal that triggered the popup is always visible, so it is always within this bbox.
 */
function _viewportBbox() {
    const b = map.getBounds();
    return `${b.getSouth()},${b.getWest()},${b.getNorth()},${b.getEast()}`;
}

/**
 * Result shape:
 *   { status: 'in-osm',      nodeId: 12345678 }
 *   { status: 'not-in-osm',  nodeId: null }
 *   { status: 'unsupported', nodeId: null }
 *   { status: 'error',       nodeId: null }
 */

const _cache = new Map();   // cacheKey -> result
const _pending = new Map();   // pendingKey -> Promise<void>

// AbortController for the current in-flight batch request.
// Aborted when a new popup opens before the previous batch resolves,
// reducing unnecessary load on the public Overpass server.
let _batchAbort = null;

function _cacheKey(refTag, idreseau) { return `${refTag}:${idreseau}`; }

function _clearCacheEntry(key) { _cache.delete(key); }

/**
 * Remove 'not-in-osm' cache entries for the given features so that the next
 * popup open triggers a fresh Overpass check.
 * Called by popup.js after a copy/JOSM export so that a node that was just
 * added to OSM will be detected on the next popup open.
 */
export function invalidateNotInOsm(feats) {
    for (const f of feats) {
        const refTag = TYPE_REF_TAG[f.p.type_if];
        if (!refTag || !f.p.idreseau) continue;
        const key = _cacheKey(refTag, f.p.idreseau);
        if (_cache.get(key)?.status === 'not-in-osm') _cache.delete(key);
    }
}

/** Raw Overpass fetch helper. Accepts an optional AbortSignal. */
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
 * Check a single signal.
 * Returns Promise<{ status, nodeId }>.
 * force=true clears any cached/pending result before querying.
 */
export function checkOsm(idreseau, type_if, force = false) {
    const unsupported = { status: 'unsupported', nodeId: null };
    if (!idreseau) return Promise.resolve(unsupported);

    const refTag = TYPE_REF_TAG[type_if];
    if (!refTag) return Promise.resolve(unsupported);

    const key = _cacheKey(refTag, idreseau);
    if (force) _clearCacheEntry(key);

    if (_cache.has(key)) return Promise.resolve(_cache.get(key));
    if (_pending.has(key)) return _pending.get(key);

    const query = `[out:json][timeout:15];node["${refTag}"="${idreseau}"](${_viewportBbox()});out ids;`;

    const promise = _fetchOverpass(query)
        .then(data => {
            const el = data.elements?.[0];
            const result = el
                ? { status: 'in-osm', nodeId: el.id }
                : { status: 'not-in-osm', nodeId: null };
            _cache.set(key, result);
            _pending.delete(key);
            return result;
        })
        .catch(err => {
            console.warn('[osm-check]', idreseau, err.message);
            _pending.delete(key);
            // Errors are not cached — allows automatic retry on next popup open
            return { status: 'error', nodeId: null };
        });

    _pending.set(key, promise);
    return promise;
}

/**
 * Check a group of co-located signals in a single Overpass request.
 * Returns Promise<Array<{ status, nodeId }>> — one entry per feat, in order.
 *
 * Signals without a supported type resolve to 'unsupported' immediately.
 * All supported signals are batched into ONE union query — a single round-trip
 * regardless of how many co-located signals there are.
 * force=true clears cached results for the whole group before querying.
 */
export function checkOsmBatch(feats, force = false) {
    // Abort any previous in-flight batch to avoid stale results updating
    // a popup that has already been replaced, and to spare the Overpass server.
    _batchAbort?.abort();
    _batchAbort = new AbortController();
    const { signal } = _batchAbort;

    const entries = feats.map(f => {
        const refTag = TYPE_REF_TAG[f.p.type_if];
        if (!refTag || !f.p.idreseau) return { key: null, refTag: null, idreseau: null };
        return { key: _cacheKey(refTag, f.p.idreseau), refTag, idreseau: f.p.idreseau };
    });

    if (force) entries.forEach(e => e.key && _clearCacheEntry(e.key));

    // Entries that need a fresh network request
    const toFetch = entries.filter(e => e.key && !_cache.has(e.key));

    let networkPromise;
    if (toFetch.length === 0) {
        networkPromise = Promise.resolve();
    } else {
        // Deduplicate by key (same signal referenced twice in the group)
        const unique = [...new Map(toFetch.map(e => [e.key, e])).values()];
        // Capture the viewport bbox once for the whole batch
        const bbox = _viewportBbox();
        const unions = unique.map(e => `node["${e.refTag}"="${e.idreseau}"](${bbox});`).join('');
        const query = `[out:json][timeout:15];(${unions});out ids tags;`;
        const batchKey = '_batch:' + unique.map(e => e.key).join('|');

        if (_pending.has(batchKey)) {
            networkPromise = _pending.get(batchKey);
        } else {
            // The promise resolves with true on network error, false on success.
            // This flag is forwarded to the final .then() so it can distinguish
            // between "signal not found in OSM" and "request failed".
            const p = _fetchOverpass(query, signal)
                .then(data => {
                    // For each returned element, match it back to cached entries
                    for (const el of (data.elements || [])) {
                        for (const e of unique) {
                            if (el.tags?.[e.refTag] === e.idreseau) {
                                _cache.set(e.key, { status: 'in-osm', nodeId: el.id });
                            }
                        }
                    }
                    // Mark unfound entries as not-in-osm
                    for (const e of unique) {
                        if (!_cache.has(e.key)) _cache.set(e.key, { status: 'not-in-osm', nodeId: null });
                    }
                    _pending.delete(batchKey);
                    return false; // no error
                })
                .catch(err => {
                    _pending.delete(batchKey);
                    // AbortError is expected when a newer popup opens — not a real failure.
                    if (err.name === 'AbortError') return 'aborted';
                    console.warn('[osm-check batch]', err.message);
                    // Errors are NOT cached — consistent with checkOsm() and allows
                    // automatic retry on the next popup open without a manual refresh.
                    return true; // error flag
                });

            _pending.set(batchKey, p);
            networkPromise = p;
        }
    }

    return networkPromise.then(hadError =>
        entries.map(e => {
            if (!e.key) return { status: 'unsupported', nodeId: null };
            // 'aborted' means the request was superseded — leave the popup in its
            // current checking state rather than flashing an error.
            if (hadError === 'aborted') return { status: 'checking', nodeId: null };
            return _cache.get(e.key) ?? (hadError ? { status: 'error', nodeId: null } : { status: 'not-in-osm', nodeId: null });
        })
    );
}
