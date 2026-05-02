/**
 * osm-index.js — Application-wide permanent OSM signal presence index.
 *
 * Pure data service: no Leaflet dependency, no map events, no guard logic.
 * map-layer.js owns the idle timer, movestart/moveend wiring, guard evaluation,
 * and bbox computation. This module only decides whether a given area is already
 * covered, fetches it if not, and maintains the index.
 *
 * Maintains a session-permanent Map of networkId → OSM node data for all signals
 * confirmed to exist in OpenStreetMap. Entries are never evicted; the index only
 * grows throughout the session.
 *
 * Population sources:
 *   - Viewport scan (fetchViewport): bulk query of all railway=signal nodes
 *     in the current map view. Triggered by map-layer.js after guard evaluation.
 *   - Popup cross-feed (primeFromPopup): osm-checker.js feeds confirmed IN_OSM
 *     results so popup checks enrich the index for other signals.
 *
 * BBox strategy:
 *   Coverage is checked against the strict viewport bbox. When a scan is needed,
 *   the padded fetch area (computed by map-layer.js) is used so that subsequent
 *   small pans and zoom adjustments fall inside the already-scanned area.
 *
 * Note on coverage and negative results:
 *   _scannedBboxes tracks where we have scanned, not what was found. Signals
 *   absent from the index are simply not in OSM — there is no negative cache.
 *   A signal added to OSM during the session can be discovered via the popup's
 *   osm-checker.js invalidate() without needing to re-scan the viewport.
 *
 * Public API:
 *   getOsmNode(networkId)            — { id, tags, lat, lon } | null
 *   hasOsmNode(networkId)            — boolean
 *   fetchViewport(bbox, paddedBbox)  — scan the area if not already covered
 *   abortScan()                      — cancel any in-flight scan (called on map move)
 *   primeFromPopup(networkId, entry) — feed a confirmed IN_OSM result
 *   onUpdate                         — Observable; notified after each index update
 */

import { fetchSignalsInBbox } from './overpass.js';
import { Observable } from './utils/observable.js';

// ===== Configuration =====

/** Matches any railway:signal:*:ref tag key. */
const REF_TAG_RE = /^railway:signal:[^:]+:ref$/;

// ===== State =====

/** Permanent session index: networkId → { id, tags, lat, lon }. Never cleared. */
const _index = new Map();

/**
 * Bounding boxes of completed scans. A viewport whose strict bounds are fully
 * contained within a previously scanned bbox is skipped — its signals are already
 * indexed. Partial overlaps are not sufficient: uncovered territory triggers a scan.
 * @type {Array<{ swLat: number, swLng: number, neLat: number, neLng: number }>}
 */
const _scannedBboxes = [];

let _abortController = null;
let _fetching = false;

// ===== Observables =====

/** Notified (no arguments) whenever new entries are added to the index. */
export const onUpdate = new Observable();

// ===== Public API =====

/**
 * Return the OSM node entry for a given networkId, or null if unknown.
 *
 * @param {string} networkId
 * @returns {{ id: number, tags: object, lat: number|null, lon: number|null } | null}
 */
export function getOsmNode(networkId) {
    return _index.get(networkId) ?? null;
}

/**
 * Return true when the given networkId is confirmed to exist in OSM.
 * @param {string} networkId
 * @returns {boolean}
 */
export function hasOsmNode(networkId) {
    return _index.has(networkId);
}

/**
 * Feed a confirmed IN_OSM result from osm-checker.js into the permanent index.
 * No-op if the networkId is already indexed (first writer wins).
 *
 * @param {string}                       networkId
 * @param {{ id: number, tags: object }} entry
 */
export function primeFromPopup(networkId, entry) {
    if (_index.has(networkId)) return;
    _index.set(networkId, { id: entry.id, tags: entry.tags, lat: null, lon: null });
    onUpdate.notify();
}

/**
 * Cancel any in-flight Overpass scan.
 * Called by map-layer.js on movestart and zoomstart.
 */
export function abortScan() {
    _abortController?.abort();
    _abortController = null;
}

/**
 * Scan the given area for railway=signal nodes and index the results.
 * Guards (zoom, bbox size, signal count) are evaluated by the caller before
 * this function is called — this module only checks area coverage.
 *
 * @param {{ swLat, swLng, neLat, neLng }} bbox       — strict viewport, used for coverage check.
 * @param {{ swLat, swLng, neLat, neLng }} paddedBbox — expanded area to fetch, absorbs small pans.
 * @returns {Promise<void>}
 */
export async function fetchViewport(bbox, paddedBbox) {
    if (_fetching) return;

    // Skip when the strict viewport is already fully covered by a previous scan.
    if (_isAlreadyCovered(bbox)) return;

    await _runScan(paddedBbox);
}

// ===== Private — coverage =====

/**
 * Return true when the given bbox is fully contained within any single
 * previously scanned bbox — meaning every signal in it was already fetched.
 *
 * @param {{ swLat, swLng, neLat, neLng }} bbox
 * @returns {boolean}
 */
function _isAlreadyCovered(bbox) {
    return _scannedBboxes.some(b =>
        bbox.swLat >= b.swLat
        && bbox.swLng >= b.swLng
        && bbox.neLat <= b.neLat
        && bbox.neLng <= b.neLng
    );
}

// ===== Private — fetch =====

/**
 * Execute the Overpass scan for the given bbox, parse results, and update the index.
 * Records the scanned bbox on success so future calls can skip covered viewports.
 *
 * @param {{ swLat, swLng, neLat, neLng }} bbox
 * @returns {Promise<void>}
 */
async function _runScan(bbox) {
    _abortController?.abort();
    _abortController = new AbortController();
    _fetching = true;

    try {
        const elements = await fetchSignalsInBbox(_bboxToString(bbox), _abortController.signal);

        let added = 0;
        for (const el of elements) {
            added += _indexElement(el);
        }

        _scannedBboxes.push(bbox);
        if (added > 0) onUpdate.notify();

    } catch (err) {
        if (err.name !== 'AbortError') {
            console.warn('[osm-index] viewport scan failed:', err.message);
        }
    } finally {
        _fetching = false;
    }
}

/** Format a numeric bbox object as the "S,W,N,E" string expected by Overpass. */
function _bboxToString(bbox) {
    return `${bbox.swLat},${bbox.swLng},${bbox.neLat},${bbox.neLng}`;
}

/**
 * Extract all railway:signal:*:ref tags from one Overpass element and add
 * any new networkId entries to the index.
 *
 * @param {{ id: number, tags: object, lat: number, lon: number }} el
 * @returns {number} Number of new entries added.
 */
function _indexElement(el) {
    const tags = el.tags ?? {};
    let added = 0;
    for (const [key, val] of Object.entries(tags)) {
        if (!REF_TAG_RE.test(key) || _index.has(val)) continue;
        _index.set(val, { id: el.id, tags, lat: el.lat, lon: el.lon });
        added++;
    }
    return added;
}
