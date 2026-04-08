/**
 * app.js — Application entry point and boot sequencer.
 *
 * Responsibilities:
 *   - Sequence module initialisation in the correct order.
 *   - Provide the map refresh callback to sidebar.js.
 *   - Wire Leaflet map events to the map-layer pipeline.
 *   - Update the record-count display after the manifest loads.
 *
 * Knows about:
 *   map.js       — Leaflet infrastructure + marker layer + toolbar (via initMap).
 *   map-layer.js — signal marker pipeline (refresh).
 *   sidebar.js   — all sidebar UI (legend, filters, pins, language, tabs, JOSM).
 *   statusbar.js — status bar DOM updates.
 *   progress.js  — loading overlay.
 */

import { initMap, map, initMapEvents } from './map.js';
import { initKeyboardShortcuts } from './map-controls.js';
import { loadManifest, getManifestStats } from './tiles.js';
import { loadStrings, translateAll, getLang, t } from './translation.js';
import { setManifest, refresh } from './map-layer.js';
import { initProgress, showProgress, hideProgress } from './progress.js';
import { initSidebar } from './sidebar.js';
import { initStatusBar, updateZoomStatus, setRecordCount, updateFilterCount } from './statusbar.js';


// ES modules are deferred by spec — the DOM is guaranteed ready when this executes.
/**
 * Application entry point.
 * Sequences all module initialisation and wires map events.
 */
async function _boot() {
    await loadStrings(getLang());
    await initMap();
    initKeyboardShortcuts();
    initSidebar({ onRefresh: _onSidebarRefresh });
    initStatusBar();
    initProgress();
    translateAll();
    await _loadData();
}

/**
 * Called by sidebar.js after any filter change that needs a map refresh.
 * @param {object}  event
 * @param {number} [event.filterCount]  Active filter count, when provided.
 */
function _onSidebarRefresh({ filterCount }) {
    refresh(true);
    if (filterCount !== undefined) updateFilterCount(filterCount);
}


/* ===== Data loading ===== */

/** Fetch the tile manifest, then start the map pipeline. */
async function _loadData() {
    showProgress(t('progress.index'));

    const manifest = await loadManifest();

    if (!manifest) {
        hideProgress();
        return;
    }

    _updateRecordCount(manifest);
    hideProgress();
    setManifest(manifest);
    _startMapPipeline();
}

/** Wire map events and trigger the initial render. */
function _startMapPipeline() {
    updateZoomStatus(map.getZoom());
    initMapEvents(crossedThreshold => {
        updateZoomStatus(map.getZoom());
        refresh(crossedThreshold);
    });
    refresh(true);
}

/**
 * Update the record-count display after the manifest loads.
 * @param {object} manifest
 */
function _updateRecordCount(manifest) {
    const { tileCount, totalSignals } = getManifestStats(manifest);
    console.info(`[App] ${totalSignals.toLocaleString()} signals across ${tileCount} tiles`);
    setRecordCount({ totalSignals, tileCount });
}

_boot();
