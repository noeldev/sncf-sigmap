/**
 * report-renderer.js - DOM rendering for all validation report sections.
 *
 * Pure presentation layer: no analysis logic, no HTML strings.
 * All structure comes from <template> elements in validate.html.
 * All visible strings come from t() (validate.en-us.json).
 *
 * Responsibilities:
 *   - Stat cards                          (renderStats)
 *   - Conflict table + filter dropdown    (renderConflicts)
 *   - Unmapped types table                (renderUnmapped)
 *   - Spec diff sections                  (renderSpecDiff)
 *   - Lazy Google Maps hrefs
 *   - Group-colored chip left borders      (group-mapping.js)
 *
 * Filter dropdown:
 *   Cloned from tpl-filter-btn-wrap (validate.html).
 *   One item per dupCat with colored dot, plus "All" row.
 *   Items cloned from tpl-filter-cat-item / tpl-filter-all-item.
 *   Filter state encoded in the URL hash.
 *
 * Visibility:
 *   Sections start with HTML `hidden`. _show() removes it + adds .visible.
 *   clearResults() restores both.
 */

import { getMappingEntry, getGroupForCat } from '../signal-types.js';
import { getColorForGroup, getUnsupportedGroup } from '../group-mapping.js';
import { getTypePriority } from '../signal-grouping.js';
import { initCollapsiblePanelsInRoot } from '../collapsible-panel.js';
import { t, translateElement } from '../translation.js';
import { makeSignalCatKey } from '../osm-tags.js';
import { contrastColor } from '../signal-mapping.js';

// ===== Module-level constants =====

const APP_URL = window.location.origin
    + window.location.pathname.replace(/\/[^/]*$/, '');

// ===== Init =====

function _init() {
    initCollapsiblePanelsInRoot(document.getElementById('main'));

    const btn = document.getElementById('btn-toc');
    if (!btn) return;
    btn.addEventListener('click', (e) => {
        e.preventDefault();
        window.scrollTo({ top: 0, behavior: 'instant' });
    });

    // Scroll to a specific conflict row when the page loads with a #row= hash.
    window.addEventListener('load', () => {
        if (!location.hash.startsWith('#row=')) return;
        const rowId = location.hash.slice('#row='.length);
        const el = document.getElementById('conflict-' + rowId);
        if (el) el.scrollIntoView({ block: 'center', behavior: 'instant', });
    });
}

_init();

// ===== Filter state =====

// _excludedFilters: Set<osmCat> — OSM cat keys whose conflict rows are hidden.
let _excludedFilters = new Set();
let _showMechanical = true;   // when false, mechanical rows are hidden
let _conflictTbody = null;
let _conflictCatCounts = new Map(); // Map<osmCat, number>

// Color for a chip: derived from the mapping's group key.
function _catColorFromMapping(mapping) {
    return getColorForGroup(mapping?.group ?? getUnsupportedGroup());
}

// ===== Template references (lazily initialised) =====

let _tplFilterBtnWrap = null;
let _tplFilterCatItem = null;
let _tplFilterAllItem = null;

function _getFilterTemplates() {
    if (!_tplFilterBtnWrap) {
        // Cache the <template> elements, not their .content DocumentFragments.
        // Cloning a cached fragment moves its children out on the first call,
        // leaving it empty for subsequent calls. Calling .content.cloneNode(true)
        // each time ensures the fragment is always read fresh from the element.
        _tplFilterBtnWrap = document.getElementById('tpl-filter-btn-wrap');
        _tplFilterCatItem = document.getElementById('tpl-filter-cat-item');
        _tplFilterAllItem = document.getElementById('tpl-filter-all-item');
    }
}

// ===== Public API =====

export function renderStats(stats) {
    _setText('stat-tiles', stats.tiles.toLocaleString());
    _setText('stat-signals', stats.signals.toLocaleString());
    _setText('stat-locations', stats.locations.toLocaleString());
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
    _showNavLinks();
}

export function renderConflicts(conflicts) {
    const badge = _el('badge-conflicts');
    const content = _el('conflicts-content');
    badge.textContent = conflicts.length;
    _show('section-conflicts');

    if (conflicts.length === 0) {
        badge.className = 'badge badge-blue';
        content.replaceChildren(_noResults(t('message.noConflicts')));
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

    const table = _cloneEl('tpl-table');
    table.className += ' table-conflicts';
    table.appendChild(_buildConflictThead(catCounts));

    const tbody = _cloneEl('tpl-tbody');
    for (const { loc, conflict, rowNum } of rows) {
        const tr = _buildConflictRow(loc, conflict, rowNum);
        tr.dataset.dupCats = conflict.dupCats.join(',');
        tr.dataset.isMech = conflict.isMech ? '1' : '0';
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
        content.replaceChildren(_noResults(t('message.allMapped')));
        return;
    }

    badge.className = 'badge badge-amber';
    const table = _cloneEl('tpl-table');

    const thead = _cloneAndTranslate('tpl-thead-unmapped');
    table.appendChild(thead);

    const tbody = _cloneEl('tpl-tbody');
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
        contentId: 'only-wiki-content',
        badgeId: 'badge-only-wiki',
        items: onlyInWiki,
        emptyMsg: t('message.allImplemented'),
        theadId: 'tpl-thead-spec-wiki',
        rowId: 'tpl-spec-row-wiki',
        emptyBadge: 'badge-blue',
        filledBadge: 'badge-amber',
        fillRow(row, { cat, type }, i) {
            _fill(row, 'row-num', i + 1);
            _fill(row, 'key', makeSignalCatKey(cat));
            _fill(row, 'type', type);
        },
    });

    _renderSpecTable({
        contentId: 'only-code-content',
        badgeId: 'badge-only-code',
        items: [...onlyInCode].sort((a, b) => Number(b.catKnown) - Number(a.catKnown)),
        emptyMsg: t('message.allMatch'),
        theadId: 'tpl-thead-spec-code',
        rowId: 'tpl-spec-row-code',
        emptyBadge: 'badge-blue',
        filledBadge: 'badge-amber',
        fillRow(row, { cat, type, catKnown }, i) {
            _fill(row, 'row-num', i + 1);
            _fill(row, 'key', makeSignalCatKey(cat));
            _fill(row, 'type', type);
            const noteEl = row.querySelector('[data-field="note"]');
            noteEl.textContent = catKnown
                ? t('spec.typeMismatch')
                : t('spec.catAbsent');
            noteEl.className = catKnown ? 'text-amber' : 'dim';
        },
    });

    _renderSpecTable({
        contentId: 'matched-content',
        badgeId: 'badge-matched',
        items: matched,
        emptyMsg: t('message.noMatches'),
        theadId: 'tpl-thead-spec-matched',
        rowId: 'tpl-spec-row-matched',
        emptyBadge: 'badge-blue',
        filledBadge: 'badge-blue',
        fillRow(row, { cat, type }, i) {
            _fill(row, 'row-num', i + 1);
            _fill(row, 'key', makeSignalCatKey(cat));
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

    _showNavLinks(false);

    _excludedFilters.clear();
    _showMechanical = true;
    _conflictTbody = null;
    _conflictCatCounts = new Map();
}

// ===== Private - conflict table =====

function _buildConflictThead(groupCounts) {
    const frag = _cloneAndTranslate('tpl-thead-conflicts');
    const thNodes = frag.querySelector('th.col-nodes');
    if (thNodes && groupCounts.size > 0) {
        thNodes.appendChild(_buildFilterDropdown(groupCounts));
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
    link.textContent = loc.milepost || (loc.lat.toFixed(5) + ',' + loc.lng.toFixed(5));
    link.dataset.lat = loc.lat;
    link.dataset.lng = loc.lng;

    const nodesList = row.querySelector('.nodes-list');
    conflict.nodes.forEach((node, i) =>
        nodesList.appendChild(_buildNodeRow(node, i + 1, conflict.isMech))
    );

    return row;
}

function _buildNodeRow(node, index, isMech) {
    const row = _cloneEl('tpl-node-row');
    _fill(row, 'idx', '#' + index);

    const mechIconEl = row.querySelector('.node-mech-icon svg');
    if (mechIconEl) mechIconEl.classList.toggle('is-hidden', !isMech);
    if (isMech) {
        const mechSpan = row.querySelector('.node-mech-icon');
        if (mechSpan) mechSpan.title = t('tooltip.mechanical');
    }

    const hasDupType = node.feats.some(f => f.p.isDupType);
    const labelEl = row.querySelector('.node-label');
    if (labelEl) {
        labelEl.classList.toggle('node-label--dup-type', hasDupType);
        if (hasDupType) labelEl.title = t('tooltip.duplicate');
    }

    const chips = row.querySelector('.node-chips');
    const sorted = [...node.feats].sort(
        (a, b) => getTypePriority(a.p.signalType) - getTypePriority(b.p.signalType)
    );
    for (const feat of sorted) chips.appendChild(_buildChip(feat));
    return row;
}

function _buildChip(feat) {
    const mapping = getMappingEntry(feat.p.signalType);
    const color = _catColorFromMapping(mapping);
    const chip = _cloneEl(mapping ? 'tpl-chip' : 'tpl-chip-unmap');
    chip.style.borderLeftColor = color;
    _fill(chip, 'sncf-type', feat.p.signalType || '(empty)');
    if (mapping) _fill(chip, 'cat', mapping.cat);

    if (feat.p.networkId) {
        const idEl = chip.querySelector('[data-field="chip-id"]');
        if (idEl) {
            idEl.textContent = feat.p.networkId;
            if (feat.p.isDupId) {
                idEl.classList.add('chip-id--dup');
                idEl.style.setProperty('--chip-id-dup-bg', color);
                idEl.style.setProperty('--chip-id-dup-fg', contrastColor(color));
            }
        }
    }

    if (feat.p.networkId) {
        chip.href = APP_URL + '/?networkId=' + encodeURIComponent(feat.p.networkId);
    } else {
        chip.removeAttribute('href');
        chip.style.pointerEvents = 'none';
    }
    return chip;
}


// ===== Private - filter dropdown =====

/**
 * Aggregate OSM cat counts into a group structure for the filter dropdown.
 * Groups are sorted by total conflict count descending.
 * Cats within each group are sorted alphabetically.
 *
 * @param {Map<string, number>} catCounts
 * @returns {Array<{groupKey, label, color, totalCount, cats: Array<{cat, count}>}>}
 */
function _buildGroupedCats(catCounts) {
    // Aggregate cats into groups.
    const groupMap = new Map();
    for (const [cat, count] of catCounts) {
        const groupKey = getGroupForCat(cat) ?? getUnsupportedGroup();
        if (!groupMap.has(groupKey)) {
            groupMap.set(groupKey, {
                groupKey,
                color: getColorForGroup(groupKey),
                totalCount: 0,
                cats: [],
            });
        }
        const g = groupMap.get(groupKey);
        g.totalCount += count;
        g.cats.push({ cat, count });
    }

    // Sort cats within each group alphabetically, groups by count desc.
    for (const g of groupMap.values()) {
        g.cats.sort((a, b) => a.cat < b.cat ? -1 : a.cat > b.cat ? 1 : 0);
    }
    return [...groupMap.values()].sort((a, b) => b.totalCount - a.totalCount);
}

function _buildFilterDropdown(catCounts) {
    _getFilterTemplates();

    const wrap = _tplFilterBtnWrap.content.cloneNode(true).querySelector('.filter-btn-wrap');
    const btn = wrap.querySelector('.filter-dropdown-btn');
    const menu = wrap.querySelector('.filter-dropdown');

    translateElement(wrap);

    const groups = _buildGroupedCats(catCounts);

    // Shared onChange: syncs menu, button, filters, hash after any state mutation.
    const _onChange = () => {
        _syncMenu(menu, groups);
        _syncBtn(btn);
        _applyFilters();
        _updateHash();
    };

    // "All" row — selects/deselects everything.
    menu.appendChild(_makeAllItem(() => {
        _excludedFilters.clear();
        _showMechanical = true;
        _onChange();
        menu.hidden = true;
        btn.setAttribute('aria-expanded', 'false');
    }));

    // "Mechanical" row — toggles mechanical conflict rows.
    menu.appendChild(_makeMechanicalItem(_onChange));

    // Group rows + their cat children.
    for (const group of groups) {
        menu.appendChild(_makeGroupItem(group, _onChange));
        for (const { cat, count } of group.cats) {
            menu.appendChild(_makeCatItem(cat, count, group.color, _onChange));
        }
    }

    btn.addEventListener('click', e => {
        e.stopPropagation();
        const open = menu.hidden;
        menu.hidden = !open;
        btn.setAttribute('aria-expanded', String(open));
        if (open) _syncMenu(menu, groups);
    });

    const ac = new AbortController();
    document.addEventListener('click', () => {
        if (!menu.hidden) {
            menu.hidden = true;
            btn.setAttribute('aria-expanded', 'false');
        }
    }, { signal: ac.signal });
    menu.addEventListener('click', e => e.stopPropagation());

    new MutationObserver((_, obs) => {
        if (!wrap.isConnected) { ac.abort(); obs.disconnect(); }
    }).observe(document.body, { childList: true, subtree: true });

    return wrap;
}

/** Build the "All" dropdown row. */
function _makeAllItem(onChange) {
    _getFilterTemplates();
    const item = _tplFilterAllItem.content.cloneNode(true).querySelector('.filter-dropdown-item');
    translateElement(item);
    const isSelected = _excludedFilters.size === 0 && _showMechanical;
    item.classList.toggle('is-selected', isSelected);
    const chk = item.querySelector('.filter-item-chk');
    if (chk) { chk.checked = isSelected; chk.dataset.role = 'all'; }
    item.addEventListener('click', e => { e.preventDefault(); onChange(); });
    return item;
}

/** Build the "Mechanical" dropdown row. */
function _makeMechanicalItem(onChange) {
    _getFilterTemplates();
    const item = _tplFilterCatItem.content.cloneNode(true).querySelector('.filter-dropdown-item');
    item.classList.add('item-mechanical');
    item.classList.toggle('is-selected', _showMechanical);
    item.style.setProperty('--item-color', 'var(--text-dim)');
    const chk = item.querySelector('.filter-item-chk');
    if (chk) { chk.checked = _showMechanical; chk.dataset.role = 'mechanical'; }
    const label = item.querySelector('.filter-item-label');
    if (label) {
        label.textContent = t('filter.mechanical');
        // Clone gear icon from template — no SVG construction in JS.
        const tpl = document.getElementById('tpl-filter-mech-icon');
        const gearEl = tpl?.content.cloneNode(true).firstElementChild ?? null;
        if (gearEl) label.after(gearEl);
    }
    item.addEventListener('click', e => {
        e.preventDefault();
        _showMechanical = !_showMechanical;
        onChange();
    });
    return item;
}

/**
 * Build a group header row. Clicking it toggles all cats in the group.
 * The row is indented 0; cat rows are indented via CSS class .item-cat.
 */
function _makeGroupItem(group, onChange) {
    _getFilterTemplates();
    const item = _tplFilterCatItem.content.cloneNode(true).querySelector('.filter-dropdown-item');
    item.classList.add('item-group');
    item.dataset.groupKey = group.groupKey;

    const allExcluded = group.cats.every(({ cat }) => _excludedFilters.has(cat));
    item.classList.toggle('is-selected', !allExcluded);
    item.style.setProperty('--item-color', group.color);

    const chk = item.querySelector('.filter-item-chk');
    if (chk) { chk.checked = !allExcluded; chk.dataset.role = 'group'; chk.dataset.groupKey = group.groupKey; }

    const label = item.querySelector('.filter-item-label');
    if (label) {
        label.textContent = t('group.' + group.groupKey)
            + ' (' + group.totalCount + ')';
    }

    item.addEventListener('click', e => {
        e.preventDefault();
        // Re-compute allExcluded at click time, not at creation time.
        const nowAllExcluded = group.cats.every(({ cat }) => _excludedFilters.has(cat));
        if (nowAllExcluded) {
            group.cats.forEach(({ cat }) => _excludedFilters.delete(cat));
        } else {
            group.cats.forEach(({ cat }) => _excludedFilters.add(cat));
        }
        onChange();
    });
    return item;
}

/** Build an individual OSM cat row, indented under its group. */
function _makeCatItem(cat, count, color, onChange) {
    _getFilterTemplates();
    const item = _tplFilterCatItem.content.cloneNode(true).querySelector('.filter-dropdown-item');
    item.classList.add('item-cat');
    item.classList.toggle('is-selected', !_excludedFilters.has(cat));
    item.style.setProperty('--item-color', color);

    const chk = item.querySelector('.filter-item-chk');
    if (chk) { chk.checked = !_excludedFilters.has(cat); chk.dataset.cat = cat; }

    const label = item.querySelector('.filter-item-label');
    if (label) label.textContent = cat + ' (' + count + ')';

    item.addEventListener('click', e => {
        e.preventDefault();
        if (_excludedFilters.has(cat)) _excludedFilters.delete(cat);
        else _excludedFilters.add(cat);
        onChange();
    });
    return item;
}

/**
 * Sync all dropdown item states from current _excludedFilters / _showMechanical.
 */
function _syncMenu(menu, groups) {
    // All row
    const allItem = menu.querySelector('.item-all');
    const allSelected = _excludedFilters.size === 0 && _showMechanical;
    if (allItem) {
        allItem.classList.toggle('is-selected', allSelected);
        const chk = allItem.querySelector('.filter-item-chk');
        if (chk) chk.checked = allSelected;
    }

    // Mechanical row
    const mechItem = menu.querySelector('.item-mechanical');
    if (mechItem) {
        mechItem.classList.toggle('is-selected', _showMechanical);
        const chk = mechItem.querySelector('.filter-item-chk');
        if (chk) chk.checked = _showMechanical;
    }

    // Group rows
    for (const group of groups) {
        const groupItem = menu.querySelector(`.item-group[data-group-key="${CSS.escape(group.groupKey)}"]`);
        if (groupItem) {
            const allExcluded = group.cats.every(({ cat }) => _excludedFilters.has(cat));
            groupItem.classList.toggle('is-selected', !allExcluded);
            const chk = groupItem.querySelector('.filter-item-chk');
            if (chk) chk.checked = !allExcluded;
        }
    }

    // Cat rows
    for (const group of groups) {
        for (const { cat } of group.cats) {
            const chk = menu.querySelector(`.filter-item-chk[data-cat="${CSS.escape(cat)}"]`);
            if (!chk) continue;
            const selected = !_excludedFilters.has(cat);
            chk.checked = selected;
            const item = chk.closest('.filter-dropdown-item');
            if (item) item.classList.toggle('is-selected', selected);
        }
    }
}

function _syncBtn(btn) {
    btn.classList.toggle('is-active', _excludedFilters.size > 0 || !_showMechanical);
}

function _applyFilters() {
    if (!_conflictTbody) return;
    let visibleIdx = 0;
    for (const tr of _conflictTbody.rows) {
        const rowCats = (tr.dataset.dupCats ?? '').split(',').filter(Boolean);
        const rowIsMech = tr.dataset.isMech === '1';

        // Hide mechanical rows when the mechanical filter is off.
        const hiddenByMech = !_showMechanical && rowIsMech;

        // Hide when ALL conflict cats are individually excluded.
        const hiddenByCat = _excludedFilters.size > 0
            && rowCats.length > 0
            && rowCats.every(cat => _excludedFilters.has(cat));

        const hidden = hiddenByMech || hiddenByCat;
        tr.classList.toggle('filtered-out', hidden);
        if (!hidden) {
            const numEl = tr.querySelector('[data-field="row-num"]');
            if (numEl) numEl.textContent = ++visibleIdx;
        }
    }
}

function _updateHash() {
    // Format: #exclude=main,stop&mech=0 — clean, readable, URLSearchParams-compatible.
    const parts = [];
    if (_excludedFilters.size > 0) parts.push('exclude=' + [..._excludedFilters].join(','));
    if (!_showMechanical) parts.push('mech=0');
    history.replaceState(null, '', parts.length
        ? '#' + parts.join('&')
        : location.pathname + location.search);
}

function _restoreFilterFromHash() {
    if (!location.hash.startsWith('#')) return;
    const params = new URLSearchParams(location.hash.slice(1));
    const excl = params.get('exclude');
    if (excl) _excludedFilters = new Set(excl.split(',').filter(Boolean));
    if (params.get('mech') === '0') _showMechanical = false;
    _applyFilters();
}

// ===== Private — utilities =====

/** @param {string} id @returns {Element|null} */
function _el(id) { return document.getElementById(id); }

/** Set textContent of element with given id. */
function _setText(id, text) {
    const el = _el(id);
    if (el) el.textContent = text;
}

/** Show a result section (unhide + add .visible). */
function _show(id) {
    const el = _el(id);
    if (!el) return;
    el.hidden = false;
    el.classList.add('visible');
}

/** Reveal nav links once results exist. */
function _showNavLinks(show = true) {
    // Toggle only the result section links and their separators.
    // The app link (Signalisation Permanente) is always visible.
    document.querySelectorAll('.header-nav-result, .header-nav-sep-results')
        .forEach(el => { el.hidden = !show; });
    // Show/hide btn-toc along with nav links.
    _el('btn-toc')?.classList.toggle('visible', show);
}

/** Clone a <template> by id and return its root element. */
function _cloneEl(templateId) {
    return document.getElementById(templateId).content.cloneNode(true).firstElementChild;
}

/** Clone a <template>, translate it, and return its DocumentFragment. */
function _cloneAndTranslate(templateId) {
    const frag = document.getElementById(templateId).content.cloneNode(true);
    translateElement(frag);
    return frag;
}

/** Set [data-field] element's textContent inside a cloned template. */
function _fill(root, field, value) {
    const el = root.querySelector(`[data-field="${field}"]`);
    if (el) el.textContent = value;
}

function _renderSpecTable({ contentId, badgeId, items, emptyMsg, theadId, rowId,
    emptyBadge, filledBadge, fillRow }) {
    const content = _el(contentId);
    const badge = _el(badgeId);
    if (!content || !badge) return;

    if (!items.length) {
        // Use the template — no HTML construction in JS.
        const noRes = _cloneEl('tpl-no-results');
        _fill(noRes, 'message', emptyMsg);
        content.replaceChildren(noRes);
        badge.textContent = '0';
        badge.className = `badge ${emptyBadge}`;
        // Close the parent <details> when empty — nothing useful to show.
        const details = content.closest('details');
        if (details) details.open = false;
        return;
    }

    badge.textContent = items.length;
    badge.className = `badge ${filledBadge}`;

    const table = _cloneEl('tpl-table');
    table.className += ' spec-table';
    table.appendChild(_cloneAndTranslate(theadId));

    const tbody = _cloneEl('tpl-tbody');
    items.forEach((item, i) => {
        const row = _cloneEl(rowId);
        fillRow(row, item, i);
        tbody.appendChild(row);
    });

    table.appendChild(tbody);
    content.replaceChildren(table);
}

function _registerGoogleMapsDelegate(root) {
    root.querySelectorAll('a[data-lat][data-lng]').forEach(a => {
        a.href = `https://www.google.com/maps?q=${a.dataset.lat},${a.dataset.lng}`;
    });
}
