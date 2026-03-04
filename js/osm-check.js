/**
 * osm-check.js
 * Check whether signals already exist in OpenStreetMap via the Overpass API.
 * Returns the OSM node ID when found so the popup can link to openstreetmap.org/node/<id>.
 * Results are cached in memory for the session.
 *
 * checkOsm()      — single signal
 * checkOsmBatch() — one Overpass request for a whole co-located group
 */

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const FRANCE_BBOX  = '41.3,-5.5,51.2,9.6';

import { TYPE_REF_TAG } from './signal-mapping.js';

/**
 * Result shape:
 *   { status: 'in-osm',      nodeId: 12345678 }
 *   { status: 'not-in-osm',  nodeId: null }
 *   { status: 'unsupported', nodeId: null }
 *   { status: 'error',       nodeId: null }
 */

const _cache   = new Map();   // cacheKey -> result
const _pending = new Map();   // pendingKey -> Promise<void>

function _cacheKey(refTag, idreseau) { return `${refTag}:${idreseau}`; }

function _clearCacheEntry(key) { _cache.delete(key); }

/** Raw Overpass fetch helper. */
function _fetchOverpass(query) {
    return fetch(OVERPASS_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body:    'data=' + encodeURIComponent(query),
    }).then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
    });
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
    if (!refTag)   return Promise.resolve(unsupported);

    const key = _cacheKey(refTag, idreseau);
    if (force) _clearCacheEntry(key);

    if (_cache.has(key))   return Promise.resolve(_cache.get(key));
    if (_pending.has(key)) return _pending.get(key);

    const query = `[out:json][timeout:10];node["${refTag}"="${idreseau}"](${FRANCE_BBOX});out ids;`;

    const promise = _fetchOverpass(query)
        .then(data => {
            const el     = data.elements?.[0];
            const result = el
                ? { status: 'in-osm',     nodeId: el.id }
                : { status: 'not-in-osm', nodeId: null  };
            _cache.set(key, result);
            _pending.delete(key);
            return result;
        })
        .catch(err => {
            console.warn('[osm-check]', idreseau, err.message);
            _pending.delete(key);
            // Errors are not cached — allows retry on next popup open or explicit retry
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
 * All others are batched into one union query.
 * force=true clears cached results for the whole group before querying.
 */
export function checkOsmBatch(feats, force = false) {
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
        const unions = unique.map(e => `node["${e.refTag}"="${e.idreseau}"](${FRANCE_BBOX});`).join('');
        const query  = `[out:json][timeout:15];(${unions});out ids tags;`;
        const batchKey = '_batch:' + unique.map(e => e.key).join('|');

        if (_pending.has(batchKey)) {
            networkPromise = _pending.get(batchKey);
        } else {
            const p = _fetchOverpass(query)
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
                })
                .catch(err => {
                    console.warn('[osm-check batch]', err.message);
                    for (const e of unique) _cache.set(e.key, { status: 'error', nodeId: null });
                    _pending.delete(batchKey);
                });

            _pending.set(batchKey, p);
            networkPromise = p;
        }
    }

    return networkPromise.then(() =>
        entries.map(e => {
            if (!e.key) return { status: 'unsupported', nodeId: null };
            return _cache.get(e.key) ?? { status: 'not-in-osm', nodeId: null };
        })
    );
}
