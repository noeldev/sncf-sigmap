// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Noël Danjou

/**
 * conflict-filter.js - Filter state and row visibility for the conflict table.
 *
 * Owns the two filter dimensions:
 *   _excludedCats   — set of OSM cat keys whose rows are hidden.
 *   _showMechanical — when false, rows flagged isMech=1 are hidden.
 *
 * Persists state in the URL hash (#exclude=main,stop&mech=0) so that a
 * page reload or a shared link restores the same filter view.
 *
 * report-renderer.js calls initConflictFilter() once after building the
 * tbody, then uses the toggle helpers when the user interacts with the
 * dropdown. Everything else (DOM traversal, hash update) is handled here.
 *
 * Public API:
 *   initConflictFilter(tbody)       — bind to a tbody and restore hash state.
 *   resetConflictFilter()           — clear all filters and re-apply.
 *   toggleCat(cat)                  — include/exclude one OSM cat.
 *   toggleMechanical(show)          — show/hide mechanical rows.
 *   isCatExcluded(cat) -> bool
 *   isMechanicalShown() -> bool
 *   isFilterActive() -> bool        — true when any filter is non-default.
 *   applyConflictFilter()           — re-apply current state to the DOM.
 */

// ===== State =====

let _excludedCats    = new Set();
let _showMechanical  = true;
let _conflictTbody   = null;

// ===== Public API =====

/**
 * Bind the filter to a newly rendered conflict tbody and restore any
 * filter state previously serialised in the URL hash.
 *
 * @param {HTMLTableSectionElement} tbody
 */
export function initConflictFilter(tbody) {
    _conflictTbody = tbody;
    _restoreFromHash();
    applyConflictFilter();
}

/**
 * Clear all filters and re-apply (used on full result reset).
 */
export function resetConflictFilter() {
    _excludedCats   = new Set();
    _showMechanical = true;
    _conflictTbody  = null;
}

/**
 * Toggle one OSM cat in/out of the excluded set and re-apply.
 *
 * @param {string} cat  OSM category key (e.g. "main", "speed_limit").
 */
export function toggleCat(cat) {
    if (_excludedCats.has(cat)) _excludedCats.delete(cat);
    else _excludedCats.add(cat);
    _applyAndSync();
}

/**
 * Set mechanical row visibility and re-apply.
 *
 * @param {boolean} show
 */
export function toggleMechanical(show) {
    _showMechanical = show;
    _applyAndSync();
}

/** @returns {boolean} */
export function isCatExcluded(cat)   { return _excludedCats.has(cat); }

/** @returns {boolean} */
export function isMechanicalShown()  { return _showMechanical; }

/** @returns {boolean} true when any filter differs from its default value. */
export function isFilterActive()     { return _excludedCats.size > 0 || !_showMechanical; }

/**
 * Apply current filter state to the tbody rows.
 * Renumbers visible rows sequentially so row numbers stay contiguous.
 * Safe to call before initConflictFilter() — no-op when tbody is null.
 */
export function applyConflictFilter() {
    if (!_conflictTbody) return;
    let visibleIdx = 0;
    for (const tr of _conflictTbody.rows) {
        const rowCats  = (tr.dataset.dupCats ?? '').split(',').filter(Boolean);
        const rowIsMech = tr.dataset.isMech === '1';

        // Hide mechanical rows when the mechanical filter is off.
        const hiddenByMech = !_showMechanical && rowIsMech;

        // Hide when ALL conflict cats are individually excluded.
        const hiddenByCat = _excludedCats.size > 0
            && rowCats.length > 0
            && rowCats.every(cat => _excludedCats.has(cat));

        const hidden = hiddenByMech || hiddenByCat;
        tr.classList.toggle('filtered-out', hidden);
        if (!hidden) {
            const numEl = tr.querySelector('[data-field="row-num"]');
            if (numEl) numEl.textContent = ++visibleIdx;
        }
    }
}

// ===== Private =====

function _applyAndSync() {
    applyConflictFilter();
    _updateHash();
}

/**
 * Serialise current filter state into the URL hash.
 * Format: #exclude=main,stop&mech=0 — URLSearchParams-compatible.
 * Removes the hash entirely when all filters are at default.
 */
function _updateHash() {
    const parts = [];
    if (_excludedCats.size > 0)  parts.push('exclude=' + [..._excludedCats].join(','));
    if (!_showMechanical)        parts.push('mech=0');
    history.replaceState(null, '', parts.length
        ? '#' + parts.join('&')
        : location.pathname + location.search);
}

/**
 * Restore filter state from the URL hash on page load.
 * Called once from initConflictFilter(); applyConflictFilter() follows.
 */
function _restoreFromHash() {
    if (!location.hash.startsWith('#')) return;
    const params = new URLSearchParams(location.hash.slice(1));
    const excl = params.get('exclude');
    if (excl) _excludedCats = new Set(excl.split(',').filter(Boolean));
    if (params.get('mech') === '0') _showMechanical = false;
}
