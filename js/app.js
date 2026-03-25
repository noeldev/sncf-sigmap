/**
 * app.js — Application entry point and boot sequencer.
 *
 * Responsibilities:
 *   - Sequence the initialization of every module in the correct order.
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
 *   signal-mapping.js — OSM tag data and category colors
 *   filters.js       — filter state and panel UI
 *   statusbar.js     — status bar DOM updates
 */

import { TILES_BASE } from './config.js';
import { initMap, map, initMapEvents } from './map.js';
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
import { loadStrings, t, translateAll, getLang } from './translation.js';
import { initLayer, setManifest, refresh } from './map-layer.js';
import { initProgress, showProgress, hideProgress } from './progress.js';
import { initSidebar } from './sidebar.js';
import { initStatusBar, updateZoomStatus, setRecordCount } from './statusbar.js';
import { initBlockSystem } from './block-system.js';


// ES modules are deferred by spec — the DOM is guaranteed ready when this executes.
async function _boot() {
    await loadStrings(getLang());
    await initMap('map');
    _initUI();
    await _loadData();
    translateAll();
}

/** Initialize all UI components after the map is ready. */
function _initUI() {
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
}

/** Fetch manifest and filter index, then start the map pipeline. */
async function _loadData() {
    console.info('[App] TILES_BASE:', TILES_BASE);
    showProgress(t('progress.index'));

    const [manifest, index] = await Promise.all([
        loadManifest(),
        loadFilterIndex(TILES_BASE),
    ]);

    if (index) initBlockSystem(index);

    if (!manifest) {
        hideProgress();
        console.error('[App] manifest.json not found at', TILES_BASE + 'manifest.json');
        return;
    }

    _updateRecordCount(manifest);
    hideProgress();
    setManifest(manifest);
    _startMapPipeline();
}

/** Wire map events and trigger the first render. */
function _startMapPipeline() {
    updateZoomStatus(map.getZoom());
    initMapEvents(crossedThreshold => {
        updateZoomStatus(map.getZoom());
        refresh(crossedThreshold);
    });
    refresh(true);
}

/**
 * Update the record-count display and status bar after the manifest loads.
 * @param {object} manifest
 */
function _updateRecordCount(manifest) {
    const { tileCount, totalSignals } = getManifestStats(manifest);
    console.info(`[App] ${totalSignals.toLocaleString()} signals across ${tileCount} tiles`);
    setRecordCount({ totalSignals, tileCount });  // also renders #record-count via _renderRecordCount
    setTotalSignals(totalSignals);
}

_boot();
