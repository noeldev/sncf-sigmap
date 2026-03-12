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
 *   updateFilterCount(n)      — write active filter count (was in filters.js).
 */

import { OVERVIEW_MAX_ZOOM } from './config.js';
import { t } from './i18n.js';

const _el = {};

/**
 * Cache status bar DOM references.
 * Must be called once before any other function in this module.
 */
export function initStatusBar() {
    _el.visible = document.getElementById('st-visible');
    _el.sampled  = document.getElementById('st-sampled');
    _el.filters  = document.getElementById('st-filters');
    _el.zoom     = document.getElementById('st-zoom');
}

/**
 * Update the visible signal count display.
 * @param {number} n
 */
export function updateVisibleCount(n) {
    if (_el.visible) _el.visible.textContent = n.toLocaleString();
}

/**
 * Show or hide the overview sample badge (~) with an explanatory tooltip.
 * @param {boolean} sampled  — true when results are spatially sampled.
 * @param {number}  [total]  — total matching signals before sampling.
 */
export function setSampledBadge(sampled, total) {
    const el = _el.sampled;
    if (!el) return;
    el.classList.toggle('is-hidden', !sampled);
    if (sampled && total) el.title = t('status.sampled_title', total, OVERVIEW_MAX_ZOOM);
}

/**
 * Update the active filter count display.
 * @param {number} n
 */
export function updateFilterCount(n) {
    if (_el.filters) _el.filters.textContent = n;
}

/**
 * Update the zoom level display.
 * @param {number} zoom
 */
export function updateZoomStatus(zoom) {
    if (_el.zoom) _el.zoom.textContent = zoom;
}
