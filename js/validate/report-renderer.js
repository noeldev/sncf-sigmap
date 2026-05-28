/**
 * report-renderer.js - DOM rendering for all validation report sections.
 *
 * Pure presentation layer: no analysis logic, no HTML strings.
 * All structure comes from <template> elements in validate.html.
 *
 * Responsibilities:
 *   - Stat cards                          (renderStats)
 *   - Conflict table + filter dropdown    (renderConflicts)
 *   - Unmapped types table                (renderUnmapped)
 *   - Spec diff sections                  (renderSpecDiff)
 *   - Lazy Google Maps hrefs
 *   - Category-colored chip left borders  (cat-mapping.js)
 *
 * Filter dropdown:
 *   Opens from a "Filters" button appended to the Nodes column header.
 *   Contains one checkbox per dupCat plus an "All" toggle at the top,
 *   matching the visual style of the application's type_if filter.
 *   State is local to this module; filter is encoded in the URL hash.
 *
 * Visibility:
 *   Sections and stat containers start with the HTML `hidden` attribute.
 *   _show() removes `hidden` (browser-native, no CSS dependency) and also
 *   adds the `.visible` class so CSS rules can hook into the visible state
 *   (transitions, layout adjustments, etc.).
 *   clearResults() restores both: sets `hidden` and removes `.visible`.
 *
 * Public API:
 *   renderStats(stats)
 *   renderConflicts(conflicts)
 *   renderUnmapped(unmappedTypes)
 *   renderSpecDiff(diffResult)
 *   clearResults()
 *   hideProgress()
 */

import { SIGNAL_MAPPING } from '../signal-types.js';
import { getColorForCategory } from '../cat-mapping.js';
import { getTypePriority } from '../signal-grouping.js';
import { initCollapsiblePanelsInRoot } from '../collapsible-panel.js';

// Derive the main app root URL from the current page location.
// Works both at the root (localhost/) and on a subpath (/sncf-sigmap/).
const APP_URL = window.location.origin
    + window.location.pathname.replace(/\/[^/]*$/, '');

// ===== Init =====

initCollapsiblePanelsInRoot(document.getElementById('main'));
document.getElementById('btn-toc')?.addEventListener('click', () => {
    document.querySelector('.page-header')?.scrollIntoView({ behavior: 'instant' });
});

// ===== Filter state =====
// _excludedFilters: EXCLUDED categories (empty = show all).
// Excel-like semantics: unchecking a category excludes it from the view.
// Clicking All clears exclusions (all rows shown, menu closes).

let _excludedFilters = new Set();   // cats to HIDE
let _conflictTbody = null;
let _conflictCatCounts = new Map();  // catCounts retained for renumbering

// ===== Category color cache =====

const _catColorCache = new Map();

function _catColor(cat) {
    if (!cat) return getColorForCategory('unsupported');
    if (!_catColorCache.has(cat)) {
        let color = getColorForCategory('unsupported');
        for (const def of Object.values(SIGNAL_MAPPING)) {
            if (def.cat === cat) { color = getColorForCategory(def.group); break; }
        }
        _catColorCache.set(cat, color);
    }
    return _catColorCache.get(cat);
}

// ===== Public API =====

export function renderStats(stats) {
    _setText('stat-tiles', stats.tiles.toLocaleString());
    _setText('stat-signals', stats.signals.toLocaleString());
    _setText('stat-locations', stats.locations.toLocaleString());

    // Show conflict locations count only (one location can produce multiple
    // direction+placement rows, but the location count is what matters for OSM work).
    _setText('stat-conflicts', stats.conflictLocations.toLocaleString());
    _setText('stat-unmapped', stats.unmappedTypes.toLocaleString());

    if (stats.wikiPairs !== undefined) {
        _setText('stat-wiki-pairs', stats.wikiPairs.toLocaleString());
        _setText('stat-matched', stats.matched.toLocaleString());
        _setText('stat-only-wiki', stats.onlyInWiki.toLocaleString());
        _setText('stat-only-code', stats.onlyInCode.toLocaleString());
        _show('stats-spec-row');
    }

    _show('stats-grid');
    _el('btn-toc').classList.add('visible');
}

export function hideProgress() {
    const l = _el('progress-label');
    if (l) l.textContent = '';
}

export function renderConflicts(conflicts) {
    const badge = _el('badge-conflicts');
    const content = _el('conflicts-content');
    badge.textContent = conflicts.length;
    _show('section-conflicts');

    if (conflicts.length === 0) {
        badge.className = 'badge badge-blue';
        content.replaceChildren(_noResults('No co-location conflicts detected.'));
        return;
    }

    badge.className = 'badge badge-red';

    const rows = [];
    for (const loc of conflicts) {
        for (const conflict of loc.conflicts) {
            rows.push({ loc, conflict, rowNum: rows.length + 1 });
        }
    }

    const catCounts = new Map();
    for (const { conflict } of rows) {
        for (const cat of conflict.dupCats) {
            catCounts.set(cat, (catCounts.get(cat) ?? 0) + 1);
        }
    }

    const table = document.createElement('table');
    table.className = 'data-table table-conflicts';
    table.appendChild(_buildConflictThead(catCounts));

    const tbody = document.createElement('tbody');
    for (const { loc, conflict, rowNum } of rows) {
        const tr = _buildConflictRow(loc, conflict, rowNum);
        tr.dataset.dupCats = conflict.dupCats.join(',');
        tr.id = `conflict-${rowNum}`;
        tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    content.replaceChildren(table);
    _conflictTbody = tbody;
    _conflictCatCounts = catCounts;

    _registerGoogleMapsDelegate(content);
    _restoreFilterFromHash();
}

export function renderUnmapped(unmappedTypes) {
    const badge = _el('badge-unmapped');
    const content = _el('unmapped-content');
    badge.textContent = unmappedTypes.size;
    _show('section-unmapped');

    if (unmappedTypes.size === 0) {
        badge.className = 'badge badge-blue';
        content.replaceChildren(_noResults('All signal types are mapped in signal-types.js.'));
        return;
    }

    badge.className = 'badge badge-amber';
    const table = document.createElement('table');
    table.className = 'data-table';
    table.appendChild(_clone('tpl-thead-unmapped'));

    const tbody = document.createElement('tbody');
    [...unmappedTypes.entries()]
        .sort((a, b) => b[1].count - a[1].count)
        .forEach(([type, info], i) => {
            const row = _cloneEl('tpl-unmapped-row');
            const ids = [...info.networkIds].slice(0, 5);
            _fill(row, 'row-num', i + 1);
            _fill(row, 'type', type || '(empty)');
            _fill(row, 'count', info.count.toLocaleString());
            _fill(row, 'ids', ids.join(', '));
            _fill(row, 'overflow', info.networkIds.size > ids.length
                ? ` +${info.networkIds.size - ids.length} more` : '');
            tbody.appendChild(row);
        });

    table.appendChild(tbody);
    content.replaceChildren(table);
}

export function renderSpecDiff({ matched, onlyInWiki, onlyInCode }) {
    _show('section-spec');

    _renderSpecTable({
        contentId: 'only-wiki-content', badgeId: 'badge-only-wiki',
        items: onlyInWiki,
        emptyMsg: 'All wiki-defined OSM types are implemented in signal-types.js.',
        theadId: 'tpl-thead-spec-wiki', rowId: 'tpl-spec-row-wiki',
        emptyBadge: 'badge-blue', filledBadge: 'badge-amber',
        fillRow(row, { cat, type }, i) {
            _fill(row, 'row-num', i + 1);
            _fill(row, 'key', `railway:signal:${cat}`);
            _fill(row, 'type', type);
        },
    });

    _renderSpecTable({
        contentId: 'only-code-content', badgeId: 'badge-only-code',
        items: [...onlyInCode].sort((a, b) => Number(b.catKnown) - Number(a.catKnown)),
        emptyMsg: 'All signal-types.js OSM types match the wiki spec.',
        theadId: 'tpl-thead-spec-code', rowId: 'tpl-spec-row-code',
        emptyBadge: 'badge-blue', filledBadge: 'badge-amber',
        fillRow(row, { cat, type, catKnown }, i) {
            _fill(row, 'row-num', i + 1);
            _fill(row, 'key', `railway:signal:${cat}`);
            _fill(row, 'type', type);
            const noteEl = row.querySelector('[data-field="note"]');
            noteEl.textContent = catKnown
                ? 'type mismatch - cat known in wiki with different value'
                : 'cat absent from wiki - extension or undocumented';
            noteEl.className = catKnown ? 'text-amber' : 'dim';
        },
    });

    _renderSpecTable({
        contentId: 'matched-content', badgeId: 'badge-matched',
        items: matched, emptyMsg: 'No matches found.',
        theadId: 'tpl-thead-spec-matched', rowId: 'tpl-spec-row-matched',
        emptyBadge: 'badge-blue', filledBadge: 'badge-blue',
        fillRow(row, { cat, type }, i) {
            _fill(row, 'row-num', i + 1);
            _fill(row, 'key', `railway:signal:${cat}`);
            _fill(row, 'type', type);
        },
    });
}

export function clearResults() {
    const sectionIds = ['stats-grid', 'stats-spec-row',
        'section-conflicts', 'section-unmapped', 'section-spec'];

    for (const id of sectionIds) {
        const el = _el(id);
        if (!el) continue;
        el.hidden = true;
        el.classList.remove('visible');
    }

    ['stat-tiles', 'stat-signals', 'stat-locations', 'stat-conflicts', 'stat-unmapped',
        'stat-wiki-pairs', 'stat-matched', 'stat-only-wiki', 'stat-only-code']
        .forEach(id => _setText(id, '-'));

    _el('btn-toc').classList.remove('visible');
    _excludedFilters.clear();
    _conflictTbody = null;
    _conflictCatCounts = new Map();
}

// ===== Private - conflict table =====

function _buildConflictThead(catCounts) {
    const frag = _clone('tpl-thead-conflicts');
    const thNodes = frag.querySelector('th.col-nodes');
    if (thNodes && catCounts.size > 0) {
        thNodes.appendChild(_buildFilterDropdown(catCounts));
    }
    return frag;
}

function _buildConflictRow(loc, conflict, rowNum) {
    const row = _cloneEl('tpl-conflict-row');
    _fill(row, 'row-num', rowNum);
    _fill(row, 'track-code', loc.trackCode || '-');
    _fill(row, 'direction', conflict.direction);
    _fill(row, 'placement', conflict.placement);

    const link = row.querySelector('a.gmaps-link');
    link.textContent = loc.milepost || `${loc.lat.toFixed(5)},${loc.lng.toFixed(5)}`;
    link.dataset.lat = loc.lat;
    link.dataset.lng = loc.lng;

    const nodesList = row.querySelector('.nodes-list');
    conflict.nodes.forEach((node, i) =>
        nodesList.appendChild(_buildNodeRow(node, i + 1))
    );

    return row;
}

function _buildNodeRow(node, index) {
    const row = _cloneEl('tpl-node-row');
    _fill(row, 'idx', `#${index}`);
    const chips = row.querySelector('.node-chips');
    // Sort feats by SIGNAL_MAPPING priority so main signals (Carre) appear before
    // speed limit signals, matching the application's display order.
    const sorted = [...node.feats].sort(
        (a, b) => getTypePriority(a.p.signalType) - getTypePriority(b.p.signalType)
    );
    for (const feat of sorted) chips.appendChild(_buildChip(feat));
    return row;
}

function _buildChip(feat) {
    const mapping = SIGNAL_MAPPING[feat.p.signalType];
    const chip = _cloneEl(mapping ? 'tpl-chip' : 'tpl-chip-unmap');
    chip.style.borderLeftColor = _catColor(mapping?.cat);
    _fill(chip, 'sncf-type', feat.p.signalType || '(empty)');
    if (mapping) _fill(chip, 'cat', mapping.cat);
    if (feat.p.networkId) _fill(chip, 'chip-id', feat.p.networkId);

    if (feat.p.networkId) {
        chip.href = `${APP_URL}/?networkId=${encodeURIComponent(feat.p.networkId)}`;
    } else {
        chip.removeAttribute('href');
        chip.style.pointerEvents = 'none';
    }
    return chip;
}

// ===== Private - filter dropdown =====

function _buildFilterDropdown(catCounts) {
    const wrap = document.createElement('span');
    wrap.className = 'filter-btn-wrap';

    const btn = document.createElement('button');
    btn.className = 'filter-dropdown-btn';
    btn.type = 'button';
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');

    // Button label + chevron icon.
    btn.appendChild(document.createTextNode('Filter\u00a0'));
    const chevron = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    chevron.setAttribute('width', '10'); chevron.setAttribute('height', '10');
    chevron.setAttribute('aria-hidden', 'true');
    chevron.classList.add('filter-dropdown-chevron');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#icon-chevron');
    chevron.appendChild(use);
    btn.appendChild(chevron);

    const menu = document.createElement('div');
    menu.className = 'filter-dropdown';
    menu.hidden = true;
    menu.setAttribute('role', 'listbox');
    menu.setAttribute('aria-multiselectable', 'true');

    // "All" row: clear all exclusions (show everything), close menu.
    menu.appendChild(_makeCheckItem('All', true, () => {
        _excludedFilters.clear();
        _syncMenu(menu, catCounts);
        _syncBtn(btn);
        _applyFilters();
        _updateHash();
        menu.hidden = true;
        btn.setAttribute('aria-expanded', 'false');
    }, '', 'item-all'));

    // Per-category rows sorted by count desc.
    // Clicking a checked cat EXCLUDES it (hides those rows).
    // Clicking an excluded cat RE-INCLUDES it (shows those rows).
    // Menu stays open for multi-selection; close via All or click outside.
    for (const [cat, count] of [...catCounts.entries()].sort((a, b) => b[1] - a[1])) {
        menu.appendChild(_makeCheckItem(`${cat}  (${count})`, false, () => {
            if (_excludedFilters.has(cat)) _excludedFilters.delete(cat);
            else _excludedFilters.add(cat);
            _syncMenu(menu, catCounts);
            _syncBtn(btn);
            _applyFilters();
            _updateHash();
        }, cat));
    }

    btn.addEventListener('click', e => {
        e.stopPropagation();
        const open = menu.hidden;
        menu.hidden = !open;
        btn.setAttribute('aria-expanded', String(open));
        if (open) _syncMenu(menu, catCounts);
    });

    // Close on outside click using bubbling (not capture) so menu's own
    // stopPropagation fires first and prevents immediate self-close.
    // AbortController removes the listener when the menu is removed from DOM.
    const ac = new AbortController();
    document.addEventListener('click', () => {
        if (!menu.hidden) {
            menu.hidden = true;
            btn.setAttribute('aria-expanded', 'false');
        }
    }, { signal: ac.signal });
    menu.addEventListener('click', e => e.stopPropagation());

    // Clean up the document listener if the wrap element is ever removed.
    new MutationObserver((_, obs) => {
        if (!wrap.isConnected) { ac.abort(); obs.disconnect(); }
    }).observe(document.body, { childList: true, subtree: true });

    wrap.appendChild(btn);
    wrap.appendChild(menu);
    return wrap;
}

function _makeCheckItem(label, checked, onChange, cat = '', extraClass = '') {
    const item = document.createElement('label');
    item.className = 'filter-dropdown-item' + (extraClass ? ' ' + extraClass : '');
    if (cat) item.style.borderLeftColor = _catColor(cat);

    const chk = document.createElement('input');
    chk.type = 'checkbox'; chk.checked = checked; chk.dataset.cat = cat;
    chk.addEventListener('change', onChange);

    item.appendChild(chk);
    item.appendChild(document.createTextNode('\u00a0' + label));
    return item;
}

// "All" checked when no exclusions active (all rows shown).
// Individual cat checkbox checked when that cat is NOT excluded.
function _syncMenu(menu, catCounts) {
    const allChk = menu.querySelector('[data-cat=""]');
    if (allChk) allChk.checked = _excludedFilters.size === 0;
    for (const [cat] of catCounts) {
        const chk = menu.querySelector(`[data-cat="${CSS.escape(cat)}"]`);
        if (chk) chk.checked = !_excludedFilters.has(cat);
    }
}

function _syncBtn(btn) {
    btn.classList.toggle('is-active', _excludedFilters.size > 0);
}

function _applyFilters() {
    if (!_conflictTbody) return;
    let visibleIdx = 0;
    for (const tr of _conflictTbody.rows) {
        const rowCats = (tr.dataset.dupCats ?? '').split(',').filter(Boolean);
        // Hide row when ALL its dupCats are in the excluded set.
        const hidden = _excludedFilters.size > 0
            && rowCats.length > 0
            && rowCats.every(cat => _excludedFilters.has(cat));
        tr.classList.toggle('filtered-out', hidden);
        // Renumber visible rows sequentially.
        if (!hidden) {
            const numEl = tr.querySelector('[data-field="row-num"]');
            if (numEl) numEl.textContent = ++visibleIdx;
        }
    }
}

function _updateHash() {
    const cats = [..._excludedFilters].join(',');
    history.replaceState(null, '', cats ? `#filter=excl:${encodeURIComponent(cats)}` : '#');
}

function _restoreFilterFromHash() {
    const match = location.hash.match(/^#filter=excl:(.+)$/);
    if (!match) return;
    _excludedFilters = new Set(decodeURIComponent(match[1]).split(',').filter(Boolean));
    _applyFilters();
}

// ===== Private - spec diff =====

function _renderSpecTable({ contentId, badgeId, items, emptyMsg,
    theadId, rowId, emptyBadge, filledBadge, fillRow }) {
    const badge = _el(badgeId), content = _el(contentId);
    badge.textContent = items.length;

    if (items.length === 0) {
        badge.className = `badge ${emptyBadge}`;
        content.replaceChildren(_noResults(emptyMsg));
        return;
    }

    badge.className = `badge ${filledBadge}`;
    const table = document.createElement('table');
    table.className = 'data-table spec-table';
    table.appendChild(_clone(theadId));

    const tbody = document.createElement('tbody');
    items.forEach((item, i) => { const row = _cloneEl(rowId); fillRow(row, item, i); tbody.appendChild(row); });
    table.appendChild(tbody);
    content.replaceChildren(table);
}

// ===== Private - lazy Google Maps links =====

function _registerGoogleMapsDelegate(container) {
    container.addEventListener('pointerenter', e => {
        const link = e.target.closest('a.gmaps-link[data-lat][data-lng]');
        if (!link || link.dataset.hrefReady) return;
        const { lat, lng } = link.dataset;
        link.href = `https://www.google.com/maps?q=${lat},${lng}&z=18`;
        link.dataset.hrefReady = '1';
    }, true);
}

// ===== Private - template helpers =====

const _cloneEl = id => document.getElementById(id).content.cloneNode(true).firstElementChild;
const _clone = id => document.getElementById(id).content.cloneNode(true);

function _fill(root, field, value) {
    const sel = `[data-field="${field}"]`;
    const el = root.matches?.(sel) ? root : root.querySelector(sel);
    if (el) el.textContent = value;
}

function _noResults(msg) { const e = _cloneEl('tpl-no-results'); e.textContent = `OK - ${msg}`; return e; }
function _el(id) { return document.getElementById(id); }
function _setText(id, v) { const e = _el(id); if (e) e.textContent = v; }

/**
 * Show a section or container by removing the `hidden` attribute and adding
 * the `.visible` CSS class. Using the native `hidden` attribute ensures the
 * element is invisible on page load regardless of CSS, and becomes visible
 * without relying on a specific CSS rule for `.visible`.
 */
function _show(id) {
    const el = _el(id);
    if (!el) return;
    el.hidden = false;
    el.classList.add('visible');
}

window.addEventListener('load', () => {
    const match = location.hash.match(/row=(\d+)/);
    if (!match) return;
    const el = document.getElementById(`conflict-${match[1]}`);
    if (el) { el.scrollIntoView({ behavior: 'instant', block: 'center' }); }
});
