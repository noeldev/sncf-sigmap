/**
 * app.js — Application entry point and boot sequencer.
 *
 * Responsibilities:
 *   - Sequence the initialisation of every module in the correct order.
 *   - Wire Leaflet map events (moveend/zoomend) to map-layer.refresh().
 *   - Update the record-count display after the manifest loads.
 *   - Track the zoom threshold crossing for overview↔detail mode transitions.
 *
 * All UI, rendering, and data pipeline logic is delegated:
 *   progress.js      — progress overlay
 *   sidebar.js       — language picker, tabs, JOSM detection panel
 *   map.js           — Leaflet infrastructure (basemaps, basemap selector)
 *   map-controls.js  — map toolbar button wiring (zoom, geolocate, fullscreen)
 *   map-layer.js     — signal marker pipeline (worker, filter, render)
 *   signal-mapping.js — OSM tag data and category colours
 *   filters.js       — filter state and panel UI
 *   statusbar.js     — status bar DOM updates
 */

import { TILES_BASE, OVERVIEW_MAX_ZOOM } from './config.js';
import { initMap, map } from './map.js';
import { initMapControls } from './map-controls.js';
import { loadManifest, getManifestStats } from './tiles.js';
import {
    initFilters,
    loadFilterIndex,
    resetFilters,
    initAddFilterButton,
    setTotalSignals,
} from './filters.js';
import { buildLegend } from './cat-mapping.js';
import { t, applyTranslations, setRecordCount } from './i18n.js';
import { initLayer, setManifest, refresh } from './map-layer.js';
import { initProgress, showProgress, hideProgress } from './progress.js';
import { initSidebar } from './sidebar.js';
import { initStatusBar, updateZoomStatus } from './statusbar.js';
import { initCantonment } from './cantonment.js';


let _lastZoom = -1;

// ES modules are deferred by spec — the DOM is guaranteed ready when this executes.
async function _boot() {
    await initMap('map');

    initProgress();
    initMapControls();
    initStatusBar();
    initLayer();
    initSidebar();

    buildLegend();
    initFilters(() => refresh(true));
    initAddFilterButton(document.getElementById('btn-add-filter'));
    document.getElementById('btn-reset-filters')?.addEventListener('click', () => {
        resetFilters();
        refresh(true);
    });

    console.info('[App] TILES_BASE:', TILES_BASE);
    showProgress(t('progress.index'));

    const [manifest, index] = await Promise.all([
        loadManifest(),
        loadFilterIndex(TILES_BASE),
    ]);

    if (index) initCantonment(index);

    if (!manifest) {
        hideProgress();
        console.error('[App] manifest.json not found at', TILES_BASE + 'manifest.json');
        return;
    }

    _updateRecordCount(manifest);
    hideProgress();
    setManifest(manifest);

    _lastZoom = map.getZoom();
    updateZoomStatus(_lastZoom);
    _initMapEvents();

    refresh(true);
    applyTranslations();
}

/**
 * Update the record-count display and status bar after the manifest loads.
 * @param {object} manifest
 */
function _updateRecordCount(manifest) {
    const { tileCount, totalSignals } = getManifestStats(manifest);
    console.info(`[App] ${totalSignals.toLocaleString()} signals across ${tileCount} tiles`);
    setRecordCount({ totalSignals, tileCount });
    setTotalSignals(totalSignals);
    const el = document.getElementById('record-count');
    if (el) el.textContent =
        `${totalSignals.toLocaleString()} ${t('status.signals_lower')} — ` +
        `${tileCount.toLocaleString()} ${t('status.tiles_lower')}`;
}

/**
 * Wire Leaflet map events to refresh() with zoom-threshold detection.
 * Debounced so rapid pan/zoom sequences produce a single refresh call.
 */
function _initMapEvents() {
    map.on('moveend zoomend', _debounce(() => {
        const z = map.getZoom();
        updateZoomStatus(z);
        const crossedThreshold =
            (_lastZoom < OVERVIEW_MAX_ZOOM) !== (z < OVERVIEW_MAX_ZOOM);
        _lastZoom = z;
        refresh(crossedThreshold);
    }, 150));
}

_boot();


// ===== Utilities =====

function _debounce(fn, ms) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), ms);
    };
}
