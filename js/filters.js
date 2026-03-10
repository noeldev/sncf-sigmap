/**
 * filters.js — Filter panel with combo-box dropdowns.
 *
 * All HTML structure lives in index.html:
 *   tpl-filter-group     — one filter panel (header, tag pills, combo, toggle)
 *   tpl-filter-tag       — one active-value pill
 *   tpl-filter-drop-item — one dropdown option row
 *   tpl-filter-no-match  — empty-results placeholder
 *
 * DOM references for each panel are stored in _defs[i].el so that
 * _refreshTags / _refreshDropdown never call document.getElementById().
 *
 * Dropdown behaviour (outside-click, ARIA, keyboard navigation, focus) is
 * handled by the Dropdown class from dropdown.js — one shared instance per
 * filter panel stored as def.dd.  _openDropdown / _closeDropdown delegate to
 * def.dd.open() / def.dd.close().  The item activation callback (activate) is
 * the single code path for both mouse and keyboard item selection.
 *
 * All filter values are uppercase (SNCF data convention); the search input
 * is uppercased before comparison so no toLowerCase() is needed.
 *
 * The idreseau field has minSearch: 5 — the dropdown shows a hint until the
 * user has typed at least 5 characters, then shows matching values from the
 * currently indexed signals.  No pre-built index exists for idreseau given
 * the 123 000+ unique values; matches are drawn from _counts['idreseau']
 * which is populated live by indexSignals() as tiles load.
 */

import { getSupportedTypes } from './signal-mapping.js';
import { t, applyI18n, onLangChange } from './i18n.js';
import { Dropdown } from './dropdown.js';

export const ALL_FILTER_FIELDS = [
    { key: 'type_if', labelKey: 'field.type_if' },
    { key: 'code_ligne', labelKey: 'field.code_ligne' },
    { key: 'nom_voie', labelKey: 'field.nom_voie' },
    { key: 'sens', labelKey: 'field.sens' },
    { key: 'position', labelKey: 'field.position' },
    { key: 'idreseau', labelKey: 'field.idreseau', minSearch: 5 },
];

// Exported as const so external importers always hold the same object reference.
// Internal mutations clear keys in-place rather than reassigning.
const _activeFilters = {};

// Tracks which minSearch fields have a value explicitly confirmed via Enter / click.
// While typing, the filter is applied live (for marker display) but no badge is shown.
const _confirmedFilters = new Set();

let _indexValues = {};
let _counts = {};
let _defs = [];   // { field, search, el: { … } } — el added on panel build
let _mappedOnly = false;
let _mappedTypes = getSupportedTypes();
let _onChange = null;
let _addFilterBtn = null;   // cached button reference for disabled-state management
let _elStFilters = null;   // cached status bar filters counter

// Templates are stable DOM nodes — cache them once after DOMContentLoaded.
// ES modules are deferred by spec so the DOM is guaranteed ready here.
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

export function initFilters(onChange) {
    _onChange = onChange;
    _elStFilters = document.getElementById('st-filters');
    _clearActiveFilters();
    _buildPanels();

    // Outside-click closing for filter dropdowns is delegated to the Dropdown
    // instances (each panel registers itself in dropdown.js's shared registry).

    // Dismiss the "Add filter" menu when clicking outside it.
    document.addEventListener('click', e => {
        if (
            !e.target.closest('.add-filter-menu') &&
            !e.target.closest('#btn-add-filter')
        ) {
            document.querySelector('.add-filter-menu')?.remove();
        }
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
        // Show a discreet warning so the user knows filter suggestions may be incomplete.
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
    for (const [f, vals] of Object.entries(_activeFilters)) {
        if (vals.size > 0) out[f] = [...vals];
    }
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
                e2.stopPropagation();
                _defs.push({ field: f.key, search: '' });
                _buildPanels();
                menu.remove();
            });
            menu.appendChild(opt);
        });

        // If the app is in fullscreen, the browser creates a new stacking
        // context on the fullscreen element.  Anything appended to <body> is
        // rendered behind it regardless of z-index.  Attach to the fullscreen
        // root instead so the menu stays on top.
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

/** Disable the "Add filter" button when every field already has a panel. */
function _updateAddFilterBtn() {
    if (!_addFilterBtn) return;
    const used = new Set(_defs.map(d => d.field));
    _addFilterBtn.disabled = !ALL_FILTER_FIELDS.some(f => !used.has(f.key));
}

/* ===== Panel DOM (template-driven) ===== */

function _buildPanels() {
    const container = document.getElementById('filters-container');
    if (!container) return;
    // Destroy existing Dropdown instances before rebuilding panels so they
    // unregister from the shared outside-click registry in dropdown.js.
    _defs.forEach(d => d.dd?.destroy());
    container.replaceChildren();

    const tplGroup = _tpl.group;

    _defs.forEach((def, idx) => {
        const isTypeIf = def.field === 'type_if';
        const fieldMeta = _fieldDef(def.field);
        const label = t(fieldMeta?.labelKey ?? def.field);

        // Clone template; apply i18n (handles the toggle label data-i18n attribute).
        const panel = tplGroup.content.cloneNode(true).querySelector('.filter-group');
        applyI18n(panel);

        // Cache element references in one pass.
        const el = {
            panel,
            title: panel.querySelector('.fg-title'),
            removeBtn: panel.querySelector('.fg-remove'),
            tags: panel.querySelector('.fg-tags'),
            comboInput: panel.querySelector('.fg-combo-input'),
            comboArrow: panel.querySelector('.fg-combo-arrow'),
            input: panel.querySelector('.fg-search'),
            dropdown: panel.querySelector('.fg-dropdown'),
            list: panel.querySelector('.fg-dropdown-inner'),
            toggleRow: panel.querySelector('.supported-only-row'),
            toggleChk: panel.querySelector('.chk-mapped-only'),
            toggleTrack: panel.querySelector('.toggle-track'),
        };
        def.el = el;

        el.title.textContent = label;

        if (isTypeIf) {
            el.toggleRow.classList.remove('is-hidden');
            el.toggleChk.checked = _mappedOnly;
            el.toggleTrack.classList.toggle('checked', _mappedOnly);
        }

        // For idreseau (minSearch > 0): hide the dropdown arrow.
        // The input is used as a free-text search; the dropdown shows matching
        // values once the minimum length is reached.
        // Tags are hidden until a value is explicitly confirmed (Enter / click).
        if (fieldMeta?.minSearch > 0) {
            el.comboArrow.classList.add('is-hidden');
            if (!_confirmedFilters.has(def.field)) {
                el.tags.classList.add('is-hidden');
                // Restore partial search text if the user was mid-search.
                el.input.value = def.search;
            }
            // If confirmed, _refreshTags() below will un-hide tags and populate the pill.
        }

        container.appendChild(panel);

        // ---- Create the Dropdown controller for this panel ----
        // Dropdown handles: ARIA, outside-click, list keyboard navigation,
        // and focus helpers (focusItem / focusInput).
        // Everything filter-specific (input events, pill logic, toggle) stays here.
        // activate — shared handler for both keyboard (Dropdown._onListKey) and
        // mouse (item mousedown below).  Pure state change; focus is managed
        // by each call site using queueMicrotask (see below).
        const activate = fieldMeta?.minSearch > 0
            ? (val) => _addExact(def.field, val, idx, /* keepDropdown= */ true)
            : (val) => _toggle(def.field, val);

        def.dd = new Dropdown({
            panel: el.panel,
            dropdownEl: el.dropdown,
            triggerEl: el.comboInput,
            listEl: el.list,
            input: el.input,
            itemSel: '.fg-drop-item',
            onActivate: activate,
            // idreseau (minSearch) is a search-and-add pattern: after keyboard
            // activation the user expects to keep typing, so focus goes back to
            // the input rather than staying on the selected item.
            activationFocusMode: fieldMeta?.minSearch > 0 ? 'input' : 'item',
        });

        // --- Event listeners ---

        el.removeBtn.addEventListener('click', () => {
            def.dd.destroy();
            delete _activeFilters[def.field];
            _confirmedFilters.delete(def.field);
            _defs.splice(idx, 1);
            _buildPanels();
            _onChange?.();
        });

        // Pill remove buttons — keyboard (Space/Enter) and mouse.
        el.tags.addEventListener('keydown', e => {
            if ((e.key === ' ' || e.key === 'Enter') && e.target.classList.contains('fg-tag-remove')) {
                e.preventDefault();
                const val = e.target.closest('.fg-tag')?.querySelector('.fg-tag-label')?.textContent;
                if (!val) return;
                _toggle(def.field, val);
                // If all pills removed for a minSearch field, reset confirmation state.
                if (fieldMeta?.minSearch > 0 && !_activeFilters[def.field]?.size) {
                    _confirmedFilters.delete(def.field);
                    if (def.el?.tags) def.el.tags.classList.add('is-hidden');
                }
                // The pill button that held focus has been detached by _refreshTags()
                // → replaceChildren() moved focus to <body>.  Restore it to the input.
                queueMicrotask(() => def.dd?.focusInput());
            }
        });

        el.input.addEventListener('input', () => {
            def.search = el.input.value.toUpperCase();
            _refreshDropdown(idx);
            if (fieldMeta?.minSearch > 0) {
                // Typing updates the dropdown display only.
                // Confirmed pills and active filter are untouched while typing.
                if (def.search.length >= fieldMeta.minSearch) _openDropdown(idx);
                else _closeDropdown(idx);
            }
        });

        // --- Keyboard: editbox (filter-specific handlers) ---
        el.input.addEventListener('keydown', e => {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                _openDropdown(idx);
                def.dd.focusFirst();
            } else if (e.key === 'Enter') {
                e.preventDefault();
                _selectFirst(idx);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                _closeDropdown(idx);
            } else if (e.key === 'Tab') {
                _closeDropdown(idx);
            }
        });
        el.input.addEventListener('focus', () => {
            // Skip programmatic focus calls (focusInput() after Escape, ArrowUp,
            // pill remove, _selectFirst…).  Without this guard every
            // dd.focusInput() call would immediately reopen the dropdown it just
            // closed.  The flag is set by Dropdown.focusInput() and reset via
            // queueMicrotask once the browser has processed the focus event.
            if (def.dd._programmaticFocus) return;
            _openDropdown(idx);
        });

        // Combo arrow click: toggle open/close, restore input focus.
        el.comboInput.addEventListener('mousedown', e => {
            if (e.target === el.input) return;
            e.preventDefault();
            def.dd.isOpen() ? _closeDropdown(idx) : (_openDropdown(idx), def.dd.focusInput());
        });

        if (isTypeIf) {
            el.toggleChk.addEventListener('change', () => {
                _mappedOnly = el.toggleChk.checked;
                el.toggleTrack.classList.toggle('checked', _mappedOnly);
                delete _activeFilters['type_if'];
                _defs.forEach(d => { if (d.field === 'type_if') d.search = ''; });
                _buildPanels();
                _onChange?.();
            });
        }

        _refreshTags(idx);
        _refreshDropdown(idx);
    });

    _updateStatusBar();
    _updateAddFilterBtn();
}

/* ===== In-place DOM updates (avoid losing focus) ===== */

function _refreshTags(idx) {
    const def = _defs[idx];
    if (!def?.el) return;
    const { tags } = def.el;

    // minSearch fields only display a tag pill when a value has been explicitly
    // confirmed via Enter or a dropdown click — not during live typing.
    const fieldMeta = _fieldDef(def.field);
    if (fieldMeta?.minSearch > 0) {
        if (!_confirmedFilters.has(def.field)) return;
        tags.classList.remove('is-hidden');   // ensure container is visible
    }

    const sel = _activeFilters[def.field] || new Set();

    tags.replaceChildren();
    for (const v of sel) {
        const pill = _tpl.tag.content.cloneNode(true).querySelector('.fg-tag');
        pill.querySelector('.fg-tag-label').textContent = v;
        const removeBtn = pill.querySelector('.fg-tag-remove');
        removeBtn.addEventListener('mousedown', e => {
            e.preventDefault();
            _toggle(def.field, v);
            // If all pills removed for a minSearch field, reset confirmation state.
            if (fieldMeta?.minSearch > 0 && !_activeFilters[def.field]?.size) {
                _confirmedFilters.delete(def.field);
                if (def.el?.tags) def.el.tags.classList.add('is-hidden');
            }
            // replaceChildren() in _refreshTags() may have detached the focused
            // element.  Restore focus to the input via microtask.
            queueMicrotask(() => def.dd?.focusInput());
        });
        tags.appendChild(pill);
    }
}

function _refreshDropdown(idx) {
    const def = _defs[idx];
    if (!def?.el) return;
    const { input, list } = def.el;

    const fieldMeta = _fieldDef(def.field);

    // activate MUST be defined here (not captured from _buildPanels) because
    // _refreshDropdown is a module-level function with its own lexical scope.
    // Items' mousedown closures capture _refreshDropdown's scope, not the
    // caller's scope — even when the caller is _buildPanels.  Without this
    // local definition every item click after the first rebuild throws a
    // silent ReferenceError and does nothing.
    const activate = fieldMeta?.minSearch > 0
        ? (val) => _addExact(def.field, val, idx, /* keepDropdown= */ true)
        : (val) => _toggle(def.field, val);
    const fromIndex = _indexValues[def.field] || [];
    const fromCounts = [...(_counts[def.field]?.keys() || [])];
    let all = fromIndex.length > 0
        ? [...new Set([...fromIndex, ...fromCounts])]
        : fromCounts;

    const sel = _activeFilters[def.field] || new Set();
    const q = def.search || '';   // already uppercase from input handler
    const isTypeIf = def.field === 'type_if';
    const isMappedOnly = _mappedOnly && isTypeIf;

    if (isMappedOnly) all = all.filter(v => _mappedTypes.has(v));

    // For minSearch fields: show a hint until the threshold is reached.
    const minSearch = fieldMeta?.minSearch || 0;
    if (minSearch > 0 && q.length < minSearch) {
        list.replaceChildren();
        const hint = document.createElement('div');
        hint.className = 'fg-empty';
        hint.textContent = t('filter.idreseau.waiting');
        list.appendChild(hint);
        if (input) input.placeholder = t('filter.idreseau.placeholder');
        return;
    }

    if (input) input.placeholder = t('dropdown.search', all.length);

    const numericSort = def.field === 'code_ligne';
    const filtered = all
        .filter(v => v.includes(q))   // values are uppercase; query is uppercase
        .map(v => ({
            v,
            count: _counts[def.field]?.get(v) || 0,
            mapped: _mappedTypes.has(v),
        }))
        .sort(numericSort
            ? (a, b) =>
                (parseFloat(a.v) || 0) - (parseFloat(b.v) || 0) ||
                a.v.localeCompare(b.v)
            : (a, b) => a.v.localeCompare(b.v)
        );

    // If a list item currently has keyboard focus, save its val so we can
    // restore focus after replaceChildren() inevitably detaches it and moves
    // the browser's focus target to <body>.  This handles both the normal
    // toggle path and background indexSignals() rebuilds.
    const prevFocusedVal = list.contains(document.activeElement)
        ? document.activeElement.dataset?.val ?? null
        : null;

    list.replaceChildren();

    if (!filtered.length) {
        const placeholder = _tpl.noMatch.content.cloneNode(true).querySelector('.fg-empty');
        applyI18n(placeholder);
        list.appendChild(placeholder);
        return;
    }

    filtered.forEach(({ v, count, mapped }, fi) => {
        const active = sel.has(v);
        const showDot = isTypeIf && mapped && !isMappedOnly;

        const item = _tpl.item.content.cloneNode(true).querySelector('.fg-drop-item');
        item.tabIndex = -1;
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', String(active));
        item.classList.toggle('active', active);
        item.classList.toggle('mapped', showDot);
        item.dataset.field = def.field;
        item.dataset.val = v;

        item.querySelector('.fgi-check').classList.toggle('checked', active);
        item.querySelector('.fgi-name').textContent = v;
        item.querySelector('.fgi-count').textContent = count > 0 ? count.toLocaleString() : '';
        item.addEventListener('mousedown', e => {
            e.preventDefault();
            // After activate() the list is rebuilt via replaceChildren().
            // Save the clicked val so the centralised focus-restore block below
            // can refocus the rebuilt item (or the input for minSearch fields).
            // Note: activate() is synchronous and runs _before_ this handler
            // returns, so by the time queueMicrotask fires the new DOM is ready.
            activate(v);
        });
        list.appendChild(item);
    });

    // Focus restoration 
    // replaceChildren() above detached any previously-focused list item,
    // moving the browser's focus target to <body>.  queueMicrotask defers the
    // refocus until AFTER the browser has processed that focus-to-body event —
    // a synchronous .focus() call here would lose the race on Blink / WebKit.
    //
    // Priority (highest → lowest):
    //   • prevFocusedVal — item that had focus before this rebuild
    //   • nothing        — focus was on input or outside the list; leave it alone
    if (prevFocusedVal && def.dd?.isOpen()) {
        queueMicrotask(() => def.dd.focusItem(prevFocusedVal));
    }
}

/**
 * Toggle a value in a minSearch filter (multi-pill support).
 * If the value is already selected, it is deselected; otherwise it is added.
 *
 * keepDropdown — true  : dropdown stays open, focus stays on rebuilt item.
 *                false : dropdown closes, focus returns to editbox.
 *
 * Focus is assigned via queueMicrotask so it runs after the browser has
 * processed the focus-to-body event caused by replaceChildren() inside
 * _refreshDropdown().
 */
function _addExact(field, val, idx, keepDropdown = true) {
    if (!val) return;
    if (!_activeFilters[field]) _activeFilters[field] = new Set();

    const wasActive = _activeFilters[field].has(val);
    if (wasActive) {
        _activeFilters[field].delete(val);
    } else {
        _activeFilters[field].add(val);
    }

    const isEmpty = !_activeFilters[field]?.size;
    if (isEmpty) delete _activeFilters[field];

    const def = _defs[idx];

    if (!wasActive) {
        // Value added — mark field as confirmed so pills are shown.
        _confirmedFilters.add(field);
        if (def?.el?.tags) def.el.tags.classList.remove('is-hidden');
    } else if (isEmpty) {
        // All values removed — reset confirmation state.
        _confirmedFilters.delete(field);
        if (def?.el?.tags) def.el.tags.classList.add('is-hidden');
    }
    // else: still has values — stays confirmed, tags stay visible.

    _refreshTags(idx);
    _refreshDropdown(idx);

    // For idreseau (minSearch / search-and-add pattern), focus always returns
    // to the input so the user can immediately type the next search term.
    // focusItem would leave focus on a list item the user is likely done with.
    if (keepDropdown) {
        queueMicrotask(() => def?.dd?.focusInput());
    } else {
        _closeDropdown(idx);
        queueMicrotask(() => def?.dd?.focusInput());
    }
    _updateStatusBar();
    _onChange?.();
}

function _selectFirst(idx) {
    const def = _defs[idx];
    const fieldMeta = _fieldDef(def?.field);
    const first = def?.el?.list?.querySelector('.fg-drop-item');
    if (!first) return;
    if (fieldMeta?.minSearch > 0) {
        // From editbox Enter: clear input, close dropdown, stay on editbox.
        def.search = '';
        if (def.el?.input) def.el.input.value = '';
        _addExact(def.field, first.dataset.val, idx, /* keepDropdown= */ false);
    } else {
        _toggle(def.field, first.dataset.val);
        // Focus stays in editbox (was already focused when Enter was pressed).
    }
}

function _openDropdown(idx) {
    // Close all other filter dropdowns first.
    _defs.forEach((d, i) => { if (i !== idx) d.dd?.close(); });
    _defs[idx]?.dd?.open();
}

function _closeDropdown(idx) {
    _defs[idx]?.dd?.close();
}

function _closeAll() {
    _defs.forEach(d => d.dd?.close());
}

function _toggle(field, val) {
    if (!_activeFilters[field]) _activeFilters[field] = new Set();
    const wasActive = _activeFilters[field].has(val);
    wasActive ? _activeFilters[field].delete(val) : _activeFilters[field].add(val);
    if (_activeFilters[field].size === 0) delete _activeFilters[field];
    const idx = _defs.findIndex(d => d.field === field);
    if (idx >= 0) {
        const def = _defs[idx];
        // When deselecting, clear the search so the full list is shown, not
        // just the item that was previously filtered to reach this value.
        if (wasActive && def.el?.input) {
            def.search = '';
            def.el.input.value = '';
        }
        _refreshTags(idx);
        _refreshDropdown(idx);
        _openDropdown(idx);
    }
    _updateStatusBar();
    _onChange?.();
}

function _updateStatusBar() {
    if (_elStFilters) _elStFilters.textContent =
        Object.values(_activeFilters).filter(s => s.size > 0).length;
}
