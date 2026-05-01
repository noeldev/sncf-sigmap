/**
 * osm-index.js — Application-wide permanent OSM signal presence index.
 *
 * Maintains a session-permanent Map of networkId → OSM node data for all signals
 * confirmed to exist in OpenStreetMap. Entries are never evicted; the index only
 * grows throughout the session.
 *
 * Population sources:
 *   - Viewport scan (fetchViewport): bulk query of all railway=signal nodes
 *     in the current map view. Triggered automatically after idle or on user action.
 *   - Popup cross-feed (primeFromPopup): osm-checker.js feeds confirmed IN_OSM
 *     results so popup checks enrich the index for other signals.
 *
 * Trigger contract (called from map-layer.js):
 *   - tooltipopen: opportunistic scan when user hovers a marker.
 *   - 30 s idle:   automatic scan after the map has been still long enough,
 *                  provided the viewport is not already covered.
 *
 * BBox strategy:
 *   Coverage is checked against the strict viewport bbox. When a scan is needed,
 *   the fetch area is padded by FETCH_PAD_FACTOR (Leaflet .pad()) so that subsequent
 *   small pans and zoom adjustments fall inside the already-scanned area, avoiding
 *   redundant Overpass queries.
 *
 * All triggers are no-ops when guards fail: zoom too low, bbox too large,
 * signal count out of range, or viewport already covered.
 *
 * Public API:
 *   init(map, getVisibleCount)        — wire map events; call once on boot.
 *   getOsmNode(networkId)             — { id, tags, lat, lon } | null
 *   hasOsmNode(networkId)             — boolean
 *   fetchViewport()                   — trigger a scan (guards enforced internally)
 *   primeFromPopup(networkId, entry)  — feed a confirmed IN_OSM result
 *   onUpdate                          — Observable; notified after each index update
 */

import { fetchSignalsInBbox } from './overpass.js';
import { Observable } from './utils/observable.js';

// ===== Configuration =====

/** Idle time after the last map movement before auto-triggering a scan. */
const IDLE_DELAY_MS = 30_000;

/** Minimum zoom level required to trigger a scan.
 *  Must stay in sync with the tile renderer's own minimum render zoom (map-layer.js). */
const MIN_ZOOM = 14;

/** Maximum bbox diagonal in decimal degrees beyond which the viewport is too wide.
 *  Acts as a safety net independent of zoom (e.g. very wide aspect ratios on large screens). */
const MAX_BBOX_DIAGONAL_DEG = 0.5;

/** Maximum visible signal count above which a scan is skipped.
 *  Keeps Overpass responses light and targets realistic mapping sessions. */
const MAX_AUTO_SIGNALS = 100;

/** Minimum visible signal count below which a scan is pointless. */
const MIN_AUTO_SIGNALS = 1;

/** Expansion factor applied to the viewport bounds when building the Overpass fetch area.
 *  Leaflet .pad(0.25) doubles linear dimensions (×2.25 area), so that subsequent small
 *  pans and zoom adjustments land inside the already-scanned bbox and skip the query.
 *  Guards (_passesGuards) are evaluated against the strict viewport, not the padded area. */
const FETCH_PAD_FACTOR = 0.25;

/** Matches any railway:signal:*:ref tag key. */
const REF_TAG_RE = /^railway:signal:[^:]+:ref$/;

// ===== State =====

/** Permanent session index: networkId → { id, tags, lat, lon }. Never cleared. */
const _index = new Map();

/**
 * Bounding boxes of completed scans. A viewport whose bounds are fully contained
 * within a previously scanned bbox is skipped — its signals are already indexed.
 * @type {Array<{ swLat: number, swLng: number, neLat: number, neLng: number }>}
 */
const _scannedBboxes = [];

/** @type {L.Map | null} */
let _map = null;

/** Returns the current visible signal count. Injected by init() from map-layer.js. */
let _getVisibleCount = null;

let _idleTimer = null;
let _abortController = null;
let _fetching = false;

// ===== Observables =====

/** Notified (no arguments) whenever new entries are added to the index. */
export const onUpdate = new Observable();

// ===== Public API =====

/**
 * Wire up the index to the Leaflet map instance.
 * Must be called once during app initialisation, after initMap() resolves.
 * getVisibleCount is injected to avoid a circular dependency with map-layer.js.
 *
 * @param {L.Map}        map
 * @param {() => number} getVisibleCount - Returns the current visible signal count.
 */
export function init(map, getVisibleCount) {
    _map = map;
    _getVisibleCount = getVisibleCount;
    map.on('movestart zoomstart', _onMoveStart);
    map.on('moveend zoomend', _onMoveEnd);
}

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
 * Trigger a viewport scan.
 * Guards are enforced against the strict viewport bbox.
 * When a scan is needed, the fetch area is padded by FETCH_PAD_FACTOR so that
 * subsequent small pans are absorbed without a new Overpass query.
 * Called from map-layer.js on tooltipopen and internally after the 30 s idle timer.
 *
 * @returns {Promise<void>}
 */
export async function fetchViewport() {
    if (_fetching || !_map) return;
    if (!_passesGuards()) return;

    // Coverage check uses the strict viewport so any uncovered territory triggers a scan.
    const viewBbox = _getCurrentBbox();
    if (_isAlreadyCovered(viewBbox)) return;

    // Fetch a padded area to absorb subsequent small pans without extra queries.
    await _runScan(_getPaddedFetchBbox());
}

// ===== Private — guards =====

/**
 * Return true when all guards pass: zoom level, bbox diagonal, and signal count.
 * Evaluated against the strict viewport — not the padded fetch area.
 * @returns {boolean}
 */
function _passesGuards() {
    if (_map.getZoom() < MIN_ZOOM) return false;

    const bounds = _map.getBounds();
    const latDelta = bounds.getNorthEast().lat - bounds.getSouthWest().lat;
    const lngDelta = bounds.getNorthEast().lng - bounds.getSouthWest().lng;
    const diagonal = Math.sqrt(latDelta ** 2 + lngDelta ** 2);
    if (diagonal > MAX_BBOX_DIAGONAL_DEG) return false;

    const count = _getVisibleCount?.() ?? 0;
    if (count < MIN_AUTO_SIGNALS || count > MAX_AUTO_SIGNALS) return false;

    return true;
}

/** Build the strict current viewport bbox from the live Leaflet map state. */
function _getCurrentBbox() {
    const bounds = _map.getBounds();
    return {
        swLat: bounds.getSouthWest().lat,
        swLng: bounds.getSouthWest().lng,
        neLat: bounds.getNorthEast().lat,
        neLng: bounds.getNorthEast().lng,
    };
}

/**
* Build a padded fetch bbox from the current viewport.
 * Leaflet .pad(factor) expands each edge by factor × half the dimension,
 * doubling linear dimensions at 0.25 (×2.25 total area).
 */
function _getPaddedFetchBbox() {
    const padded = _map.getBounds().pad(FETCH_PAD_FACTOR);
    return {
        swLat: padded.getSouthWest().lat,
        swLng: padded.getSouthWest().lng,
        neLat: padded.getNorthEast().lat,
        neLng: padded.getNorthEast().lng,
    };
}

/**
 * Return true when the given bbox is fully contained within any single
 * previously scanned bbox — meaning every signal in it was already fetched.
 * Partial overlaps are not sufficient: uncovered territory requires a new scan.
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

// ===== Private — map event handlers =====

function _onMoveStart() {
    clearTimeout(_idleTimer);
    _idleTimer = null;
    _abortController?.abort();
}

function _onMoveEnd() {
    clearTimeout(_idleTimer);
    _idleTimer = setTimeout(fetchViewport, IDLE_DELAY_MS);
}
