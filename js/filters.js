/**
 * filters.js — Filter state and orchestration.
 *
 * Owns all application data regarding active filters:
 * _activeFilters    — currently selected values per field
 * _defs             — [ { field, search, panel: FilterPanel } ]
 *
 * Delegates all DOM / event work to FilterPanel (one instance per active
 * filter, stored as def.panel).  This file contains no direct DOM queries
 * after _buildPanels() returns.
 *
 * All filter values are uppercase (SNCF data convention); the search input
 * is uppercased before comparison so no toLowerCase() is needed.
 *
 * numericOnly fields (networkId):
 *   Non-digit characters are stripped from the query string before it is
 *   stored in def.search and used for filtering. FilterPanel must expose
 *   setSearch(value) to keep the visible input in sync.
 *
 * labelSearch fields (lineCode):
 *   The search is performed against both the code and the line label via
 *   searchLineCodes() in signal-data.js. Accent-insensitive, case-insensitive.
 *   Dropdown items carry a subtitle (line label) for display; tags show a
 *   tooltip with the full line name from getLineLabel().
 */

import { MIN_SEARCH_THRESHOLD } from './config.js';
import { FIELD } from './field-keys.js';
import { FILTER_FIELDS_META, getFilterFieldKeys } from './filter-config.js';
import { getCategoryEntries } from './cat-mapping.js';
import { getSupportedTypes, getTypesByGroup } from './signal-mapping.js';
import { t, onLangChange } from './translation.js';
import { FilterPanel } from './filter-panel.js';
import { saveFilters, loadFilters } from './prefs.js';
import {
    loadIndexData, getFilterData,
    searchNetworkIds, getLineLabel, searchLineCodes, getLineBbox,
} from './signal-data.js';
import { isSampled, flyToSignal, flyToLine, showLinePreview, hideLinePreview } from './map-layer.js';
import { registerPanel, unregisterPanel, openPanel } from './collapsible-panel.js';

// Import data layer functions
import {
    initFieldState, parseFieldIndex, accumulateSignals,
    resetLiveCounts as resetDataLiveCounts,
    resetKnownValues,
    getCountMap, getCandidateValues, normalize, buildItemSorter
} from './filter-data.js';

/**
 * Flat array form of FILTER_FIELDS_META, shaped as { key, ...meta }.
 * Derived at module load time so order and content are always in sync with
 * the registry. Replaces the former hand-maintained local array.
 */
const ALL_FILTER_FIELDS = Object.entries(FILTER_FIELDS_META).map(([key, meta]) => ({
    key,
    ...meta,
}));

// Ordered field key list — consumed by filter-data.js, parseFieldIndex, etc.
const _fieldKeys = getFilterFieldKeys();

// Exported as const so external importers always hold the same object reference.
// Internal mutations clear keys in-place rather than reassigning the object.
const _activeFilters = {};

let _defs = [];             // [{ field: string, search: string, panel: FilterPanel }]
let _mappedOnly = false;
let _mappedTypes = getSupportedTypes();
let _onChange = null;
let _activeGroup = null;

// Templates
const _tpl = {
    get group() { return document.getElementById('tpl-filter-group'); },
    get tag() { return document.getElementById('tpl-filter-tag'); },
    get item() { return document.getElementById('tpl-filter-drop-item'); },
    get itemRich() { return document.getElementById('tpl-filter-drop-item-rich'); },
    get noMatch() { return document.getElementById('tpl-filter-no-match'); },
};

// ===== Public API =====

export function initFilters(onChange) {
    _onChange = onChange;

    initFieldState(_fieldKeys);

    _clearActiveFilters();
    _buildPanels();
    _restoreFilters();
    _waitForIndexAndRefresh();

    onLangChange(() => {
        _buildPanels();
        _refreshAllTags();
    });
}


/**
 * Index a set of normalized signals into per-field value counts.
 * Called by map-layer.js after each worker 'done' message.
 * Triggers a refresh of all open filter dropdowns.
 *
 * @param {Array} signals  Flat array of normalized signal objects ({ lat, lng, p }).
 */
export function indexSignals(signals) {
    const changed = accumulateSignals(signals, _fieldKeys);
    if (changed) _refreshAllDropdowns();
}

/**
 * Remove all active filters and clear persisted filter state.
 * Called from app.js when the Reset Filters button is clicked.
 */
export function resetFilters() {
    _mappedOnly = false;
    saveFilters([]);
    resetKnownValues(_fieldKeys);

    _clearActiveFilters();
    _clearActiveGroup();
    _resetSearch();
    _buildPanels();
    _onChange?.();
}

/**
 * Clear all per-field live signal counts.
 * Called by map-layer.js at the start of each worker cycle before new data arrives.
 * Delegates to the data layer so that map-layer.js never touches filter-data.js directly.
 */
export function resetLiveCounts() {
    resetDataLiveCounts(_fieldKeys);
}

/**
 * Reset non-signalType filters and apply a signalType filter for the given
 * display group. Called when the user clicks a category in the legend.
 *
 * Logic:
 *   1. Toggle off: if the current state is exactly this group (and nothing else),
 *      confirm then reset all filters.
 *   2. No-op: if applying this group would produce no change, return silently.
 *   3. Confirm only when meaningful filter state (active values or searches)
 *      would be overwritten.
 *
 * @param {string} group  Display group name matching _SIGNAL_MAPPING (e.g. 'main').
 */
export function filterByGroup(group) {
    const types = getTypesByGroup(group);
    if (!types.length) return;

    const current = _activeFilters[FIELD.SIGNAL_TYPE];
    const signalDef = _defs.find(d => _isSignalType(d.field));

    // If the current filter already contains exactly the types of this group,
    // just sync the active group indicator — no filter change needed.
    if (current?.size === types.length && types.every(v => current.has(v))) {
        _activeGroup = group;
        _commit();
        return;
    }

    // Confirm only if the current filter contains types that would be lost —
    // i.e. at least one active value is not in the new group.
    if (current?.size > 0) {
        const typesSet = new Set(types);
        const hasOutsiders = [...current].some(v => !typesSet.has(v));
        if (hasOutsiders && !_confirmClear()) return;
    }

    // Apply the group: only adds/replaces the signalType filter.
    // Other active filters (lineCode, trackName…) are preserved.
    if (!signalDef) {
        _defs.unshift({ field: FIELD.SIGNAL_TYPE, search: '' });
    } else {
        signalDef.search = '';
    }

    _mappedOnly = true;
    _activeFilters[FIELD.SIGNAL_TYPE] = new Set(types);
    _activeGroup = group;

    _buildPanels();
    _commit();
}

/**
 * Return active filter values in the format expected by tiles.worker.js.
 * @returns {Record<string, string[]>}  Field name → selected values.
 */
export function getActiveFiltersForWorker() {
    const out = {};
    for (const [f, vals] of Object.entries(_activeFilters))
        if (vals.size > 0) out[f] = [...vals];
    return out;
}

/**
 * Returns true when at least one filter panel has active values or a pending
 * search query. Empty open panels do not count.
 * Used by app.js to enable/disable the Reset button and by filterByGroup
 * to decide whether a confirmation is needed before overwriting filter state.
 * @returns {boolean}
 */
export function hasAnyFilters() {
    return _defs.some(d => _activeFilters[d.field]?.size > 0 || d.search.length > 0);
}

/**
 * Return the list of filter fields not yet in use
 * @returns {{ key: string, labelKey: string }[]}
 */
export function getAvailableFields() {
    const used = new Set(_defs.map(d => d.field));
    return ALL_FILTER_FIELDS.filter(f => !used.has(f.key));
}

/**
 * Add a new filter panel for the given field key
 * @param {string} key
 */
export function addFilterField(key) {
    _defs.push({ field: key, search: '' });
    _buildPanels();
    // Notify + persist: triggers _onFiltersChange which calls updateFilterToolbar.
    _commit();
    // Guarantee the new panel is open regardless of any stale persisted closed state.
    // registerPanel (called inside _buildPanels) applies the last known state, which
    // may be false if the user closed this panel in a previous session without removing
    // it first. openPanel overrides that and saves the open state.
    const newDef = _defs.find(d => d.field === key);
    if (newDef?.panel) openPanel(newDef.panel.panelEl());
    queueMicrotask(() => newDef?.panel?.focusInput());
}

/**
 * Return the number of fields that have at least one active filter value.
 * Used by app.js to update the status bar after any filter change.
 * @returns {number}
 */
export function getActiveFilterCount() {
    return Object.values(_activeFilters).filter(s => s.size > 0).length;
}

/**
 * Return the currently active group preset key, or null when no preset
 * category is active (e.g. after a manual filter change).
 * Used by sidebar.js/legend.js to sync the legend indicator after every filter change.
 * @returns {string|null}
 */
export function getActiveGroup() {
    return _activeGroup;
}


// ===== Private helpers =====

function _resetSearch(targetField = null) {
    _defs.forEach(d => {
        if (!targetField || d.field === targetField) {
            d.search = '';
        }
    });
}

/**
 * Reveal the index-load error indicator in the filter panel.
 */
function _showIndexError() {
    document.getElementById('filter-index-error')?.classList.remove('is-hidden');
}

/**
 * Wait for index.json to load, then populate filter value lists and refresh
 * dropdowns. If the index failed to load, getFilterData() returns null and
 * the error indicator is shown. Uses the same loadIndexData() promise as
 * app.js — the fetch is shared and only runs once.
 */
function _waitForIndexAndRefresh() {
    loadIndexData().then(() => {
        const data = getFilterData();
        if (!data) {
            _showIndexError();
            return;
        }
        parseFieldIndex(data, _fieldKeys);
        _refreshAllDropdowns();
        _refreshAllTags();
    });
}

function _clearActiveFilters() {
    for (const key in _activeFilters) delete _activeFilters[key];
}

/**
 * Return the metadata for a given field key, or undefined when unknown.
 * O(1) direct property access on FILTER_FIELDS_META replaces the former
 * linear ALL_FILTER_FIELDS.find() — avoids scanning the array on every
 * dropdown refresh and panel re-render.
 * @param {string} key
 * @returns {object|undefined}
 */
function _fieldDef(key) {
    return FILTER_FIELDS_META[key];
}

/**
 * Translate a filter item value to a localized display string.
 * Returns the raw value when no translation key exists for it.
 * Used by FilterPanel to display direction and placement values in their locale.
 * @param {string} field  App field name (e.g. 'direction', 'placement')
 * @param {string} val    Raw value (e.g. 'forward', 'right')
 * @returns {string}
 */
function _translateFilterValue(field, val) {
    const key = `values.${field}.${val}`;
    const translated = t(key);
    return translated !== key ? translated : val;
}


/**
 * Ask the user to confirm clearing filter values.
 * Centralised to avoid duplicating the confirm(t(...)) call at every site.
 * @returns {boolean} True when the user confirmed.
 */
function _confirmClear() {
    return confirm(t('filter.confirmClear'));
}

// ===== Group preset state =====

/**
 * Return true when the given field key is FIELD.SIGNAL_TYPE.
 * Centralises the comparison so field-specific logic is easy to find and adjust.
 * @param {string} field
 * @returns {boolean}
 */
function _isSignalType(field) {
    return field === FIELD.SIGNAL_TYPE;
}

function _syncActiveGroup(field) {
    if (_isSignalType(field)) _clearActiveGroup();
}

/**
 * Clear the active group preset when any filter is manually changed.
 * No-op when already null — avoids a spurious callback on every toggle.
 */
function _clearActiveGroup() {
    if (_activeGroup === null) return;
    _activeGroup = null;
}


// ===== Commit helper =====

/**
 * Persist filter state and fire the external change callback.
 * Every filter mutation ends with _commit() — the single exit point
 * for state changes. Internal panel refreshes (_refreshTags, _refreshDropdown,
 * _buildPanels) run before _commit() as they are filters.js's own concern.
 */
function _commit() {
    _persistFilters();
    _onChange?.();
}


// ===== Panel management =====

/**
 * Build the FilterPanel options object for one filter definition.
 * Extracted from _buildPanels to keep that function readable.
 */
function _panelOptions(def, idx, fieldMeta, label, activate) {
    return {
        fieldKey: def.field,
        fieldMeta,
        label,
        tplGroup: _tpl.group,
        tplTag: _tpl.tag,
        tplItem: _tpl.item,
        tplItemRich: _tpl.itemRich,
        tplNoMatch: _tpl.noMatch,
        translateValue: _translateFilterValue,
        // isConfirmed: true when the field already has selected values (e.g. after restore).
        // Prevents minSearch fields from hiding the tags container on rebuild.
        isConfirmed: (_activeFilters[def.field]?.size ?? 0) > 0,
        searchValue: def.search,
        mappedOnly: _mappedOnly,

        onActivate: activate,
        onDelete: () => _onDelete(def, idx),
        onTagRemove: val => _onTagRemove(def, val),
        onTagLabelClick: fieldMeta?.globalSearch
            ? val => flyToSignal(val) : fieldMeta?.labelSearch
                ? val => flyToLine(val) : undefined,
        onTagHover: fieldMeta?.labelSearch
            ? (val, active) => active
                ? showLinePreview(getLineBbox(val), getLineLabel(val))
                : hideLinePreview()
            : undefined,
        onRemove: () => _onRemove(def, idx),
        onToggleMappedOnly: checked => _onToggleMappedOnly(def, checked),
        onSearch: query => _onSearch(def, idx, fieldMeta, query),
        onEnter: () => _selectFirst(idx),
        onOpen: () => _openDropdown(idx),
    };
}


// ===== Panel callback handlers =====

/**
 * Ask for user confirmation before executing callback when the given field has
 * active filter values. Executes immediately when no values are active.
 * @param {string}   field
 * @param {Function} callback
 */
function _confirmIfActive(field, callback) {
    if (_activeFilters[field]?.size > 0 && !_confirmClear()) return;
    callback();
}

/**
 * Clear all active filter values for the given panel field.
 * Handles persistence and UI refresh. Confirmation is the caller's responsibility.
 * @param {{ field: string, panel: FilterPanel }} def
 * @param {number} idx
 */
function _clearFilter(def, idx) {
    delete _activeFilters[def.field];
    _syncActiveGroup(def.field);
    _refreshTags(idx);
    _refreshDropdown(idx);
    _commit();
}

/** onDelete handler — clears active values with confirmation when needed. */
function _onDelete(def, idx) {
    _confirmIfActive(def.field, () => _clearFilter(def, idx));
}

/**
 * onTagRemove handler — toggles the removed value and restores focus to the input.
 * @param {{ field: string, panel: FilterPanel }} def
 * @param {string} val
 */
function _onTagRemove(def, val) {
    _toggle(def.field, val);
    // The focused tag button was detached by replaceChildren() inside
    // _refreshTags → focus moved to <body>. Restore via microtask.
    queueMicrotask(() => def.panel?.focusInput());
}

/**
 * onRemove handler — destroys the panel entirely.
 * Asks for confirmation first when the field has active values.
 */
function _onRemove(def, idx) {
    _confirmIfActive(def.field, () => {
        unregisterPanel(def.panel.panelEl());
        def.panel.destroy();
        delete _activeFilters[def.field];
        _defs.splice(idx, 1);
        _syncActiveGroup(def.field);
        _buildPanels();
        _commit();
    });
}

/**
 * onToggleMappedOnly handler — toggles the "supported types only" dropdown
 * filter mode. Clears all signalType active values and rebuilds the panel.
 * The CSS :checked + .toggle-track rule drives the visual state.
 * @param {{ field: string }} def
 * @param {boolean}          checked
 */
function _onToggleMappedOnly(def, checked) {
    _confirmIfActive(def.field, () => {
        _mappedOnly = checked;
        delete _activeFilters[FIELD.SIGNAL_TYPE];
        _resetSearch(FIELD.SIGNAL_TYPE);
        _clearActiveGroup();
        _buildPanels();
        _commit();
    });
}

/**
 * onSearch handler — sanitizes the query (numericOnly fields strip non-digits),
 * keeps the visible input in sync when the sanitized value differs, and refreshes
 * the dropdown.
 * @param {{ field: string, search: string, panel: FilterPanel }} def
 * @param {number}      idx
 * @param {object|null} fieldMeta
 * @param {string}      query
 */
function _onSearch(def, idx, fieldMeta, query) {
    const sanitized = fieldMeta?.numericOnly ? query.replace(/\D/g, '') : query;
    if (sanitized !== query) def.panel?.setSearch(sanitized);
    def.search = sanitized;
    _refreshDropdown(idx);
    _openDropdown(idx);
}

function _buildPanels() {
    const container = document.getElementById('filters-container');
    if (!container) return;

    // Destroy Dropdown instances so they unregister from the outside-click registry.
    _defs.forEach(d => d.panel?.destroy());
    container.replaceChildren();

    // Show the static empty-state div when no filters are active.
    // The div lives directly in #filters-container in index.html (always in the DOM).
    document.getElementById('filters-empty-state')
        ?.classList.toggle('is-hidden', _defs.length > 0);

    _defs.forEach((def, idx) => {
        const fieldMeta = _fieldDef(def.field);
        const label = t(fieldMeta?.labelKey ?? def.field);

        const activate = (val) => _toggle(def.field, val);

        def.panel = new FilterPanel(_panelOptions(def, idx, fieldMeta, label, activate));
        def.panel.appendTo(container);
        // Register with collapsible-panel.js — applies persisted state if any,
        // otherwise falls back to the HTML default (cp-panel--open = open).
        registerPanel(def.panel.panelEl());
        _refreshTags(idx);
        _refreshDropdown(idx);
    });
}

// ===== DOM update helpers =====

function _refreshTags(idx) {
    const def = _defs[idx];
    if (!def?.panel) return;

    const activeVals = Array.from(_activeFilters[def.field] || []);
    const fieldMeta = _fieldDef(def.field);

    // labelSearch fields expose a tooltip showing the full line label on each tag.
    // The callback is declared on the field definition so _refreshTags stays generic.
    const tooltipFn = fieldMeta?.labelSearch ? v => getLineLabel(v) : null;

    def.panel.refreshTags(activeVals, tooltipFn);
}

function _refreshAllTags() {
    _defs.forEach((_, idx) => _refreshTags(idx));
}

/**
 * Prepare the filtered, sorted item list and hand it to the panel for rendering.
 * All data logic (merging index + counts, filtering, sorting) stays here;
 * FilterPanel receives a plain array and renders it without any application knowledge.
 */
function _refreshDropdown(idx) {
    const def = _defs[idx];
    if (!def?.panel) return;

    const fieldMeta = _fieldDef(def.field);
    const sel = _activeFilters[def.field] || new Set();
    const q = def.search || '';

    if (fieldMeta?.globalSearch) {
        _refreshGlobalSearchDropdown(def, fieldMeta, sel, q);
    } else {
        _refreshStandardDropdown(def, fieldMeta, sel, q);
    }
}

function _refreshAllDropdowns() {
    _defs.forEach((_, i) => _refreshDropdown(i));
}

/** Render the networkId dropdown — searches the full spatial index via signal-locator.js. */
function _refreshGlobalSearchDropdown(def, fieldMeta, sel, q) {
    def.panel.setInputPlaceholder(t('dropdown.searchNetworkId'));
    const activeItems = () => [...sel].map(v => ({ v, count: 0, active: true, showDot: false }));
    if (!q) {
        def.panel.refreshList([]);
        return;
    }

    const threshold = fieldMeta.searchThreshold ?? MIN_SEARCH_THRESHOLD;
    const matched = searchNetworkIds(q);
    if (matched.length > threshold) {
        def.panel.refreshList(activeItems());
        return;
    }

    def.panel.refreshList(
        matched.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
            .map(v => ({ v, count: 0, active: sel.has(v), showDot: false }))
    );
}

/**
 * Render a standard dropdown from local counts and the global index.
 *
 * labelSearch fields (lineCode) use a dedicated search path: searchLineCodes()
 * matches both the code and the line label, returning items with a subtitle
 * property that FilterPanel renders as a small secondary text span.
 * All other fields use the existing prefix-match path against getCandidateValues().
 */
function _refreshStandardDropdown(def, fieldMeta, sel, q) {
    const isSignalType = _isSignalType(def.field);
    const isLabelSearch = fieldMeta?.labelSearch === true;
    const isMappedOnly = _mappedOnly && isSignalType;
    const countMap = getCountMap(def.field, isSampled());

    if (isLabelSearch) {
        const results = searchLineCodes(q);
        const items = results
            .map(({ code, label, count }) => ({
                v: code,
                subtitle: label || null,
                count: countMap?.get(code) ?? count ?? 0,
                active: sel.has(code),
                showDot: false,
            }))
            .sort(buildItemSorter(fieldMeta, false, true));
        def.panel.setInputPlaceholder(t('dropdown.search', results.length));
        def.panel.refreshList(items);
        return;
    }

    const all = getCandidateValues(def.field, {
        mappedOnly: _mappedOnly,
        mappedTypes: _mappedTypes,
        isSignalType
    });

    const nq = normalize(q);
    const filtered = q ? all.filter(v => normalize(v).startsWith(nq)) : all;

    def.panel.setInputPlaceholder(
        fieldMeta?.readOnly
            ? t('dropdown.clickToSelect')
            : t('dropdown.search', all.length)
    );

    def.panel.refreshList(
        filtered
            .map(v => ({
                v,
                count: countMap?.get(v) || 0,
                active: sel.has(v),
                showDot: isSignalType && _mappedTypes.has(v) && !isMappedOnly,
            }))
            .sort(buildItemSorter(fieldMeta, isSignalType, false))
    );
}

/**
 * Restore filter state persisted by a previous session.
 * Recreates panels and re-activates values without triggering _onChange.
 */
function _restoreFilters() {
    const saved = loadFilters();
    if (!saved.length) return;
    for (const { field, values, mappedOnly } of saved) {
        if (!ALL_FILTER_FIELDS.some(f => f.key === field)) continue;
        if (mappedOnly) _mappedOnly = true;
        if (!_defs.some(d => d.field === field)) _defs.push({ field, search: '' });
        for (const v of values) {
            if (!_activeFilters[field]) _activeFilters[field] = new Set();
            _activeFilters[field].add(v);
        }
    }
    if (_defs.length) {
        _activeGroup = _detectActiveGroup();
        _buildPanels();
        _onChange?.();
    }
}

/**
 * Check whether the current signalType active filters match exactly one
 * legend category. Returns the matching group key, or null.
 */
function _detectActiveGroup() {
    const current = _activeFilters[FIELD.SIGNAL_TYPE];
    if (!current?.size) return null;
    for (const [key] of getCategoryEntries()) {
        const types = getTypesByGroup(key);
        if (types.length > 0 && current.size === types.length && types.every(v => current.has(v)))
            return key;
    }
    return null;
}

/** Serialize active filter state to localStorage via prefs.js. */
function _persistFilters() {
    const state = _defs.map(d => ({
        field: d.field,
        values: [...(_activeFilters[d.field] || [])],
        mappedOnly: _isSignalType(d.field) ? _mappedOnly : undefined,
    }));
    saveFilters(state);
}



// ===== State mutations =====

function _selectFirst(idx) {
    const firstVal = _defs[idx]?.panel?.getFirstItemVal();
    if (!firstVal) return;
    _toggle(_defs[idx].field, firstVal);
}

function _openDropdown(idx) {
    // Close all sibling filter dropdowns first (only one open at a time).
    _defs.forEach((d, i) => {
        if (i !== idx) d.panel?.closeDropdown();
    });
    _defs[idx]?.panel?.openDropdown();
}

function _toggle(field, val) {
    _syncActiveGroup(field);
    if (!_activeFilters[field]) _activeFilters[field] = new Set();
    const wasActive = _activeFilters[field].has(val);
    wasActive
        ? _activeFilters[field].delete(val)
        : _activeFilters[field].add(val);
    if (_activeFilters[field].size === 0) delete _activeFilters[field];

    const idx = _defs.findIndex(d => d.field === field);
    if (idx >= 0) {
        const def = _defs[idx];
        // On select: clear the search query so the full list reopens after picking.
        // On deselect: keep the query so the user can see remaining selections.
        if (!wasActive) {
            def.search = '';
            def.panel?.clearSearch();
        }
        _refreshTags(idx);
        _refreshDropdown(idx);
        _openDropdown(idx);
    }
    _commit();
}
