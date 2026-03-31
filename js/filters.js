/**
 * filters.js — Filter state and orchestration.
 *
 * Owns all application data:
 *   _activeFilters    — currently selected values per field
 *   _indexValues      — pre-loaded value lists from index.json
 *   _counts           — live signal counts per field / value (from tiles)
 *   _defs             — [ { field, search, panel: FilterPanel } ]
 *
 * Delegates all DOM / event work to FilterPanel (one instance per active
 * filter, stored as def.panel).  This file contains no direct DOM queries
 * after _buildPanels() returns.
 *
 * All filter values are uppercase (SNCF data convention); the search input
 * is uppercased before comparison so no toLowerCase() is needed.
 *
 * numericOnly fields (lineCode, networkId):
 *   Non-digit characters are stripped from the query string before it is
 *   stored in def.search and used for filtering.  FilterPanel must expose
 *   setSearch(value) to keep the visible input in sync.
 */

import { MIN_SEARCH_THRESHOLD } from './config.js';
import { fetchTileByKey, findSignalLocation } from './tiles.js';
import { getSupportedTypes } from './signal-mapping.js';
import { t, onLangChange } from './translation.js';
import { FilterPanel } from './filter-panel.js';
import { updateFilterCount, isSampled } from './statusbar.js';
import { saveFilters, loadFilters } from './prefs.js';
import { flyToLocationWithMarker } from './map.js';
import { getSignalLatlng } from './map-layer.js';

const _ALL_FILTER_FIELDS = [
    { key: 'signalType', labelKey: 'fields.signalType' },
    { key: 'lineCode', labelKey: 'fields.lineCode', numericOnly: true },
    { key: 'trackName', labelKey: 'fields.trackName' },
    {
        key: 'direction', labelKey: 'fields.direction',
        valueOrder: ['backward', 'forward', 'both'], readOnly: true,
    },
    {
        key: 'placement', labelKey: 'fields.placement',
        valueOrder: ['left', 'right', 'bridge'], readOnly: true,
    },
    {
        key: 'networkId', labelKey: 'fields.networkId', numericOnly: true,
        globalSearch: true,   // searches the full index.json location table
        searchThreshold: MIN_SEARCH_THRESHOLD
    },
];

// Exported as const so external importers always hold the same object reference.
// Internal mutations clear keys in-place rather than reassigning the object.
const _activeFilters = {};

let _indexValues = {};
let _networkIdToTile = new Map();  // networkId → tileKey — inverted at load time

let _counts = {};
let _globalCounts = {};     // per-value counts from index.json (full dataset, always accurate)
let _knownValues = {};      // accumulated across tile loads; never reset by resetCounts()
let _defs = [];             // [{ field: string, search: string, panel: FilterPanel }]
let _mappedOnly = false;
let _mappedTypes = getSupportedTypes();
let _onChange = null;
let _addFilterBtn = null;

// Templates: resolved lazily via getters so they are always read from the live DOM.
const _tpl = {
    get group() { return document.getElementById('tpl-filter-group'); },
    get tag() { return document.getElementById('tpl-filter-tag'); },
    get item() { return document.getElementById('tpl-filter-drop-item'); },
    get noMatch() { return document.getElementById('tpl-filter-no-match'); },
    get addFilterMenu() { return document.getElementById('tpl-add-filter-menu'); },
    get addFilterOption() { return document.getElementById('tpl-add-filter-option'); },
};

/* ===== Public API ===== */

export function initFilters(onChange) {
    _onChange = onChange;

    _initFieldState();
    _clearActiveFilters();
    _buildPanels();
    _initMenuDismissListener();

    onLangChange(() => {
        _buildPanels();
        _defs.forEach((_, idx) => _refreshTags(idx));
    });

    _restoreFilters();
}

/**
  * Return the networkId → tileKey map built from index.json.
 * Used by pins.js to fly to pinned signals.
 * @returns {Map<string, string>}
 */
export function getNetworkIdToTile() {
    return _networkIdToTile;
}

/**
* Fetch and parse the filter index from index.json.
 * Populates _indexValues and _globalCounts for all indexed fields.
 * Also builds the networkId → tileKey map for the globalSearch filter.
 * @param {string} tilesBase  Base URL of the tiles directory.
 * @returns {Promise<object|null>}  Raw index data, or null on failure.
 */
export async function loadFilterIndex(tilesBase) {
    try {
        const res = await fetch(tilesBase + 'index.json');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        _parseFieldIndex(data);
        _parseNetworkIdIndex(data);
        _defs.forEach((_, i) => _refreshDropdown(i));
        return data;
    } catch (err) {
        console.warn('[Filters] index.json:', err.message);
        const container = document.getElementById('filters-container');
        if (container) {
            const warn = _tpl.noMatch.content.cloneNode(true).querySelector('.fg-empty');
            warn.removeAttribute('data-i18n');
            warn.style.color = 'var(--warn)';
            warn.textContent = t('filter.indexError');
            container.prepend(warn);
        }
    }
}

/**
 * Index a set of normalized signals into per-field value counts.
 * Called by map-layer.js after each worker 'done' message.
 * Triggers a refresh of all open filter dropdowns.
 * @param {Array<{p: object}>} signals  Normalized signal objects.
 */
export function indexSignals(signals) {
    let changed = false;
    for (const s of signals) {
        _ALL_FILTER_FIELDS.forEach(f => {
            const v = s.p[f.key];
            if (v) {
                _counts[f.key].set(v, (_counts[f.key].get(v) || 0) + 1);
                _knownValues[f.key].add(v);   // persist across viewport changes
                changed = true;
            }
        });
    }
    if (changed) _defs.forEach((_, i) => _refreshDropdown(i));
}

/**
 * Clear all per-field live signal counts accumulated by indexSignals().
 * Called at the start of each worker cycle before new data arrives.
 */
export function resetCounts() {
    _ALL_FILTER_FIELDS.forEach(f => { _counts[f.key] = new Map(); });
    // _knownValues is intentionally NOT cleared here — values discovered in
    // previous tile loads must remain visible in dropdowns even when a filter
    // causes the worker to exclude groups that would otherwise carry those values.
}

/**
 * Remove all active filters and clear persisted filter state.
 * Called from app.js when the Reset Filters button is clicked.
 */
export function resetFilters() {
    _clearActiveFilters();
    _mappedOnly = false;
    saveFilters([]);
    _defs.forEach(d => { d.search = ''; });
    _ALL_FILTER_FIELDS.forEach(f => { _knownValues[f.key] = new Set(); });
    _buildPanels();
    _onChange?.();
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
 * Wire the '+ Add filter' button to its dropdown menu.
 * Adds only fields not already present in the active filter list.
 * @param {HTMLElement|null} btn
 */
export function initAddFilterButton(btn) {
    if (!btn) return;
    _addFilterBtn = btn;
    btn.addEventListener('click', e => {
        e.stopPropagation();
        const existing = document.querySelector('.add-filter-menu');
        if (existing) { existing.remove(); btn.focus(); return; }
        const menu = _buildAddFilterMenu(btn);
        if (menu) {
            (document.fullscreenElement ?? document.body).appendChild(menu);
            // Focus first item so the menu is immediately keyboard-navigable.
            menu.querySelector('.afm-option')?.focus();
        }
    });
    // Open menu and focus first item with ArrowDown or Enter/Space.
    btn.addEventListener('keydown', e => {
        if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
            if (document.querySelector('.add-filter-menu')) return;
            e.preventDefault();
            btn.click();
        }
    });
}

/**
 * Build the add-filter dropdown menu positioned below btn.
 * Returns null when all fields are already in use.
 */
function _buildAddFilterMenu(btn) {
    const used = new Set(_defs.map(d => d.field));
    const available = _ALL_FILTER_FIELDS.filter(f => !used.has(f.key));
    if (!available.length) return null;

    const menu = _tpl.addFilterMenu.content.cloneNode(true).querySelector('.add-filter-menu');
    const r = btn.getBoundingClientRect();
    Object.assign(menu.style, {
        position: 'fixed',
        top: (r.bottom + 4) + 'px',
        left: r.left + 'px',
        zIndex: '9999',
    });

    const _activateOption = (f, menu) => {
        _defs.push({ field: f.key, search: '' });
        _buildPanels();
        menu.remove();
        btn.focus();
    };

    for (const f of available) {
        const opt = _tpl.addFilterOption.content.cloneNode(true).querySelector('.afm-option');
        opt.textContent = t(f.labelKey);
        opt.tabIndex = 0;
        opt.setAttribute('role', 'menuitem');
        // Mouse activation.
        opt.addEventListener('mousedown', e => {
            e.preventDefault();
            _activateOption(f, menu);
        });
        // Keyboard activation.
        opt.addEventListener('keydown', e => {
            switch (e.key) {
                case 'Enter':
                case ' ':
                    e.preventDefault();
                    _activateOption(f, menu);
                    break;
                case 'ArrowDown':
                    e.preventDefault();
                    (opt.nextElementSibling ?? menu.firstElementChild)?.focus();
                    break;
                case 'ArrowUp':
                    e.preventDefault();
                    if (!opt.previousElementSibling) {
                        // Wrap back to the trigger button.
                        menu.remove();
                        btn.focus();
                    } else {
                        opt.previousElementSibling?.focus();
                    }
                    break;
                case 'Escape':
                case 'Tab':
                    e.preventDefault();
                    menu.remove();
                    btn.focus();
                    break;
            }
        });
        menu.appendChild(opt);
    }
    menu.setAttribute('role', 'menu');
    return menu;
}

/* ===== Internal helpers ===== */

/**
 * Parse filter value counts from index.json into _indexValues and _globalCounts.
 * Entries are objects: { value: count } or { value: { count, label? } }.
 */
/** Wire the outside-click listener that dismisses the 'Add filter' menu. */
function _initMenuDismissListener() {
    document.addEventListener('click', e => {
        if (!e.target.closest('.add-filter-menu') &&
            !e.target.closest('#btn-add-filter'))
            document.querySelector('.add-filter-menu')?.remove();
    });
}


function _parseFieldIndex(data) {
    _ALL_FILTER_FIELDS.forEach(f => {
        const entry = data[f.key];
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return;
        _indexValues[f.key] = Object.keys(entry);
        _globalCounts[f.key] = new Map(
            Object.entries(entry).map(([k, v]) =>
                [k, typeof v === 'object' && v !== null ? v.count : v]
            )
        );
    });
}

/**
 * Flatten the tileKey → { networkId → [lat, lng] } index from index.json
 * into a single Map for O(1) lookup by networkId.
 */
function _parseNetworkIdIndex(data) {
    if (!data.networkId) return;
    // index.json: tileKey → [networkId, …]. Build a flat networkId → tileKey Map.
    _networkIdToTile = new Map();
    for (const [tileKey, ids] of Object.entries(data.networkId)) {
        for (const id of ids) _networkIdToTile.set(id, tileKey);
    }
    console.info(`[Filters] networkId index: ${_networkIdToTile.size.toLocaleString()} entries`);
}


/** Initialise per-field state maps — called once from initFilters(). */
function _initFieldState() {
    _ALL_FILTER_FIELDS.forEach(f => {
        _indexValues[f.key] = [];
        _counts[f.key] = new Map();
        _knownValues[f.key] = new Set();
        _globalCounts[f.key] = null;   // null means not yet loaded from index.json
    });
}

function _clearActiveFilters() {
    for (const key in _activeFilters) delete _activeFilters[key];
}

function _fieldDef(key) {
    return _ALL_FILTER_FIELDS.find(f => f.key === key);
}

function _updateAddFilterBtn() {
    if (!_addFilterBtn) return;
    const used = new Set(_defs.map(d => d.field));
    _addFilterBtn.disabled = !_ALL_FILTER_FIELDS.some(f => !used.has(f.key));
}

/**
 * Normalize a string for case-insensitive, accent-insensitive search comparison.
 */
function _normalize(str) {
    return String(str).toUpperCase();
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


/* ===== Panel management ===== */

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
        tplNoMatch: _tpl.noMatch,
        translateValue: _translateFilterValue,
        // isConfirmed: true when the field already has selected values (e.g. after restore).
        // Prevents minSearch fields from hiding the tags container on rebuild.
        isConfirmed: (_activeFilters[def.field]?.size ?? 0) > 0,
        searchValue: def.search,
        mappedOnly: _mappedOnly,

        onActivate: activate,

        onClear: () => {
            if (_activeFilters[def.field]?.size > 0) {
                delete _activeFilters[def.field];
                _persistFilters();
                _refreshTags(idx);
                _refreshDropdown(idx);
                _updateStatusBar();
                _onChange?.();
            }
        },

        onPillRemove: val => {
            _toggle(def.field, val);
            // The focused pill button was detached by replaceChildren() inside
            // _refreshTags → focus moved to <body>.  Restore via microtask.
            queueMicrotask(() => def.panel?.focusInput());
        },

        // Clicking a networkId pill label flies the map to that signal's tile.
        onPillLabelClick: fieldMeta?.globalSearch
            ? val => flyToSignal(val)
            : undefined,

        onRemove: () => {
            // First press: clear selected values if any — keep the panel open.
            // Second press (no values): remove the panel entirely.
            if (_activeFilters[def.field]?.size > 0) {
                delete _activeFilters[def.field];
                _persistFilters();
                _refreshTags(idx);
                _refreshDropdown(idx);
                _updateStatusBar();
            } else {
                def.panel.destroy();
                delete _activeFilters[def.field];
                _defs.splice(idx, 1);
                _persistFilters();
                _buildPanels();
            }
            _onChange?.();
        },

        onToggleMappedOnly: checked => {
            // The CSS :checked + .toggle-track rule drives the visual state —
            // no manual class manipulation needed here.
            _mappedOnly = checked;
            delete _activeFilters['signalType'];
            _defs.forEach(d => { if (d.field === 'signalType') d.search = ''; });
            _persistFilters();
            _buildPanels();
            _onChange?.();
        },

        onSearch: query => {
            // numericOnly: strip non-digit characters before storing the query.
            // FilterPanel.setSearch() keeps the visible input in sync when the
            // sanitized value differs from what was typed.
            const sanitized = fieldMeta?.numericOnly
                ? query.replace(/\D/g, '')
                : query;
            if (sanitized !== query) def.panel?.setSearch(sanitized);
            def.search = sanitized;
            _refreshDropdown(idx);
            _openDropdown(idx);
        },

        onEnter: () => _selectFirst(idx),
        onOpen: () => _openDropdown(idx),
    };
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
        _refreshTags(idx);
        _refreshDropdown(idx);
    });

    _updateStatusBar();
    _updateAddFilterBtn();
}

/* ===== DOM update helpers ===== */

function _refreshTags(idx) {
    const def = _defs[idx];
    if (!def?.panel) return;
    def.panel.refreshTags(_activeFilters[def.field] || new Set());
}

/**
 * Prepare the filtered, sorted item list and hand it to the panel for rendering.
 * All data logic (merging index + counts, filtering, sorting) stays here;
 * FilterPanel receives a plain [{v, count, active, showDot}] array and renders
 * it without any application knowledge.
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

/** Render the networkId dropdown — searches the full _networkIdToTile index. */
function _refreshGlobalSearchDropdown(def, fieldMeta, sel, q) {
    def.panel.setInputPlaceholder(t('dropdown.searchNetworkId'));
    const activeItems = () => [...sel].map(v => ({ v, count: 0, active: true, showDot: false }));
    if (!q) {
        def.panel.refreshList([]);
        return;
    }

    const threshold = fieldMeta.searchThreshold ?? MIN_SEARCH_THRESHOLD;
    const matched = [..._networkIdToTile.keys()].filter(id => id.startsWith(q));
    if (matched.length > threshold) {
        def.panel.refreshList(activeItems());
        return;
    }

    def.panel.refreshList(
        matched.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
            .map(v => ({ v, count: 0, active: sel.has(v), showDot: false }))
    );
}

/** Render a standard dropdown from local counts and the global index. */
function _refreshStandardDropdown(def, fieldMeta, sel, q) {
    const all = _candidateValues(def);
    const isSignalType = def.field === 'signalType';
    const numericSort = def.field === 'lineCode';
    const isMappedOnly = _mappedOnly && isSignalType;
    // In overview sampling mode use global counts — the spatial sample is not
    // representative of the full dataset, so live counts would be misleading.
    const countMap = isSampled()
        ? (_globalCounts[def.field] ?? _counts[def.field])
        : (_counts[def.field] ?? _globalCounts[def.field]);
    const nq = _normalize(q);
    const filtered = q ? all.filter(v => _normalize(v).startsWith(nq)) : all;

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
            .sort(_itemSorter(fieldMeta, isSignalType, numericSort))
    );
}

/**
 * Build the merged candidate value list for a filter field.
 * Indexed fields (signalType, lineCode) use the index as the universe.
 * Non-indexed fields use _knownValues to preserve values from previous tiles.
 */
function _candidateValues(def) {
    const fromIndex = _indexValues[def.field] || [];
    const fromCounts = [...(_counts[def.field]?.keys() || [])];
    const base = fromIndex.length > 0
        ? [...new Set([...fromIndex, ...fromCounts])]
        : [...new Set([...(_knownValues[def.field] || []), ...fromCounts])];
    if (_mappedOnly && def.field === 'signalType') return base.filter(v => _mappedTypes.has(v));
    return base;
}



/**
 * Return a comparator for _refreshList item sorting.
 * Priority: explicit valueOrder > count-descending (signalType) > numeric > alphabetical.
 */
function _itemSorter(fieldMeta, isSignalType, numericSort) {
    if (fieldMeta?.valueOrder) {
        const order = fieldMeta.valueOrder;
        return (a, b) => {
            const ia = order.indexOf(a.v);
            const ib = order.indexOf(b.v);
            if (ia >= 0 && ib >= 0) return ia - ib;
            if (ia >= 0) return -1;
            if (ib >= 0) return 1;
            return a.v.localeCompare(b.v);
        };
    }
    if (isSignalType)
        return (a, b) => (b.count - a.count) || a.v.localeCompare(b.v);
    if (numericSort)
        return (a, b) => a.v.localeCompare(b.v, undefined, { numeric: true });
    return (a, b) => a.v.localeCompare(b.v);
}


/**
 * Restore filter state persisted by a previous session.
 * Recreates panels and re-activates values without triggering _onChange.
 */
function _restoreFilters() {
    const saved = loadFilters();
    if (!saved.length) return;
    for (const { field, values, mappedOnly } of saved) {
        if (!_ALL_FILTER_FIELDS.some(f => f.key === field)) continue;
        if (mappedOnly) _mappedOnly = true;
        if (!_defs.some(d => d.field === field)) _defs.push({ field, search: '' });
        for (const v of values) {
            if (!_activeFilters[field]) _activeFilters[field] = new Set();
            _activeFilters[field].add(v);
        }
    }
    if (_defs.length) { _buildPanels(); _onChange?.(); }
}

/** Serialize active filter state to localStorage via prefs.js. */
function _persistFilters() {
    const state = _defs.map(d => ({
        field: d.field,
        values: [...(_activeFilters[d.field] || [])],
        mappedOnly: d.field === 'signalType' ? _mappedOnly : undefined,
    }));
    saveFilters(state);
}


/**
 * Fly to a signal by Network ID and show a location marker.
 * Fast path: signal is in the current viewport — fly immediately.
 * Slow path: fetch the tile from cache, then fly with marker after moveend.
 * Exported so pins.js can reuse it without duplicating the lookup logic.
 *
 * @param {string} networkId
 */
export async function flyToSignal(networkId) {
    // Fast path: signal is currently rendered in the viewport.
    const latlng = getSignalLatlng(networkId);
    if (latlng) {
        flyToLocationWithMarker(latlng);
        return;
    }
    // Slow path: fetch tile from cache to get exact coordinates.
    const tileKey = _networkIdToTile.get(networkId);
    if (!tileKey) return;
    const signals = await fetchTileByKey(tileKey);
    const location = findSignalLocation(signals, networkId);
    if (location) flyToLocationWithMarker(location);
}


/* ===== State mutations ===== */

function _selectFirst(idx) {
    const firstVal = _defs[idx]?.panel?.getFirstItemVal();
    if (!firstVal) return;
    _toggle(_defs[idx].field, firstVal);
}

function _openDropdown(idx) {
    // Close all sibling filter dropdowns first (only one open at a time).
    _defs.forEach((d, i) => { if (i !== idx) d.panel?.closeDropdown(); });
    _defs[idx]?.panel?.openDropdown();
}

function _closeDropdown(idx) {
    _defs[idx]?.panel?.closeDropdown();
}

function _toggle(field, val) {
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
    _persistFilters();
    _updateStatusBar();
    _onChange?.();
}

function _updateStatusBar() {
    updateFilterCount(
        Object.values(_activeFilters).filter(s => s.size > 0).length
    );
}
