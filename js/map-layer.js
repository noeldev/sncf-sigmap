/**
 * map-layer.js — Signal marker layer: worker pipeline and Leaflet rendering.
 *
 * Responsibilities:
 *   - Manage the Leaflet marker layer for signal dots.
 *   - Drive the tiles.worker.js pipeline: fetch tiles, normalize, filter, sample.
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
import { openSignalPopup, resolveStartTab } from './signal-popup.js';
import { getTypeColor } from './signal-mapping.js';
import { buildTooltip } from './tooltip.js';
import { t, onLangChange } from './translation.js';
import { isOwnWorkerMessage } from './worker-contract.js';
import { showProgress, hideProgress } from './progress.js';
import { isPinned, togglePin, flashPinned } from './pins.js';
import { updateVisibleCount, setSampledBadge } from './statusbar.js';


// ===== Module state =====

let _manifest = null;
let _markersLayer = null;
let _worker = null;
let _loadPending = false;
let _loadRunning = false;
let _lastGroups = [];   // last rendered groups — used by getSignalLatlng()


/* ===== Language change handling ===== */

// Leaflet caches tooltip DOM nodes at marker-creation time.
// Rebuild all markers when the language changes so tooltips use the new locale.
onLangChange(() => refresh(true));


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
    if (_loadRunning) {
        _loadPending = true;
        return;
    }

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



/**
 * Return the [lat, lng] of a signal by networkId from the last rendered groups.
 * Returns null when the signal is not currently in the viewport.
 * Used by filters.js to fly to a selected networkId pill without a tile fetch.
 * @param {string} networkId
 * @returns {[number, number] | null}
 */
export function getSignalLatlng(networkId) {
    for (const { lat, lng, all } of _lastGroups) {
        if (all.some(s => String(s.p.networkId) === networkId)) return [lat, lng];
    }
    return null;
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

    _worker = new Worker(new URL('tiles.worker.js', import.meta.url), { type: 'module' });
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();
    const isOverview = zoom < OVERVIEW_MAX_ZOOM;

    // Track markers by group key for incremental updates.
    // Key: "lat,lng" — value: Leaflet marker instance.
    const _markerMap = new Map();

    _worker.onmessage = e => _handleWorkerMessage(e, isOverview, _markerMap);

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

/**
 * Dispatch a single worker message to the appropriate handler.
 * Extracted from _runWorker to keep that function focused on setup.
 */
function _handleWorkerMessage(e, isOverview, markerMap) {
    if (!isOwnWorkerMessage(e)) return;
    const { status, msg, groups, loaded, total, sampled } = e.data;

    if (status === 'progress') {
        showProgress(t(e.data.key, ...e.data.args));
        return;
    }

    if (status === 'error') {
        _terminateLoad();
        console.error('[Worker]', e.data.error);
        return;
    }

    if (status === 'partial') {
        // Overview mode waits for 'done' (spatial sampling requires the full set).
        if (isOverview) return;
        _renderGroupsIncremental(groups, markerMap);
        updateVisibleCount(markerMap.size);
        showProgress(t('progress.tiles', `${loaded} / ${total}`));
        return;
    }

    if (status === 'done') {
        _onWorkerDone(groups, sampled, e.data.total);
    }
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
    _lastGroups = groups;
    resetCounts();
    setSampledBadge(sampled, total);    // must precede indexSignals so isSampled() is current
    indexSignals(groups.flatMap(g => g.all));
    _renderGroups(groups);
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
    const color = getTypeColor(display[0].p.signalType);
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
            const orig = e.originalEvent;
            const ctrl = orig?.ctrlKey || orig?.metaKey;
            const shift = orig?.shiftKey;
            if (ctrl && !shift) {
                // Ctrl+click: pin the first signal at this location.
                const networkId = all[0]?.p?.networkId;
                if (networkId) {
                    togglePin(networkId);
                    flashPinned(isPinned(networkId) ? t('pinned.flash') : t('pinned.unflash'));
                }
            } else {
                // Normal click or Shift+click: open popup (Shift flips default tab).
                openSignalPopup([lat, lng], all, 0, resolveStartTab(shift));
            }
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

