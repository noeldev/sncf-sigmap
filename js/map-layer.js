/**
 * map-layer.js — Signal marker layer: worker pipeline and Leaflet rendering.
 *
 * Responsibilities:
 *   - Manage the Leaflet marker layer for signal dots.
 *   - Drive the geojson.worker.js pipeline: fetch tiles, filter, sample.
 *   - Render worker results as Leaflet markers with tooltips and popups.
 *   - Own the dot size scale (DOT_SCALE) used by _makeDotIcon().
 *
 * Public API (called from app.js):
 *   initLayer()         — create markersLayer.
 *   setManifest(m)      — provide the tile manifest after it loads.
 *   refresh(force)      — trigger a data fetch/render cycle.
 *
 * Progress overlay is driven via progress.js directly.
 * Status bar updates are delegated to statusbar.js.
 *
 * Separation from map.js:
 *   map.js owns Leaflet infrastructure (tile layers, basemap selector).
 *   This module owns the application data pipeline built on top of that map.
 */

import { OVERVIEW_MAX_ZOOM, OVERVIEW_MAX_SIGNALS } from './config.js';
import { map } from './map.js';
import { getTileUrlsForBounds } from './tiles.js';
import { getActiveFiltersForWorker, indexSignals, resetCounts } from './filters.js';
import { openSignalPopup } from './signal-popup.js';
import { getTypeColor } from './signal-mapping.js';
import { buildTooltip } from './tooltip.js';
import { t } from './i18n.js';
import { isOwnWorkerMessage } from './worker-contract.js';
import { showProgress, hideProgress } from './progress.js';
import { updateVisibleCount, setSampledBadge } from './statusbar.js';


// ===== Module state =====

let _manifest = null;
let _markersLayer = null;
let _worker = null;
let _loadPending = false;
let _loadRunning = false;


// ===== Dot size scale =====
// Single source of truth for marker dot diameters.
// count=5 covers "5 or more" — the formula caps at this entry.
// Private to this module: the only consumer is _getDotSize() below.

const DOT_SCALE = [
    { count: 1, size: 10 },
    { count: 2, size: 12 },
    { count: 3, size: 14 },
    { count: 4, size: 16 },
    { count: 5, size: 18 },
];

function _getDotSize(count) {
    const idx = Math.min(count, DOT_SCALE.length) - 1;
    return DOT_SCALE[Math.max(idx, 0)].size;
}


// ===== Public API =====

/**
 * Initialise the marker layer.
 * Must be called once from app.js/_boot() after initMap() resolves.
 */
export function initLayer() {
    _markersLayer = L.layerGroup().addTo(map);
}

/**
 * Store the tile manifest once it has been fetched by app.js.
 * refresh() is a no-op until this has been called with a non-null value.
 *
 * @param {object} manifest
 */
export function setManifest(manifest) {
    _manifest = manifest;
}

/**
 * Trigger a data fetch/render cycle.
 * When force=false, the call is skipped if the visible tile set is unchanged.
 * When a load is already running, the request is queued as a pending load.
 *
 * @param {boolean} [force=false]
 */
export function refresh(force = false) {
    if (_loadRunning) { _loadPending = true; return; }

    if (!_manifest) return;

    const bounds = map.getBounds();
    const zoom = map.getZoom();
    const fetchUrls = getTileUrlsForBounds(bounds, _manifest, 1);

    if (fetchUrls.length === 0) {
        _markersLayer.clearLayers();
        updateVisibleCount(0);
        setSampledBadge(false);
        return;
    }

    _loadPending = false;
    _runWorker(bounds, fetchUrls, zoom);
}



// ===== Worker lifecycle =====

/**
 * Terminate the active worker and clear the module-level reference.
 * Centralised here to avoid duplicating the null-guard at every call site.
 */
function _terminateWorker() {
    if (_worker) {
        _worker.terminate();
        _worker = null;
    }
}

function _runWorker(bounds, tileUrls, zoom) {
    _terminateWorker();
    _loadRunning = true;
    showProgress(t('progress.tiles', tileUrls.length));

    _worker = new Worker(new URL('geojson.worker.js', import.meta.url), { type: 'module' });
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();
    const isOverview = zoom < OVERVIEW_MAX_ZOOM;

    // Track markers by group key for incremental updates.
    // Key: "lat,lng" — value: Leaflet marker instance.
    const _markerMap = new Map();

    _worker.onmessage = e => {
        if (!isOwnWorkerMessage(e)) return;
        const { status, msg, groups, loaded, total, sampled } = e.data;

        if (status === 'progress') { showProgress(msg); return; }
        if (status === 'error') { _terminateLoad(); console.error('[Worker]', e.data.error); return; }

        if (status === 'partial') {
            // In overview mode, skip incremental rendering — the final 'done'
            // message will apply spatial sampling and render the stable result.
            if (isOverview) return;
            _renderGroupsIncremental(groups, _markerMap);
            updateVisibleCount(_markerMap.size);
            showProgress(`Loading ${loaded} / ${total} tile(s)…`);
            return;
        }

        if (status === 'done') {
            _onWorkerDone(groups, sampled, e.data.total);
        }
    };

    _worker.onerror = err => {
        console.error('[Worker error]', err.message);
        _terminateLoad();
    };

    _worker.postMessage({
        type: 'fetch-tiles',
        urls: tileUrls,
        activeFilters: getActiveFiltersForWorker(),
        bounds: { swLat: sw.lat, swLng: sw.lng, neLat: ne.lat, neLng: ne.lng },
        maxSignals: isOverview ? OVERVIEW_MAX_SIGNALS : null,
    });
}

/** Release the worker and clear the running flag. */
function _terminateLoad() {
    _terminateWorker();
    _loadRunning = false;
    hideProgress();
}

/**
 * Handle a successful worker 'done' message.
 * Rebuilds filter counts, renders markers, then runs any pending refresh.
 * _loadRunning stays true until _terminateLoad() to prevent double-counting
 * if a refresh() arrives during indexSignals().
 */
function _onWorkerDone(groups, sampled, total) {
    resetCounts();
    indexSignals(groups.flatMap(g => g.all));
    _renderGroups(groups);
    setSampledBadge(sampled, total);
    _terminateLoad();
    if (_loadPending) {
        _loadPending = false;
        refresh(true);
    }
}


// ===== Rendering =====

/**
 * Build a Leaflet divIcon for a signal dot.
 * The HTML is minimal and intentionally generated at runtime — the color
 * (CSS custom property --c) and size (--sz) are computed values that cannot
 * be inlined in a static template.
 *
 * @param {string}  color  CSS color value (hex or named).
 * @param {number}  size   Icon dimension in pixels.
 * @param {boolean} multi  True when the group contains more than one signal.
 * @returns {L.DivIcon}
 */
function _makeDotIcon(color, size, multi) {
    const half = size / 2;
    return L.divIcon({
        className: '',
        html: `<div class="sig-dot${multi ? ' multi' : ''}" style="--c:${color};--sz:${size}px"></div>`,
        iconSize: [size, size],
        iconAnchor: [half, half],
    });
}

/**
 * Build a fully configured Leaflet marker for one group.
 * Shared by _renderGroups (full render) and _renderGroupsIncremental (partial).
 * @param {number}   lat
 * @param {number}   lng
 * @param {object[]} all      all co-located signals (for JOSM export)
 * @param {object[]} display  filtered signals (for icon colour and tooltip)
 * @returns {L.Marker}
 */
function _makeMarker(lat, lng, all, display) {
    const color = getTypeColor(display[0].p.type_if);
    const count = display.length;
    const icon = _makeDotIcon(color, _getDotSize(count), count > 1);
    return L.marker([lat, lng], { icon })
        .bindTooltip(buildTooltip(display), {
            direction: 'top',
            offset: [0, -6],
            className: 'sig-tooltip',
            sticky: false,
        })
        .on('click', e => {
            const startTab = (e.originalEvent?.shiftKey || e.originalEvent?.ctrlKey)
                ? 'tags' : 'signals';
            openSignalPopup([lat, lng], all, 0, startTab);
        });
}

/**
 * Full render — clears the layer and rebuilds all markers from scratch.
 * Used by overview mode and the final 'done' message in detail mode.
 */
function _renderGroups(groups) {
    _markersLayer.clearLayers();
    for (const { lat, lng, all, display } of groups) {
        _makeMarker(lat, lng, all, display).addTo(_markersLayer);
    }
    updateVisibleCount(groups.length);
}

/**
 * Incremental render — adds or replaces markers for the given groups only.
 * Uses a markerMap keyed by "lat,lng" so existing markers are replaced rather
 * than duplicated when a group gains more signals from a subsequent tile.
 * @param {{ lat, lng, all, display }[]} groups
 * @param {Map<string, L.Marker>}        markerMap
 */
function _renderGroupsIncremental(groups, markerMap) {
    for (const { lat, lng, all, display } of groups) {
        const key = `${lat},${lng}`;
        if (markerMap.has(key)) _markersLayer.removeLayer(markerMap.get(key));
        const marker = _makeMarker(lat, lng, all, display).addTo(_markersLayer);
        markerMap.set(key, marker);
    }
}

