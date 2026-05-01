/**
 * map-layer.js — Signal marker layer: worker pipeline and Leaflet rendering.
 *
 * Responsibilities:
 *   - Manage the Leaflet marker layer for signal dots.
 *   - Drive the tiles-worker.js pipeline: fetch tiles, normalize, filter, sample.
 *   - Render worker results as Leaflet markers with tooltips and popups.
 *   - Own the dot size scale (DOT_SCALE) used by _makeDotIcon().
 *   - Own the visible signal count (_visibleCount) as the authoritative source;
 *     statusbar.js receives it for display only.
 *
 * Public API (called from app.js):
 *   initLayer()         — create markersLayer and wire OSM index.
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

import { OVERVIEW_MAX_ZOOM } from './config.js';
import { map, dismissLocationMarker, flyToLocationWithMarker } from './map.js';
import { getTileUrlsForBounds, fetchTileByKey, findSignalLocation } from './tiles.js';
import { getActiveFiltersForWorker, indexSignals, resetLiveCounts } from './filters.js';
import { openSignalPopup, resolveStartTab, closeSignalPopup } from './signal-popup.js';
import { getPrimaryTypeColor } from './signal-mapping.js';
import { buildTooltip } from './tooltip.js';
import { t, onLangChange } from './translation.js';
import { isOwnWorkerMessage } from './tiles-worker-contract.js';
import { showFlash, showProgress, hideProgress } from './progress.js';
import { togglePin, isPinned } from './pins.js';
import { updateVisibleCount, setSampledBadge } from './statusbar.js';
import { showContextMenu, closeContextMenu } from './context-menu.js';
import { getNetworkIdIndex, getLineBbox } from './signal-data.js';
import { fetchViewport, abortScan, onUpdate } from './osm-index.js';


// ===== Module state =====

let _manifest = null;
let _markersLayer = null;
let _worker = null;

let _loadPending = false;
let _loadRunning = false;
let _sampled = false;            // true when the current view is a spatial overview sample
let _popupOpen = false;          // true when a Leaflet popup is open

let _lastGroups = [];            // last rendered groups — used by _getSignalLatlng()
let _lastUrlKey = '';            // cache key for the last worker run (tile URLs + filter snapshot)
let _visibleCount = 0;           // authoritative visible signal count; statusbar.js is display-only

/**
 * Returns true when the current view is a spatial overview sample.
 * Exported so filters.js (via initFilters injection) can use accurate counts.
 * @returns {boolean}
 */
export function isSampled() { return _sampled; }


// ===== Language change handling =====

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


// ===== OSM scan wiring =====
// map-layer.js owns the idle timer, map event handlers, guard evaluation, and bbox
// computation so that osm-index.js remains a pure data service with no Leaflet dependency.
// All scan triggers funnel through _triggerOsmScan(), which is the single call point.

/** Idle time after the last map movement before auto-triggering a viewport scan. */
const OSM_IDLE_DELAY_MS = 30_000;

/** Minimum zoom level required to trigger a scan.
 *  Must stay in sync with the tile renderer's own minimum render zoom. */
const OSM_MIN_ZOOM = 14;

/** Maximum viewport extent guards */
const OSM_MAX_LAT_DELTA = 0.35;
const OSM_MAX_LNG_DELTA = 0.5;

/** Maximum visible signal count above which a scan is skipped.
 *  Keeps Overpass responses light and targets realistic mapping sessions. */
const OSM_MAX_SIGNALS = 100;

/** Minimum visible signal count below which a scan is pointless. */
const OSM_MIN_SIGNALS = 1;

/** Expansion factor applied to the viewport bounds when building the Overpass fetch area.
 *  Leaflet .pad(0.25) doubles linear dimensions (×2.25 area), so that subsequent small
 *  pans and zoom adjustments land inside the already-scanned bbox and skip the query.
 *  Guards are evaluated against the strict viewport, not this padded area. */
const OSM_FETCH_PAD_FACTOR = 0.25;

let _osmIdleTimer = null;

/**
 * Evaluate all scan guards and, when they pass, build the strict and padded bbox objects.
 * Cheap guards (zoom, signal count) are checked before map.getBounds() to avoid
 * unnecessary Leaflet calls in the common case where scanning is not needed.
 *
 * @returns {{ bbox, paddedBbox } | null} Null when any guard fails.
 */
function _buildScanContext() {
    if (map.getZoom() < OSM_MIN_ZOOM) return null;
    if (_visibleCount < OSM_MIN_SIGNALS || _visibleCount > OSM_MAX_SIGNALS) return null;

    const bounds = map.getBounds();
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();

    if ((ne.lat - sw.lat) > OSM_MAX_LAT_DELTA) return null;
    if ((ne.lng - sw.lng) > OSM_MAX_LNG_DELTA) return null;

    const padded = bounds.pad(OSM_FETCH_PAD_FACTOR);
    const psw = padded.getSouthWest();
    const pne = padded.getNorthEast();

    return {
        bbox: {
            swLat: sw.lat,
            swLng: sw.lng,
            neLat: ne.lat,
            neLng: ne.lng,
        },
        paddedBbox: {
            swLat: psw.lat,
            swLng: psw.lng,
            neLat: pne.lat,
            neLng: pne.lng,
        },
    };
}

/**
 * Evaluate scan guards and trigger a viewport scan if all pass.
 * Single call point for all OSM scan triggers (tooltipopen, idle timer).
 */
function _triggerOsmScan() {
    const ctx = _buildScanContext();
    if (ctx) fetchViewport(ctx.bbox, ctx.paddedBbox);
}

/**
 * Cancel any in-flight OSM scan, dismiss the context menu, and reset the idle timer.
 * Registered on movestart and zoomstart.
 */
function _onMapMoveStart() {
    closeContextMenu();
    clearTimeout(_osmIdleTimer);
    _osmIdleTimer = null;
    abortScan();
}

/**
 * Schedule an automatic viewport scan after OSM_IDLE_DELAY_MS of inactivity.
 * Registered on moveend and zoomend.
 */
function _onMapMoveEnd() {
    clearTimeout(_osmIdleTimer);
    _osmIdleTimer = setTimeout(_triggerOsmScan, OSM_IDLE_DELAY_MS);
}


// ===== Public API =====

/**
 * Initialise the marker layer and wire the OSM index.
 * Must be called once from app.js/_boot() after initMap() resolves.
 */
export function initLayer() {
    _markersLayer = L.layerGroup().addTo(map);

    // Map movement: dismiss context menu, reset idle timer, and abort any in-flight OSM scan.
    map.on('movestart zoomstart', _onMapMoveStart);
    // Schedule an automatic OSM viewport scan after the map has been still long enough.
    map.on('moveend zoomend', _onMapMoveEnd);

    map.on('popupopen', () => { _popupOpen = true; });
    map.on('popupclose', () => { _popupOpen = false; });
    map.on('tooltipopen', _onTooltipOpen);

    // When the OSM index gains new entries, refresh the currently open tooltip so
    // OSM indicators (dotted underline, group badge) appear without user interaction.
    onUpdate.subscribe(_onOsmIndexUpdate);
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
 * Trigger a data fetch / render cycle.
 * When force = false, the call is skipped if the visible tile set, viewport,
 * and active filters are all unchanged since the last run.
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
        _updateVisibleCount(0);
        setSampledBadge(false);
        return;
    }

    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();
    const cacheKey = _computeCacheKey(fetchUrls, sw, ne);

    if (!force && cacheKey === _lastUrlKey) return;
    _lastUrlKey = cacheKey;
    _loadPending = false;
    _runWorker(bounds, fetchUrls, zoom, sw, ne);
}


// ===== Visible count =====

/**
 * Update the visible signal count in both module state and the status bar UI.
 * Module state (_visibleCount) is the authoritative source; statusbar.js is display-only.
 * @param {number} n
 */
function _updateVisibleCount(n) {
    _visibleCount = n;
    updateVisibleCount(n);
}


// ===== Tooltip lifecycle =====

/**
 * Handle tooltipopen: close the tooltip when a popup is already open,
 * otherwise trigger an opportunistic OSM viewport scan.
 * @param {L.LeafletEvent} e
 */
function _onTooltipOpen(e) {
    if (_popupOpen) {
        e.tooltip.close();
        return;
    }
    _triggerOsmScan();
}

/**
 * Triggered when the OSM index receives new entries.
 * Delegates to _refreshActiveTooltip; no-op when a popup is open.
 */
function _onOsmIndexUpdate() {
    if (_popupOpen) return;
    _refreshActiveTooltip();
}

/**
 * Scan the marker layer for any open tooltip and refresh its content.
 *
 * Walking the layer is more robust than relying on a manual state reference
 * which can be cleared by Leaflet's internal tooltip lifecycle before the
 * async Overpass callback fires. At scanning zoom levels (≥ 14, ≤ 100 visible
 * markers) eachLayer is negligible.
 *
 * The rAF defers the DOM write out of the Overpass Promise microtask queue,
 * guaranteeing a clean browser repaint. The isTooltipOpen() re-check inside
 * the frame guards against tooltips closed during the frame delay.
 */
function _refreshActiveTooltip() {
    if (!_markersLayer) return;
    _markersLayer.eachLayer(layer => {
        if (!layer.isTooltipOpen?.()) return;
        const display = layer._sigData?.display;
        if (!display) return;
        requestAnimationFrame(() => {
            if (layer.isTooltipOpen?.()) {
                layer.setTooltipContent(buildTooltip(display));
            }
        });
    });
}

// ===== Worker lifecycle =====

/**
 * Terminate the active worker and clear the module-level reference.
 * Centralised here to avoid duplicating the null-guard at every call site.
 */
function _terminateWorker() {
    _worker?.terminate();
    _worker = null;
}

/**
 * Terminate the active worker, start a new one, and post the fetch-tiles message.
 * sw / ne are passed in from refresh() to avoid recomputing them.
 *
 * @param {L.LatLngBounds} bounds
 * @param {string[]}        tileUrls
 * @param {number}          zoom
 * @param {L.LatLng}        sw
 * @param {L.LatLng}        ne
 */
function _runWorker(bounds, tileUrls, zoom, sw, ne) {
    _terminateWorker();
    _loadRunning = true;
    showProgress(t('progress.tiles', tileUrls.length));

    try {
        _worker = new Worker(new URL('tiles-worker.js', import.meta.url), { type: 'module' });
    } catch (err) {
        console.error('[Worker] Failed to create worker:', err.message);
        _terminateLoad();
        return;
    }

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
        forceOverview: isOverview
    });
}

/**
 * Dispatch a single worker message to the appropriate handler.
 * Extracted from _runWorker to keep that function focused on setup.
 */
function _handleWorkerMessage(e, isOverview, markerMap) {
    if (!isOwnWorkerMessage(e)) return;
    const { status, groups, loaded, total, sampled } = e.data;

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
        _updateVisibleCount(markerMap.size);
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
    _sampled = sampled;     // must precede indexSignals so isSampled() is current
    resetLiveCounts();
    setSampledBadge(sampled, total);
    indexSignals(groups.flatMap(g => g.all));
    _renderGroups(groups);
    _terminateLoad();
    if (_loadPending) {
        _loadPending = false;
        refresh(true);
    }
}


// ===== Cache key =====

/**
 * Compute the worker run cache key from tile URLs, viewport corners, and active filters.
 * Bounds are rounded to 2 decimal places (~1 km) to absorb floating-point drift during
 * micro-pans while still catching any meaningful viewport change.
 * Bounds MUST be included: the worker filters signals by viewport, so zooming within
 * the same 0.5° tile changes which signals are visible even when URLs don't change.
 *
 * @param {string[]}  fetchUrls
 * @param {L.LatLng}  sw
 * @param {L.LatLng}  ne
 * @returns {string}
 */
function _computeCacheKey(fetchUrls, sw, ne) {
    const r = v => Math.round(v * 100) / 100;
    const boundsKey = `${r(sw.lat)},${r(sw.lng)},${r(ne.lat)},${r(ne.lng)}`;
    return fetchUrls.join('|') + '|' + boundsKey + '|' + JSON.stringify(getActiveFiltersForWorker());
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
        html: `<div class="sig-dot${multi ? ' multi' : ''}" style="--c:${color};--sz:${size}px" tabindex="0" role="button"></div>`,
        iconSize: [size, size],
        iconAnchor: [half, half],
    });
}

/**
 * Build a fully configured Leaflet marker for one group.
 * Signal data is stored on marker._sigData during construction (no closure needed in
 * event handlers). The 'add' handler mirrors it onto the DOM element for keyboard
 * shortcut access (_sigData on el, not just on the Leaflet instance).
 * Shared by _renderGroups (full render) and _renderGroupsIncremental (partial).
 *
 * @param {number}   lat
 * @param {number}   lng
 * @param {object[]} all      all co-located signals (for JOSM export)
 * @param {object[]} display  filtered signals (for icon color and tooltip)
 * @returns {L.Marker}
 */
function _makeMarker(lat, lng, all, display) {
    const types = display.map(s => s.p.signalType);
    const color = getPrimaryTypeColor(types);
    const count = display.length;
    const icon = _makeDotIcon(color, _getDotSize(count), count > 1);
    const marker = L.marker([lat, lng], { icon })
        .bindTooltip(() => buildTooltip(display), {
            direction: 'top',
            offset: [0, -6],
            className: 'sig-tooltip',
            sticky: false,
        })
        .on('add', _onMarkerAdd)
        .on('click', _handleMarkerClick)
        .on('contextmenu', _handleMarkerContextMenu);

    // Store signal data directly on the marker instance so named event handlers
    // can read it via 'this._sigData' without capturing a per-marker closure.
    marker._sigData = { lat, lng, all, display };
    return marker;
}


// ===== Marker event handlers =====
// Named functions registered via .on() — use 'this' to access marker._sigData.
// Keeping them outside _makeMarker avoids creating a new function object per marker.

/**
 * Copy _sigData from the Leaflet marker instance onto its DOM element.
 * Needed for keyboard shortcut access (showSignalContextMenu reads from activeElement._sigData).
 */
function _onMarkerAdd() {
    const el = this.getElement();
    if (el) el._sigData = this._sigData;
}

/**
 * Dispatch a marker click to the appropriate action based on modifier keys.
 * @this {L.Marker}
 * @param {L.LeafletMouseEvent} e
 */
function _handleMarkerClick(e) {
    dismissLocationMarker();
    closeContextMenu();

    const { lat, lng, all } = this._sigData;
    const orig = e.originalEvent;
    const ctrl = orig?.ctrlKey || orig?.metaKey;
    const shift = orig?.shiftKey;
    const alt = orig?.altKey;

    if (alt && !ctrl && !shift) {
        _onMarkerAltClick(lat, lng);
    } else if (ctrl && !shift) {
        _onMarkerCtrlClick(all);
    } else {
        _onMarkerNormalClick([lat, lng], all, shift);
    }
}

/**
 * Open the context menu for a right-clicked marker.
 * @this {L.Marker}
 * @param {L.LeafletMouseEvent} e
 */
function _handleMarkerContextMenu(e) {
    L.DomEvent.preventDefault(e);
    dismissLocationMarker();
    this.closeTooltip();
    const { lat, lng, all } = this._sigData;
    _showContextMenuAt(e.originalEvent.clientX, e.originalEvent.clientY, lat, lng, all);
}


// ===== Marker actions =====

/**
 * Alt+Click: zoom to and center on the signal without opening the popup.
 */
function _onMarkerAltClick(lat, lng) {
    flyToLocationWithMarker([lat, lng]);
}

/**
 * Ctrl+Click: pin or unpin the first signal in the group.
 * @param {object[]} all
 */
function _onMarkerCtrlClick(all) {
    const networkId = all[0]?.p?.networkId;
    if (networkId) {
        showFlash(togglePin(networkId)
            ? t('pinned.flash')
            : t('pinned.unflash'));
    }
}

/**
 * Normal/Shift+Click: open the signal popup.
 * Shift flips the default starting tab.
 * @param {[number, number]} latlng
 * @param {object[]}         all
 * @param {boolean}          shift
 */
function _onMarkerNormalClick(latlng, all, shift) {
    openSignalPopup(latlng, all, 0, resolveStartTab(shift));
}

/**
 * Build and show the context menu for a signal marker.
 * Pin/Unpin label is resolved dynamically from the current pinned state.
 * @param {number}   x    clientX of the triggering event.
 * @param {number}   y    clientY of the triggering event.
 * @param {number}   lat
 * @param {number}   lng
 * @param {object[]} all  All co-located signals in the group.
 */
function _showContextMenuAt(x, y, lat, lng, all) {
    const networkId = all[0]?.p?.networkId ?? null;
    const pinned = networkId ? isPinned(networkId) : false;
    const items = [
        {
            labelKey: 'context.zoomCenter',
            shortcut: 'Alt+Click',
            action: () => _onMarkerAltClick(lat, lng),
        },
        {
            labelKey: pinned ? 'context.unpin' : 'context.pin',
            shortcut: 'Ctrl+Click',
            action: () => _onMarkerCtrlClick(all),
        },
        'separator',
        {
            labelKey: 'context.properties',
            shortcut: 'Click',
            // shift (passed from the menu's Shift+click/Enter) flips the tab,
            // matching the behaviour of Shift+Click directly on the marker.
            action: (shift) => openSignalPopup([lat, lng], all, 0, resolveStartTab(shift)),
        },
    ];

    // Close the signal popup before showing the context menu — the two UIs
    // are mutually exclusive and the popup would obscure the menu on small viewports.
    closeSignalPopup();
    showContextMenu(x, y, items);
}


// ===== Navigation =====

/**
 * Fly to the signal with the given network ID and show a location marker.
 *
 * Fast path: signal is currently visible in the viewport → immediate flight.
 * Slow path: fetch the tile that contains the signal (browser-cached on repeat
 *            calls), then fly once the coordinates are known.
 *
 * @param {string} networkId
 * @returns {Promise<void>}
 */
export async function flyToSignal(networkId) {
    // Fast path — signal is already rendered in the viewport.
    const latlng = _getSignalLatlng(networkId);
    if (latlng) {
        flyToLocationWithMarker(latlng);
        return;
    }

    const tileKey = getNetworkIdIndex()?.get(networkId);
    if (!tileKey) {
        console.warn(`[map-layer] No tile key for networkId ${networkId}`);
        return;
    }

    const signals = await fetchTileByKey(tileKey);
    const location = findSignalLocation(signals, networkId);
    if (location) flyToLocationWithMarker(location);
}

/**
 * Fly to the bounding box of the given line code with a smooth animation.
 * Uses the precomputed bbox from index.json (set by TileBuilder).
 * Silently no-ops when the bbox is not available.
 *
 * bbox is stored as [[minLat, minLng], [maxLat, maxLng]] (Leaflet LatLngBounds),
 * so it can be passed directly to flyToBounds() without coordinate conversion.
 * duration caps the animation so long lines do not animate for too long.
 *
 * @param {string} lineCode
 */
export function flyToLine(lineCode) {
    const bbox = getLineBbox(lineCode);
    if (!bbox) return;
    map.flyToBounds(bbox, { padding: [40, 40], duration: 1.5 });
}

/**
 * Show the signal context menu for the currently focused marker (keyboard access).
 * Reads signal data from the DOM element's _sigData, mirrored there by _onMarkerAdd.
 * Called by map-controls.js keyboard shortcuts — avoids synthetic contextmenu events
 * which would also trigger the browser's native context menu on some platforms.
 */
export function showSignalContextMenu() {
    const data = document.activeElement?._sigData ?? null;
    if (!data) return;
    const rect = document.activeElement.getBoundingClientRect();
    _showContextMenuAt(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
        data.lat, data.lng, data.all
    );
}

/**
 * Return the [lat, lng] of a signal by networkId from the last rendered groups.
 * Returns null when the signal is not currently in the viewport.
 * Used to fly to a selected networkId tag without a tile fetch.
 * @param {string} networkId
 * @returns {[number, number] | null}
 */
function _getSignalLatlng(networkId) {
    for (const { lat, lng, all } of _lastGroups) {
        if (all.some(s => String(s.p.networkId) === networkId)) return [lat, lng];
    }
    return null;
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
    _updateVisibleCount(groups.length);
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
