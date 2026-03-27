/**
 * statusbar.js — Status bar DOM updates.
 *
 * Centralises every write to the four #st-* elements so that map-layer.js,
 * filters.js, and app.js no longer hold their own DOM references or inline
 * textContent assignments scattered across the codebase.
 *
 * Public API (called from app.js, map-layer.js, filters.js):
 *   initStatusBar()           — cache DOM refs; call once in app.js/_boot().
 *   updateZoomStatus(zoom)    — write zoom level (was in map.js).
 *   updateVisibleCount(n)     — write visible signal count (was in map-layer.js).
 *   setSampledBadge(s, total) — show/hide the overview sample badge (was in map-layer.js).
 *   setRecordCount(data)      — store and render the total signal / tile count.
 *   updateFilterCount(n)      — write active filter count (was in filters.js).
 */

import { OVERVIEW_MAX_ZOOM } from './config.js';
import { t, onLangChange } from './translation.js';

const _el = {};
let _recordCount = null;

/**
 * Cache status bar DOM references.
 * Must be called once before any other function in this module.
 */
export function initStatusBar() {
    _el.visible = document.getElementById('st-visible');
    _el.sampled = document.getElementById('st-sampled');
    _el.filters = document.getElementById('st-filters');
    _el.zoom = document.getElementById('st-zoom');
    _el.count = document.getElementById('record-count');
    // Re-render the record count string whenever the language changes.
    onLangChange(_renderRecordCount);
}

/**
 * Update the visible signal count display.
 * @param {number} n
 */
export function updateVisibleCount(n) {
    if (_el.visible) _el.visible.textContent = n.toLocaleString();
}

let _sampled = false;
/**
 * Show or hide the overview sample badge with an explanatory tooltip.
 * Must be called before indexSignals() so isSampled() reflects the current cycle.
 * @param {boolean} sampled  True when results are spatially sampled.
 * @param {number}  [total]  Total matching signal count before sampling.
 */
export function setSampledBadge(sampled, total) {
    _sampled = sampled;
    const el = _el.sampled;
    if (!el) return;
    el.classList.toggle('is-hidden', !sampled);
    if (sampled && total) el.title = t('status.sampledTitle', total, OVERVIEW_MAX_ZOOM);
}

/** Returns true when the current view is a spatial overview sample. */
export function isSampled() { return _sampled; }

/**
 * Update the active filter count display.
 * @param {number} n
 */
export function updateFilterCount(n) {
    if (_el.filters) _el.filters.textContent = n.toLocaleString();
}

/**
 * Store the record counts and render the #record-count element.
 * Called once by app.js after the manifest loads.
 * @param {{ totalSignals: number, tileCount: number }} data
 */
export function setRecordCount(data) {
    _recordCount = data;
    _renderRecordCount();
}

function _renderRecordCount() {
    if (!_recordCount || !_el.count) return;
    _el.count.textContent =
        t('status.recordCount', _recordCount.totalSignals, _recordCount.tileCount);
}

/**
 * Update the zoom level display.
 * @param {number} zoom
 */
export function updateZoomStatus(zoom) {
    if (_el.zoom) _el.zoom.textContent = zoom.toLocaleString();
}
