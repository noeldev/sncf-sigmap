/**
 * filters.js — Filter state and orchestration.
 *
 * Owns all application data:
 *   _activeFilters    — currently selected values per field
 *   _confirmedFilters — minSearch fields with an explicitly confirmed value
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
 * The idreseau field has minSearch: 5 — the dropdown shows a hint until the
 * user has typed at least 5 characters, then shows matching values from
 * _counts['idreseau'] (populated live by indexSignals() as tiles load).
 */

import { getSupportedTypes } from './signal-mapping.js';
import { t, applyI18n, onLangChange } from './i18n.js';
import { FilterPanel } from './ui/filter-panel.js';

export const ALL_FILTER_FIELDS = [
    { key: 'type_if', labelKey: 'field.type_if' },
    { key: 'code_ligne', labelKey: 'field.code_ligne' },
    { key: 'nom_voie', labelKey: 'field.nom_voie' },
    { key: 'sens', labelKey: 'field.sens' },
    { key: 'position', labelKey: 'field.position' },
    { key: 'idreseau', labelKey: 'field.idreseau', minSearch: 5 },
];

// Exported as const so external importers always hold the same object reference.
// Internal mutations clear keys in-place rather than reassigning the object.
const _activeFilters = {};

// Tracks minSearch fields with a value explicitly confirmed via Enter / click.
// During live typing the filter is applied for marker display but no pill shown.
const _confirmedFilters = new Set();

let _indexValues = {};
let _counts = {};
let _defs = [];   // [{ field: string, search: string, panel: FilterPanel }]
let _mappedOnly = false;
let _mappedTypes = getSupportedTypes();
let _onChange = null;
let _addFilterBtn = null;
let _elStFilters = null;

// Templates: resolved lazily via getters so they are always read from the live DOM.
const _tpl = {
    get group() { return document.getElementById('tpl-filter-group'); },
    get tag() { return document.getElementById('tpl-filter-tag'); },
    get item() { return document.getElementById('tpl-filter-drop-item'); },
    get noMatch() { return document.getElementById('tpl-filter-no-match'); },
};

ALL_FILTER_FIELDS.forEach(f => {
    _indexValues[f.key] = [];
    _counts[f.key] = new Map();
});

/* ===== Public API ===== */

export function initFilters(onChange) {
    _onChange = onChange;
    _elStFilters = document.getElementById('st-filters');
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
        ALL_FILTER_FIELDS.forEach(f => {
            if (data[f.key]) _indexValues[f.key] = data[f.key];
        });
        _defs.forEach((_, i) => _refreshDropdown(i));
    } catch (err) {
        console.warn('[Filters] index.json:', err.message);
        const container = document.getElementById('filters-container');
        if (container) {
            const warn = document.createElement('div');
            warn.className = 'fg-empty';
            warn.style.color = 'var(--warn)';
            warn.textContent = t('filter.indexError');
            container.prepend(warn);
        }
    }
}

export function indexSignals(signals) {
    let changed = false;
    for (const s of signals) {
        ALL_FILTER_FIELDS.forEach(f => {
            const v = s.p[f.key];
            if (v) {
                _counts[f.key].set(v, (_counts[f.key].get(v) || 0) + 1);
                changed = true;
            }
        });
    }
    if (changed) _defs.forEach((_, i) => _refreshDropdown(i));
}

export function resetCounts() {
    ALL_FILTER_FIELDS.forEach(f => { _counts[f.key] = new Map(); });
}

export function resetFilters() {
    _clearActiveFilters();
    _mappedOnly = false;
    _defs.forEach(d => { d.search = ''; });
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
        const available = ALL_FILTER_FIELDS.filter(f => !used.has(f.key));
        if (!available.length) return;

        const menu = document.createElement('div');
        menu.className = 'add-filter-menu';
        const r = btn.getBoundingClientRect();
        Object.assign(menu.style, {
            position: 'fixed',
            top: (r.bottom + 4) + 'px',
            left: r.left + 'px',
            zIndex: '9999',
        });

        available.forEach(f => {
            const opt = document.createElement('div');
            opt.className = 'afm-option';
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
    _confirmedFilters.clear();
}

function _fieldDef(key) {
    return ALL_FILTER_FIELDS.find(f => f.key === key);
}

function _updateAddFilterBtn() {
    if (!_addFilterBtn) return;
    const used = new Set(_defs.map(d => d.field));
    _addFilterBtn.disabled = !ALL_FILTER_FIELDS.some(f => !used.has(f.key));
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

        // activate MUST be defined before new FilterPanel() — the constructor
        // stores it as onActivate immediately.  Defining it after the constructor
        // call would place it in the Temporal Dead Zone at the point of use,
        // causing a silent ReferenceError on every item click.
        const activate = fieldMeta?.minSearch > 0
            ? (val) => _addExact(def.field, val, idx, /* keepDropdown= */ true)
            : (val) => _toggle(def.field, val);

        def.panel = new FilterPanel({
            fieldKey: def.field,
            fieldMeta,
            label,
            tplGroup: _tpl.group,
            tplTag: _tpl.tag,
            tplItem: _tpl.item,
            tplNoMatch: _tpl.noMatch,
            applyI18n,
            isConfirmed: _confirmedFilters.has(def.field),
            searchValue: def.search,
            mappedOnly: _mappedOnly,

            onActivate: activate,

            onPillRemove: val => {
                _toggle(def.field, val);
                // If all pills removed for a minSearch field, reset confirmation.
                if (fieldMeta?.minSearch > 0 && !_activeFilters[def.field]?.size) {
                    _confirmedFilters.delete(def.field);
                    def.panel.hideTags();
                }
                // The focused pill button was detached by replaceChildren() inside
                // _refreshTags → focus moved to <body>.  Restore via microtask.
                queueMicrotask(() => def.panel?.focusInput());
            },

            onRemove: () => {
                def.panel.destroy();
                delete _activeFilters[def.field];
                _confirmedFilters.delete(def.field);
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
                def.search = query;
                _refreshDropdown(idx);
                if (fieldMeta?.minSearch > 0) {
                    if (query.length >= fieldMeta.minSearch) _openDropdown(idx);
                    else _closeDropdown(idx);
                }
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

    const fieldMeta = _fieldDef(def.field);
    if (fieldMeta?.minSearch > 0) {
        if (!_confirmedFilters.has(def.field)) return;
        def.panel.showTags();
    }

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
    let all = fromIndex.length > 0
        ? [...new Set([...fromIndex, ...fromCounts])]
        : fromCounts;

    const q = def.search || '';
    const isTypeIf = def.field === 'type_if';
    const isMappedOnly = _mappedOnly && isTypeIf;

    if (isMappedOnly) all = all.filter(v => _mappedTypes.has(v));

    // minSearch: show a hint row until the threshold length is reached.
    const minSearch = fieldMeta?.minSearch || 0;
    if (minSearch > 0 && q.length < minSearch) {
        def.panel.showHint(t('filter.idreseau.waiting'));
        def.panel.setInputPlaceholder(t('filter.idreseau.placeholder'));
        return;
    }

    def.panel.setInputPlaceholder(t('dropdown.search', all.length));

    const numericSort = def.field === 'code_ligne';
    const sel = _activeFilters[def.field] || new Set();

    const items = all
        .filter(v => v.includes(q))
        .map(v => ({
            v,
            count: _counts[def.field]?.get(v) || 0,
            active: sel.has(v),
            showDot: isTypeIf && _mappedTypes.has(v) && !isMappedOnly,
        }))
        .sort(numericSort
            ? (a, b) =>
                (parseFloat(a.v) || 0) - (parseFloat(b.v) || 0) ||
                a.v.localeCompare(b.v)
            : (a, b) => a.v.localeCompare(b.v)
        );

    def.panel.refreshList(items);
}

/* ===== State mutations ===== */

/**
 * Add or remove a value for a minSearch field (search-and-add pattern).
 *
 * keepDropdown true  — dropdown stays open; focus returns to input for next term.
 *              false — dropdown closes; focus returns to input.
 */
function _addExact(field, val, idx, keepDropdown = true) {
    if (!val) return;
    if (!_activeFilters[field]) _activeFilters[field] = new Set();

    const wasActive = _activeFilters[field].has(val);
    wasActive
        ? _activeFilters[field].delete(val)
        : _activeFilters[field].add(val);

    const isEmpty = !_activeFilters[field]?.size;
    if (isEmpty) delete _activeFilters[field];

    const def = _defs[idx];

    if (!wasActive) {
        _confirmedFilters.add(field);
        def.panel?.showTags();
    } else if (isEmpty) {
        _confirmedFilters.delete(field);
        def.panel?.hideTags();
    }

    _refreshTags(idx);
    _refreshDropdown(idx);

    if (keepDropdown) {
        queueMicrotask(() => def.panel?.focusInput());
    } else {
        _closeDropdown(idx);
        queueMicrotask(() => def.panel?.focusInput());
    }
    _updateStatusBar();
    _onChange?.();
}

function _selectFirst(idx) {
    const def = _defs[idx];
    const fieldMeta = _fieldDef(def?.field);
    const firstVal = def?.panel?.getFirstItemVal();
    if (!firstVal) return;

    if (fieldMeta?.minSearch > 0) {
        // From editbox Enter: confirm the first result, clear input, close dropdown.
        def.search = '';
        def.panel.clearSearch();
        _addExact(def.field, firstVal, idx, /* keepDropdown= */ false);
    } else {
        _toggle(def.field, firstVal);
        // Focus stays in the editbox (it was already focused when Enter was pressed).
    }
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
        // On deselect: clear the query so the full list reappears rather than
        // only the previously filtered subset.
        if (wasActive && def.panel) {
            def.search = '';
            def.panel.clearSearch();
        }
        _refreshTags(idx);
        _refreshDropdown(idx);
        _openDropdown(idx);
    }
    _updateStatusBar();
    _onChange?.();
}

function _updateStatusBar() {
    if (_elStFilters)
        _elStFilters.textContent =
            Object.values(_activeFilters).filter(s => s.size > 0).length;
}
