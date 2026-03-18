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
 * UI class responsibilities:
 *   FilterPanel  (ui/filter-panel.js)
 *     ↳ Dropdown  (ui/dropdown.js)  — outside-click, ARIA, list keyboard nav
 *     ↳ ComboBox  (ui/combobox.js)  — input search / keyboard / focus
 *     ↳ PillList  (ui/pill-list.js) — pill container delegation
 *
 * All filter values are uppercase (SNCF data convention); the search input
 * is uppercased before comparison so no toLowerCase() is needed.
 *
 * numericOnly fields (code_ligne, idreseau):
 *   Non-digit characters are stripped from the query string before it is
 *   stored in def.search and used for filtering.  FilterPanel must expose
 *   setSearch(value) to keep the visible input in sync.
 */

import { getSupportedTypes } from './signal-mapping.js';
import { t, applyI18n, onLangChange } from './i18n.js';
import { FilterPanel } from './ui/filter-panel.js';
import { updateFilterCount } from './statusbar.js';
import { MIN_SEARCH_THRESHOLD } from './config.js';

const _ALL_FILTER_FIELDS = [
    { key: 'type_if', labelKey: 'field.type_if' },
    { key: 'code_ligne', labelKey: 'field.code_ligne', numericOnly: true },
    { key: 'nom_voie', labelKey: 'field.nom_voie' },
    { key: 'sens', labelKey: 'field.sens' },
    { key: 'position', labelKey: 'field.position' },
    { key: 'idreseau', labelKey: 'field.idreseau', numericOnly: true },
];

// Exported as const so external importers always hold the same object reference.
// Internal mutations clear keys in-place rather than reassigning the object.
const _activeFilters = {};

let _indexValues = {};
let _counts = {};
let _globalCounts = {};   // per-value counts from index.json (full dataset, always accurate)
let _totalSignals = 0;    // total signal count from manifest, used as placeholder for non-indexed fields

/** Store the total signal count so non-indexed dropdowns can show a meaningful placeholder. */
export function setTotalSignals(n) {
    _totalSignals = n;
}
let _knownValues = {};   // accumulated across tile loads; never reset by resetCounts()
let _defs = [];   // [{ field: string, search: string, panel: FilterPanel }]
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

_ALL_FILTER_FIELDS.forEach(f => {
    _indexValues[f.key] = [];
    _counts[f.key] = new Map();
    _knownValues[f.key] = new Set();
    _globalCounts[f.key] = null;   // null means not yet loaded from index.json
});

/* ===== Public API ===== */

export function initFilters(onChange) {
    _onChange = onChange;
    _clearActiveFilters();
    _buildPanels();

    // Dismiss the "Add filter" menu when clicking outside it.
    document.addEventListener('click', e => {
        if (!e.target.closest('.add-filter-menu') &&
            !e.target.closest('#btn-add-filter'))
            document.querySelector('.add-filter-menu')?.remove();
    });

    onLangChange(() => _buildPanels());
}

export async function loadFilterIndex(tilesBase) {
    try {
        const res = await fetch(tilesBase + 'index.json');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        _ALL_FILTER_FIELDS.forEach(f => {
            const entry = data[f.key];
            if (!entry) return;
            if (Array.isArray(entry)) {
                // Legacy format: plain value array, no counts.
                _indexValues[f.key] = entry;
            } else if (typeof entry === 'object') {
                // New format: { value: count, ... } — counts from full dataset.
                _indexValues[f.key] = Object.keys(entry);
                _globalCounts[f.key] = new Map(Object.entries(entry).map(([k, v]) => [k, v]));
            }
        });
        _defs.forEach((_, i) => _refreshDropdown(i));
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

export function resetCounts() {
    _ALL_FILTER_FIELDS.forEach(f => { _counts[f.key] = new Map(); });
    // _knownValues is intentionally NOT cleared here — values discovered in
    // previous tile loads must remain visible in dropdowns even when a filter
    // causes the worker to exclude groups that would otherwise carry those values.
}

export function resetFilters() {
    _clearActiveFilters();
    _mappedOnly = false;
    _defs.forEach(d => { d.search = ''; });
    _ALL_FILTER_FIELDS.forEach(f => { _knownValues[f.key] = new Set(); });
    _buildPanels();
    _onChange?.();
}

export function getActiveFiltersForWorker() {
    const out = {};
    for (const [f, vals] of Object.entries(_activeFilters))
        if (vals.size > 0) out[f] = [...vals];
    return out;
}

export function initAddFilterButton(btn) {
    if (!btn) return;
    _addFilterBtn = btn;
    btn.addEventListener('click', e => {
        e.stopPropagation();

        const existing = document.querySelector('.add-filter-menu');
        if (existing) { existing.remove(); return; }

        const used = new Set(_defs.map(d => d.field));
        const available = _ALL_FILTER_FIELDS.filter(f => !used.has(f.key));
        if (!available.length) return;

        const menu = _tpl.addFilterMenu.content.cloneNode(true).querySelector('.add-filter-menu');
        const r = btn.getBoundingClientRect();
        Object.assign(menu.style, {
            position: 'fixed',
            top: (r.bottom + 4) + 'px',
            left: r.left + 'px',
            zIndex: '9999',
        });

        available.forEach(f => {
            const opt = _tpl.addFilterOption.content.cloneNode(true).querySelector('.afm-option');
            opt.textContent = t(f.labelKey);
            opt.addEventListener('mousedown', e2 => {
                e2.preventDefault();
                // Do NOT stopPropagation: let the event reach the document 'click'
                // handler that dismisses the menu.  We also call menu.remove()
                // explicitly so the menu closes even if the click event does not fire
                // (e.g. after _buildPanels rebuilds the DOM under the cursor).
                _defs.push({ field: f.key, search: '' });
                _buildPanels();
                menu.remove();
            });
            menu.appendChild(opt);
        });

        // In fullscreen the browser creates a new stacking context on the
        // fullscreen element; append there so the menu is not hidden behind it.
        (document.fullscreenElement ?? document.body).appendChild(menu);
    });
}

/* ===== Internal helpers ===== */

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

/* ===== Panel management ===== */

function _buildPanels() {
    const container = document.getElementById('filters-container');
    if (!container) return;

    // Destroy Dropdown instances so they unregister from the outside-click registry.
    _defs.forEach(d => d.panel?.destroy());
    container.replaceChildren();

    _defs.forEach((def, idx) => {
        const fieldMeta = _fieldDef(def.field);
        const label = t(fieldMeta?.labelKey ?? def.field);

        const activate = (val) => _toggle(def.field, val);

        def.panel = new FilterPanel({
            fieldKey: def.field,
            fieldMeta,
            label,
            tplGroup: _tpl.group,
            tplTag: _tpl.tag,
            tplItem: _tpl.item,
            tplNoMatch: _tpl.noMatch,
            applyI18n,
            searchValue: def.search,
            mappedOnly: _mappedOnly,

            onActivate: activate,

            onPillRemove: val => {
                _toggle(def.field, val);
                // The focused pill button was detached by replaceChildren() inside
                // _refreshTags → focus moved to <body>.  Restore via microtask.
                queueMicrotask(() => def.panel?.focusInput());
            },

            onRemove: () => {
                def.panel.destroy();
                delete _activeFilters[def.field];
                _defs.splice(idx, 1);
                _buildPanels();
                _onChange?.();
            },

            onToggleMappedOnly: checked => {
                _mappedOnly = checked;
                delete _activeFilters['type_if'];
                _defs.forEach(d => { if (d.field === 'type_if') d.search = ''; });
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
        });

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
    const fromIndex = _indexValues[def.field] || [];
    const fromCounts = [...(_counts[def.field]?.keys() || [])];
    // For fields covered by index.json (type_if, code_ligne…), the index is the
    // complete universe of values — merge with live counts for the sort order.
    // For fields NOT in index.json (sens, position, nom_voie…), use _knownValues
    // so that values discovered in previous tile loads are never lost when a filter
    // causes the worker to exclude the groups that would otherwise carry them.
    let all = fromIndex.length > 0
        ? [...new Set([...fromIndex, ...fromCounts])]
        : [...new Set([...(_knownValues[def.field] || []), ...fromCounts])];

    const q = def.search || '';
    const isTypeIf = def.field === 'type_if';
    const isMappedOnly = _mappedOnly && isTypeIf;

    if (isMappedOnly) all = all.filter(v => _mappedTypes.has(v));

    // Placeholder: for indexed fields show the known value count; for non-indexed
    // fields show the total signal count from the manifest (more meaningful than
    // the partial knownValues count which only reflects loaded tiles).
    const placeholderCount = fromIndex.length > 0 ? all.length : (_totalSignals || all.length);
    def.panel.setInputPlaceholder(t('dropdown.search', placeholderCount));

    const numericSort = def.field === 'code_ligne';
    const sel = _activeFilters[def.field] || new Set();

    // Build the filtered candidate list first.
    const filtered = q ? all.filter(v => v.includes(q)) : all;

    // Large value lists: when the set of matches still exceeds the threshold,
    // the list would be too long to render usefully. Keep requiring more input
    // until the match count drops below MIN_SEARCH_THRESHOLD.
    // The minimum query length is derived from the full list size (proportional gate),
    // but the actual render decision uses the filtered count — a rare prefix unlocks
    // the list sooner than a common one.
    // Global counts from index.json when available; live viewport counts otherwise.
    const countMap = _globalCounts[def.field] ?? _counts[def.field];

    if (filtered.length > MIN_SEARCH_THRESHOLD) {
        const minChars = Math.max(1, Math.ceil(Math.log10(all.length / MIN_SEARCH_THRESHOLD)));
        if (q.length < minChars) {
            const activeItems = [...sel].map(v => ({
                v,
                count: countMap?.get(v) || 0,
                active: true,
                showDot: isTypeIf && _mappedTypes.has(v) && !isMappedOnly,
            }));
            def.panel.refreshList(activeItems);
            return;
        }
    }

    const items = filtered
        .map(v => ({
            v,
            count: countMap?.get(v) || 0,
            active: sel.has(v),
            showDot: isTypeIf && _mappedTypes.has(v) && !isMappedOnly,
        }))
        .sort(
            // type_if: descending count when global counts available, else alphabetical.
            // code_ligne: numeric ascending.
            // others: alphabetical.
            isTypeIf && _globalCounts[def.field]
                ? (a, b) => (b.count - a.count) || a.v.localeCompare(b.v)
                : numericSort
                    ? (a, b) => (parseFloat(a.v) || 0) - (parseFloat(b.v) || 0) || a.v.localeCompare(b.v)
                    : (a, b) => a.v.localeCompare(b.v)
        );

    def.panel.refreshList(items);
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
        // On deselect: do NOT clear the query. The typed text stays visible so
        // the user can see which items are still selected among their search results.
        // Only clear when the user explicitly clears the input themselves.
        _refreshTags(idx);
        _refreshDropdown(idx);
        _openDropdown(idx);
    }
    _updateStatusBar();
    _onChange?.();
}

function _updateStatusBar() {
    updateFilterCount(
        Object.values(_activeFilters).filter(s => s.size > 0).length
    );
}
